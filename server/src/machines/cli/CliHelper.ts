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

import type { CliExecResult, CliHelper } from '../types.js';
import type { MachineRuntimeOptions } from '../types.js';
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

const formatTranscriptContent = (input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}) =>
  [
    `command: ${input.command}`,
    `args: ${JSON.stringify(input.args)}`,
    `cwd: ${input.cwd}`,
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

  const writeTranscript = (input: {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly durationMs: number;
  }): Promise<CliExecResult['transcript'] | undefined> => {
    if (!resolveTranscriptPath) return Promise.resolve(undefined);

    const label = deriveCliTranscriptLabel(input.command);
    const transcriptPath = resolveTranscriptPath(label);
    const content = formatTranscriptContent(input);

    return fs
      .mkdir(path.dirname(transcriptPath.resolvedPath), { recursive: true })
      .then(() => fs.writeFile(transcriptPath.resolvedPath, content, 'utf-8'))
      .then(() => ({
        workspace: transcriptPath.workspace,
        path: transcriptPath.path,
        resolvedPath: transcriptPath.resolvedPath,
        label: transcriptPath.label,
        exitCode: input.exitCode,
        durationMs: input.durationMs,
      }))
      .catch(() => undefined);
  };

  return {
    exec: (input) =>
      Effect.async<CliExecResult>((resume) => {
        const startTime = Date.now();
        const cwd = input.cwd ?? opts.workspaceRoot;
        const args = input.args ?? [];
        let settled = false;

        const finish = (result: CliExecResult) => {
          if (settled) return;
          settled = true;
          resume(Effect.succeed(result));
        };

        const finishWithCapture = (baseResult: Omit<CliExecResult, 'transcript'>) => {
          void writeTranscript({
            command: input.command,
            args,
            cwd,
            exitCode: baseResult.exitCode,
            stdout: baseResult.stdout,
            stderr: baseResult.stderr,
            durationMs: baseResult.durationMs,
          }).then((transcript) => {
            finish(
              transcript
                ? {
                    ...baseResult,
                    transcript,
                  }
                : baseResult,
            );
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
