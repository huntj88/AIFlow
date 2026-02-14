/**
 * CLI Helper — factory function for creating a `CliHelper` placed on `ActionContext.cli`.
 *
 * Provides standardized command execution and result capture. `exec()` never fails
 * in the Effect error channel — all outcomes (including spawn failures) are surfaced
 * in `CliExecResult`.
 *
 * @module
 */

import { Effect } from 'effect';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type {
  CliCaptureWarning,
  CliExecResult,
  CliHelper,
  MachineRuntimeOptions,
} from '../types.js';
import {
  deriveCliTranscriptLabel,
  makeCliTranscriptPathResolver,
  type CliTranscriptPathResolver,
} from '../workspace/index.js';

/** Maximum bytes captured per stream (stdout / stderr). */
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MiB

/** Suffix appended when output is truncated. */
const TRUNCATION_SUFFIX = '\n...<truncated>';

/** Options for constructing a `CliHelper`. */
export interface MakeCliHelperOptions {
  readonly workspaceRoot: string;
  readonly artifactsRoot: string;
  readonly runtimeOptions: MachineRuntimeOptions;
  readonly stateName?: string;
  readonly stateVisitIndex?: number;
  readonly lineageInstanceIds?: readonly string[];
}

const formatTranscriptSummary = (input: {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}) =>
  [
    '',
    `exitCode: ${String(input.exitCode)}`,
    `durationMs: ${String(input.durationMs)}`,
    '',
    'stdout:',
    input.stdout,
    '',
    'stderr:',
    input.stderr,
    '',
  ].join('\n');

const createCaptureWarning = (input: {
  readonly err: unknown;
  readonly transcriptPath?: string;
  readonly transcriptResolvedPath?: string;
}): CliCaptureWarning => ({
  code: 'transcript_stream_write_failed',
  message: `Failed to write transcript stream: ${
    input.err instanceof Error ? input.err.message : String(input.err)
  }`,
  transcriptPath: input.transcriptPath,
  transcriptResolvedPath: input.transcriptResolvedPath,
});

interface TranscriptCapture {
  readonly appendChunk: (source: 'stdout' | 'stderr', chunk: Buffer) => void;
  readonly finalize: (result: Omit<CliExecResult, 'transcript' | 'captureWarnings'>) => Promise<{
    readonly transcript?: CliExecResult['transcript'];
    readonly captureWarnings?: readonly CliCaptureWarning[];
  }>;
}

/**
 * Construct a `CliHelper` bound to the given workspace and artifacts root.
 *
 * The returned helper satisfies the `CliHelper` interface from `types.ts`:
 * - `exec()` returns `Effect.Effect<CliExecResult>` — never fails in error channel
 * - `WORKSPACE_ROOT` and `ARTIFACTS_ROOT` are injected into every child process env
 * - Default `cwd` is `workspaceRoot`
 * - stdout/stderr capped at 1 MiB with truncation suffix
 * - Fiber interruption kills the child process
 */
export function makeCliHelper(opts: MakeCliHelperOptions): CliHelper {
  const shouldCapture = opts.runtimeOptions.cliOutputCapture.enabled;
  const resolveTranscriptPath: CliTranscriptPathResolver | null = shouldCapture
    ? makeCliTranscriptPathResolver({
        artifactsRoot: opts.artifactsRoot,
        lineageInstanceIds: opts.lineageInstanceIds ?? [],
        stateName: opts.stateName ?? 'state',
        visitIndex: opts.stateVisitIndex ?? 1,
      })
    : null;

  const makeTranscriptCapture = (input: {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string;
  }): TranscriptCapture | null => {
    if (!resolveTranscriptPath) return null;

    const label = deriveCliTranscriptLabel(input.command);
    const transcriptPath = resolveTranscriptPath(label);
    const warnings: CliCaptureWarning[] = [];
    let initSucceeded = false;
    let hasCapturedFailure = false;

    let writeQueue: Promise<void> = fs
      .mkdir(path.dirname(transcriptPath.resolvedPath), { recursive: true })
      .then(() =>
        fs.writeFile(
          transcriptPath.resolvedPath,
          [
            `command: ${input.command}`,
            `args: ${JSON.stringify(input.args)}`,
            `cwd: ${input.cwd}`,
            '',
            'stream:',
            '',
          ].join('\n'),
          'utf-8',
        ),
      )
      .then(() => {
        initSucceeded = true;
      })
      .catch((err: unknown) => {
        hasCapturedFailure = true;
        warnings.push(
          createCaptureWarning({
            err,
            transcriptPath: transcriptPath.path,
            transcriptResolvedPath: transcriptPath.resolvedPath,
          }),
        );
      });

    const enqueue = (content: string) => {
      writeQueue = writeQueue
        .then(() => fs.appendFile(transcriptPath.resolvedPath, content, 'utf-8'))
        .catch((err: unknown) => {
          if (!hasCapturedFailure) {
            warnings.push(
              createCaptureWarning({
                err,
                transcriptPath: transcriptPath.path,
                transcriptResolvedPath: transcriptPath.resolvedPath,
              }),
            );
            hasCapturedFailure = true;
          }
        });
    };

    return {
      appendChunk: (source, chunk) => {
        enqueue(`[${source}]\n${chunk.toString('utf-8')}\n`);
      },
      finalize: async (result) => {
        enqueue(formatTranscriptSummary(result));
        await writeQueue;

        return {
          transcript: initSucceeded
            ? {
                workspace: transcriptPath.workspace,
                path: transcriptPath.path,
                resolvedPath: transcriptPath.resolvedPath,
                label: transcriptPath.label,
                exitCode: result.exitCode,
                durationMs: result.durationMs,
              }
            : undefined,
          captureWarnings: warnings.length > 0 ? warnings : undefined,
        };
      },
    };
  };

  return {
    exec: (input) =>
      Effect.async<CliExecResult>((resume) => {
        const startTime = Date.now();
        const cwd = input.cwd ?? opts.workspaceRoot;
        const args = input.args ?? [];
        const capture = makeTranscriptCapture({ command: input.command, args, cwd });
        let settled = false;

        const finish = (result: CliExecResult) => {
          if (settled) return;
          settled = true;
          resume(Effect.succeed(result));
        };

        const finishWithCapture = (
          baseResult: Omit<CliExecResult, 'transcript' | 'captureWarnings'>,
        ) => {
          if (!capture) {
            finish(baseResult);
            return;
          }

          void capture.finalize(baseResult).then((captureResult) => {
            finish({
              ...baseResult,
              ...(captureResult.transcript ? { transcript: captureResult.transcript } : {}),
              ...(captureResult.captureWarnings
                ? { captureWarnings: captureResult.captureWarnings }
                : {}),
            });
          });
        };

        // Build environment: inherit process env, add workspace vars, merge user env
        const env: Record<string, string | undefined> = {
          ...process.env,
          WORKSPACE_ROOT: opts.workspaceRoot,
          ARTIFACTS_ROOT: opts.artifactsRoot,
          ...input.env,
        };

        try {
          const child = spawn(input.command, args, {
            cwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
          });

          const stdoutChunks: Buffer[] = [];
          const stderrChunks: Buffer[] = [];
          let stdoutBytes = 0;
          let stderrBytes = 0;
          let stdoutTruncated = false;
          let stderrTruncated = false;

          child.stdout.on('data', (chunk: Buffer) => {
            capture?.appendChunk('stdout', chunk);
            if (!stdoutTruncated) {
              stdoutBytes += chunk.length;
              if (stdoutBytes > MAX_OUTPUT_BYTES) {
                stdoutTruncated = true;
              } else {
                stdoutChunks.push(chunk);
              }
            }
          });

          child.stderr.on('data', (chunk: Buffer) => {
            capture?.appendChunk('stderr', chunk);
            if (!stderrTruncated) {
              stderrBytes += chunk.length;
              if (stderrBytes > MAX_OUTPUT_BYTES) {
                stderrTruncated = true;
              } else {
                stderrChunks.push(chunk);
              }
            }
          });

          child.on('close', (code) => {
            const durationMs = Date.now() - startTime;
            let stdout = Buffer.concat(stdoutChunks).toString('utf-8');
            let stderr = Buffer.concat(stderrChunks).toString('utf-8');
            if (stdoutTruncated) stdout += TRUNCATION_SUFFIX;
            if (stderrTruncated) stderr += TRUNCATION_SUFFIX;

            finishWithCapture({
              exitCode: code ?? -1,
              stdout,
              stderr,
              durationMs,
            });
          });

          child.on('error', (err) => {
            const durationMs = Date.now() - startTime;
            finishWithCapture({
              exitCode: -1,
              stdout: '',
              stderr: err.message,
              durationMs,
            });
          });

          // Return a finalizer that kills the child process on fiber interruption
          return Effect.sync(() => {
            if (!child.killed) {
              child.kill('SIGTERM');
            }
          });
        } catch (err) {
          const durationMs = Date.now() - startTime;
          finishWithCapture({
            exitCode: -1,
            stdout: '',
            stderr: err instanceof Error ? err.message : String(err),
            durationMs,
          });
        }
      }),
  };
}
