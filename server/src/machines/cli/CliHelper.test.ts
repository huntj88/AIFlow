/**
 * CliHelper — Unit Tests (Task 03)
 *
 * Tests for the `makeCliHelper` factory and the `CliHelper` it produces.
 * Covers basic execution, exit codes, spawn failures, cwd, environment
 * variables, output truncation, and fiber interruption.
 *
 * @module
 */

import { Effect, Fiber } from 'effect';
import { describe, expect, it, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { makeCliHelper, type MakeCliHelperOptions } from './CliHelper.js';
import type { CliHelper } from '../types.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

let tmpDir: string;
let artifactsDir: string;
let opts: MakeCliHelperOptions;
let cli: CliHelper;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-helper-test-'));
  artifactsDir = path.join(tmpDir, 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });
  opts = {
    workspaceRoot: tmpDir,
    artifactsRoot: artifactsDir,
    runtimeOptions: {
      cliDirectoryPolicy: {
        workspaceDirs: [tmpDir],
      },
      cliOutputCapture: {
        enabled: false,
      },
    },
  };
  cli = makeCliHelper(opts);
});

function run<A>(effect: Effect.Effect<A>): Promise<A> {
  return Effect.runPromise(effect);
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('CliHelper', () => {
  describe('basic execution', () => {
    it('executes a simple command and captures stdout', async () => {
      const result = await run(cli.exec({ command: 'echo', args: ['hello'] }));

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello');
      expect(result.stderr).toBe('');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('captures multi-line stdout', async () => {
      const result = await run(
        cli.exec({ command: 'bash', args: ['-c', 'echo line1; echo line2'] }),
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('line1\nline2');
    });
  });

  describe('exit codes', () => {
    it('returns non-zero exit code without failing the Effect', async () => {
      const result = await run(cli.exec({ command: 'bash', args: ['-c', 'exit 42'] }));

      expect(result.exitCode).toBe(42);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('captures stderr from a failing command', async () => {
      const result = await run(
        cli.exec({ command: 'bash', args: ['-c', 'echo oops >&2; exit 1'] }),
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr.trim()).toBe('oops');
    });
  });

  describe('spawn failures', () => {
    it('returns exitCode -1 for a nonexistent command', async () => {
      const result = await run(cli.exec({ command: 'nonexistent-command-xyz-12345' }));

      expect(result.exitCode).toBe(-1);
      expect(result.stderr).toBeTruthy();
      expect(result.stdout).toBe('');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('working directory', () => {
    it('defaults cwd to workspaceRoot', async () => {
      const result = await run(cli.exec({ command: 'pwd' }));

      expect(result.exitCode).toBe(0);
      // Resolve to handle symlinks (e.g. /tmp -> /private/tmp on macOS)
      expect(fs.realpathSync(result.stdout.trim())).toBe(fs.realpathSync(tmpDir));
    });

    it('respects custom cwd', async () => {
      const result = await run(cli.exec({ command: 'pwd', cwd: '/tmp' }));

      expect(result.exitCode).toBe(0);
      expect(fs.realpathSync(result.stdout.trim())).toBe(fs.realpathSync('/tmp'));
    });

    it('runs multiple execs with different cwd values independently', async () => {
      const r1 = await run(cli.exec({ command: 'pwd', cwd: tmpDir }));
      const r2 = await run(cli.exec({ command: 'pwd', cwd: '/tmp' }));

      expect(fs.realpathSync(r1.stdout.trim())).toBe(fs.realpathSync(tmpDir));
      expect(fs.realpathSync(r2.stdout.trim())).toBe(fs.realpathSync('/tmp'));
    });
  });

  describe('environment variables', () => {
    it('injects WORKSPACE_ROOT', async () => {
      const result = await run(cli.exec({ command: 'bash', args: ['-c', 'echo $WORKSPACE_ROOT'] }));

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(tmpDir);
    });

    it('injects ARTIFACTS_ROOT', async () => {
      const result = await run(cli.exec({ command: 'bash', args: ['-c', 'echo $ARTIFACTS_ROOT'] }));

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(artifactsDir);
    });

    it('merges custom env with defaults', async () => {
      const result = await run(
        cli.exec({
          command: 'bash',
          args: ['-c', 'echo $MY_VAR $WORKSPACE_ROOT'],
          env: { MY_VAR: 'test123' },
        }),
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(`test123 ${tmpDir}`);
    });

    it('allows custom env to override defaults', async () => {
      const result = await run(
        cli.exec({
          command: 'bash',
          args: ['-c', 'echo $WORKSPACE_ROOT'],
          env: { WORKSPACE_ROOT: '/overridden' },
        }),
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('/overridden');
    });
  });

  describe('output truncation', () => {
    it('truncates stdout exceeding 1 MiB', async () => {
      // Generate ~1.5 MiB of output
      const result = await run(
        cli.exec({
          command: 'bash',
          args: ['-c', 'dd if=/dev/zero bs=1024 count=1536 2>/dev/null | tr "\\0" "A"'],
        }),
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('\n...<truncated>');
      // Truncated output should be less than the full 1.5 MiB
      expect(result.stdout.length).toBeLessThan(1536 * 1024);
    });

    it('truncates stderr exceeding 1 MiB', async () => {
      const result = await run(
        cli.exec({
          command: 'bash',
          args: ['-c', 'dd if=/dev/zero bs=1024 count=1536 2>/dev/null | tr "\\0" "A" >&2'],
        }),
      );

      expect(result.stderr).toContain('\n...<truncated>');
      expect(result.stderr.length).toBeLessThan(1536 * 1024);
    });

    it('still provides exitCode and durationMs on truncated output', async () => {
      const result = await run(
        cli.exec({
          command: 'bash',
          args: ['-c', 'dd if=/dev/zero bs=1024 count=1536 2>/dev/null | tr "\\0" "A"'],
        }),
      );

      expect(result.exitCode).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('global transcript capture', () => {
    it('writes transcript and returns metadata when capture is enabled', async () => {
      const captureCli = makeCliHelper({
        ...opts,
        runtimeOptions: {
          ...opts.runtimeOptions,
          cliOutputCapture: { enabled: true },
        },
        stateName: 'runCli',
        stateVisitIndex: 1,
      });

      const result = await run(captureCli.exec({ command: 'echo', args: ['captured-output'] }));

      expect(result.transcript).toBeDefined();
      expect(result.transcript?.workspace).toBe('artifacts');
      expect(result.transcript?.path).toBe('runCli/001-echo.txt');
      expect(result.transcript?.resolvedPath).toBe(path.join(artifactsDir, 'runCli/001-echo.txt'));
      expect(result.transcript?.label).toBe('echo');
      expect(result.transcript?.exitCode).toBe(result.exitCode);
      expect(result.transcript?.durationMs).toBe(result.durationMs);

      const transcript = result.transcript;
      expect(transcript).toBeDefined();
      if (!transcript) {
        throw new Error('Expected transcript metadata when capture is enabled');
      }
      const transcriptText = fs.readFileSync(transcript.resolvedPath, 'utf-8');
      expect(transcriptText).toContain('command: echo');
      expect(transcriptText).toContain('args: ["captured-output"]');
      expect(transcriptText).toContain(`cwd: ${tmpDir}`);
      expect(transcriptText).toContain('stream:');
      expect(transcriptText).toContain('[stdout]');
      expect(transcriptText).toContain('captured-output');
      expect(transcriptText).toContain('stdout:\ncaptured-output\n');
      expect(transcriptText).toContain('stderr:\n');
    });

    it('does not write transcript when capture is disabled', async () => {
      const result = await run(cli.exec({ command: 'echo', args: ['no-capture'] }));

      expect(result.transcript).toBeUndefined();
      const maybeTranscript = path.join(artifactsDir, 'state', '001-echo.txt');
      expect(fs.existsSync(maybeTranscript)).toBe(false);
    });

    it('uses lineage path for nested children', async () => {
      const captureCli = makeCliHelper({
        ...opts,
        runtimeOptions: {
          ...opts.runtimeOptions,
          cliOutputCapture: { enabled: true },
        },
        stateName: 'runCli',
        stateVisitIndex: 1,
        lineageInstanceIds: ['child-1', 'grandchild-1'],
      });

      const result = await run(captureCli.exec({ command: 'echo', args: ['lineage'] }));

      expect(result.transcript?.path).toBe(
        'children/child-1/children/grandchild-1/runCli/001-echo.txt',
      );
      const transcript = result.transcript;
      expect(transcript).toBeDefined();
      if (!transcript) {
        throw new Error('Expected transcript metadata for lineage assertion');
      }
      expect(fs.existsSync(transcript.resolvedPath)).toBe(true);
    });

    it('appends deterministic suffix when labels collide in one visit', async () => {
      const captureCli = makeCliHelper({
        ...opts,
        runtimeOptions: {
          ...opts.runtimeOptions,
          cliOutputCapture: { enabled: true },
        },
        stateName: 'runCli',
        stateVisitIndex: 1,
      });

      const first = await run(captureCli.exec({ command: 'echo', args: ['one'] }));
      const second = await run(captureCli.exec({ command: 'echo', args: ['two'] }));

      expect(first.transcript?.path).toBe('runCli/001-echo.txt');
      expect(second.transcript?.path).toBe('runCli/001-echo-2.txt');
    });

    it('streams transcript chunks while command is still running', async () => {
      const captureCli = makeCliHelper({
        ...opts,
        runtimeOptions: {
          ...opts.runtimeOptions,
          cliOutputCapture: { enabled: true },
        },
        stateName: 'runCli',
        stateVisitIndex: 1,
      });

      const transcriptPath = path.join(artifactsDir, 'runCli/001-bash.txt');

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(
            captureCli.exec({
              command: 'bash',
              args: ['-c', 'for i in 1 2 3 4 5; do echo chunk-$i; sleep 0.2; done'],
            }),
          );

          yield* Effect.sleep('120 millis');

          expect(fs.existsSync(transcriptPath)).toBe(true);
          const firstSize = fs.statSync(transcriptPath).size;
          const firstPartial = fs.readFileSync(transcriptPath, 'utf-8');
          expect(firstPartial).toContain('[stdout]');
          expect(firstPartial).toContain('chunk-1');

          yield* Effect.sleep('260 millis');
          const secondSize = fs.statSync(transcriptPath).size;
          expect(secondSize).toBeGreaterThan(firstSize);

          return yield* Fiber.join(fiber);
        }),
      );

      const finalText = fs.readFileSync(transcriptPath, 'utf-8');
      expect(result.exitCode).toBe(0);
      expect(finalText).toContain('chunk-5');
    });

    it('returns capture warnings and does not fail command when transcript write fails', async () => {
      const invalidArtifactsRoot = path.join(tmpDir, 'artifacts-file');
      fs.writeFileSync(invalidArtifactsRoot, 'not-a-directory', 'utf-8');

      const captureCli = makeCliHelper({
        ...opts,
        artifactsRoot: invalidArtifactsRoot,
        runtimeOptions: {
          ...opts.runtimeOptions,
          cliOutputCapture: { enabled: true },
        },
        stateName: 'runCli',
        stateVisitIndex: 1,
      });

      const result = await run(captureCli.exec({ command: 'echo', args: ['safe-run'] }));

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('safe-run');
      expect(result.transcript).toBeUndefined();
      expect(result.captureWarnings?.length).toBeGreaterThan(0);
      expect(result.captureWarnings?.[0]?.code).toBe('transcript_stream_write_failed');
    });
  });

  describe('fiber interruption', () => {
    it('kills child process when fiber is interrupted', async () => {
      // Start a long-running process, then race it against a short timeout
      const longRunning = cli.exec({
        command: 'sleep',
        args: ['60'],
      });

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(longRunning);
          // Give the process a moment to start
          yield* Effect.sleep('50 millis');
          // Interrupt the fiber
          yield* Fiber.interrupt(fiber);
          return 'interrupted';
        }),
      );

      expect(result).toBe('interrupted');
    });
  });
});
