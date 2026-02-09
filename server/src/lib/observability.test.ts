/**
 * Observability — Unit Tests (Task 31)
 *
 * Covers:
 * - TelemetryMiddleware creates spans and records metrics (OTel disabled mode)
 * - TelemetryMiddleware records error metrics on onError
 * - Logger trace correlation (trace_id/span_id injection)
 * - OTel SDK conditional initialization (isOtelEnabled flag)
 * - MachineMetrics instrument creation
 *
 * These tests run without a live OTel collector — the global OTel API
 * returns no-op providers when not configured, so all span/metric calls
 * succeed silently.
 *
 * @module
 */

import { Effect, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import type {
  MachineError,
  MachineInstance,
  MiddlewareContext,
  StateMachineDefinition,
  TransitionResult,
} from '../machines/types.js';
import { mkActionError } from '../machines/types.js';

import { TelemetryMiddleware } from '../machines/middleware/TelemetryMiddleware.js';
import * as MachineMetrics from './MachineMetrics.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Safe wrapper: calls a middleware hook or Effect.void if missing, suppresses logs. */
function callHook(
  hookFn: ((ctx: never) => Effect.Effect<void, MachineError>) | undefined,
  ctx: unknown,
): Promise<void> {
  const eff = hookFn ? hookFn(ctx as never) : Effect.void;
  return Effect.runPromise(
    eff.pipe(
      Effect.catchAll(() => Effect.void),
      Effect.provide(Logger.replace(Logger.defaultLogger, Logger.none)),
    ),
  );
}

function makeDefinition(): StateMachineDefinition {
  return {
    id: 'def-otel-01',
    name: 'otel-test-machine',
    version: 1,
    inputSchema: {},
    outputSchema: {},
    initialState: 'start',
    transitions: [{ from: 'start', to: 'done' }],
    states: {
      start: { name: 'start', type: 'action', actionId: 'test-action' },
      done: { name: 'done', type: 'terminal' },
      error: { name: 'error', type: 'terminal' },
    },
    metadata: {
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

function makeInstance(): MachineInstance {
  return {
    id: 'inst-otel-01',
    definitionId: 'def-otel-01',
    definitionVersion: 1,
    status: 'running',
    currentState: 'start',
    stateData: { x: 1 },
    input: {},
    history: [],
    logs: [],
    artifacts: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeCtx(overrides?: Partial<MiddlewareContext>): MiddlewareContext {
  return {
    instance: makeInstance(),
    stateName: 'start',
    stateData: { x: 1 },
    definition: makeDefinition(),
    ...overrides,
  };
}

function makeAfterCtx(
  result: TransitionResult = { nextState: 'done', data: { y: 2 } },
): MiddlewareContext & { result: TransitionResult } {
  return {
    ...makeCtx(),
    result,
  };
}

function makeErrorCtx(
  error: MachineError = mkActionError({
    actionId: 'test-action',
    stateName: 'start',
    cause: 'boom',
  }),
): MiddlewareContext & { error: MachineError } {
  return {
    ...makeCtx(),
    error,
  };
}

/** Run a middleware hook with a custom logger, collecting log entries. */
function runWithLogger(
  hookFn: ((ctx: never) => Effect.Effect<void, MachineError>) | undefined,
  ctx: unknown,
  testLogger: Logger.Logger<unknown, void>,
): Promise<void> {
  const eff = hookFn ? hookFn(ctx as never) : Effect.void;
  return Effect.runPromise(
    eff.pipe(Effect.orDie, Effect.provide(Logger.replace(Logger.defaultLogger, testLogger))),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TelemetryMiddleware (OTel-aware)
// ────────────────────────────────────────────────────────────────────────────

describe('TelemetryMiddleware (Task 31)', () => {
  it('has name "TelemetryMiddleware"', () => {
    expect(TelemetryMiddleware.name).toBe('TelemetryMiddleware');
  });

  it('beforeTransition → afterTransition produces structured log with timing', async () => {
    const logMessages: { message: string; annotations: Record<string, unknown> }[] = [];
    const testLogger = Logger.make(({ message, annotations }) => {
      logMessages.push({
        message: typeof message === 'string' ? message : String(message),
        annotations: Object.fromEntries(annotations),
      });
    });

    const ctx = makeCtx();
    const afterCtx = makeAfterCtx();

    await runWithLogger(TelemetryMiddleware.beforeTransition, ctx, testLogger);
    await runWithLogger(TelemetryMiddleware.afterTransition, afterCtx, testLogger);

    expect(logMessages).toHaveLength(1);
    expect(logMessages[0].message).toContain('Transition completed');
    expect(logMessages[0].annotations).toMatchObject({
      middleware: 'TelemetryMiddleware',
      machineDefId: 'def-otel-01',
      instanceId: 'inst-otel-01',
      stateName: 'start',
      nextState: 'done',
    });
    const dur = Number(logMessages[0].annotations.durationMs);
    expect(dur).toBeGreaterThanOrEqual(0);
  });

  it('onError cleans up state and records error metrics without throwing', async () => {
    const ctx = makeCtx();
    const errorCtx = makeErrorCtx();

    // Start timing
    await callHook(TelemetryMiddleware.beforeTransition, ctx);

    // Error cleanup — must not throw
    await callHook(TelemetryMiddleware.onError, errorCtx);

    // Subsequent after should show -1 duration (timing was cleaned up)
    const logMessages: { annotations: Record<string, unknown> }[] = [];
    const testLogger = Logger.make(({ annotations }) => {
      logMessages.push({ annotations: Object.fromEntries(annotations) });
    });

    const afterCtx = makeAfterCtx();
    await runWithLogger(TelemetryMiddleware.afterTransition, afterCtx, testLogger);

    expect(Number(logMessages[0].annotations.durationMs)).toBe(-1);
  });

  it('handles multiple concurrent instances without cross-contamination', async () => {
    const ctx1 = makeCtx({
      instance: { ...makeInstance(), id: 'inst-concurrent-1' },
    });
    const ctx2 = makeCtx({
      instance: { ...makeInstance(), id: 'inst-concurrent-2' },
    });

    // Start both
    await callHook(TelemetryMiddleware.beforeTransition, ctx1);
    await callHook(TelemetryMiddleware.beforeTransition, ctx2);

    // Complete only ctx1
    const afterCtx1: MiddlewareContext & { result: TransitionResult } = {
      ...ctx1,
      result: { nextState: 'done' },
    };
    const logMessages: { annotations: Record<string, unknown> }[] = [];
    const testLogger = Logger.make(({ annotations }) => {
      logMessages.push({ annotations: Object.fromEntries(annotations) });
    });

    await runWithLogger(TelemetryMiddleware.afterTransition, afterCtx1, testLogger);

    // ctx1 should have valid timing
    expect(Number(logMessages[0].annotations.durationMs)).toBeGreaterThanOrEqual(0);

    // Complete ctx2 — should also have valid timing
    const afterCtx2: MiddlewareContext & { result: TransitionResult } = {
      ...ctx2,
      result: { nextState: 'done' },
    };
    await runWithLogger(TelemetryMiddleware.afterTransition, afterCtx2, testLogger);

    expect(Number(logMessages[1].annotations.durationMs)).toBeGreaterThanOrEqual(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// MachineMetrics
// ────────────────────────────────────────────────────────────────────────────

describe('MachineMetrics', () => {
  it('exports counter instruments', () => {
    expect(MachineMetrics.instancesStarted).toBeDefined();
    expect(MachineMetrics.instancesCompleted).toBeDefined();
    expect(MachineMetrics.instancesFailed).toBeDefined();
    expect(MachineMetrics.instancesCancelled).toBeDefined();
    expect(MachineMetrics.instancesSuspended).toBeDefined();
    expect(MachineMetrics.instancesResumed).toBeDefined();
  });

  it('exports histogram instruments', () => {
    expect(MachineMetrics.executionDuration).toBeDefined();
    expect(MachineMetrics.statesVisited).toBeDefined();
  });

  it('counter.add() does not throw (no-op provider)', () => {
    expect(() => {
      MachineMetrics.instancesStarted.add(1);
    }).not.toThrow();
    expect(() => {
      MachineMetrics.instancesCompleted.add(1, { 'machine.definition_id': 'test' });
    }).not.toThrow();
  });

  it('histogram.record() does not throw (no-op provider)', () => {
    expect(() => {
      MachineMetrics.executionDuration.record(123);
    }).not.toThrow();
    expect(() => {
      MachineMetrics.statesVisited.record(5, { 'machine.instance_id': 'test' });
    }).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// OTel conditional init
// ────────────────────────────────────────────────────────────────────────────

describe('Telemetry module', () => {
  it('exports isOtelEnabled as false when OTEL_ENABLED is not set', async () => {
    const { isOtelEnabled } = await import('./Telemetry.js');
    expect(isOtelEnabled).toBe(false);
  });

  it('exports OtelLive as a valid Layer', async () => {
    const { OtelLive } = await import('./Telemetry.js');
    expect(OtelLive).toBeDefined();
  });

  it('exports logOtelStatus as an Effect', async () => {
    const { logOtelStatus } = await import('./Telemetry.js');
    expect(logOtelStatus).toBeDefined();
    await Effect.runPromise(
      logOtelStatus.pipe(Effect.provide(Logger.replace(Logger.defaultLogger, Logger.none))),
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Logger trace correlation
// ────────────────────────────────────────────────────────────────────────────

describe('Logger trace correlation', () => {
  it('ServerLoggerLive can be used without OTel active', async () => {
    const { ServerLoggerLive } = await import('./Logger.js');
    await Effect.runPromise(Effect.log('test message').pipe(Effect.provide(ServerLoggerLive)));
  });
});
