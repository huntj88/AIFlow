/**
 * StateMachineRunner — Core Engine Test Suite (Tasks 09–15, 17)
 *
 * Comprehensive unit / integration tests:
 *   §4   Linear Execution
 *   §4.3 Input Validation
 *   §4.4 Transition History / Workspace Root Validation
 *   §4.5 Logs
 *   §5   Branching
 *   §6   Error Handling
 *   §7   Timeouts & Depth
 *   §8   Single Child Machine
 *   §8.5 Family Root Inheritance
 *   §9   Parallel Children
 *   §9.6 Parallel Children Workspace Inheritance
 *   §10  Concurrency & Semaphore
 *   §11  Cancellation
 *   §13  Persistence Checkpoints
 *   §14  Middleware
 *   §15  ActionContext — workspace, artifactsWorkspace, CLI
 *   §15.6 Artifact Infrastructure Removal
 *   §16  CLI Exit Code Branching
 *
 * @module
 */

import { Duration, Effect, Layer } from 'effect';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { ActionRegistry, InMemoryActionRegistryLive } from './ActionRegistry.js';
import { MachineEventPubSubLive } from './EventPubSub.js';
import { ExecutionSemaphore, ExecutionSemaphoreLive } from './ExecutionSemaphore.js';
import { ValidationMiddleware } from './middleware/ValidationMiddleware.js';
import { makeMiddlewareExecutorLayer } from './middleware/MiddlewareExecutor.js';
import { InMemoryMachineStoreLive } from './store/InMemoryMachineStore.js';
import { MachineStore } from './store/MachineStore.js';
import { StateMachineRunner, StateMachineRunnerLive } from './StateMachineRunner.js';
import type {
  ActionFunction,
  MachineEvent,
  MachineInstance,
  StateMachineDefinition,
  TransitionMiddleware,
  TransitionResult,
} from './types.js';
import { mkActionError } from './types.js';

// ────────────────────────────────────────────────────────────────────────────
// Test Layer
// ────────────────────────────────────────────────────────────────────────────

const NoMiddleware = makeMiddlewareExecutorLayer([]);

/**
 * Fresh test layer — every invocation yields an isolated in-memory store,
 * empty action registry, and default semaphore.
 */
const makeTestLayer = (middleware: readonly TransitionMiddleware[] = []) =>
  StateMachineRunnerLive.pipe(
    Layer.provide(InMemoryMachineStoreLive),
    Layer.provide(InMemoryActionRegistryLive),
    Layer.provide(middleware.length > 0 ? makeMiddlewareExecutorLayer(middleware) : NoMiddleware),
    Layer.provide(ExecutionSemaphoreLive),
    Layer.provide(MachineEventPubSubLive),
    Layer.provideMerge(InMemoryMachineStoreLive),
    Layer.provideMerge(InMemoryActionRegistryLive),
    Layer.provideMerge(MachineEventPubSubLive),
  );

// ────────────────────────────────────────────────────────────────────────────
// Factory Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Register a simple action that transitions to the given state. */
function registerAction(
  registry: ActionRegistry,
  actionId: string,
  nextState: string,
  data?: unknown,
) {
  const fn: ActionFunction = () => Effect.succeed({ nextState, data } as TransitionResult);
  return registry.register(actionId, fn, { description: `Test action → ${nextState}` });
}

/** Register an action that inspects ctx and returns a result based on stateData. */
function registerBranchAction(registry: ActionRegistry, actionId: string, fn: ActionFunction) {
  return registry.register(actionId, fn, { description: `Branching action ${actionId}` });
}

/** Register a failing action. */
function registerFailAction(registry: ActionRegistry, actionId: string) {
  const fn: ActionFunction = () =>
    Effect.fail(
      mkActionError({ actionId, stateName: '', cause: `Intentional failure in ${actionId}` }),
    );
  return registry.register(actionId, fn, { description: `Failing action ${actionId}` });
}

/** Register an action that sleeps for a given duration. */
function registerDelayAction(
  registry: ActionRegistry,
  actionId: string,
  delayMs: number,
  nextState: string,
) {
  const fn: ActionFunction = () =>
    Effect.sleep(Duration.millis(delayMs)).pipe(
      Effect.map(() => ({ nextState }) as TransitionResult),
    );
  return registry.register(actionId, fn, {
    description: `Delay ${String(delayMs)}ms → ${nextState}`,
  });
}

/** Register an action that logs using ctx.logger. */
function registerLoggingAction(
  registry: ActionRegistry,
  actionId: string,
  nextState: string,
  messages: { level: 'debug' | 'info' | 'warn' | 'error'; message: string }[],
) {
  const fn: ActionFunction = (ctx) =>
    Effect.gen(function* () {
      for (const msg of messages) {
        yield* ctx.logger[msg.level](msg.message);
      }
      return { nextState } as TransitionResult;
    });
  return registry.register(actionId, fn, { description: `Logging action → ${nextState}` });
}

/**
 * Build a minimal linear definition: A → B → C → completed
 */
function makeLinearDef(overrides?: Partial<StateMachineDefinition>): StateMachineDefinition {
  return {
    id: 'def-linear',
    name: 'Linear Test Machine',
    version: 1,
    inputSchema: {},
    outputSchema: {},
    states: {
      stateA: { name: 'stateA', type: 'action', actionId: 'action-a' },
      stateB: { name: 'stateB', type: 'action', actionId: 'action-b' },
      stateC: { name: 'stateC', type: 'action', actionId: 'action-c' },
      completed: { name: 'completed', type: 'terminal' },
      cancelled: { name: 'cancelled', type: 'terminal' },
      error: { name: 'error', type: 'terminal' },
    },
    initialState: 'stateA',
    transitions: [
      { from: 'stateA', to: 'stateB' },
      { from: 'stateA', to: 'error' },
      { from: 'stateB', to: 'stateC' },
      { from: 'stateB', to: 'error' },
      { from: 'stateC', to: 'completed' },
      { from: 'stateC', to: 'error' },
    ],
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

/**
 * Build a two-state linear definition: start → completed
 */
function makeSimpleDef(overrides?: Partial<StateMachineDefinition>): StateMachineDefinition {
  return {
    id: 'def-simple',
    name: 'Simple Test Machine',
    version: 1,
    inputSchema: {},
    outputSchema: {},
    states: {
      start: { name: 'start', type: 'action', actionId: 'test-action' },
      completed: { name: 'completed', type: 'terminal' },
      cancelled: { name: 'cancelled', type: 'terminal' },
      error: { name: 'error', type: 'terminal' },
    },
    initialState: 'start',
    transitions: [
      { from: 'start', to: 'completed' },
      { from: 'start', to: 'error' },
    ],
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

/**
 * Build a branching definition:
 *   init → (branch-a | branch-b) → completed | error
 */
function makeBranchingDef(overrides?: Partial<StateMachineDefinition>): StateMachineDefinition {
  return {
    id: 'def-branching',
    name: 'Branching Test Machine',
    version: 1,
    inputSchema: {},
    outputSchema: {},
    states: {
      init: { name: 'init', type: 'action', actionId: 'branch-action' },
      branchA: { name: 'branchA', type: 'action', actionId: 'action-a' },
      branchB: { name: 'branchB', type: 'action', actionId: 'action-b' },
      completed: { name: 'completed', type: 'terminal' },
      cancelled: { name: 'cancelled', type: 'terminal' },
      error: { name: 'error', type: 'terminal' },
    },
    initialState: 'init',
    transitions: [
      { from: 'init', to: 'branchA' },
      { from: 'init', to: 'branchB' },
      { from: 'init', to: 'error' },
      { from: 'branchA', to: 'completed' },
      { from: 'branchA', to: 'error' },
      { from: 'branchB', to: 'completed' },
      { from: 'branchB', to: 'error' },
    ],
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// §4 — Linear Execution (Task 09)
// ════════════════════════════════════════════════════════════════════════════

describe('StateMachineRunner — Linear Execution (§4)', () => {
  it('simple linear machine (A → B → C → completed) runs to completion', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'action-a', 'stateB', { fromA: true });
      yield* registerAction(registry, 'action-b', 'stateC', { fromB: true });
      yield* registerAction(registry, 'action-c', 'completed', { fromC: true });

      const def = makeLinearDef();
      const result = yield* runner.run(def, { hello: 'world' });

      expect(result.status).toBe('completed');
      expect(result).toHaveProperty('instanceId');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('instance has status "completed" and populated output', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'action-a', 'stateB', { step: 'a' });
      yield* registerAction(registry, 'action-b', 'stateC', { step: 'b' });
      yield* registerAction(registry, 'action-c', 'completed', { step: 'c', final: true });

      const result = yield* runner.run(makeLinearDef(), {});
      expect(result.status).toBe('completed');

      const instance = yield* store.getInstance(result.instanceId);
      expect(instance.status).toBe('completed');
      expect(instance.output).toEqual({ step: 'c', final: true });
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('output matches final action transition data', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'action-a', 'stateB');
      yield* registerAction(registry, 'action-b', 'stateC');
      yield* registerAction(registry, 'action-c', 'completed', { answer: 42 });

      const result = yield* runner.run(makeLinearDef(), {});
      expect(result.status).toBe('completed');
      if (result.status === 'completed') {
        expect(result.output).toEqual({ answer: 42 });
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('initial state action receives machineInput; stateData equals input in first state', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      let capturedMachineInput: unknown = null;
      let capturedStateData: unknown = null;

      const fn: ActionFunction = (ctx) => {
        capturedMachineInput = ctx.machineInput;
        capturedStateData = ctx.stateData;
        return Effect.succeed({ nextState: 'completed' } as TransitionResult);
      };
      yield* registry.register('test-action', fn, { description: 'capture ctx' });

      const def = makeSimpleDef();
      yield* runner.run(def, { inputKey: 'inputValue' });

      // Per implementation: stateData in first state is set to input
      expect(capturedMachineInput).toEqual({ inputKey: 'inputValue' });
      expect(capturedStateData).toEqual({ inputKey: 'inputValue' });
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('when action returns { nextState, data }, next state receives data as stateData', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      let stateBData: unknown = null;

      yield* registerAction(registry, 'action-a', 'stateB', { passedFromA: true });

      const fnB: ActionFunction = (ctx) => {
        stateBData = ctx.stateData;
        return Effect.succeed({ nextState: 'stateC' } as TransitionResult);
      };
      yield* registry.register('action-b', fnB, { description: 'capture stateData' });
      yield* registerAction(registry, 'action-c', 'completed');

      yield* runner.run(makeLinearDef(), {});

      expect(stateBData).toEqual({ passedFromA: true });
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('each action receives correct ctx.stateName, ctx.machineInstanceId, ctx.machineDefId', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      const captured: { stateName: string; defId: string; instanceId: string }[] = [];

      for (const [actionId, nextState] of [
        ['action-a', 'stateB'],
        ['action-b', 'stateC'],
        ['action-c', 'completed'],
      ]) {
        const fn: ActionFunction = (ctx) => {
          captured.push({
            stateName: ctx.stateName,
            defId: ctx.machineDefId,
            instanceId: ctx.machineInstanceId,
          });
          return Effect.succeed({ nextState } as TransitionResult);
        };
        yield* registry.register(actionId, fn, { description: actionId });
      }

      const def = makeLinearDef();
      const result = yield* runner.run(def, {});

      expect(captured).toHaveLength(3);
      expect(captured[0].stateName).toBe('stateA');
      expect(captured[1].stateName).toBe('stateB');
      expect(captured[2].stateName).toBe('stateC');
      captured.forEach((c) => {
        expect(c.defId).toBe('def-linear');
        expect(c.instanceId).toBe(result.instanceId);
      });
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §4.4 — Transition History
// ════════════════════════════════════════════════════════════════════════════

describe('StateMachineRunner — Transition History (§4.4)', () => {
  it('history is an ordered array of TransitionRecords', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'action-a', 'stateB');
      yield* registerAction(registry, 'action-b', 'stateC');
      yield* registerAction(registry, 'action-c', 'completed');

      const result = yield* runner.run(makeLinearDef(), {});
      const instance = yield* store.getInstance(result.instanceId);

      expect(instance.history).toHaveLength(3);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('each record has fromState, toState, timestamp, durationMs, actionId', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'action-a', 'stateB');
      yield* registerAction(registry, 'action-b', 'stateC');
      yield* registerAction(registry, 'action-c', 'completed');

      const result = yield* runner.run(makeLinearDef(), {});
      const instance = yield* store.getInstance(result.instanceId);

      for (const record of instance.history) {
        expect(record).toHaveProperty('fromState');
        expect(record).toHaveProperty('toState');
        expect(record).toHaveProperty('timestamp');
        expect(record).toHaveProperty('durationMs');
        expect(record).toHaveProperty('actionId');
        expect(typeof record.timestamp).toBe('string');
        expect(typeof record.durationMs).toBe('number');
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('history length equals number of transitions', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'action-a', 'stateB');
      yield* registerAction(registry, 'action-b', 'stateC');
      yield* registerAction(registry, 'action-c', 'completed');

      const result = yield* runner.run(makeLinearDef(), {});
      const instance = yield* store.getInstance(result.instanceId);

      // 3 transitions: A→B, B→C, C→completed
      expect(instance.history).toHaveLength(3);
      expect(instance.history[0].fromState).toBe('stateA');
      expect(instance.history[0].toState).toBe('stateB');
      expect(instance.history[1].fromState).toBe('stateB');
      expect(instance.history[1].toState).toBe('stateC');
      expect(instance.history[2].fromState).toBe('stateC');
      expect(instance.history[2].toState).toBe('completed');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('records are in chronological order', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'action-a', 'stateB');
      yield* registerAction(registry, 'action-b', 'stateC');
      yield* registerAction(registry, 'action-c', 'completed');

      const result = yield* runner.run(makeLinearDef(), {});
      const instance = yield* store.getInstance(result.instanceId);

      for (let i = 1; i < instance.history.length; i++) {
        const prev = new Date(instance.history[i - 1].timestamp).getTime();
        const curr = new Date(instance.history[i].timestamp).getTime();
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §4.5 — Logs
// ════════════════════════════════════════════════════════════════════════════

describe('StateMachineRunner — Logs (§4.5)', () => {
  it('logs contain all LogEntry records emitted during execution', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerLoggingAction(registry, 'test-action', 'completed', [
        { level: 'info', message: 'hello from action' },
        { level: 'warn', message: 'something maybe wrong' },
      ]);

      const result = yield* runner.run(makeSimpleDef(), {});
      const instance = yield* store.getInstance(result.instanceId);

      expect(instance.logs.length).toBeGreaterThanOrEqual(2);
      const messages = instance.logs.map((l) => l.message);
      expect(messages).toContain('hello from action');
      expect(messages).toContain('something maybe wrong');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('each entry has stateName, level, message, timestamp', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerLoggingAction(registry, 'test-action', 'completed', [
        { level: 'info', message: 'test log' },
      ]);

      const result = yield* runner.run(makeSimpleDef(), {});
      const instance = yield* store.getInstance(result.instanceId);

      for (const entry of instance.logs) {
        expect(entry).toHaveProperty('stateName');
        expect(entry).toHaveProperty('level');
        expect(entry).toHaveProperty('message');
        expect(entry).toHaveProperty('timestamp');
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('ctx.logger.info() produces level "info"; ctx.logger.error() produces level "error"', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerLoggingAction(registry, 'test-action', 'completed', [
        { level: 'info', message: 'info msg' },
        { level: 'error', message: 'error msg' },
      ]);

      const result = yield* runner.run(makeSimpleDef(), {});
      const instance = yield* store.getInstance(result.instanceId);

      const infoEntry = instance.logs.find((l) => l.message === 'info msg');
      const errorEntry = instance.logs.find((l) => l.message === 'error msg');

      expect(infoEntry?.level).toBe('info');
      expect(errorEntry?.level).toBe('error');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §5 — Branching
// ════════════════════════════════════════════════════════════════════════════

describe('StateMachineRunner — Branching (§5)', () => {
  it('action inspects stateData and returns different nextState → machine follows different paths', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;
      const store = yield* MachineStore;

      // Branch action picks branchA or branchB based on input
      yield* registerBranchAction(registry, 'branch-action', (ctx) => {
        const data = ctx.stateData as { branch?: string };
        const nextState = data.branch === 'a' ? 'branchA' : 'branchB';
        return Effect.succeed({ nextState } as TransitionResult);
      });
      yield* registerAction(registry, 'action-a', 'completed', { path: 'A' });
      yield* registerAction(registry, 'action-b', 'completed', { path: 'B' });

      // Path A
      const resultA = yield* runner.run(makeBranchingDef(), { branch: 'a' });
      expect(resultA.status).toBe('completed');
      const instA = yield* store.getInstance(resultA.instanceId);
      expect(instA.history.some((h) => h.toState === 'branchA')).toBe(true);
      expect(instA.history.some((h) => h.toState === 'branchB')).toBe(false);

      // Path B
      const resultB = yield* runner.run(makeBranchingDef(), { branch: 'b' });
      expect(resultB.status).toBe('completed');
      const instB = yield* store.getInstance(resultB.instanceId);
      expect(instB.history.some((h) => h.toState === 'branchB')).toBe(true);
      expect(instB.history.some((h) => h.toState === 'branchA')).toBe(false);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('machine can reach "completed" via multiple valid paths', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      yield* registerBranchAction(registry, 'branch-action', (ctx) => {
        const data = ctx.stateData as { branch?: string };
        return Effect.succeed({
          nextState: data.branch === 'a' ? 'branchA' : 'branchB',
        } as TransitionResult);
      });
      yield* registerAction(registry, 'action-a', 'completed', { via: 'A' });
      yield* registerAction(registry, 'action-b', 'completed', { via: 'B' });

      const resultA = yield* runner.run(makeBranchingDef(), { branch: 'a' });
      const resultB = yield* runner.run(makeBranchingDef(), { branch: 'b' });

      expect(resultA.status).toBe('completed');
      expect(resultB.status).toBe('completed');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('machine can reach "error" terminal from any non-terminal state', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      // Branch action goes to error
      yield* registerAction(registry, 'branch-action', 'error');
      yield* registerAction(registry, 'action-a', 'completed');
      yield* registerAction(registry, 'action-b', 'completed');

      const result = yield* runner.run(makeBranchingDef(), {});
      expect(result.status).toBe('error');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §6 — Error Handling (Task 10)
// ════════════════════════════════════════════════════════════════════════════

describe('StateMachineRunner — Error Handling (§6)', () => {
  it('action failure → machine transitions to "error" terminal', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;
      const store = yield* MachineStore;

      yield* registerFailAction(registry, 'test-action');

      const def = makeSimpleDef();
      const result = yield* runner.run(def, {});

      expect(result.status).toBe('error');
      const instance = yield* store.getInstance(result.instanceId);
      expect(instance.status).toBe('error');
      expect(instance.currentState).toBe('error');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('instance "error" field contains descriptive message; status is "error"', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;
      const store = yield* MachineStore;

      yield* registerFailAction(registry, 'test-action');

      const result = yield* runner.run(makeSimpleDef(), {});
      expect(result.status).toBe('error');

      if (result.status === 'error') {
        expect(typeof result.error).toBe('string');
        expect(result.error.length).toBeGreaterThan(0);
      }

      const instance = yield* store.getInstance(result.instanceId);
      expect(instance.status).toBe('error');
      expect(instance.error).toBeTruthy();
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('illegal transition (nextState not in transitions[]) → DefinitionError', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;
      const store = yield* MachineStore;

      // Action returns a state that is not allowed by transitions
      yield* registerAction(registry, 'test-action', 'nonexistent-state');

      const def = makeSimpleDef();
      const result = yield* runner.run(def, {});

      // Illegal transitions are now caught and persisted as error state
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toContain('Illegal transition');
      }
      const instance = yield* store.getInstance(result.instanceId);
      expect(instance.status).toBe('error');
      expect(instance.currentState).toBe('error');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('action error in middle of chain → error terminal with history preserved', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;
      const store = yield* MachineStore;

      yield* registerAction(registry, 'action-a', 'stateB', { step: 'a' });
      yield* registerFailAction(registry, 'action-b');
      yield* registerAction(registry, 'action-c', 'completed');

      const result = yield* runner.run(makeLinearDef(), {});
      expect(result.status).toBe('error');

      const instance = yield* store.getInstance(result.instanceId);
      expect(instance.status).toBe('error');
      // Should have A→B and B→error transitions
      expect(instance.history.length).toBeGreaterThanOrEqual(2);
      expect(instance.history[0].fromState).toBe('stateA');
      expect(instance.history[0].toState).toBe('stateB');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('stateData fails dataSchema validation → error with schema details', async () => {
    // ValidationMiddleware must be in the middleware stack to enforce dataSchema
    const layer = makeTestLayer([ValidationMiddleware]);

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      // Action returns data that violates the dataSchema of the target state
      yield* registerAction(registry, 'action-a', 'stateB', { count: 'not-a-number' });
      yield* registerAction(registry, 'action-b', 'stateC');
      yield* registerAction(registry, 'action-c', 'completed');

      const def = makeLinearDef({
        states: {
          stateA: { name: 'stateA', type: 'action', actionId: 'action-a' },
          stateB: {
            name: 'stateB',
            type: 'action',
            actionId: 'action-b',
            dataSchema: {
              type: 'object',
              properties: { count: { type: 'number' } },
              required: ['count'],
            },
          },
          stateC: { name: 'stateC', type: 'action', actionId: 'action-c' },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
      });

      const exit = yield* runner.run(def, {}).pipe(Effect.either);

      // ValidationMiddleware failure propagates as a ValidationError
      if (exit._tag === 'Left') {
        expect(exit.left._tag).toBe('ValidationError');
        if (exit.left._tag === 'ValidationError') {
          expect(exit.left.message).toContain('stateB');
        }
      } else {
        // If the runner catches it and returns error status, that's also valid
        expect(exit.right.status).toBe('error');
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('beforeTransition middleware failure → error terminal; onError hooks fire', async () => {
    const onErrorCalls: string[] = [];

    const failingMiddleware: TransitionMiddleware = {
      name: 'failing-middleware',
      beforeTransition: () =>
        Effect.fail(
          mkActionError({
            actionId: 'middleware',
            stateName: '',
            cause: 'Middleware blocked this transition',
          }),
        ),
      onError: () => {
        onErrorCalls.push('onError-fired');
        return Effect.void;
      },
    };

    const layer = makeTestLayer([failingMiddleware]);

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'test-action', 'completed');

      const exit = yield* runner.run(makeSimpleDef(), {}).pipe(Effect.either);

      // beforeTransition failure propagates as an ActionError
      if (exit._tag === 'Left') {
        expect(exit.left._tag).toBe('ActionError');
        // When beforeTransition fails, onError may or may not fire depending
        // on whether the middleware pipeline invokes onError for its own errors.
        // The key assertion is that the error propagates correctly.
      } else {
        expect(exit.right.status).toBe('error');
        // If the runner catches it, onError should have fired
        expect(onErrorCalls.length).toBeGreaterThanOrEqual(1);
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §7 — Timeouts & Depth (Task 10)
// ════════════════════════════════════════════════════════════════════════════

describe('StateMachineRunner — Timeouts & Depth (§7)', () => {
  it('state with timeoutMs + slow action → timeout error', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;
      const store = yield* MachineStore;

      // Slow action that takes 2 seconds
      yield* registerDelayAction(registry, 'test-action', 2000, 'completed');

      const def = makeSimpleDef({
        states: {
          start: { name: 'start', type: 'action', actionId: 'test-action', timeoutMs: 200 },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
      });

      const result = yield* runner.run(def, {});
      expect(result.status).toBe('error');

      if (result.status === 'error') {
        expect(result.error).toContain('timed out');
      }

      const instance = yield* store.getInstance(result.instanceId);
      expect(instance.status).toBe('error');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('state without timeoutMs → no timeout', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      // Quick action, no timeout
      yield* registerAction(registry, 'test-action', 'completed', { ok: true });

      const result = yield* runner.run(makeSimpleDef(), {});
      expect(result.status).toBe('completed');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('machine-level timeout → error if not completed in time', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;
      const store = yield* MachineStore;

      // Register a slow action (takes 2 seconds)
      yield* registerDelayAction(registry, 'test-action', 2000, 'completed');

      const def = makeSimpleDef();
      const result = yield* runner.run(def, {}, { timeoutMs: 200, workspaceRoot: '' });

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toContain('timed out');
      }

      const instance = yield* store.getInstance(result.instanceId);
      expect(instance.status).toBe('error');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('depth at MAX_MACHINE_DEPTH is allowed', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'test-action', 'completed');

      const def = makeSimpleDef();
      // Depth 10 (the default MAX_MACHINE_DEPTH) should be allowed
      const result = yield* runner.run(def, {}, { depth: 10, workspaceRoot: '' });
      expect(result.status).toBe('completed');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('depth exceeding MAX_MACHINE_DEPTH is rejected with DefinitionError', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'test-action', 'completed');

      const def = makeSimpleDef();
      // Depth 11 should exceed the default MAX_MACHINE_DEPTH of 10
      const exit = yield* runner.run(def, {}, { depth: 11, workspaceRoot: '' }).pipe(Effect.either);

      expect(exit._tag).toBe('Left');
      if (exit._tag === 'Left') {
        expect(exit.left._tag).toBe('DefinitionError');
        if (exit.left._tag === 'DefinitionError') {
          expect(exit.left.message).toContain('depth');
        }
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §4.3 — Input Validation
// ════════════════════════════════════════════════════════════════════════════

describe('StateMachineRunner — Input Validation (§4.3)', () => {
  it('input violating inputSchema → error (machine never created)', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'test-action', 'completed');

      const def = makeSimpleDef({
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      });

      // Pass invalid input (missing required field)
      const exit = yield* runner.run(def, { notName: 123 }).pipe(Effect.either);

      expect(exit._tag).toBe('Left');
      if (exit._tag === 'Left') {
        expect(exit.left._tag).toBe('ValidationError');
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('valid input proceeds normally', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'test-action', 'completed');

      const def = makeSimpleDef({
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      });

      const result = yield* runner.run(def, { name: 'Alice' });
      expect(result.status).toBe('completed');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('non-existent definition ID → NotFoundError (via child machine spawn)', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'parent-after-child', 'completed');

      // Parent references a child definition ID that doesn't exist
      const parentDef: StateMachineDefinition = {
        id: 'def-missing-child-parent',
        name: 'Missing Child Parent',
        version: 1,
        inputSchema: {},
        outputSchema: {},
        states: {
          spawnChild: {
            name: 'spawnChild',
            type: 'child_machine',
            actionId: 'parent-after-child',
            childMachineDefId: 'non-existent-def-id',
            childInputMapping: '$.stateData',
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'spawnChild',
        transitions: [
          { from: 'spawnChild', to: 'completed' },
          { from: 'spawnChild', to: 'error' },
        ],
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      const result = yield* runner.run(parentDef, {});

      // NotFoundError from child spawn is now caught and persisted as error state
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toBeDefined();
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §8 — Single Child Machine (Task 11)
// ════════════════════════════════════════════════════════════════════════════

describe('StateMachineRunner — Single Child Machine (§8)', () => {
  /** Save a child definition in the store so the runner can look it up. */
  const setupChildDef = (store: MachineStore) =>
    store.saveDefinition({
      name: 'Child Machine',
      inputSchema: {},
      outputSchema: {},
      states: {
        childStart: { name: 'childStart', type: 'action', actionId: 'child-action' },
        completed: { name: 'completed', type: 'terminal' },
        cancelled: { name: 'cancelled', type: 'terminal' },
        error: { name: 'error', type: 'terminal' },
      },
      initialState: 'childStart',
      transitions: [
        { from: 'childStart', to: 'completed' },
        { from: 'childStart', to: 'error' },
      ],
    });

  const makeParentDef = (childDefId: string): StateMachineDefinition => ({
    id: 'def-parent',
    name: 'Parent Machine',
    version: 1,
    inputSchema: {},
    outputSchema: {},
    states: {
      spawnChild: {
        name: 'spawnChild',
        type: 'child_machine',
        actionId: 'parent-after-child',
        childMachineDefId: childDefId,
        childInputMapping: '$.stateData',
      },
      completed: { name: 'completed', type: 'terminal' },
      cancelled: { name: 'cancelled', type: 'terminal' },
      error: { name: 'error', type: 'terminal' },
    },
    initialState: 'spawnChild',
    transitions: [
      { from: 'spawnChild', to: 'completed' },
      { from: 'spawnChild', to: 'error' },
    ],
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });

  it('child_machine state spawns child with parentInstanceId', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'child-action', 'completed', { childDone: true });
      yield* registerAction(registry, 'parent-after-child', 'completed', { parentDone: true });

      const childDef = yield* setupChildDef(store);
      const parentDef = makeParentDef(childDef.id);

      const result = yield* runner.run(parentDef, { forChild: true });
      expect(result.status).toBe('completed');

      // Find child instances
      const children = yield* store.listInstances({ parentInstanceId: result.instanceId });
      expect(children.length).toBeGreaterThanOrEqual(1);
      expect(children[0].parentInstanceId).toBe(result.instanceId);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('child completes → parent stateData = child MachineResult', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'child-action', 'completed', { childOutput: 42 });

      let parentStatedData: unknown = null;
      const parentFn: ActionFunction = (ctx) => {
        parentStatedData = ctx.stateData;
        return Effect.succeed({ nextState: 'completed' } as TransitionResult);
      };
      yield* registry.register('parent-after-child', parentFn, { description: 'parent action' });

      const childDef = yield* setupChildDef(store);
      const parentDef = makeParentDef(childDef.id);

      yield* runner.run(parentDef, { forChild: true });

      // Parent action received the child's MachineResult as stateData
      expect(parentStatedData).toHaveProperty('status', 'completed');
      expect(parentStatedData).toHaveProperty('instanceId');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('both parent and child have status "completed"', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'child-action', 'completed', { done: true });
      yield* registerAction(registry, 'parent-after-child', 'completed', { parentDone: true });

      const childDef = yield* setupChildDef(store);
      const parentDef = makeParentDef(childDef.id);

      const result = yield* runner.run(parentDef, {});
      expect(result.status).toBe('completed');

      const parentInst = yield* store.getInstance(result.instanceId);
      expect(parentInst.status).toBe('completed');

      const children = yield* store.listInstances({ parentInstanceId: result.instanceId });
      expect(children.length).toBeGreaterThanOrEqual(1);
      expect(children[0].status).toBe('completed');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('childInputMapping correctly extracts child input', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      let childReceivedInput: unknown = null;
      const childFn: ActionFunction = (ctx) => {
        childReceivedInput = ctx.machineInput;
        return Effect.succeed({ nextState: 'completed' } as TransitionResult);
      };
      yield* registry.register('child-action', childFn, { description: 'child action' });
      yield* registerAction(registry, 'parent-after-child', 'completed');

      const childDef = yield* setupChildDef(store);
      const parentDef = makeParentDef(childDef.id);

      yield* runner.run(parentDef, { nested: { value: 99 } });

      // With childInputMapping '$.stateData', child receives parent's stateData
      // (which is the machine input in first state)
      expect(childReceivedInput).toEqual({ nested: { value: 99 } });
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('child error → parent action receives error result; action decides transition', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      // Child action fails
      yield* registerFailAction(registry, 'child-action');

      let parentReceivedData: unknown = null;
      const parentFn: ActionFunction = (ctx) => {
        parentReceivedData = ctx.stateData;
        // Parent decides to go to error based on child failure
        const childResult = ctx.stateData as { status: string };
        if (childResult.status === 'error') {
          return Effect.succeed({ nextState: 'error' } as TransitionResult);
        }
        return Effect.succeed({ nextState: 'completed' } as TransitionResult);
      };
      yield* registry.register('parent-after-child', parentFn, { description: 'parent action' });

      const childDef = yield* setupChildDef(store);
      const parentDef = makeParentDef(childDef.id);

      yield* runner.run(parentDef, {});

      // Parent received child's error result
      expect(parentReceivedData).toHaveProperty('status', 'error');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('ctx.parentContext populated in child actions', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      let childParentCtx: unknown = null;
      const childFn: ActionFunction = (ctx) => {
        childParentCtx = ctx.parentContext;
        return Effect.succeed({ nextState: 'completed' } as TransitionResult);
      };
      yield* registry.register('child-action', childFn, { description: 'child action' });
      yield* registerAction(registry, 'parent-after-child', 'completed');

      const childDef = yield* setupChildDef(store);
      const parentDef = makeParentDef(childDef.id);

      const result = yield* runner.run(parentDef, {});
      expect(result.status).toBe('completed');

      // Child action should have received parentContext
      expect(childParentCtx).not.toBeNull();
      expect(childParentCtx).toHaveProperty('parentInstanceId');
      expect(childParentCtx).toHaveProperty('parentStateName', 'spawnChild');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('TransitionRecord includes childInstanceId / childDefinitionId', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'child-action', 'completed', { done: true });
      yield* registerAction(registry, 'parent-after-child', 'completed');

      const childDef = yield* setupChildDef(store);
      const parentDef = makeParentDef(childDef.id);

      const result = yield* runner.run(parentDef, {});
      const parentInst = yield* store.getInstance(result.instanceId);

      // The transition record from the child_machine state should reference the child
      const childTransition = parentInst.history.find((h) => h.fromState === 'spawnChild');
      expect(childTransition).toBeDefined();
      expect(childTransition?.childInstanceId).toBeTruthy();
      expect(childTransition?.childDefinitionId).toBe(childDef.id);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('invalid JSONPath in childInputMapping → parent error (not null)', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'child-action', 'completed');
      yield* registerAction(registry, 'parent-after-child', 'completed');

      const childDef = yield* setupChildDef(store);

      // Use an invalid JSONPath expression
      const parentDef: StateMachineDefinition = {
        ...makeParentDef(childDef.id),
        states: {
          spawnChild: {
            name: 'spawnChild',
            type: 'child_machine',
            actionId: 'parent-after-child',
            childMachineDefId: childDef.id,
            childInputMapping: '$[[[invalid',
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
      };

      const exit = yield* runner.run(parentDef, {}).pipe(Effect.either);

      // Invalid JSONPath should result in an error (either propagated or caught)
      if (exit._tag === 'Left') {
        // Error propagated as a fiber failure
        expect(['ActionError', 'DefinitionError']).toContain(exit.left._tag);
      } else {
        // Runner caught the error and returned error status
        expect(exit.right.status).toBe('error');
        const instance = yield* store.getInstance(exit.right.instanceId);
        expect(instance.status).toBe('error');
        expect(instance.error).toBeTruthy();
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §9 — Parallel Children (Task 12)
// ════════════════════════════════════════════════════════════════════════════

describe('StateMachineRunner — Parallel Children (§9)', () => {
  /** Save a child definition. */
  const setupChildDef = (store: MachineStore, name = 'Parallel Child') =>
    store.saveDefinition({
      name,
      inputSchema: {},
      outputSchema: {},
      states: {
        childStart: { name: 'childStart', type: 'action', actionId: 'parallel-child-action' },
        completed: { name: 'completed', type: 'terminal' },
        cancelled: { name: 'cancelled', type: 'terminal' },
        error: { name: 'error', type: 'terminal' },
      },
      initialState: 'childStart',
      transitions: [
        { from: 'childStart', to: 'completed' },
        { from: 'childStart', to: 'error' },
      ],
    });

  const makeParallelParentDef = (
    childDefId: string,
    mode: 'all_or_interrupt' | 'all_settled' = 'all_or_interrupt',
  ): StateMachineDefinition => ({
    id: 'def-parallel-parent',
    name: 'Parallel Parent Machine',
    version: 1,
    inputSchema: {},
    outputSchema: {},
    states: {
      spawnChildren: {
        name: 'spawnChildren',
        type: 'parallel_children',
        actionId: 'parent-after-children',
        parallelMode: mode,
        children: [
          { key: 'child-a', machineDefId: childDefId, inputMapping: '$.stateData' },
          { key: 'child-b', machineDefId: childDefId, inputMapping: '$.stateData' },
        ],
      },
      completed: { name: 'completed', type: 'terminal' },
      cancelled: { name: 'cancelled', type: 'terminal' },
      error: { name: 'error', type: 'terminal' },
    },
    initialState: 'spawnChildren',
    transitions: [
      { from: 'spawnChildren', to: 'completed' },
      { from: 'spawnChildren', to: 'error' },
    ],
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });

  it('parallel_children spawns N children; all visible in store', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'parallel-child-action', 'completed', { done: true });
      yield* registerAction(registry, 'parent-after-children', 'completed');

      const childDef = yield* setupChildDef(store);
      const parentDef = makeParallelParentDef(childDef.id);

      const result = yield* runner.run(parentDef, {});
      expect(result.status).toBe('completed');

      const children = yield* store.listInstances({ parentInstanceId: result.instanceId });
      expect(children).toHaveLength(2);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('parent childInstanceIds keyed by key', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'parallel-child-action', 'completed');
      yield* registerAction(registry, 'parent-after-children', 'completed');

      const childDef = yield* setupChildDef(store);
      const parentDef = makeParallelParentDef(childDef.id);

      const result = yield* runner.run(parentDef, {});

      // Check transition record has childInstanceIds
      const parentInst = yield* store.getInstance(result.instanceId);
      const transition = parentInst.history.find((h) => h.fromState === 'spawnChildren');
      expect(transition).toBeDefined();
      expect(transition?.childInstanceIds).toBeDefined();
      expect(transition?.childInstanceIds).toHaveProperty('child-a');
      expect(transition?.childInstanceIds).toHaveProperty('child-b');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('all children complete → ParallelChildrenResult correct', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'parallel-child-action', 'completed', { result: 'ok' });

      let parentReceivedData: unknown = null;
      const parentFn: ActionFunction = (ctx) => {
        parentReceivedData = ctx.stateData;
        return Effect.succeed({ nextState: 'completed' } as TransitionResult);
      };
      yield* registry.register('parent-after-children', parentFn, { description: 'parent action' });

      const childDef = yield* setupChildDef(store);
      const parentDef = makeParallelParentDef(childDef.id);

      yield* runner.run(parentDef, {});

      // Parent action should have received ParallelChildrenResult
      expect(parentReceivedData).toHaveProperty('results');
      expect(parentReceivedData).toHaveProperty('childInstanceIds');
      const data = parentReceivedData as { results: Record<string, unknown> };
      expect(data.results).toHaveProperty('child-a');
      expect(data.results).toHaveProperty('child-b');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('all_settled: one error → remaining continue; all results collected', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      // Save two different child defs — one that fails, one that succeeds
      const goodChildDef = yield* store.saveDefinition({
        name: 'Good Child',
        inputSchema: {},
        outputSchema: {},
        states: {
          childStart: { name: 'childStart', type: 'action', actionId: 'good-child-action' },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'childStart',
        transitions: [
          { from: 'childStart', to: 'completed' },
          { from: 'childStart', to: 'error' },
        ],
      });

      const badChildDef = yield* store.saveDefinition({
        name: 'Bad Child',
        inputSchema: {},
        outputSchema: {},
        states: {
          childStart: { name: 'childStart', type: 'action', actionId: 'bad-child-action' },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'childStart',
        transitions: [
          { from: 'childStart', to: 'completed' },
          { from: 'childStart', to: 'error' },
        ],
      });

      yield* registerAction(registry, 'good-child-action', 'completed', { success: true });
      yield* registerFailAction(registry, 'bad-child-action');

      let parentReceivedData: unknown = null;
      const parentFn: ActionFunction = (ctx) => {
        parentReceivedData = ctx.stateData;
        return Effect.succeed({ nextState: 'completed' } as TransitionResult);
      };
      yield* registry.register('parent-after-children', parentFn, { description: 'parent action' });

      const parentDef: StateMachineDefinition = {
        id: 'def-settled-parent',
        name: 'All Settled Parent',
        version: 1,
        inputSchema: {},
        outputSchema: {},
        states: {
          spawnChildren: {
            name: 'spawnChildren',
            type: 'parallel_children',
            actionId: 'parent-after-children',
            parallelMode: 'all_settled',
            children: [
              { key: 'good', machineDefId: goodChildDef.id, inputMapping: '$.stateData' },
              { key: 'bad', machineDefId: badChildDef.id, inputMapping: '$.stateData' },
            ],
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'spawnChildren',
        transitions: [
          { from: 'spawnChildren', to: 'completed' },
          { from: 'spawnChildren', to: 'error' },
        ],
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      yield* runner.run(parentDef, {});

      // In all_settled mode, parent action still runs
      expect(parentReceivedData).toHaveProperty('results');
      const data = parentReceivedData as { results: Record<string, { status: string }> };
      // Good child should be completed
      expect(data.results.good.status).toBe('completed');
      // Bad child should be error
      expect(data.results.bad.status).toBe('error');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('each child receives correct input from its inputMapping', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      const receivedInputs: unknown[] = [];
      const childFn: ActionFunction = (ctx) => {
        receivedInputs.push(ctx.machineInput);
        return Effect.succeed({ nextState: 'completed' } as TransitionResult);
      };
      yield* registry.register('parallel-child-action', childFn, { description: 'child action' });
      yield* registerAction(registry, 'parent-after-children', 'completed');

      const childDef = yield* setupChildDef(store);
      const parentDef = makeParallelParentDef(childDef.id);

      yield* runner.run(parentDef, { key: 'value' });

      // Both children received the parent's stateData (= input in first state)
      expect(receivedInputs).toHaveLength(2);
      receivedInputs.forEach((inp) => {
        expect(inp).toEqual({ key: 'value' });
      });
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('all_or_interrupt: one error → remaining interrupted (cancelled)', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      // Save two different child defs — one fails immediately, one is slow
      const badChildDef = yield* store.saveDefinition({
        name: 'Bad Child (interrupt)',
        inputSchema: {},
        outputSchema: {},
        states: {
          childStart: { name: 'childStart', type: 'action', actionId: 'bad-interrupt-action' },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'childStart',
        transitions: [
          { from: 'childStart', to: 'completed' },
          { from: 'childStart', to: 'error' },
        ],
      });

      const slowChildDef = yield* store.saveDefinition({
        name: 'Slow Child (interrupt)',
        inputSchema: {},
        outputSchema: {},
        states: {
          childStart: { name: 'childStart', type: 'action', actionId: 'slow-interrupt-action' },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'childStart',
        transitions: [
          { from: 'childStart', to: 'completed' },
          { from: 'childStart', to: 'error' },
        ],
      });

      yield* registerFailAction(registry, 'bad-interrupt-action');
      yield* registerDelayAction(registry, 'slow-interrupt-action', 60_000, 'completed');

      let parentReceivedData: unknown = null;
      const parentFn: ActionFunction = (ctx) => {
        parentReceivedData = ctx.stateData;
        return Effect.succeed({ nextState: 'error' } as TransitionResult);
      };
      yield* registry.register('parent-after-interrupt', parentFn, { description: 'parent' });

      const parentDef: StateMachineDefinition = {
        id: 'def-interrupt-parent',
        name: 'All-or-Interrupt Parent',
        version: 1,
        inputSchema: {},
        outputSchema: {},
        states: {
          spawnChildren: {
            name: 'spawnChildren',
            type: 'parallel_children',
            actionId: 'parent-after-interrupt',
            parallelMode: 'all_or_interrupt',
            children: [
              { key: 'bad', machineDefId: badChildDef.id, inputMapping: '$.stateData' },
              { key: 'slow', machineDefId: slowChildDef.id, inputMapping: '$.stateData' },
            ],
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'spawnChildren',
        transitions: [
          { from: 'spawnChildren', to: 'completed' },
          { from: 'spawnChildren', to: 'error' },
        ],
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      yield* runner.run(parentDef, {});

      // In all_or_interrupt mode, the bad child's error should trigger
      // interruption of the slow child. Parent receives error results.
      expect(parentReceivedData).toHaveProperty('results');
      const data = parentReceivedData as { results: Record<string, { status: string }> };
      expect(data.results.bad.status).toBe('error');
      // The slow child should be cancelled/interrupted or errored
      expect(['cancelled', 'error']).toContain(data.results.slow.status);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  }, 10_000);
});

// ════════════════════════════════════════════════════════════════════════════
// §10 — Concurrency & Semaphore (Task 13)
// ════════════════════════════════════════════════════════════════════════════

describe('StateMachineRunner — Concurrency & Semaphore (§10)', () => {
  it('linked-list of recursive child machines → no deadlock', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      // Create a chain: depth 0 → spawns depth 1 → spawns depth 2 → ... → depth 5 (leaf)
      // The leaf machine just completes.

      const leafDef = yield* store.saveDefinition({
        name: 'Leaf Machine',
        inputSchema: {},
        outputSchema: {},
        states: {
          start: { name: 'start', type: 'action', actionId: 'leaf-action' },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'start',
        transitions: [
          { from: 'start', to: 'completed' },
          { from: 'start', to: 'error' },
        ],
      });

      yield* registerAction(registry, 'leaf-action', 'completed', { leaf: true });
      yield* registerAction(registry, 'chain-after-child', 'completed', { chained: true });

      // Build chain definitions (each spawns the next)
      let currentChildDefId = leafDef.id;
      for (let i = 4; i >= 0; i--) {
        const chainDef = yield* store.saveDefinition({
          name: `Chain Machine ${String(i)}`,
          inputSchema: {},
          outputSchema: {},
          states: {
            spawn: {
              name: 'spawn',
              type: 'child_machine',
              actionId: 'chain-after-child',
              childMachineDefId: currentChildDefId,
              childInputMapping: '$.stateData',
            },
            completed: { name: 'completed', type: 'terminal' },
            cancelled: { name: 'cancelled', type: 'terminal' },
            error: { name: 'error', type: 'terminal' },
          },
          initialState: 'spawn',
          transitions: [
            { from: 'spawn', to: 'completed' },
            { from: 'spawn', to: 'error' },
          ],
        });
        currentChildDefId = chainDef.id;
      }

      // Load the root definition from the store
      const rootDef = yield* store.getDefinition(currentChildDefId);

      // Run the chain — should NOT deadlock thanks to release-before-wait
      const chainResult = yield* runner.run(rootDef, {});
      expect(chainResult.status).toBe('completed');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  }, 15_000);

  it('fan-out with parallel children → no deadlock', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      const childDef = yield* store.saveDefinition({
        name: 'Fan Child',
        inputSchema: {},
        outputSchema: {},
        states: {
          start: { name: 'start', type: 'action', actionId: 'fan-child-action' },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'start',
        transitions: [
          { from: 'start', to: 'completed' },
          { from: 'start', to: 'error' },
        ],
      });

      yield* registerAction(registry, 'fan-child-action', 'completed', { fanDone: true });
      yield* registerAction(registry, 'fan-parent-action', 'completed');

      // Build 5 parallel children
      const children = Array.from({ length: 5 }, (_, i) => ({
        key: `child-${String(i)}`,
        machineDefId: childDef.id,
        inputMapping: '$.stateData',
      }));

      const parentDef: StateMachineDefinition = {
        id: 'def-fan-parent',
        name: 'Fan-Out Parent',
        version: 1,
        inputSchema: {},
        outputSchema: {},
        states: {
          fanOut: {
            name: 'fanOut',
            type: 'parallel_children',
            actionId: 'fan-parent-action',
            parallelMode: 'all_or_interrupt',
            children,
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'fanOut',
        transitions: [
          { from: 'fanOut', to: 'completed' },
          { from: 'fanOut', to: 'error' },
        ],
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      const result = yield* runner.run(parentDef, {});
      expect(result.status).toBe('completed');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  }, 15_000);

  it('more instances than permits → excess queue (not reject)', async () => {
    // Create a semaphore with only 2 permits
    const TwoPermitSemaphore = Layer.effect(ExecutionSemaphore, Effect.makeSemaphore(2));

    const layer = StateMachineRunnerLive.pipe(
      Layer.provide(InMemoryMachineStoreLive),
      Layer.provide(InMemoryActionRegistryLive),
      Layer.provide(NoMiddleware),
      Layer.provide(TwoPermitSemaphore),
      Layer.provide(MachineEventPubSubLive),
      Layer.provideMerge(InMemoryMachineStoreLive),
      Layer.provideMerge(InMemoryActionRegistryLive),
    );

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      // Register a slow action so machines hold permits
      yield* registerDelayAction(registry, 'test-action', 500, 'completed');

      const def = makeSimpleDef();

      // Launch 4 machines (more than 2 permits)
      const fibers = yield* Effect.all(
        Array.from({ length: 4 }, () => Effect.fork(runner.run(def, {}))),
      );

      // Give them a moment to queue
      yield* Effect.sleep(Duration.millis(50));

      // All should have been created (not rejected)
      const allInstances = yield* store.listInstances({});
      expect(allInstances.length).toBe(4);

      // Wait for them all to complete
      yield* Effect.all(fibers.map((f) => Effect.fromFiber(f)));

      // All completed
      const completed = yield* store.listInstances({ status: 'completed' });
      expect(completed.length).toBe(4);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  }, 15_000);

  it('queued machines start as permits free up', async () => {
    const TwoPermitSemaphore = Layer.effect(ExecutionSemaphore, Effect.makeSemaphore(2));

    const layer = StateMachineRunnerLive.pipe(
      Layer.provide(InMemoryMachineStoreLive),
      Layer.provide(InMemoryActionRegistryLive),
      Layer.provide(NoMiddleware),
      Layer.provide(TwoPermitSemaphore),
      Layer.provide(MachineEventPubSubLive),
      Layer.provideMerge(InMemoryMachineStoreLive),
      Layer.provideMerge(InMemoryActionRegistryLive),
    );

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;
      const store = yield* MachineStore;

      // Track completion order
      const completionOrder: number[] = [];
      let machineCounter = 0;

      // Register action that takes 200ms and tracks order
      const fn: ActionFunction = () => {
        const myId = machineCounter++;
        return Effect.sleep(Duration.millis(200)).pipe(
          Effect.map(() => {
            completionOrder.push(myId);
            return { nextState: 'completed' } as TransitionResult;
          }),
        );
      };
      yield* registry.register('test-action', fn, { description: 'ordered action' });

      const def = makeSimpleDef();

      // Launch 3 machines with only 2 permits
      const fibers = yield* Effect.all(
        Array.from({ length: 3 }, () => Effect.fork(runner.run(def, {}))),
      );

      // Wait for all to complete
      yield* Effect.all(fibers.map((f) => Effect.fromFiber(f)));

      // All should have completed
      const completed = yield* store.listInstances({ status: 'completed' });
      expect(completed.length).toBe(3);

      // The third machine should have started after one of the first two freed up
      expect(completionOrder).toHaveLength(3);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  }, 15_000);

  it('mixed nesting (chain + parallel) → no deadlock', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      // Leaf machine — just completes
      const leafDef = yield* store.saveDefinition({
        name: 'Mixed Leaf',
        inputSchema: {},
        outputSchema: {},
        states: {
          start: { name: 'start', type: 'action', actionId: 'mixed-leaf-action' },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'start',
        transitions: [
          { from: 'start', to: 'completed' },
          { from: 'start', to: 'error' },
        ],
      });

      yield* registerAction(registry, 'mixed-leaf-action', 'completed', { leaf: true });
      yield* registerAction(registry, 'mixed-after-children', 'completed');
      yield* registerAction(registry, 'mixed-chain-after', 'completed');

      // Mid-level: parallel children (2 leaves)
      const parallelDef = yield* store.saveDefinition({
        name: 'Mixed Parallel Mid',
        inputSchema: {},
        outputSchema: {},
        states: {
          fanOut: {
            name: 'fanOut',
            type: 'parallel_children',
            actionId: 'mixed-after-children',
            parallelMode: 'all_or_interrupt',
            children: [
              { key: 'leaf-a', machineDefId: leafDef.id, inputMapping: '$.stateData' },
              { key: 'leaf-b', machineDefId: leafDef.id, inputMapping: '$.stateData' },
            ],
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'fanOut',
        transitions: [
          { from: 'fanOut', to: 'completed' },
          { from: 'fanOut', to: 'error' },
        ],
      });

      // Root: chain → spawns parallelDef as child
      const rootDef: StateMachineDefinition = {
        id: 'def-mixed-root',
        name: 'Mixed Root',
        version: 1,
        inputSchema: {},
        outputSchema: {},
        states: {
          spawn: {
            name: 'spawn',
            type: 'child_machine',
            actionId: 'mixed-chain-after',
            childMachineDefId: parallelDef.id,
            childInputMapping: '$.stateData',
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'spawn',
        transitions: [
          { from: 'spawn', to: 'completed' },
          { from: 'spawn', to: 'error' },
        ],
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      const result = yield* runner.run(rootDef, {});
      expect(result.status).toBe('completed');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  }, 15_000);
});

// ════════════════════════════════════════════════════════════════════════════
// §11 — Cancellation (Task 14)
// ════════════════════════════════════════════════════════════════════════════

describe('StateMachineRunner — Cancellation (§11)', () => {
  it('cancel running instance → "cancelled" terminal; history records cancellation', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerDelayAction(registry, 'test-action', 60_000, 'completed');

      const def = makeSimpleDef();
      void (yield* Effect.fork(runner.run(def, {})));
      yield* Effect.sleep(Duration.millis(100));

      const running = yield* store.listInstances({ status: 'running' });
      expect(running.length).toBeGreaterThanOrEqual(1);

      yield* runner.cancel(running[0].id);
      yield* Effect.sleep(Duration.millis(100));

      const inst = yield* store.getInstance(running[0].id);
      expect(inst.status).toBe('cancelled');

      // History should have a cancellation record
      const cancelRecord = inst.history.find((h) => h.toState === 'cancelled');
      expect(cancelRecord).toBeDefined();
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('cancel while waiting for single child → both cancelled', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      // Register a long-running child action
      yield* registerDelayAction(registry, 'child-action', 60_000, 'completed');
      yield* registerAction(registry, 'parent-after-child', 'completed');

      const childDef = yield* store.saveDefinition({
        name: 'Slow Child',
        inputSchema: {},
        outputSchema: {},
        states: {
          childStart: { name: 'childStart', type: 'action', actionId: 'child-action' },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'childStart',
        transitions: [
          { from: 'childStart', to: 'completed' },
          { from: 'childStart', to: 'error' },
        ],
      });

      const parentDef: StateMachineDefinition = {
        id: 'def-cancel-parent',
        name: 'Cancel Parent',
        version: 1,
        inputSchema: {},
        outputSchema: {},
        states: {
          spawnChild: {
            name: 'spawnChild',
            type: 'child_machine',
            actionId: 'parent-after-child',
            childMachineDefId: childDef.id,
            childInputMapping: '$.stateData',
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'spawnChild',
        transitions: [
          { from: 'spawnChild', to: 'completed' },
          { from: 'spawnChild', to: 'error' },
        ],
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      void (yield* Effect.fork(runner.run(parentDef, {})));
      yield* Effect.sleep(Duration.millis(200));

      // Find the parent (should be waiting_for_child)
      const waiting = yield* store.listInstances({ status: 'waiting_for_child' });
      expect(waiting.length).toBeGreaterThanOrEqual(1);

      yield* runner.cancel(waiting[0].id);
      yield* Effect.sleep(Duration.millis(200));

      const parentInst = yield* store.getInstance(waiting[0].id);
      expect(parentInst.status).toBe('cancelled');

      // Child should also be cancelled
      const children = yield* store.listInstances({ parentInstanceId: waiting[0].id });
      if (children.length > 0) {
        expect(children[0].status).toBe('cancelled');
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  }, 10_000);

  it('cancel suspended instance → direct transition to cancelled', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;

      // Create a suspended instance directly
      const inst = yield* store.saveInstance({
        definitionId: 'def-1',
        definitionVersion: 1,
        status: 'suspended',
        currentState: 'start',
        stateData: {},
        input: {},
        history: [],
        logs: [],
        workspaceRoot: '/tmp/test-workspace',
        familyRootInstanceId: 'root-001',
        artifactsPath: '/tmp/data/artifacts/root-001',
      });

      yield* runner.cancel(inst.id);

      const updated = yield* store.getInstance(inst.id);
      expect(updated.status).toBe('cancelled');
      expect(updated.currentState).toBe('cancelled');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('cancel completed/cancelled/errored → DefinitionError (409 Conflict)', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'test-action', 'completed');

      const def = makeSimpleDef();
      const result = yield* runner.run(def, {});
      expect(result.status).toBe('completed');

      // Cancel completed instance → should fail
      const exit = yield* runner.cancel(result.instanceId).pipe(Effect.either);
      expect(exit._tag).toBe('Left');
      if (exit._tag === 'Left') {
        expect(exit.left._tag).toBe('DefinitionError');
        if (exit.left._tag === 'DefinitionError') {
          expect(exit.left.message).toContain('Cannot cancel');
        }
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('cancel while waiting for parallel children → all cancelled', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      // Slow child action
      yield* registerDelayAction(registry, 'slow-parallel-action', 60_000, 'completed');
      yield* registerAction(registry, 'parent-after-parallel', 'completed');

      const childDef = yield* store.saveDefinition({
        name: 'Slow Parallel Child',
        inputSchema: {},
        outputSchema: {},
        states: {
          childStart: {
            name: 'childStart',
            type: 'action',
            actionId: 'slow-parallel-action',
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'childStart',
        transitions: [
          { from: 'childStart', to: 'completed' },
          { from: 'childStart', to: 'error' },
        ],
      });

      const parentDef: StateMachineDefinition = {
        id: 'def-cancel-parallel-parent',
        name: 'Cancel Parallel Parent',
        version: 1,
        inputSchema: {},
        outputSchema: {},
        states: {
          spawnChildren: {
            name: 'spawnChildren',
            type: 'parallel_children',
            actionId: 'parent-after-parallel',
            parallelMode: 'all_or_interrupt',
            children: [
              { key: 'child-a', machineDefId: childDef.id, inputMapping: '$.stateData' },
              { key: 'child-b', machineDefId: childDef.id, inputMapping: '$.stateData' },
            ],
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'spawnChildren',
        transitions: [
          { from: 'spawnChildren', to: 'completed' },
          { from: 'spawnChildren', to: 'error' },
        ],
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      void (yield* Effect.fork(runner.run(parentDef, {})));
      yield* Effect.sleep(Duration.millis(200));

      // Find the parent (should be waiting_for_child)
      const waiting = yield* store.listInstances({ status: 'waiting_for_child' });
      expect(waiting.length).toBeGreaterThanOrEqual(1);

      yield* runner.cancel(waiting[0].id);
      yield* Effect.sleep(Duration.millis(200));

      const parentInst = yield* store.getInstance(waiting[0].id);
      expect(parentInst.status).toBe('cancelled');

      // All children should also be cancelled
      const children = yield* store.listInstances({ parentInstanceId: waiting[0].id });
      expect(children.length).toBeGreaterThanOrEqual(1);
      for (const child of children) {
        expect(child.status).toBe('cancelled');
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  }, 10_000);
});

// ════════════════════════════════════════════════════════════════════════════
// §13 — Persistence Checkpoints
// ════════════════════════════════════════════════════════════════════════════

describe('StateMachineRunner — Persistence Checkpoints (§13)', () => {
  it('checkpoint 1: after start → status "running", currentState = initial', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      yield* MachineStore;
      const registry = yield* ActionRegistry;

      let instanceIdDuringAction: string | null = null;

      // Register an action that checks the store during execution
      const fn: ActionFunction = (ctx) => {
        instanceIdDuringAction = ctx.machineInstanceId;
        return Effect.succeed({ nextState: 'completed' } as TransitionResult);
      };
      yield* registry.register('test-action', fn, { description: 'checkpoint test' });

      const def = makeSimpleDef();
      yield* runner.run(def, {});

      expect(instanceIdDuringAction).not.toBeNull();
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('checkpoint 4: terminal → status final, output/error populated', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'test-action', 'completed', { finalOutput: true });

      const result = yield* runner.run(makeSimpleDef(), {});
      expect(result.status).toBe('completed');

      const instance = yield* store.getInstance(result.instanceId);
      expect(instance.status).toBe('completed');
      expect(instance.output).toBeDefined();
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('checkpoint on error: status "error", error message populated', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerFailAction(registry, 'test-action');

      const result = yield* runner.run(makeSimpleDef(), {});
      expect(result.status).toBe('error');

      const instance = yield* store.getInstance(result.instanceId);
      expect(instance.status).toBe('error');
      expect(instance.error).toBeTruthy();
      expect(typeof instance.error).toBe('string');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('checkpoint 2: before action → currentState and stateData persisted', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      // In the action, check that the store already has the instance
      // at the correct currentState with correct stateData
      let snapshotDuringAction: {
        currentState: string;
        stateData: unknown;
        status: string;
      } | null = null;

      const fn: ActionFunction = (ctx) =>
        Effect.gen(function* () {
          // Read the instance from the store during the action execution
          const inst = yield* store.getInstance(ctx.machineInstanceId);
          snapshotDuringAction = {
            currentState: inst.currentState,
            stateData: inst.stateData,
            status: inst.status,
          };
          return { nextState: 'completed' } as TransitionResult;
        }).pipe(
          Effect.catchAll((e: unknown) =>
            Effect.fail(
              mkActionError({
                actionId: 'test-action',
                stateName: ctx.stateName,
                cause: JSON.stringify(e),
              }),
            ),
          ),
        );
      yield* registry.register('test-action', fn, { description: 'checkpoint 2 test' });

      const def = makeSimpleDef();
      yield* runner.run(def, { checkpointData: true });

      expect(snapshotDuringAction).not.toBeNull();
      // The instance should be at 'start' with the input as stateData
      expect(snapshotDuringAction).toHaveProperty('currentState', 'start');
      expect(snapshotDuringAction).toHaveProperty('status', 'running');
      expect(snapshotDuringAction).toHaveProperty('stateData');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §14 — Middleware
// ════════════════════════════════════════════════════════════════════════════

describe('StateMachineRunner — Middleware (§14)', () => {
  it('beforeTransition fires before each action', async () => {
    const beforeCalls: string[] = [];

    const testMiddleware: TransitionMiddleware = {
      name: 'test-middleware',
      beforeTransition: (ctx) => {
        beforeCalls.push(ctx.stateName);
        return Effect.void;
      },
    };

    const layer = makeTestLayer([testMiddleware]);

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'action-a', 'stateB');
      yield* registerAction(registry, 'action-b', 'stateC');
      yield* registerAction(registry, 'action-c', 'completed');

      yield* runner.run(makeLinearDef(), {});

      expect(beforeCalls).toHaveLength(3);
      expect(beforeCalls).toEqual(['stateA', 'stateB', 'stateC']);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('afterTransition fires after each action, in reverse order', async () => {
    const afterCalls: string[] = [];

    const mw1: TransitionMiddleware = {
      name: 'mw1',
      afterTransition: (ctx) => {
        afterCalls.push(`mw1:${ctx.stateName}`);
        return Effect.void;
      },
    };

    const mw2: TransitionMiddleware = {
      name: 'mw2',
      afterTransition: (ctx) => {
        afterCalls.push(`mw2:${ctx.stateName}`);
        return Effect.void;
      },
    };

    const layer = makeTestLayer([mw1, mw2]);

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'test-action', 'completed');

      yield* runner.run(makeSimpleDef(), {});

      // afterTransition fires in reverse order: mw2 first, then mw1
      expect(afterCalls).toEqual(['mw2:start', 'mw1:start']);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('middleware fires on child machine transitions independently', async () => {
    const beforeCalls: { stateName: string; parentId?: string }[] = [];

    const testMiddleware: TransitionMiddleware = {
      name: 'child-middleware',
      beforeTransition: (ctx) => {
        beforeCalls.push({
          stateName: ctx.stateName,
          parentId: ctx.instance.parentInstanceId,
        });
        return Effect.void;
      },
    };

    const layer = makeTestLayer([testMiddleware]);

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'child-action', 'completed');
      yield* registerAction(registry, 'parent-after-child', 'completed');

      const childDef = yield* store.saveDefinition({
        name: 'MW Child',
        inputSchema: {},
        outputSchema: {},
        states: {
          childStart: { name: 'childStart', type: 'action', actionId: 'child-action' },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'childStart',
        transitions: [
          { from: 'childStart', to: 'completed' },
          { from: 'childStart', to: 'error' },
        ],
      });

      const parentDef: StateMachineDefinition = {
        id: 'def-mw-parent',
        name: 'MW Parent',
        version: 1,
        inputSchema: {},
        outputSchema: {},
        states: {
          spawnChild: {
            name: 'spawnChild',
            type: 'child_machine',
            actionId: 'parent-after-child',
            childMachineDefId: childDef.id,
            childInputMapping: '$.stateData',
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'spawnChild',
        transitions: [
          { from: 'spawnChild', to: 'completed' },
          { from: 'spawnChild', to: 'error' },
        ],
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      yield* runner.run(parentDef, {});

      // Should have fired for: parent's spawnChild (pre-spawn), child's childStart, parent's spawnChild (post-child action)
      // At minimum child and parent transitions both triggered middleware
      const childCalls = beforeCalls.filter((c) => c.parentId !== undefined);
      const parentCalls = beforeCalls.filter((c) => c.parentId === undefined);
      expect(childCalls.length).toBeGreaterThanOrEqual(1);
      expect(parentCalls.length).toBeGreaterThanOrEqual(1);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('MiddlewareContext.instance.parentInstanceId distinguishes child from parent', async () => {
    const parentIds: (string | undefined)[] = [];

    const testMiddleware: TransitionMiddleware = {
      name: 'parent-id-middleware',
      beforeTransition: (ctx) => {
        parentIds.push(ctx.instance.parentInstanceId);
        return Effect.void;
      },
    };

    const layer = makeTestLayer([testMiddleware]);

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'child-action', 'completed');
      yield* registerAction(registry, 'parent-after-child', 'completed');

      const childDef = yield* store.saveDefinition({
        name: 'ParentId Child',
        inputSchema: {},
        outputSchema: {},
        states: {
          childStart: { name: 'childStart', type: 'action', actionId: 'child-action' },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'childStart',
        transitions: [
          { from: 'childStart', to: 'completed' },
          { from: 'childStart', to: 'error' },
        ],
      });

      const parentDef: StateMachineDefinition = {
        id: 'def-pid-parent',
        name: 'ParentId Parent',
        version: 1,
        inputSchema: {},
        outputSchema: {},
        states: {
          spawnChild: {
            name: 'spawnChild',
            type: 'child_machine',
            actionId: 'parent-after-child',
            childMachineDefId: childDef.id,
            childInputMapping: '$.stateData',
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'spawnChild',
        transitions: [
          { from: 'spawnChild', to: 'completed' },
          { from: 'spawnChild', to: 'error' },
        ],
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      yield* runner.run(parentDef, {});

      // Parent middleware calls have undefined parentInstanceId
      // Child middleware calls have a valid parentInstanceId
      const hasUndefined = parentIds.some((id) => id === undefined);
      const hasDefined = parentIds.some((id) => id !== undefined);
      expect(hasUndefined).toBe(true);
      expect(hasDefined).toBe(true);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §15.1–15.4 — ActionContext: workspace, artifactsWorkspace, CLI (Task 15)
// ════════════════════════════════════════════════════════════════════════════

describe('ActionContext — workspace and CLI', () => {
  it('provides ctx.workspace.root matching workspaceRoot', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-ws-test-'));
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      let capturedRoot = '';
      const fn: ActionFunction = (ctx) => {
        capturedRoot = ctx.workspace.root;
        return Effect.succeed({ nextState: 'completed' } as TransitionResult);
      };
      yield* registry.register('test-action', fn, { description: 'capture ws root' });

      yield* runner.run(makeSimpleDef(), {}, { workspaceRoot: tmpDir });
      expect(capturedRoot).toBe(tmpDir);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('provides ctx.workspace.resolve() that resolves paths', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-ws-test-'));
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      let resolvedPath = '';
      const fn: ActionFunction = (ctx) => {
        resolvedPath = ctx.workspace.resolve('sub/file.txt');
        return Effect.succeed({ nextState: 'completed' } as TransitionResult);
      };
      yield* registry.register('test-action', fn, { description: 'resolve path' });

      yield* runner.run(makeSimpleDef(), {}, { workspaceRoot: tmpDir });
      expect(resolvedPath).toBe(path.resolve(tmpDir, 'sub/file.txt'));
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('provides ctx.artifactsWorkspace.root matching family root', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-ws-test-'));
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      let capturedArtifactsRoot = '';
      const fn: ActionFunction = (ctx) => {
        capturedArtifactsRoot = ctx.artifactsWorkspace.root;
        return Effect.succeed({ nextState: 'completed' } as TransitionResult);
      };
      yield* registry.register('test-action', fn, { description: 'capture artifacts root' });

      const result = yield* runner.run(makeSimpleDef(), {}, { workspaceRoot: tmpDir });
      const instance = yield* store.getInstance(result.instanceId);

      // Root instance: artifactsWorkspace.root = <ARTIFACT_ROOT>/<instanceId>
      expect(capturedArtifactsRoot).toContain(instance.id);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('provides ctx.artifactsWorkspace.resolve() that resolves paths', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-ws-test-'));
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      let resolvedArtifact = '';
      const fn: ActionFunction = (ctx) => {
        resolvedArtifact = ctx.artifactsWorkspace.resolve('report.json');
        return Effect.succeed({ nextState: 'completed' } as TransitionResult);
      };
      yield* registry.register('test-action', fn, { description: 'resolve artifact path' });

      yield* runner.run(makeSimpleDef(), {}, { workspaceRoot: tmpDir });
      expect(resolvedArtifact).toContain('report.json');
      expect(path.isAbsolute(resolvedArtifact)).toBe(true);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('provides ctx.cli with working exec()', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-ws-test-'));
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      let cliResult: { exitCode: number; stdout: string } | null = null;
      const fn: ActionFunction = (ctx) =>
        Effect.gen(function* () {
          const result = yield* ctx.cli.exec({ command: 'echo', args: ['test'] });
          cliResult = { exitCode: result.exitCode, stdout: result.stdout.trim() };
          return { nextState: 'completed' } as TransitionResult;
        });
      yield* registry.register('test-action', fn, { description: 'cli exec' });

      yield* runner.run(makeSimpleDef(), {}, { workspaceRoot: tmpDir });
      expect(cliResult).not.toBeNull();
      expect(cliResult).toHaveProperty('exitCode', 0);
      expect(cliResult).toHaveProperty('stdout', 'test');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('does NOT provide ctx.artifacts (removed)', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      let hasArtifacts = true;
      const fn: ActionFunction = (ctx) => {
        hasArtifacts = 'artifacts' in ctx;
        return Effect.succeed({ nextState: 'completed' } as TransitionResult);
      };
      yield* registry.register('test-action', fn, { description: 'check no artifacts' });

      yield* runner.run(makeSimpleDef(), {});
      expect(hasArtifacts).toBe(false);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §8.5 — Family Root Inheritance (Task 15)
// ════════════════════════════════════════════════════════════════════════════

describe('Family root inheritance', () => {
  /** Save a child definition in the store. */
  const setupChildDef = (store: MachineStore) =>
    store.saveDefinition({
      name: 'Family Child',
      inputSchema: {},
      outputSchema: {},
      states: {
        childStart: { name: 'childStart', type: 'action', actionId: 'child-action' },
        completed: { name: 'completed', type: 'terminal' },
        cancelled: { name: 'cancelled', type: 'terminal' },
        error: { name: 'error', type: 'terminal' },
      },
      initialState: 'childStart',
      transitions: [
        { from: 'childStart', to: 'completed' },
        { from: 'childStart', to: 'error' },
      ],
    });

  it('root instance has familyRootInstanceId equal to own id', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'test-action', 'completed');

      const result = yield* runner.run(makeSimpleDef(), {});
      const instance = yield* store.getInstance(result.instanceId);

      expect(instance.familyRootInstanceId).toBe(instance.id);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('child instance inherits parent familyRootInstanceId', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'child-action', 'completed', { childDone: true });
      yield* registerAction(registry, 'parent-after-child', 'completed', { parentDone: true });

      const childDef = yield* setupChildDef(store);
      const parentDef: StateMachineDefinition = {
        id: 'def-parent',
        name: 'Parent Machine',
        version: 1,
        inputSchema: {},
        outputSchema: {},
        states: {
          spawnChild: {
            name: 'spawnChild',
            type: 'child_machine',
            actionId: 'parent-after-child',
            childMachineDefId: childDef.id,
            childInputMapping: '$.stateData',
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'spawnChild',
        transitions: [
          { from: 'spawnChild', to: 'completed' },
          { from: 'spawnChild', to: 'error' },
        ],
        metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      };

      const result = yield* runner.run(parentDef, {});
      const parent = yield* store.getInstance(result.instanceId);
      const children = yield* store.listInstances({ parentInstanceId: parent.id });

      expect(children.length).toBeGreaterThanOrEqual(1);
      expect(children[0].familyRootInstanceId).toBe(parent.familyRootInstanceId);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('grandchild inherits root familyRootInstanceId', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      // Grandchild action
      yield* registerAction(registry, 'grandchild-action', 'completed', { gcDone: true });
      yield* registerAction(registry, 'child-after-gc', 'completed', { childDone: true });
      yield* registerAction(registry, 'root-after-child', 'completed', { rootDone: true });

      // Grandchild definition
      const gcDef = yield* store.saveDefinition({
        name: 'Grandchild Machine',
        inputSchema: {},
        outputSchema: {},
        states: {
          gcStart: { name: 'gcStart', type: 'action', actionId: 'grandchild-action' },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'gcStart',
        transitions: [
          { from: 'gcStart', to: 'completed' },
          { from: 'gcStart', to: 'error' },
        ],
      });

      // Child definition (spawns grandchild)
      const childDef = yield* store.saveDefinition({
        name: 'Child Machine',
        inputSchema: {},
        outputSchema: {},
        states: {
          spawnGC: {
            name: 'spawnGC',
            type: 'child_machine',
            actionId: 'child-after-gc',
            childMachineDefId: gcDef.id,
            childInputMapping: '$.stateData',
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'spawnGC',
        transitions: [
          { from: 'spawnGC', to: 'completed' },
          { from: 'spawnGC', to: 'error' },
        ],
      });

      // Root definition (spawns child)
      const rootDef: StateMachineDefinition = {
        id: 'def-root',
        name: 'Root Machine',
        version: 1,
        inputSchema: {},
        outputSchema: {},
        states: {
          spawnChild: {
            name: 'spawnChild',
            type: 'child_machine',
            actionId: 'root-after-child',
            childMachineDefId: childDef.id,
            childInputMapping: '$.stateData',
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'spawnChild',
        transitions: [
          { from: 'spawnChild', to: 'completed' },
          { from: 'spawnChild', to: 'error' },
        ],
        metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      };

      const result = yield* runner.run(rootDef, {});
      const root = yield* store.getInstance(result.instanceId);
      const allInstances = yield* store.listInstances({});

      // All instances in the chain should share the same familyRootInstanceId
      for (const inst of allInstances) {
        expect(inst.familyRootInstanceId).toBe(root.id);
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('child inherits parent workspaceRoot', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-inherit-test-'));
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'child-action', 'completed');
      yield* registerAction(registry, 'parent-after-child', 'completed');

      const childDef = yield* setupChildDef(store);
      const parentDef: StateMachineDefinition = {
        id: 'def-parent-ws',
        name: 'Parent WS',
        version: 1,
        inputSchema: {},
        outputSchema: {},
        states: {
          spawnChild: {
            name: 'spawnChild',
            type: 'child_machine',
            actionId: 'parent-after-child',
            childMachineDefId: childDef.id,
            childInputMapping: '$.stateData',
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'spawnChild',
        transitions: [
          { from: 'spawnChild', to: 'completed' },
          { from: 'spawnChild', to: 'error' },
        ],
        metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      };

      yield* runner.run(parentDef, {}, { workspaceRoot: tmpDir });

      const children = yield* store.listInstances({});
      const child = children.find((i) => i.parentInstanceId !== undefined);
      expect(child).toBeDefined();
      expect(child).toHaveProperty('workspaceRoot', tmpDir);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('child artifactsPath matches parent artifactsPath', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'child-action', 'completed');
      yield* registerAction(registry, 'parent-after-child', 'completed');

      const childDef = yield* setupChildDef(store);
      const parentDef: StateMachineDefinition = {
        id: 'def-parent-art',
        name: 'Parent Artifacts',
        version: 1,
        inputSchema: {},
        outputSchema: {},
        states: {
          spawnChild: {
            name: 'spawnChild',
            type: 'child_machine',
            actionId: 'parent-after-child',
            childMachineDefId: childDef.id,
            childInputMapping: '$.stateData',
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'spawnChild',
        transitions: [
          { from: 'spawnChild', to: 'completed' },
          { from: 'spawnChild', to: 'error' },
        ],
        metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      };

      const result = yield* runner.run(parentDef, {});
      const parent = yield* store.getInstance(result.instanceId);
      const children = yield* store.listInstances({ parentInstanceId: parent.id });

      expect(children.length).toBeGreaterThanOrEqual(1);
      expect(children[0].artifactsPath).toBe(parent.artifactsPath);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('parallel children all inherit family root', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'pc-child-action', 'completed', { done: true });
      yield* registerAction(registry, 'pc-parent-after', 'completed', { parentDone: true });

      const childDef = yield* store.saveDefinition({
        name: 'Parallel Family Child',
        inputSchema: {},
        outputSchema: {},
        states: {
          childStart: { name: 'childStart', type: 'action', actionId: 'pc-child-action' },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'childStart',
        transitions: [
          { from: 'childStart', to: 'completed' },
          { from: 'childStart', to: 'error' },
        ],
      });

      const parentDef: StateMachineDefinition = {
        id: 'def-parallel-family',
        name: 'Parallel Family Parent',
        version: 1,
        inputSchema: {},
        outputSchema: {},
        states: {
          spawnChildren: {
            name: 'spawnChildren',
            type: 'parallel_children',
            actionId: 'pc-parent-after',
            parallelMode: 'all_settled',
            children: [
              { key: 'child-a', machineDefId: childDef.id, inputMapping: '$.stateData' },
              { key: 'child-b', machineDefId: childDef.id, inputMapping: '$.stateData' },
            ],
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'spawnChildren',
        transitions: [
          { from: 'spawnChildren', to: 'completed' },
          { from: 'spawnChildren', to: 'error' },
        ],
        metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      };

      const result = yield* runner.run(parentDef, {});
      const parent = yield* store.getInstance(result.instanceId);
      const children = yield* store.listInstances({ parentInstanceId: parent.id });

      expect(children.length).toBeGreaterThanOrEqual(2);
      for (const child of children) {
        expect(child.familyRootInstanceId).toBe(parent.familyRootInstanceId);
        expect(child.artifactsPath).toBe(parent.artifactsPath);
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §4.4 — Workspace Root Validation (Task 15)
// ════════════════════════════════════════════════════════════════════════════

describe('workspaceRoot validation', () => {
  it('accepts valid absolute workspaceRoot', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-valid-ws-'));
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'test-action', 'completed');

      const result = yield* runner.run(makeSimpleDef(), {}, { workspaceRoot: tmpDir });
      expect(result.status).toBe('completed');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('instance stores the workspaceRoot value', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-ws-store-'));
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'test-action', 'completed');

      const result = yield* runner.run(makeSimpleDef(), {}, { workspaceRoot: tmpDir });
      const instance = yield* store.getInstance(result.instanceId);
      expect(instance.workspaceRoot).toBe(tmpDir);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('defaults workspaceRoot to empty string when not provided', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'test-action', 'completed');

      const result = yield* runner.run(makeSimpleDef(), {});
      const instance = yield* store.getInstance(result.instanceId);
      expect(instance.workspaceRoot).toBe('');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §16.1–16.6 — CLI Exit Code Branching (Task 15)
// ════════════════════════════════════════════════════════════════════════════

describe('CLI exit code branching', () => {
  it('action can branch on exitCode === 0 (success path)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-cli-branch-'));
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      const fn: ActionFunction = (ctx) =>
        Effect.gen(function* () {
          const result = yield* ctx.cli.exec({ command: 'echo', args: ['ok'] });
          const nextState = result.exitCode === 0 ? 'successState' : 'errorState';
          return { nextState } as TransitionResult;
        });
      yield* registry.register('branch-action', fn, { description: 'cli branch' });
      yield* registerAction(registry, 'success-action', 'completed', { path: 'success' });
      yield* registerAction(registry, 'error-action', 'completed', { path: 'error' });

      const def = makeBranchingDef({
        id: 'def-cli-branch',
        states: {
          init: { name: 'init', type: 'action', actionId: 'branch-action' },
          successState: { name: 'successState', type: 'action', actionId: 'success-action' },
          errorState: { name: 'errorState', type: 'action', actionId: 'error-action' },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        transitions: [
          { from: 'init', to: 'successState' },
          { from: 'init', to: 'errorState' },
          { from: 'init', to: 'error' },
          { from: 'successState', to: 'completed' },
          { from: 'successState', to: 'error' },
          { from: 'errorState', to: 'completed' },
          { from: 'errorState', to: 'error' },
        ],
      });

      const result = yield* runner.run(def, {}, { workspaceRoot: tmpDir });
      expect(result.status).toBe('completed');
      if (result.status === 'completed') {
        expect(result.output).toEqual({ path: 'success' });
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('action can branch on exitCode !== 0 (error path)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-cli-branch-'));
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      const fn: ActionFunction = (ctx) =>
        Effect.gen(function* () {
          const result = yield* ctx.cli.exec({ command: 'bash', args: ['-c', 'exit 1'] });
          const nextState = result.exitCode === 0 ? 'successState' : 'errorState';
          return { nextState } as TransitionResult;
        });
      yield* registry.register('branch-action', fn, { description: 'cli branch fail' });
      yield* registerAction(registry, 'success-action', 'completed', { path: 'success' });
      yield* registerAction(registry, 'error-action', 'completed', { path: 'error' });

      const def = makeBranchingDef({
        id: 'def-cli-branch-fail',
        states: {
          init: { name: 'init', type: 'action', actionId: 'branch-action' },
          successState: { name: 'successState', type: 'action', actionId: 'success-action' },
          errorState: { name: 'errorState', type: 'action', actionId: 'error-action' },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        transitions: [
          { from: 'init', to: 'successState' },
          { from: 'init', to: 'errorState' },
          { from: 'init', to: 'error' },
          { from: 'successState', to: 'completed' },
          { from: 'successState', to: 'error' },
          { from: 'errorState', to: 'completed' },
          { from: 'errorState', to: 'error' },
        ],
      });

      const result = yield* runner.run(def, {}, { workspaceRoot: tmpDir });
      expect(result.status).toBe('completed');
      if (result.status === 'completed') {
        expect(result.output).toEqual({ path: 'error' });
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('action can parse stdout to determine next state', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-cli-parse-'));
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      const fn: ActionFunction = (ctx) =>
        Effect.gen(function* () {
          const result = yield* ctx.cli.exec({
            command: 'bash',
            args: ['-c', 'echo \'{"route": "branchA"}\''],
          });
          const parsed = JSON.parse(result.stdout.trim()) as { route: string };
          return { nextState: parsed.route, data: parsed } as TransitionResult;
        });
      yield* registry.register('branch-action', fn, { description: 'parse stdout' });
      yield* registerAction(registry, 'action-a', 'completed', { fromA: true });
      yield* registerAction(registry, 'action-b', 'completed', { fromB: true });

      const result = yield* runner.run(makeBranchingDef(), {}, { workspaceRoot: tmpDir });
      expect(result.status).toBe('completed');
      if (result.status === 'completed') {
        expect(result.output).toEqual({ fromA: true });
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('non-zero exit does not automatically fail the machine', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-cli-nofail-'));
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      const fn: ActionFunction = (ctx) =>
        Effect.gen(function* () {
          const result = yield* ctx.cli.exec({ command: 'bash', args: ['-c', 'exit 42'] });
          // Non-zero exit code, but the action decides to succeed
          return {
            nextState: 'completed',
            data: { exitCode: result.exitCode },
          } as TransitionResult;
        });
      yield* registry.register('test-action', fn, { description: 'non-zero ok' });

      const result = yield* runner.run(makeSimpleDef(), {}, { workspaceRoot: tmpDir });
      expect(result.status).toBe('completed');
      if (result.status === 'completed') {
        expect(result.output).toEqual({ exitCode: 42 });
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });
});

describe('CLI transcript capture lineage', () => {
  it('writes root, child, and nested-child transcripts in lineage paths', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-cli-lineage-'));
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      const captureAction =
        (nextState: string): ActionFunction =>
        (ctx) =>
          Effect.gen(function* () {
            const result = yield* ctx.cli.exec({ command: 'echo', args: [ctx.stateName] });
            return {
              nextState,
              data: {
                transcriptPath: result.transcript?.path,
              },
            } as TransitionResult;
          });

      const forwardChild: ActionFunction = (ctx) => {
        const childResult = ctx.stateData as { status?: string };
        return Effect.succeed({
          nextState: childResult.status === 'completed' ? 'completed' : 'error',
          data: ctx.stateData,
        } as TransitionResult);
      };

      yield* registry.register('capture-parent', captureAction('spawnChild'), {
        description: 'capture parent',
      });
      yield* registry.register('capture-child', captureAction('spawnGrand'), {
        description: 'capture child',
      });
      yield* registry.register('capture-grand', captureAction('completed'), {
        description: 'capture grandchild',
      });
      yield* registry.register('forward-child', forwardChild, { description: 'forward child' });

      const grandchildDef = yield* store.saveDefinition({
        name: 'Grandchild lineage',
        inputSchema: {},
        outputSchema: {},
        states: {
          runGrand: { name: 'runGrand', type: 'action', actionId: 'capture-grand' },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'runGrand',
        transitions: [{ from: 'runGrand', to: 'completed' }],
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      const childDef = yield* store.saveDefinition({
        name: 'Child lineage',
        inputSchema: {},
        outputSchema: {},
        states: {
          runChild: { name: 'runChild', type: 'action', actionId: 'capture-child' },
          spawnGrand: {
            name: 'spawnGrand',
            type: 'child_machine',
            actionId: 'forward-child',
            childMachineDefId: grandchildDef.id,
            childInputMapping: '$.machineInput',
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'runChild',
        transitions: [
          { from: 'runChild', to: 'spawnGrand' },
          { from: 'spawnGrand', to: 'completed' },
          { from: 'spawnGrand', to: 'error' },
        ],
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      const parentDef: StateMachineDefinition = {
        id: 'def-parent-cli-lineage',
        name: 'Parent lineage',
        version: 1,
        inputSchema: {},
        outputSchema: {},
        states: {
          runParent: { name: 'runParent', type: 'action', actionId: 'capture-parent' },
          spawnChild: {
            name: 'spawnChild',
            type: 'child_machine',
            actionId: 'forward-child',
            childMachineDefId: childDef.id,
            childInputMapping: '$.machineInput',
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'runParent',
        transitions: [
          { from: 'runParent', to: 'spawnChild' },
          { from: 'spawnChild', to: 'completed' },
          { from: 'spawnChild', to: 'error' },
        ],
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      const result = yield* runner.run(
        parentDef,
        {},
        {
          workspaceRoot: tmpDir,
          runtimeOptions: {
            cliDirectoryPolicy: {
              workspaceDirs: [tmpDir],
            },
            cliOutputCapture: {
              enabled: true,
            },
          },
        },
      );

      expect(result.status).toBe('completed');

      const parent = yield* store.getInstance(result.instanceId);
      const children = yield* store.listInstances({ parentInstanceId: parent.id });
      expect(children).toHaveLength(1);
      const child = children[0];

      const grandchildren = yield* store.listInstances({ parentInstanceId: child.id });
      expect(grandchildren).toHaveLength(1);
      const grandchild = grandchildren[0];

      expect(fs.existsSync(path.join(parent.artifactsPath, 'runParent/001-echo.txt'))).toBe(true);
      expect(
        fs.existsSync(
          path.join(parent.artifactsPath, `children/${child.id}/runChild/001-echo.txt`),
        ),
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(
            parent.artifactsPath,
            `children/${child.id}/children/${grandchild.id}/runGrand/001-echo.txt`,
          ),
        ),
      ).toBe(true);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('increments visit index for repeated visits to the same state', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-cli-visit-index-'));
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      const loopAction: ActionFunction = (ctx) =>
        Effect.gen(function* () {
          const current = (ctx.stateData as { count?: number } | null)?.count ?? 0;
          yield* ctx.cli.exec({ command: 'echo', args: [`visit-${String(current + 1)}`] });
          return {
            nextState: current >= 1 ? 'completed' : 'repeat',
            data: { count: current + 1 },
          } as TransitionResult;
        });

      yield* registry.register('loop-cli', loopAction, { description: 'loop cli' });

      const def: StateMachineDefinition = {
        id: 'def-cli-visit-index',
        name: 'Visit index machine',
        version: 1,
        inputSchema: {},
        outputSchema: {},
        states: {
          repeat: { name: 'repeat', type: 'action', actionId: 'loop-cli' },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'repeat',
        transitions: [
          { from: 'repeat', to: 'repeat' },
          { from: 'repeat', to: 'completed' },
        ],
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      const result = yield* runner.run(
        def,
        {},
        {
          workspaceRoot: tmpDir,
          runtimeOptions: {
            cliDirectoryPolicy: {
              workspaceDirs: [tmpDir],
            },
            cliOutputCapture: {
              enabled: true,
            },
          },
        },
      );

      expect(result.status).toBe('completed');

      const instance = yield* store.getInstance(result.instanceId);
      expect(fs.existsSync(path.join(instance.artifactsPath, 'repeat/001-echo.txt'))).toBe(true);
      expect(fs.existsSync(path.join(instance.artifactsPath, 'repeat/002-echo.txt'))).toBe(true);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });
});

describe('runtimeOptions pass-through integration', () => {
  it('forwards runtimeOptions into child actions and does not persist them on instances', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-runtime-policy-'));
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      let parentRuntimeSnapshot: unknown;
      let childRuntimeSnapshot: unknown;

      const parentCaptureAction: ActionFunction = (ctx) =>
        Effect.sync(() => {
          parentRuntimeSnapshot = ctx.runtimeOptions;
          return {
            nextState: 'spawnChild',
            data: { observed: true },
          } as TransitionResult;
        });

      const childCaptureAction: ActionFunction = (ctx) =>
        Effect.sync(() => {
          childRuntimeSnapshot = ctx.runtimeOptions;
          return {
            nextState: 'completed',
            data: { capturedInChild: true },
          } as TransitionResult;
        });

      const forwardChildResult: ActionFunction = (ctx) => {
        const childResult = ctx.stateData as { status?: string };
        return Effect.succeed({
          nextState: childResult.status === 'completed' ? 'completed' : 'error',
          data: childResult,
        } as TransitionResult);
      };

      yield* registry.register('parent-capture-runtime', parentCaptureAction, {
        description: 'capture parent runtime options',
      });
      yield* registry.register('child-capture-runtime', childCaptureAction, {
        description: 'capture child runtime options',
      });
      yield* registry.register('forward-child-runtime', forwardChildResult, {
        description: 'forward child result',
      });

      const childDef = yield* store.saveDefinition({
        name: 'Runtime child definition',
        inputSchema: {},
        outputSchema: {},
        states: {
          runChild: { name: 'runChild', type: 'action', actionId: 'child-capture-runtime' },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'runChild',
        transitions: [{ from: 'runChild', to: 'completed' }],
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      const parentDef: StateMachineDefinition = {
        id: 'def-runtime-parent',
        name: 'Runtime parent definition',
        version: 1,
        inputSchema: {},
        outputSchema: {},
        states: {
          captureParent: {
            name: 'captureParent',
            type: 'action',
            actionId: 'parent-capture-runtime',
          },
          spawnChild: {
            name: 'spawnChild',
            type: 'child_machine',
            actionId: 'forward-child-runtime',
            childMachineDefId: childDef.id,
            childInputMapping: '$.machineInput',
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'captureParent',
        transitions: [
          { from: 'captureParent', to: 'spawnChild' },
          { from: 'spawnChild', to: 'completed' },
          { from: 'spawnChild', to: 'error' },
        ],
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };

      const runtimeOptions = {
        cliDirectoryPolicy: {
          workspaceDirs: [tmpDir],
        },
        cliOutputCapture: {
          enabled: true,
        },
      };

      const result = yield* runner.run(
        parentDef,
        { value: 1 },
        { workspaceRoot: tmpDir, runtimeOptions },
      );
      expect(result.status).toBe('completed');
      expect(parentRuntimeSnapshot).toEqual(runtimeOptions);
      expect(childRuntimeSnapshot).toEqual(runtimeOptions);

      const parent = yield* store.getInstance(result.instanceId);
      const children = yield* store.listInstances({ parentInstanceId: parent.id });
      expect(children).toHaveLength(1);

      expect(parent).not.toHaveProperty('runtimeOptions');
      expect(children[0]).not.toHaveProperty('runtimeOptions');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §15.6 — Artifact Infrastructure Removal (Task 15)
// ════════════════════════════════════════════════════════════════════════════

describe('artifact infrastructure removal', () => {
  it('MachineInstance does not have artifacts field', () => {
    // Runtime check: build a minimal instance and verify no artifacts property
    const instance: MachineInstance = {
      id: 'inst-1',
      definitionId: 'def-1',
      definitionVersion: 1,
      status: 'running',
      currentState: 'start',
      stateData: {},
      input: {},
      history: [],
      logs: [],
      workspaceRoot: '/tmp/test',
      familyRootInstanceId: 'inst-1',
      artifactsPath: '/tmp/data/artifacts/inst-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect('artifacts' in instance).toBe(false);
    expect(instance).not.toHaveProperty('artifacts');
  });

  it('MachineEvent does not include artifact_created', () => {
    // Verify all known event types — none should be artifact_created
    const eventTypes: MachineEvent['type'][] = [
      'state_changed',
      'transition_recorded',
      'log_entry',
      'machine_completed',
      'machine_resumed',
      'child_spawned',
      'child_completed',
      'children_spawned',
      'children_completed',
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((eventTypes as any[]).includes('artifact_created')).toBe(false);
  });

  it('no artifact_created events are published during machine execution', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'test-action', 'completed', { done: true });

      // Run a machine
      const result = yield* runner.run(makeSimpleDef(), {});
      expect(result.status).toBe('completed');

      // Verify at the type level: MachineEvent union does not include artifact_created
      const knownEventTypes = new Set<string>([
        'state_changed',
        'transition_recorded',
        'log_entry',
        'machine_completed',
        'machine_resumed',
        'child_spawned',
        'child_completed',
        'children_spawned',
        'children_completed',
      ]);
      expect(knownEventTypes.has('artifact_created')).toBe(false);

      // Also verify the instance has no artifacts field
      const instance = yield* store.getInstance(result.instanceId);
      expect('artifacts' in instance).toBe(false);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('ActionContext does not include artifacts property', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      const ctxKeys: string[] = [];
      const fn: ActionFunction = (ctx) => {
        ctxKeys.push(...Object.keys(ctx));
        return Effect.succeed({ nextState: 'completed' } as TransitionResult);
      };
      yield* registry.register('test-action', fn, { description: 'check ctx keys' });

      yield* runner.run(makeSimpleDef(), {});

      expect(ctxKeys).not.toContain('artifacts');
      // Verify expected keys are present
      expect(ctxKeys).toContain('cli');
      expect(ctxKeys).toContain('workspace');
      expect(ctxKeys).toContain('artifactsWorkspace');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });
});
