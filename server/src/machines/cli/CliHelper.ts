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

import type { CliExecResult, CliHelper } from '../types.js';

/** Maximum bytes captured per stream (stdout / stderr). */
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MiB

/** Suffix appended when output is truncated. */
const TRUNCATION_SUFFIX = '\n...<truncated>';

/** Options for constructing a `CliHelper`. */
export interface MakeCliHelperOptions {
  readonly workspaceRoot: string;
  readonly artifactsRoot: string;
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
  return {
    exec: (input) =>
      Effect.async<CliExecResult>((resume) => {
        const startTime = Date.now();
        const cwd = input.cwd ?? opts.workspaceRoot;

        // Build environment: inherit process env, add workspace vars, merge user env
        const env: Record<string, string | undefined> = {
          ...process.env,
          WORKSPACE_ROOT: opts.workspaceRoot,
          ARTIFACTS_ROOT: opts.artifactsRoot,
          ...input.env,
        };

        try {
          const child = spawn(input.command, input.args ?? [], {
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

            resume(
              Effect.succeed({
                exitCode: code ?? -1,
                stdout,
                stderr,
                durationMs,
              }),
            );
          });

          child.on('error', (err) => {
            const durationMs = Date.now() - startTime;
            resume(
              Effect.succeed({
                exitCode: -1,
                stdout: '',
                stderr: err.message,
                durationMs,
              }),
            );
          });

          // Return a finalizer that kills the child process on fiber interruption
          return Effect.sync(() => {
            if (!child.killed) {
              child.kill('SIGTERM');
            }
          });
        } catch (err) {
          const durationMs = Date.now() - startTime;
          resume(
            Effect.succeed({
              exitCode: -1,
              stdout: '',
              stderr: err instanceof Error ? err.message : String(err),
              durationMs,
            }),
          );
        }
      }),
  };
}
