# Task 03 — CLI Helper Implementation

> **Phase**: 2 (Infrastructure)
> **Depends on**: Task 01 (server type updates — `CliHelper`, `CliExecResult` interfaces)
> **Blocks**: Task 05 (runner ActionContext wiring)

---

## Objective

Implement the `CliHelper` — a plain object (not an Effect Service) that provides
standardized command execution and result capture. The CLI helper is constructed by
the runner and placed on `ActionContext` as `ctx.cli`, consistent with the existing
`ctx.logger` pattern.

---

## Design Constraints (from feature spec)

1. `exec()` **never fails** in the Effect error channel. All outcomes — including
   spawn failures — are surfaced in `CliExecResult`.
2. The CLI helper does **not** enforce its own timeout. The runner's state-level
   `timeoutMs` governs the deadline; if it fires, the Effect fiber (and any
   in-flight child process) is interrupted.
3. `stdout`/`stderr` are captured up to **1 MiB** each; truncate with a clear
   suffix (`\n...<truncated>`).
4. Spawn failures set `exitCode: -1` with the error message in `stderr`.
5. Every `exec()` call provides `WORKSPACE_ROOT` and `ARTIFACTS_ROOT` in the
   process environment.
6. `cwd` defaults to `WORKSPACE_ROOT` unless explicitly set.
7. Action-provided `env` vars are merged with (and override) the defaults.

---

## Steps

### 1. Create `server/src/machines/cli/CliHelper.ts`

Implement a factory function that constructs a `CliHelper` for a given workspace
and artifacts root:

```typescript
import { Effect } from 'effect';
import { spawn } from 'node:child_process';
import type { CliExecResult, CliHelper } from '../types.js';

const MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MiB
const TRUNCATION_SUFFIX = '\n...<truncated>';

export interface MakeCliHelperOptions {
  readonly workspaceRoot: string;
  readonly artifactsRoot: string;
}

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
```

### 2. Create `server/src/machines/cli/index.ts`

Barrel export:

```typescript
export { makeCliHelper, type MakeCliHelperOptions } from './CliHelper.js';
```

### 3. Unit tests — `server/src/machines/cli/CliHelper.test.ts`

Test cases:

- **Basic execution**: `exec({ command: 'echo', args: ['hello'] })` → `exitCode: 0`,
  `stdout` contains `'hello'`, `stderr` is empty, `durationMs >= 0`
- **Non-zero exit code**: `exec({ command: 'bash', args: ['-c', 'exit 42'] })` →
  `exitCode: 42`, no error in Effect channel
- **Spawn failure**: `exec({ command: 'nonexistent-command-xyz' })` → `exitCode: -1`,
  `stderr` contains error message
- **Custom cwd**: `exec({ command: 'pwd', cwd: '/tmp' })` → stdout contains `/tmp`
- **Default cwd**: `exec({ command: 'pwd' })` → stdout contains the workspaceRoot
- **Environment variables (WORKSPACE_ROOT)**: `exec({ command: 'bash', args: ['-c', 'echo $WORKSPACE_ROOT'] })`
  → stdout contains the workspace root path
- **Environment variables (ARTIFACTS_ROOT)**: `exec({ command: 'bash', args: ['-c', 'echo $ARTIFACTS_ROOT'] })`
  → stdout contains the artifacts root path
- **Custom env override**: `exec({ command: 'bash', args: ['-c', 'echo $MY_VAR'], env: { MY_VAR: 'test123' } })`
  → stdout contains `test123`
- **Custom env merges with defaults**: providing `env: { MY_VAR: 'x' }` still provides
  `WORKSPACE_ROOT` and `ARTIFACTS_ROOT`
- **Output truncation**: run a command that produces > 1 MiB stdout → stdout is truncated
  and ends with `\n...<truncated>`
- **stderr truncation**: same for stderr
- **Truncated output still has exitCode and durationMs**
- **Multiple exec calls**: two sequential `exec()` calls with different `cwd` values
  each run in their respective directories
- **Fiber interruption kills child process**: start a long-running process, interrupt
  the fiber, verify the child process is killed (use `Effect.race` or
  `Effect.timeout` to simulate)

---

## Behavior Spec Coverage

- **§16.1** — Basic execution, `CliExecResult` fields, exec never fails in error channel,
  spawn failures return `exitCode: -1`
- **§16.2** — Default cwd is workspace root, custom cwd is respected, multiple cwd values,
  no enforcement
- **§16.3** — `WORKSPACE_ROOT` and `ARTIFACTS_ROOT` in env, custom env merge/override
- **§16.4** — stdout/stderr capture up to 1 MiB, truncation suffix
- **§16.5** — CLI has no timeout; runner interrupt kills child process
- **§16.6** — Exit code available for branching (tested via action in Task 15)

---

## Validation Checklist

- [ ] `server/src/machines/cli/CliHelper.ts` implements `makeCliHelper()`
- [ ] `exec()` returns `Effect.Effect<CliExecResult>` — never fails in error channel
- [ ] Spawn failures return `exitCode: -1` with error message in `stderr`
- [ ] `WORKSPACE_ROOT` and `ARTIFACTS_ROOT` injected in every `exec()` call
- [ ] Default `cwd` is workspace root
- [ ] Action-provided `env` merges with defaults
- [ ] stdout/stderr capped at 1 MiB with truncation suffix
- [ ] Fiber interruption kills child process
- [ ] All unit tests pass: `pnpm --filter @aiflow/server run test`
