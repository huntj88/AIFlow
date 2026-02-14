/**
 * Built-in action: copilot-cli-prompt
 *
 * Runs `copilot chat` with runtime add-dir policy, supports new+resume
 * conversation modes, performs strict JSON capture/recovery, and shapes
 * success/exec-error transitions.
 *
 * @module
 */

import { Effect } from 'effect';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';

import type { ActionFunction, CliExecResult, TransitionResult } from '../types.js';
import {
  type CopilotActionResult,
  type CopilotCliPromptInput,
  parseAndValidateCopilotActionResult,
  parseCopilotCliPromptInput,
} from './copilot-cli-prompt-contracts.js';
import {
  buildFirstTurnPrompt,
  buildJsonRepairPrompt,
  buildStrictJsonResultPrompt,
} from './copilot-cli-prompts.js';

const MAX_FORMAT_RETRIES = 2;
const MAIN_PROMPT_MODEL = 'gpt-5.3-codex';
const RESULT_PROMPT_MODEL = 'gpt-5.1-codex-mini';

interface FilePathWarning {
  readonly index: number;
  readonly workspace: 'workspace' | 'artifacts';
  readonly path: string;
  readonly message: string;
}

interface NormalizedFilePath {
  readonly workspace: 'workspace' | 'artifacts';
  readonly path: string;
  readonly resolvedPath: string;
}

const looksInsideRoot = (root: string, resolvedPath: string): boolean => {
  const rel = path.relative(path.resolve(root), path.resolve(resolvedPath));
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};

const resolveAsAbsolute = (
  resolver: { readonly resolve: (p: string) => string },
  p: string,
): string => (path.isAbsolute(p) ? path.resolve(p) : resolver.resolve(p));

const extractConversationId = (output: string): string | undefined => {
  const patterns = [
    /conversation(?:[\s_-]?id)?\s*[:=]\s*([A-Za-z0-9._-]+)/i,
    /"conversationId"\s*:\s*"([^"]+)"/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(output);
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
};

const buildCopilotArgs = (input: {
  readonly prompt: string;
  readonly model: string;
  readonly allowDirs: readonly string[];
  readonly contextPaths: readonly string[];
  readonly conversationId?: string;
}): string[] => {
  const args: string[] = ['--yolo'];

  if (input.conversationId) {
    args.push('--resume', input.conversationId);
  }

  args.push('--prompt', input.prompt);
  args.push('--model', input.model);

  for (const allowDir of input.allowDirs) {
    args.push('--add-dir', allowDir);
  }

  for (const contextPath of input.contextPaths) {
    args.push('--context', contextPath);
  }

  return args;
};

const toExecError = (
  input: CopilotCliPromptInput,
  data: Record<string, unknown>,
): TransitionResult => ({
  nextState: input.execErrorState,
  data,
});

const normalizeFilePaths = (
  result: CopilotActionResult,
  ctx: Parameters<ActionFunction>[0],
): {
  readonly normalizedFilePaths: readonly NormalizedFilePath[];
  readonly filePathWarnings: readonly FilePathWarning[];
} => {
  const normalizedFilePaths: NormalizedFilePath[] = [];
  const filePathWarnings: FilePathWarning[] = [];

  result.filePaths.forEach((fp, index) => {
    const root = fp.workspace === 'workspace' ? ctx.workspace.root : ctx.artifactsWorkspace.root;
    const resolvedPath =
      fp.workspace === 'workspace'
        ? resolveAsAbsolute(ctx.workspace, fp.path)
        : resolveAsAbsolute(ctx.artifactsWorkspace, fp.path);

    if (!looksInsideRoot(root, resolvedPath)) {
      filePathWarnings.push({
        index,
        workspace: fp.workspace,
        path: fp.path,
        message: 'path resolves outside workspace root',
      });
      return;
    }

    normalizedFilePaths.push({
      workspace: fp.workspace,
      path: fp.path,
      resolvedPath,
    });
  });

  return {
    normalizedFilePaths,
    filePathWarnings,
  };
};

export const copilotCliPromptAction: ActionFunction = (ctx) =>
  Effect.gen(function* () {
    const parsedInput = parseCopilotCliPromptInput(ctx.stateData);

    if (!parsedInput.ok) {
      const stateDataRecord =
        ctx.stateData != null && typeof ctx.stateData === 'object'
          ? (ctx.stateData as Record<string, unknown>)
          : {};

      const fallbackErrorState =
        typeof stateDataRecord.execErrorState === 'string' &&
        stateDataRecord.execErrorState.length > 0
          ? stateDataRecord.execErrorState
          : 'error';

      return {
        nextState: fallbackErrorState,
        data: {
          reason: 'invalid_action_input',
          validationErrors: parsedInput.errors,
        },
      };
    }

    const input = parsedInput.value;
    const commandOutputFiles: CliExecResult['transcript'][] = [];
    const commandOutputWarnings: NonNullable<CliExecResult['captureWarnings']>[number][] = [];

    const allowDirs = [
      ...inputFromRuntimeDirs(ctx.runtimeOptions.cliDirectoryPolicy.workspaceDirs, (p) =>
        resolveAsAbsolute(ctx.workspace, p),
      ),
      ctx.artifactsWorkspace.root,
    ];

    const contextPaths = (input.contextFilePaths ?? []).map((entry) =>
      entry.workspace === 'workspace'
        ? resolveAsAbsolute(ctx.workspace, entry.path)
        : resolveAsAbsolute(ctx.artifactsWorkspace, entry.path),
    );

    const conversationId = input.conversationId ?? randomUUID();

    const initialPrompt = input.conversationId
      ? input.prompt
      : buildFirstTurnPrompt({
          workspaceRoot: ctx.workspace.root,
          artifactsWorkspaceRoot: ctx.artifactsWorkspace.root,
          stateName: ctx.stateName,
          machineInstanceId: ctx.machineInstanceId,
          userPrompt: input.prompt,
        });

    const mainExec = yield* ctx.cli.exec({
      command: 'copilot',
      args: buildCopilotArgs({
        prompt: initialPrompt,
        model: MAIN_PROMPT_MODEL,
        allowDirs,
        contextPaths,
        conversationId,
      }),
    });

    if (mainExec.transcript) {
      commandOutputFiles.push(mainExec.transcript);
    }
    if (mainExec.captureWarnings && mainExec.captureWarnings.length > 0) {
      commandOutputWarnings.push(...mainExec.captureWarnings);
      yield* ctx.logger.warn('CLI transcript capture warning', {
        command: 'copilot',
        warnings: mainExec.captureWarnings,
      });
    }

    if (mainExec.exitCode !== 0) {
      return toExecError(input, {
        reason: 'copilot_exec_failed',
        exitCode: mainExec.exitCode,
        stderr: mainExec.stderr,
        stdout: mainExec.stdout,
        commandOutputFiles,
        commandOutputWarnings,
        conversationId,
      });
    }

    const activeConversationId =
      conversationId || extractConversationId(`${mainExec.stdout}\n${mainExec.stderr}`);

    if (!activeConversationId) {
      return toExecError(input, {
        reason: 'missing_conversation_id',
        message: 'Unable to determine conversation ID from copilot output',
        commandOutputFiles,
        commandOutputWarnings,
      });
    }

    const totalFormatAttempts = MAX_FORMAT_RETRIES + 1;
    let attemptCount = 0;
    let lastRawResult = '';
    let validationErrors: readonly { path: string; message: string }[] = [];
    let validatedResult: CopilotActionResult | null = null;

    while (attemptCount < totalFormatAttempts) {
      const resultPrompt =
        attemptCount === 0
          ? buildStrictJsonResultPrompt()
          : buildJsonRepairPrompt({ previousOutput: lastRawResult });

      const resultExec = yield* ctx.cli.exec({
        command: 'copilot',
        args: buildCopilotArgs({
          prompt: resultPrompt,
          model: RESULT_PROMPT_MODEL,
          allowDirs,
          contextPaths,
          conversationId: activeConversationId,
        }),
      });

      if (resultExec.transcript) {
        commandOutputFiles.push(resultExec.transcript);
      }
      if (resultExec.captureWarnings && resultExec.captureWarnings.length > 0) {
        commandOutputWarnings.push(...resultExec.captureWarnings);
        yield* ctx.logger.warn('CLI transcript capture warning', {
          command: 'copilot',
          warnings: resultExec.captureWarnings,
        });
      }

      if (resultExec.exitCode !== 0) {
        return toExecError(input, {
          reason: 'result_prompt_exec_failed',
          exitCode: resultExec.exitCode,
          stderr: resultExec.stderr,
          stdout: resultExec.stdout,
          commandOutputFiles,
          commandOutputWarnings,
          conversationId: activeConversationId,
          attemptCount: attemptCount + 1,
        });
      }

      attemptCount += 1;
      lastRawResult = resultExec.stdout.trim();

      const parsedResult = parseAndValidateCopilotActionResult(lastRawResult);
      if (parsedResult.ok) {
        validatedResult = parsedResult.value;
        break;
      }

      validationErrors = parsedResult.errors;
    }

    if (!validatedResult) {
      return toExecError(input, {
        reason: 'invalid_result_json',
        attemptCount,
        validationErrors,
        rawResult: lastRawResult,
        commandOutputFiles,
        commandOutputWarnings,
        conversationId: activeConversationId,
      });
    }

    const { normalizedFilePaths, filePathWarnings } = normalizeFilePaths(validatedResult, ctx);

    return {
      nextState: input.successState,
      data: {
        conversationId: activeConversationId,
        copilotResult: validatedResult,
        normalizedFilePaths,
        commandOutputFiles,
        commandOutputWarnings,
        filePathWarnings,
      },
    };
  });

function inputFromRuntimeDirs(
  dirs: readonly string[],
  resolver: (dir: string) => string,
): readonly string[] {
  const deduped = new Set<string>();
  for (const dir of dirs) {
    deduped.add(resolver(dir));
  }
  return [...deduped.values()];
}
