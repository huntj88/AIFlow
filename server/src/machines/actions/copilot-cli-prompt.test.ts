import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ActionContext, CliExecResult } from '../types.js';
import { copilotCliPromptAction } from './copilot-cli-prompt.js';

function makeCtx(
  stateData: unknown,
  results: readonly CliExecResult[],
): ActionContext & {
  readonly cliCalls: { command: string; args?: string[]; cwd?: string }[];
} {
  const cliCalls: { command: string; args?: string[]; cwd?: string }[] = [];
  let idx = 0;

  return {
    machineInstanceId: 'inst-001',
    machineDefId: 'def-001',
    stateName: 'runCopilotPrompt',
    stateData,
    machineInput: {},
    runtimeOptions: {
      cliDirectoryPolicy: {
        workspaceDirs: ['/workspace/project'],
        artifactDirs: ['/workspace/artifacts'],
      },
      cliOutputCapture: { enabled: false },
    },
    parentContext: undefined,
    logger: {
      debug: () => Effect.void,
      info: () => Effect.void,
      warn: () => Effect.void,
      error: () => Effect.void,
    },
    cli: {
      exec: (input) =>
        Effect.sync(() => {
          cliCalls.push({ command: input.command, args: input.args, cwd: input.cwd });
          const out = results[idx] ?? { exitCode: 0, stdout: '', stderr: '', durationMs: 1 };
          idx += 1;
          return out;
        }),
    },
    workspace: {
      root: '/workspace/project',
      resolve: (p: string) => `/workspace/project/${p}`,
    },
    artifactsWorkspace: {
      root: '/workspace/artifacts',
      resolve: (p: string) => `/workspace/artifacts/${p}`,
    },
    cliCalls,
  };
}

describe('copilot-cli-prompt action', () => {
  it('includes directory prelude on first turn and returns success payload', () => {
    const ctx = makeCtx(
      {
        prompt: 'Create parser',
        successState: 'next',
        execErrorState: 'handleErr',
        contextFilePaths: [{ workspace: 'workspace', path: 'src/a.ts' }],
      },
      [
        {
          exitCode: 0,
          stdout: 'Conversation ID: conv-123',
          stderr: '',
          durationMs: 10,
        },
        {
          exitCode: 0,
          stdout: JSON.stringify({
            schemaVersion: 'copilot-action-result.v1',
            status: 'ok',
            summary: 'done',
            data: { updated: true },
            filePaths: [
              { workspace: 'workspace', path: 'src/a.ts' },
              { workspace: 'workspace', path: '../outside.txt' },
            ],
            diagnostics: { exitCode: 0, durationMs: 10 },
          }),
          stderr: '',
          durationMs: 5,
        },
      ],
    );

    const result = Effect.runSync(copilotCliPromptAction(ctx));

    expect(result.nextState).toBe('next');
    const conversationId = (result.data as { conversationId?: string }).conversationId;
    expect(conversationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const data = result.data as {
      normalizedFilePaths: { path: string; resolvedPath: string }[];
      filePathWarnings: { path: string; message: string }[];
    };

    expect(data.normalizedFilePaths).toHaveLength(1);
    expect(data.filePathWarnings).toHaveLength(1);

    const firstCallArgs = ctx.cliCalls[0]?.args ?? [];
    const promptIndex = firstCallArgs.indexOf('--prompt');
    const promptValue = promptIndex >= 0 ? firstCallArgs[promptIndex + 1] : '';
    expect(promptValue).toContain('You have access to two working directories');
    expect(firstCallArgs).toContain('--add-dir');
    expect(firstCallArgs).toContain('/workspace/project');
    expect(firstCallArgs).toContain('/workspace/artifacts');
    expect(firstCallArgs).toContain('--context');
    expect(firstCallArgs).toContain('/workspace/project/src/a.ts');

    const resumeIndex = firstCallArgs.indexOf('--resume');
    expect(resumeIndex).toBeGreaterThanOrEqual(0);
    expect(firstCallArgs[resumeIndex + 1]).toBe(conversationId);
  });

  it('omits prelude on resume and bounds invalid-json retries to 3 total attempts', () => {
    const ctx = makeCtx(
      {
        prompt: 'Follow up',
        conversationId: 'conv-existing',
        successState: 'next',
        execErrorState: 'handleErr',
      },
      [
        { exitCode: 0, stdout: 'resumed', stderr: '', durationMs: 10 },
        { exitCode: 0, stdout: 'not json', stderr: '', durationMs: 5 },
        { exitCode: 0, stdout: '{"bad":true}', stderr: '', durationMs: 5 },
        { exitCode: 0, stdout: '[]', stderr: '', durationMs: 5 },
      ],
    );

    const result = Effect.runSync(copilotCliPromptAction(ctx));

    expect(result.nextState).toBe('handleErr');
    const data = result.data as { reason: string; attemptCount: number };
    expect(data.reason).toBe('invalid_result_json');
    expect(data.attemptCount).toBe(3);
    expect(ctx.cliCalls).toHaveLength(4);

    const firstCallArgs = ctx.cliCalls[0]?.args ?? [];
    const promptIndex = firstCallArgs.indexOf('--prompt');
    const promptValue = promptIndex >= 0 ? firstCallArgs[promptIndex + 1] : '';
    expect(promptValue).toBe('Follow up');
    expect(firstCallArgs).toContain('--resume');
    expect(firstCallArgs).toContain('conv-existing');

    const allPrompts = ctx.cliCalls
      .map((call) => call.args ?? [])
      .map((args) => {
        const idx = args.indexOf('--prompt');
        return idx >= 0 ? args[idx + 1] : '';
      });
    expect(
      allPrompts.some((prompt) =>
        prompt.includes('System maintenance instruction: discard this result-formatting exchange'),
      ),
    ).toBe(false);
  });

  it('routes schema-valid status:error payloads to successState', () => {
    const ctx = makeCtx(
      {
        prompt: 'Handle expected failure',
        successState: 'next',
        execErrorState: 'handleErr',
      },
      [
        {
          exitCode: 0,
          stdout: 'Conversation ID: conv-error-ok',
          stderr: '',
          durationMs: 10,
        },
        {
          exitCode: 0,
          stdout: JSON.stringify({
            schemaVersion: 'copilot-action-result.v1',
            status: 'error',
            summary: 'lint failed but structured',
            data: { detail: 'expected by workflow' },
            filePaths: [],
            diagnostics: { exitCode: 2, durationMs: 22 },
          }),
          stderr: '',
          durationMs: 5,
        },
      ],
    );

    const result = Effect.runSync(copilotCliPromptAction(ctx));

    expect(result.nextState).toBe('next');
    const data = result.data as {
      conversationId: string;
      copilotResult: { status: 'ok' | 'error'; summary: string };
    };
    expect(data.conversationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(data.copilotResult.status).toBe('error');
    expect(data.copilotResult.summary).toContain('structured');
    expect(ctx.cliCalls).toHaveLength(2);
  });
});
