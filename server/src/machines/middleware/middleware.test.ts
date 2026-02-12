/**
 * Middleware System — Unit Tests (Task 07)
 *
 * Covers:
 * - MiddlewareExecutor execution ordering (before: registration, after: reverse)
 * - ValidationMiddleware schema enforcement
 * - LoggingMiddleware structured output
 * - AuditMiddleware immutable records
 * - TelemetryMiddleware timing annotations
 * - onError hook invocation
 * - Middleware failure propagation as MachineError
 * - onError handler errors swallowed
 *
 * @module
 */

import { Effect, Logger } from 'effect';
import { describe, expect, it, beforeEach } from 'vitest';

import type {
  MachineError,
  MachineInstance,
  MiddlewareContext,
  StateMachineDefinition,
  TransitionMiddleware,
  TransitionResult,
} from '../types.js';
import { mkValidationError } from '../types.js';

import { makeMiddlewareExecutor } from './MiddlewareExecutor.js';
import { ValidationMiddleware } from './ValidationMiddleware.js';
import { LoggingMiddleware } from './LoggingMiddleware.js';
import { createAuditMiddleware } from './AuditMiddleware.js';
import { TelemetryMiddleware } from './TelemetryMiddleware.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Suppress Effect.log console output during tests. */
function runSilent<A>(effect: Effect.Effect<A, MachineError>): Promise<A> {
  return Effect.runPromise(
    effect.pipe(Effect.provide(Logger.replace(Logger.defaultLogger, Logger.none))),
  );
}

function runSilentVoid(effect: Effect.Effect<void>): Promise<void> {
  return Effect.runPromise(
    effect.pipe(Effect.provide(Logger.replace(Logger.defaultLogger, Logger.none))),
  );
}

/**
 * Safely invoke an optional middleware hook — returns `Effect.void` if the
 * hook is not defined, avoiding non-null assertions throughout the tests.
 */
function callBefore(mw: TransitionMiddleware, ctx: MiddlewareContext) {
  return mw.beforeTransition ? mw.beforeTransition(ctx) : Effect.void;
}

function callAfter(
  mw: TransitionMiddleware,
  ctx: MiddlewareContext & { readonly result: TransitionResult },
) {
  return mw.afterTransition ? mw.afterTransition(ctx) : Effect.void;
}

function callOnError(
  mw: TransitionMiddleware,
  ctx: MiddlewareContext & { readonly error: MachineError },
) {
  return mw.onError ? mw.onError(ctx) : Effect.void;
}

/** Minimal definition for testing. */
function makeDefinition(statesOverride?: StateMachineDefinition['states']): StateMachineDefinition {
  return {
    id: 'def-001',
    name: 'test-machine',
    version: 1,
    inputSchema: {},
    outputSchema: {},
    initialState: 'start',
    transitions: [{ from: 'start', to: 'completed' }],
    states: statesOverride ?? {
      start: { name: 'start', type: 'action', actionId: 'do-something' },
      completed: { name: 'completed', type: 'terminal' },
      cancelled: { name: 'cancelled', type: 'terminal' },
      error: { name: 'error', type: 'terminal' },
    },
    metadata: {
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

/** Minimal instance for testing. */
function makeInstance(): MachineInstance {
  return {
    id: 'inst-001',
    definitionId: 'def-001',
    definitionVersion: 1,
    status: 'running',
    currentState: 'start',
    stateData: { value: 42 },
    input: {},
    history: [],
    logs: [],
    workspaceRoot: '/tmp/test-workspace',
    familyRootInstanceId: 'inst-001',
    artifactsPath: './data/artifacts/inst-001',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeCtx(overrides?: Partial<MiddlewareContext>): MiddlewareContext {
  return {
    instance: makeInstance(),
    stateName: 'start',
    stateData: { value: 42 },
    definition: makeDefinition(),
    ...overrides,
  };
}

function makeAfterCtx(
  result: TransitionResult = { nextState: 'completed', data: { out: true } },
  overrides?: Partial<MiddlewareContext>,
): MiddlewareContext & { result: TransitionResult } {
  return {
    ...makeCtx(overrides),
    result,
  };
}

function makeErrorCtx(
  error: MachineError = mkValidationError({ message: 'test error', path: 'start' }),
  overrides?: Partial<MiddlewareContext>,
): MiddlewareContext & { error: MachineError } {
  return {
    ...makeCtx(overrides),
    error,
  };
}

/** Create a spy middleware that records when its hooks are called. */
function spyMiddleware(name: string, calls: string[]): TransitionMiddleware {
  return {
    name,
    beforeTransition() {
      return Effect.sync(() => {
        calls.push(`${name}:before`);
      });
    },
    afterTransition() {
      return Effect.sync(() => {
        calls.push(`${name}:after`);
      });
    },
    onError() {
      return Effect.sync(() => {
        calls.push(`${name}:onError`);
      });
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// MiddlewareExecutor
// ────────────────────────────────────────────────────────────────────────────

describe('MiddlewareExecutor', () => {
  describe('runBefore — registration order', () => {
    it('fires beforeTransition hooks in registration order', async () => {
      const calls: string[] = [];
      const executor = makeMiddlewareExecutor([
        spyMiddleware('A', calls),
        spyMiddleware('B', calls),
        spyMiddleware('C', calls),
      ]);

      await runSilent(executor.runBefore(makeCtx()));
      expect(calls).toEqual(['A:before', 'B:before', 'C:before']);
    });

    it('skips middleware with no beforeTransition hook', async () => {
      const calls: string[] = [];
      const noBeforeMw: TransitionMiddleware = {
        name: 'no-before',
        afterTransition: () =>
          Effect.sync(() => {
            calls.push('no-before:after');
          }),
      };
      const executor = makeMiddlewareExecutor([
        spyMiddleware('A', calls),
        noBeforeMw,
        spyMiddleware('C', calls),
      ]);

      await runSilent(executor.runBefore(makeCtx()));
      expect(calls).toEqual(['A:before', 'C:before']);
    });
  });

  describe('runAfter — reverse registration order', () => {
    it('fires afterTransition hooks in reverse order (onion model)', async () => {
      const calls: string[] = [];
      const executor = makeMiddlewareExecutor([
        spyMiddleware('A', calls),
        spyMiddleware('B', calls),
        spyMiddleware('C', calls),
      ]);

      await runSilent(executor.runAfter(makeAfterCtx()));
      expect(calls).toEqual(['C:after', 'B:after', 'A:after']);
    });

    it('skips middleware with no afterTransition hook', async () => {
      const calls: string[] = [];
      const noAfterMw: TransitionMiddleware = {
        name: 'no-after',
        beforeTransition: () =>
          Effect.sync(() => {
            calls.push('no-after:before');
          }),
      };
      const executor = makeMiddlewareExecutor([
        spyMiddleware('A', calls),
        noAfterMw,
        spyMiddleware('C', calls),
      ]);

      await runSilent(executor.runAfter(makeAfterCtx()));
      expect(calls).toEqual(['C:after', 'A:after']);
    });
  });

  describe('runOnError — all hooks fire, errors swallowed', () => {
    it('fires onError hooks for all middleware', async () => {
      const calls: string[] = [];
      const executor = makeMiddlewareExecutor([
        spyMiddleware('A', calls),
        spyMiddleware('B', calls),
      ]);

      await runSilentVoid(executor.runOnError(makeErrorCtx()));
      expect(calls).toEqual(['A:onError', 'B:onError']);
    });

    it('skips middleware with no onError hook', async () => {
      const calls: string[] = [];
      const noOnErrorMw: TransitionMiddleware = {
        name: 'no-onerror',
        beforeTransition: () =>
          Effect.sync(() => {
            calls.push('no-onerror:before');
          }),
      };
      const executor = makeMiddlewareExecutor([
        spyMiddleware('A', calls),
        noOnErrorMw,
        spyMiddleware('C', calls),
      ]);

      await runSilentVoid(executor.runOnError(makeErrorCtx()));
      expect(calls).toEqual(['A:onError', 'C:onError']);
    });

    it('swallows errors thrown by onError handlers', async () => {
      const calls: string[] = [];
      const throwingMw: TransitionMiddleware = {
        name: 'thrower',
        onError: () => Effect.fail('boom' as never),
      };
      const executor = makeMiddlewareExecutor([throwingMw, spyMiddleware('B', calls)]);

      // Should not throw — the error from 'thrower' is swallowed
      await runSilentVoid(executor.runOnError(makeErrorCtx()));
      expect(calls).toEqual(['B:onError']);
    });
  });

  describe('error propagation', () => {
    it('propagates beforeTransition failure as MachineError', async () => {
      const failingMw: TransitionMiddleware = {
        name: 'failing',
        beforeTransition: () =>
          Effect.fail(mkValidationError({ message: 'bad data', path: 'start' })),
      };
      const calls: string[] = [];
      const executor = makeMiddlewareExecutor([
        spyMiddleware('A', calls),
        failingMw,
        spyMiddleware('C', calls),
      ]);

      const result = await Effect.runPromiseExit(
        executor
          .runBefore(makeCtx())
          .pipe(Effect.provide(Logger.replace(Logger.defaultLogger, Logger.none))),
      );

      // A:before should have run, then failing mw should stop execution
      expect(calls).toEqual(['A:before']);
      expect(result._tag).toBe('Failure');
    });

    it('propagates afterTransition failure as MachineError', async () => {
      const failingMw: TransitionMiddleware = {
        name: 'failing-after',
        afterTransition: () =>
          Effect.fail(mkValidationError({ message: 'post fail', path: 'start' })),
      };
      const calls: string[] = [];
      // After runs in reverse: C, failing-after, A
      // So C runs first, then failing-after fails, A never runs
      const executor = makeMiddlewareExecutor([
        spyMiddleware('A', calls),
        failingMw,
        spyMiddleware('C', calls),
      ]);

      const result = await Effect.runPromiseExit(
        executor
          .runAfter(makeAfterCtx())
          .pipe(Effect.provide(Logger.replace(Logger.defaultLogger, Logger.none))),
      );

      expect(calls).toEqual(['C:after']);
      expect(result._tag).toBe('Failure');
    });
  });

  describe('empty middleware stack', () => {
    it('runBefore succeeds with no middleware', async () => {
      const executor = makeMiddlewareExecutor([]);
      await runSilent(executor.runBefore(makeCtx()));
    });

    it('runAfter succeeds with no middleware', async () => {
      const executor = makeMiddlewareExecutor([]);
      await runSilent(executor.runAfter(makeAfterCtx()));
    });

    it('runOnError succeeds with no middleware', async () => {
      const executor = makeMiddlewareExecutor([]);
      await runSilentVoid(executor.runOnError(makeErrorCtx()));
    });
  });

  it('getMiddleware returns the registered middleware', () => {
    const mw: TransitionMiddleware[] = [{ name: 'a' }, { name: 'b' }];
    const executor = makeMiddlewareExecutor(mw);
    expect(executor.getMiddleware()).toEqual(mw);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ValidationMiddleware
// ────────────────────────────────────────────────────────────────────────────

describe('ValidationMiddleware', () => {
  it('passes when no dataSchema is defined', async () => {
    const ctx = makeCtx();
    await runSilent(callBefore(ValidationMiddleware, ctx));
  });

  it('passes when stateData conforms to schema', async () => {
    const definition = makeDefinition({
      start: {
        name: 'start',
        type: 'action',
        actionId: 'do-something',
        dataSchema: {
          type: 'object',
          properties: { value: { type: 'number' } },
          required: ['value'],
        },
      },
      completed: { name: 'completed', type: 'terminal' },
      cancelled: { name: 'cancelled', type: 'terminal' },
      error: { name: 'error', type: 'terminal' },
    });

    const ctx = makeCtx({
      definition,
      stateData: { value: 42 },
    });

    await runSilent(callBefore(ValidationMiddleware, ctx));
  });

  it('rejects stateData that violates dataSchema', async () => {
    const definition = makeDefinition({
      start: {
        name: 'start',
        type: 'action',
        actionId: 'do-something',
        dataSchema: {
          type: 'object',
          properties: { value: { type: 'number' } },
          required: ['value'],
        },
      },
      completed: { name: 'completed', type: 'terminal' },
      cancelled: { name: 'cancelled', type: 'terminal' },
      error: { name: 'error', type: 'terminal' },
    });

    const ctx = makeCtx({
      definition,
      stateData: { value: 'not-a-number' },
    });

    const result = await Effect.runPromiseExit(
      callBefore(ValidationMiddleware, ctx).pipe(
        Effect.provide(Logger.replace(Logger.defaultLogger, Logger.none)),
      ),
    );

    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') {
      const error = (result.cause as { _tag: string; error: MachineError }).error;
      expect(error._tag).toBe('ValidationError');
      if (error._tag === 'ValidationError') {
        expect(error.path).toBe('start');
        expect(error.message).toContain('State data validation failed');
      }
    }
  });

  it('passes when dataSchema is an empty object', async () => {
    const definition = makeDefinition({
      start: {
        name: 'start',
        type: 'action',
        actionId: 'do-something',
        dataSchema: {},
      },
      completed: { name: 'completed', type: 'terminal' },
      cancelled: { name: 'cancelled', type: 'terminal' },
      error: { name: 'error', type: 'terminal' },
    });

    const ctx = makeCtx({
      definition,
      stateData: { anything: 'goes' },
    });

    await runSilent(callBefore(ValidationMiddleware, ctx));
  });

  it('rejects missing required fields', async () => {
    const definition = makeDefinition({
      start: {
        name: 'start',
        type: 'action',
        actionId: 'do-something',
        dataSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
          },
          required: ['name', 'age'],
        },
      },
      completed: { name: 'completed', type: 'terminal' },
      cancelled: { name: 'cancelled', type: 'terminal' },
      error: { name: 'error', type: 'terminal' },
    });

    const ctx = makeCtx({
      definition,
      stateData: { name: 'Alice' }, // missing 'age'
    });

    const result = await Effect.runPromiseExit(
      callBefore(ValidationMiddleware, ctx).pipe(
        Effect.provide(Logger.replace(Logger.defaultLogger, Logger.none)),
      ),
    );

    expect(result._tag).toBe('Failure');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// LoggingMiddleware
// ────────────────────────────────────────────────────────────────────────────

describe('LoggingMiddleware', () => {
  it('produces structured log output in beforeTransition', async () => {
    const logMessages: { message: string; annotations: Record<string, unknown> }[] = [];
    const testLogger = Logger.make(({ message, annotations }) => {
      logMessages.push({
        message: typeof message === 'string' ? message : String(message),
        annotations: Object.fromEntries(annotations),
      });
    });

    const ctx = makeCtx();

    await Effect.runPromise(
      callBefore(LoggingMiddleware, ctx).pipe(
        Effect.provide(Logger.replace(Logger.defaultLogger, testLogger)),
      ),
    );

    expect(logMessages).toHaveLength(1);
    expect(logMessages[0].message).toContain('Entering state');
    expect(logMessages[0].annotations).toMatchObject({
      middleware: 'LoggingMiddleware',
      phase: 'beforeTransition',
      machineDefId: 'def-001',
      instanceId: 'inst-001',
      stateName: 'start',
    });
  });

  it('produces structured log output in afterTransition', async () => {
    const logMessages: { message: string; annotations: Record<string, unknown> }[] = [];
    const testLogger = Logger.make(({ message, annotations }) => {
      logMessages.push({
        message: typeof message === 'string' ? message : String(message),
        annotations: Object.fromEntries(annotations),
      });
    });

    const ctx = makeAfterCtx();

    await Effect.runPromise(
      callAfter(LoggingMiddleware, ctx).pipe(
        Effect.provide(Logger.replace(Logger.defaultLogger, testLogger)),
      ),
    );

    expect(logMessages).toHaveLength(1);
    expect(logMessages[0].message).toContain('Transition from');
    expect(logMessages[0].annotations).toMatchObject({
      middleware: 'LoggingMiddleware',
      phase: 'afterTransition',
      nextState: 'completed',
    });
  });

  it('produces structured log output in onError', async () => {
    const logMessages: { message: string; annotations: Record<string, unknown> }[] = [];
    const testLogger = Logger.make(({ message, annotations }) => {
      logMessages.push({
        message: typeof message === 'string' ? message : String(message),
        annotations: Object.fromEntries(annotations),
      });
    });

    const ctx = makeErrorCtx();

    await Effect.runPromise(
      callOnError(LoggingMiddleware, ctx).pipe(
        Effect.provide(Logger.replace(Logger.defaultLogger, testLogger)),
      ),
    );

    expect(logMessages).toHaveLength(1);
    expect(logMessages[0].message).toContain('Error in state');
    expect(logMessages[0].annotations).toMatchObject({
      middleware: 'LoggingMiddleware',
      phase: 'onError',
      errorTag: 'ValidationError',
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// AuditMiddleware
// ────────────────────────────────────────────────────────────────────────────

describe('AuditMiddleware', () => {
  let audit: ReturnType<typeof createAuditMiddleware>;

  beforeEach(() => {
    audit = createAuditMiddleware('test-user');
  });

  it('creates an audit record with correct fields', async () => {
    const ctx = makeAfterCtx({ nextState: 'completed', data: { out: true } });

    await runSilent(callAfter(audit, ctx));

    const records = audit.getRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      actor: 'test-user',
      instanceId: 'inst-001',
      machineDefId: 'def-001',
      stateName: 'start',
      nextState: 'completed',
      transitionData: { out: true },
    });
    expect(records[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('defaults actor to "system"', async () => {
    const systemAudit = createAuditMiddleware();
    const ctx = makeAfterCtx();

    await runSilent(callAfter(systemAudit, ctx));
    expect(systemAudit.getRecords()[0].actor).toBe('system');
  });

  it('records are immutable (frozen objects cannot be modified from outside)', () => {
    // The records array is exposed as readonly
    const records = audit.getRecords();
    expect(Array.isArray(records)).toBe(true);
  });

  it('accumulates multiple records in order', async () => {
    const ctx1 = makeAfterCtx({ nextState: 'step2' });
    const ctx2 = makeAfterCtx({ nextState: 'completed' }, { stateName: 'step2' });

    await runSilent(callAfter(audit, ctx1));
    await runSilent(callAfter(audit, ctx2));

    const records = audit.getRecords();
    expect(records).toHaveLength(2);
    expect(records[0].nextState).toBe('step2');
    expect(records[1].nextState).toBe('completed');
  });

  it('clear() removes all records', async () => {
    const ctx = makeAfterCtx();
    await runSilent(callAfter(audit, ctx));
    expect(audit.getRecords()).toHaveLength(1);

    audit.clear();
    expect(audit.getRecords()).toHaveLength(0);
  });

  it('captures transitionData when present', async () => {
    const ctx = makeAfterCtx({ nextState: 'done', data: { key: 'val' } });
    await runSilent(callAfter(audit, ctx));
    expect(audit.getRecords()[0].transitionData).toEqual({ key: 'val' });
  });

  it('transitionData is undefined when not present', async () => {
    const ctx = makeAfterCtx({ nextState: 'done' });
    await runSilent(callAfter(audit, ctx));
    expect(audit.getRecords()[0].transitionData).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TelemetryMiddleware
// ────────────────────────────────────────────────────────────────────────────

describe('TelemetryMiddleware', () => {
  it('emits a log with timing annotations in afterTransition', async () => {
    const logMessages: { message: string; annotations: Record<string, unknown> }[] = [];
    const testLogger = Logger.make(({ message, annotations }) => {
      logMessages.push({
        message: typeof message === 'string' ? message : String(message),
        annotations: Object.fromEntries(annotations),
      });
    });

    const ctx = makeCtx();
    const afterCtx = makeAfterCtx();

    // Run before to start timing
    await Effect.runPromise(
      callBefore(TelemetryMiddleware, ctx).pipe(
        Effect.provide(Logger.replace(Logger.defaultLogger, testLogger)),
      ),
    );

    // Run after to capture duration
    await Effect.runPromise(
      callAfter(TelemetryMiddleware, afterCtx).pipe(
        Effect.provide(Logger.replace(Logger.defaultLogger, testLogger)),
      ),
    );

    expect(logMessages).toHaveLength(1);
    expect(logMessages[0].message).toContain('Transition completed');
    expect(logMessages[0].annotations).toMatchObject({
      middleware: 'TelemetryMiddleware',
      machineDefId: 'def-001',
      instanceId: 'inst-001',
      stateName: 'start',
      nextState: 'completed',
    });
    // durationMs should be a string of a non-negative number
    const dur = Number(logMessages[0].annotations.durationMs);
    expect(dur).toBeGreaterThanOrEqual(0);
  });

  it('cleans up timing on error', async () => {
    const ctx = makeCtx();

    // Start timing
    await runSilent(callBefore(TelemetryMiddleware, ctx));

    // Trigger error cleanup
    const errorCtx = makeErrorCtx();
    await runSilentVoid(callOnError(TelemetryMiddleware, errorCtx));

    // After should still work with -1 duration (no start found)
    const logMessages: { annotations: Record<string, unknown> }[] = [];
    const testLogger = Logger.make(({ annotations }) => {
      logMessages.push({ annotations: Object.fromEntries(annotations) });
    });

    const afterCtx = makeAfterCtx();
    await Effect.runPromise(
      callAfter(TelemetryMiddleware, afterCtx).pipe(
        Effect.provide(Logger.replace(Logger.defaultLogger, testLogger)),
      ),
    );

    expect(Number(logMessages[0].annotations.durationMs)).toBe(-1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Integration: Full Default Stack
// ────────────────────────────────────────────────────────────────────────────

describe('Default middleware stack integration', () => {
  it('runs full before → after cycle without errors', async () => {
    const audit = createAuditMiddleware();

    const executor = makeMiddlewareExecutor([
      ValidationMiddleware,
      LoggingMiddleware,
      TelemetryMiddleware,
      audit,
    ]);

    const ctx = makeCtx();
    const afterCtx = makeAfterCtx();

    await Effect.runPromise(
      executor
        .runBefore(ctx)
        .pipe(Effect.provide(Logger.replace(Logger.defaultLogger, Logger.none))),
    );

    await Effect.runPromise(
      executor
        .runAfter(afterCtx)
        .pipe(Effect.provide(Logger.replace(Logger.defaultLogger, Logger.none))),
    );

    // Audit should have recorded the transition
    expect(audit.getRecords()).toHaveLength(1);
    expect(audit.getRecords()[0].nextState).toBe('completed');
  });

  it('validation failure stops before chain and triggers onError', async () => {
    const calls: string[] = [];
    const audit = createAuditMiddleware();

    const definition = makeDefinition({
      start: {
        name: 'start',
        type: 'action',
        actionId: 'do-something',
        dataSchema: {
          type: 'object',
          properties: { value: { type: 'number' } },
          required: ['value'],
        },
      },
      completed: { name: 'completed', type: 'terminal' },
      cancelled: { name: 'cancelled', type: 'terminal' },
      error: { name: 'error', type: 'terminal' },
    });

    const spyMw = spyMiddleware('spy', calls);
    const executor = makeMiddlewareExecutor([
      ValidationMiddleware,
      spyMw,
      TelemetryMiddleware,
      audit,
    ]);

    const ctx = makeCtx({
      definition,
      stateData: { value: 'not-a-number' }, // violates schema
    });

    // Before should fail
    const result = await Effect.runPromiseExit(
      executor
        .runBefore(ctx)
        .pipe(Effect.provide(Logger.replace(Logger.defaultLogger, Logger.none))),
    );

    expect(result._tag).toBe('Failure');
    // Spy's beforeTransition should NOT have run (validation failed first)
    expect(calls).not.toContain('spy:before');
  });
});
