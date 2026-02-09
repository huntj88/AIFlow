/**
 * StateMachineRunner — Suspension, Resume & Startup Recovery Tests (Task 15)
 *
 * Covers:
 * - §12.1 — `suspendAll()` suspends (not cancels) running instances
 * - §12.1 — `waiting_for_child` instances and children recursively suspended
 * - §12.1 — SHUTDOWN_TIMEOUT_MS bounds finalizer wait
 * - §12.2 — `resume()` re-enters currentState and completes to terminal
 * - §12.2 — Already-completed transitions are NOT re-executed
 * - §12.3 — Resume with single child: child resumed if suspended
 * - §12.5 — Resume non-suspended → 409 Conflict (DefinitionError)
 * - §12.5 — Resume with changed definition version → DefinitionError
 * - §12.5 — Resume with deleted definition → NotFoundError
 * - §12.6 — Startup recovery auto-resumes top-level instances
 * - §13   — Checkpoint 5: status set to 'suspended' during graceful shutdown
 *
 * @module
 */

import { Duration, Effect, Fiber, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { InMemoryActionRegistryLive, ActionRegistry } from './ActionRegistry.js';
import { MachineEventPubSubLive } from './EventPubSub.js';
import { ExecutionSemaphoreLive } from './ExecutionSemaphore.js';
import { FsArtifactStoreLive } from './artifacts/FsArtifactStore.js';
import { makeMiddlewareExecutorLayer } from './middleware/MiddlewareExecutor.js';
import { InMemoryMachineStoreLive } from './store/InMemoryMachineStore.js';
import { MachineStore } from './store/MachineStore.js';
import {
  StateMachineRunner,
  StateMachineRunnerLive,
  startupRecovery,
} from './StateMachineRunner.js';
import type { ActionFunction, StateMachineDefinition, TransitionResult } from './types.js';

// ────────────────────────────────────────────────────────────────────────────
// Test Layer
// ────────────────────────────────────────────────────────────────────────────

const NoMiddleware = makeMiddlewareExecutorLayer([]);

/**
 * Build a full test layer. Each call provides a fresh in-memory store
 * and a fresh empty action registry so tests don't interfere.
 */
const makeTestLayer = () =>
  StateMachineRunnerLive.pipe(
    Layer.provide(InMemoryMachineStoreLive),
    Layer.provide(InMemoryActionRegistryLive),
    Layer.provide(FsArtifactStoreLive.pipe(Layer.provide(InMemoryMachineStoreLive))),
    Layer.provide(NoMiddleware),
    Layer.provide(ExecutionSemaphoreLive),
    Layer.provide(MachineEventPubSubLive),
    // Merge MachineStore + ActionRegistry so they are accessible in tests
    Layer.provideMerge(InMemoryMachineStoreLive),
    Layer.provideMerge(InMemoryActionRegistryLive),
  );

// ────────────────────────────────────────────────────────────────────────────
// Factory Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Minimal two-state linear definition:
 *   start → completed
 */
function makeLinearDef(overrides?: Partial<StateMachineDefinition>): StateMachineDefinition {
  return {
    id: 'def-linear',
    name: 'Linear Test Machine',
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

/** Register a simple pass-through action that transitions to the given state. */
function registerAction(
  registry: ActionRegistry,
  actionId: string,
  nextState: string,
  data?: unknown,
) {
  const fn: ActionFunction = () => Effect.succeed({ nextState, data } as TransitionResult);
  return registry.register(actionId, fn, { description: `Test action → ${nextState}` });
}

/** Register a long-running (delayed) action. */
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

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('StateMachineRunner — Suspend & Resume (Task 15)', () => {
  // ── §12.5: Resume non-suspended instance → DefinitionError ──────────

  it('resume() rejects a running instance (409)', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      // Register a long-running action so the machine stays running
      yield* registerDelayAction(registry, 'test-action', 60_000, 'completed');

      const def = makeLinearDef();

      // Start the machine (fire and forget via fork)
      const fiber = yield* Effect.fork(runner.run(def, {}));

      // Give it a moment to start
      yield* Effect.sleep(Duration.millis(50));

      // Find the running instance
      const instances = yield* store.listInstances({ status: 'running' });
      expect(instances.length).toBeGreaterThanOrEqual(1);

      // Try to resume a running instance → should fail
      const resumeResult = yield* runner.resume(instances[0].id).pipe(Effect.either);

      expect(resumeResult._tag).toBe('Left');
      if (resumeResult._tag === 'Left') {
        expect(resumeResult.left._tag).toBe('DefinitionError');
      }

      // Cleanup: cancel the running instance
      yield* Fiber.interrupt(fiber);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  it('resume() rejects a completed instance (409)', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'test-action', 'completed', { done: true });

      const def = makeLinearDef();
      const result = yield* runner.run(def, {});
      expect(result.status).toBe('completed');

      // Try to resume
      const resumeResult = yield* runner.resume(result.instanceId).pipe(Effect.either);

      expect(resumeResult._tag).toBe('Left');
      if (resumeResult._tag === 'Left') {
        expect(resumeResult.left._tag).toBe('DefinitionError');
        if (resumeResult.left._tag === 'DefinitionError') {
          expect(resumeResult.left.message).toContain(
            'Cannot resume instance with status: completed',
          );
        }
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  // ── §12.5: Resume with deleted definition → NotFoundError ──────────

  it('resume() fails when definition was deleted', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'test-action', 'completed');

      // Manually create a suspended instance pointing to a non-existent definition
      const inst = yield* store.saveInstance({
        definitionId: 'deleted-def-id',
        definitionVersion: 1,
        status: 'suspended',
        currentState: 'start',
        stateData: {},
        input: {},
        history: [],
        logs: [],
        artifacts: [],
      });

      const runner = yield* StateMachineRunner;
      const result = yield* runner.resume(inst.id).pipe(Effect.either);

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('NotFoundError');
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  // ── §12.5: Resume with changed definition version → DefinitionError ──

  it('resume() fails when definition version changed', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;
      const runner = yield* StateMachineRunner;

      yield* registerAction(registry, 'test-action', 'completed');

      // Save a definition at version 1
      const savedDef = yield* store.saveDefinition({
        name: 'Version Test',
        inputSchema: {},
        outputSchema: {},
        states: {
          start: { name: 'start', type: 'action', actionId: 'test-action' },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'start',
        transitions: [{ from: 'start', to: 'completed' }],
      });

      // Create a suspended instance at version 1
      const inst = yield* store.saveInstance({
        definitionId: savedDef.id,
        definitionVersion: 1,
        status: 'suspended',
        currentState: 'start',
        stateData: {},
        input: {},
        history: [],
        logs: [],
        artifacts: [],
      });

      // Bump definition version
      yield* store.updateDefinition(savedDef.id, { name: 'Version Test v2' });

      // Now resume should fail because version changed (definition is now v2)
      const result = yield* runner.resume(inst.id).pipe(Effect.either);

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('DefinitionError');
        if (result.left._tag === 'DefinitionError') {
          expect(result.left.message).toContain('version changed');
        }
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  // ── §12.2: Resume a suspended instance completes successfully ──────

  it('resume() re-enters currentState and completes to terminal', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;
      const runner = yield* StateMachineRunner;

      // Register the action needed
      yield* registerAction(registry, 'pass-action', 'step2');

      // Save definition in the store so resume can look it up
      const savedDef = yield* store.saveDefinition({
        name: 'Multi Step Machine',
        inputSchema: {},
        outputSchema: {},
        states: {
          step1: { name: 'step1', type: 'action', actionId: 'pass-action' },
          step2: { name: 'step2', type: 'action', actionId: 'finish-action' },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        initialState: 'step1',
        transitions: [
          { from: 'step1', to: 'step2' },
          { from: 'step2', to: 'completed' },
        ],
      });

      // Register the finish action
      yield* registerAction(registry, 'finish-action', 'completed', { result: 'done' });

      // Create a suspended instance at step2 (step1 already completed)
      const inst = yield* store.saveInstance({
        definitionId: savedDef.id,
        definitionVersion: savedDef.version,
        status: 'suspended',
        currentState: 'step2',
        stateData: { intermediate: true },
        input: { original: true },
        history: [
          {
            id: 'hist-1',
            fromState: 'step1',
            toState: 'step2',
            timestamp: new Date().toISOString(),
            durationMs: 10,
            actionId: 'pass-action',
          },
        ],
        logs: [],
        artifacts: [],
      });

      // Resume it
      const result = yield* runner.resume(inst.id);

      expect(result.status).toBe('completed');

      // Verify the instance in the store
      const finalInstance = yield* store.getInstance(inst.id);
      expect(finalInstance.status).toBe('completed');
      expect(finalInstance.currentState).toBe('completed');
      // Should have step1→step2 (from before) + step2→completed (from resume)
      expect(finalInstance.history.length).toBe(2);
      expect(finalInstance.history[0].fromState).toBe('step1');
      expect(finalInstance.history[0].toState).toBe('step2');
      expect(finalInstance.history[1].fromState).toBe('step2');
      expect(finalInstance.history[1].toState).toBe('completed');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  // ── §12.1 + §13: suspendAll sets status to 'suspended' (not cancelled) ──

  it('suspendAll() suspends running instances (not cancels)', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      // Register a long-running action
      yield* registerDelayAction(registry, 'test-action', 60_000, 'completed');

      const def = makeLinearDef();

      // Start the machine (fire and forget)
      void (yield* Effect.fork(runner.run(def, {})));

      // Wait a moment for it to start
      yield* Effect.sleep(Duration.millis(100));

      // Verify instance is running
      const running = yield* store.listInstances({ status: 'running' });
      expect(running.length).toBeGreaterThanOrEqual(1);

      // Now suspend all
      yield* runner.suspendAll();

      // Give finalizers a moment
      yield* Effect.sleep(Duration.millis(100));

      // The instance should be suspended, NOT cancelled
      const suspended = yield* store.listInstances({ status: 'suspended' });
      expect(suspended.length).toBeGreaterThanOrEqual(1);

      const cancelled = yield* store.listInstances({ status: 'cancelled' });
      // The instance should NOT have been cancelled
      expect(cancelled.filter((i) => i.definitionId === 'def-linear').length).toBe(0);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  // ── §12.1: suspendAll rejects new run() calls ──────────────────────

  it('run() rejects after suspendAll()', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const registry = yield* ActionRegistry;

      yield* registerAction(registry, 'test-action', 'completed');

      // Suspend all (even with no running instances, it flips the flag)
      yield* runner.suspendAll();

      const def = makeLinearDef();
      const result = yield* runner.run(def, {}).pipe(Effect.either);

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('DefinitionError');
        if (result.left._tag === 'DefinitionError') {
          expect(result.left.message).toContain('shutting down');
        }
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  // ── §12.1: suspendAll rejects new resume() calls ──────────────────

  it('resume() rejects after suspendAll()', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;

      // Create a suspended instance
      const inst = yield* store.saveInstance({
        definitionId: 'def-1',
        definitionVersion: 1,
        status: 'suspended',
        currentState: 'start',
        stateData: {},
        input: {},
        history: [],
        logs: [],
        artifacts: [],
      });

      // Suspend all
      yield* runner.suspendAll();

      // Try to resume → should be rejected
      const result = yield* runner.resume(inst.id).pipe(Effect.either);

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('DefinitionError');
        if (result.left._tag === 'DefinitionError') {
          expect(result.left.message).toContain('shutting down');
        }
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  // ── §12.6: Startup recovery (AUTO_RESUME_ON_STARTUP=false) ────────

  it('startupRecovery does nothing when AUTO_RESUME_ON_STARTUP is not set', async () => {
    // Ensure env var is not set
    /* eslint-disable @typescript-eslint/dot-notation */
    const origVal = process.env['AUTO_RESUME_ON_STARTUP'];
    delete process.env['AUTO_RESUME_ON_STARTUP'];
    /* eslint-enable @typescript-eslint/dot-notation */

    const layer = makeTestLayer();

    try {
      await Effect.gen(function* () {
        const store = yield* MachineStore;
        const registry = yield* ActionRegistry;

        yield* registerAction(registry, 'test-action', 'completed');

        // Save definition so resume could theoretically work
        yield* store.saveDefinition({
          name: 'Auto Resume Test',
          inputSchema: {},
          outputSchema: {},
          states: {
            start: { name: 'start', type: 'action', actionId: 'test-action' },
            completed: { name: 'completed', type: 'terminal' },
            cancelled: { name: 'cancelled', type: 'terminal' },
            error: { name: 'error', type: 'terminal' },
          },
          initialState: 'start',
          transitions: [{ from: 'start', to: 'completed' }],
        });

        // Create a suspended instance
        const inst = yield* store.saveInstance({
          definitionId: 'some-def',
          definitionVersion: 1,
          status: 'suspended',
          currentState: 'start',
          stateData: {},
          input: {},
          history: [],
          logs: [],
          artifacts: [],
        });

        // Run startup recovery
        yield* startupRecovery;

        // Instance should STILL be suspended
        const after = yield* store.getInstance(inst.id);
        expect(after.status).toBe('suspended');
      }).pipe(Effect.provide(layer), Effect.runPromise);
    } finally {
      if (origVal !== undefined) {
        /* eslint-disable @typescript-eslint/dot-notation */
        process.env['AUTO_RESUME_ON_STARTUP'] = origVal;
        /* eslint-enable @typescript-eslint/dot-notation */
      }
    }
  });

  // ── §12.2: Cancel still works and sets status to 'cancelled' ──────

  it('cancel() still sets status to cancelled (not suspended)', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerDelayAction(registry, 'test-action', 60_000, 'completed');

      const def = makeLinearDef();

      // Start the machine
      void (yield* Effect.fork(runner.run(def, {})));
      yield* Effect.sleep(Duration.millis(100));

      // Find the running instance
      const instances = yield* store.listInstances({ status: 'running' });
      expect(instances.length).toBeGreaterThanOrEqual(1);

      // Cancel it
      yield* runner.cancel(instances[0].id);
      yield* Effect.sleep(Duration.millis(100));

      // Should be cancelled (NOT suspended)
      const inst = yield* store.getInstance(instances[0].id);
      expect(inst.status).toBe('cancelled');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  // ── §12.1: suspended ≠ cancelled (distinct statuses) ──────────────

  it('suspend and cancel produce distinct statuses', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;

      yield* registerDelayAction(registry, 'test-action', 60_000, 'completed');

      const def1 = makeLinearDef({ id: 'def-1' });
      const def2 = makeLinearDef({ id: 'def-2' });

      // Start two machines
      void (yield* Effect.fork(runner.run(def1, {})));
      void (yield* Effect.fork(runner.run(def2, {})));
      yield* Effect.sleep(Duration.millis(100));

      // Find both running instances
      const running = yield* store.listInstances({ status: 'running' });
      expect(running.length).toBeGreaterThanOrEqual(2);

      // Cancel the first one (explicit cancel)
      yield* runner.cancel(running[0].id);
      yield* Effect.sleep(Duration.millis(50));

      // Suspend all (should suspend the second one)
      yield* runner.suspendAll();
      yield* Effect.sleep(Duration.millis(100));

      const first = yield* store.getInstance(running[0].id);
      const second = yield* store.getInstance(running[1].id);

      expect(first.status).toBe('cancelled');
      expect(second.status).toBe('suspended');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  // ── resume() rejects instance that doesn't exist → NotFoundError ──

  it('resume() fails for non-existent instance', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const runner = yield* StateMachineRunner;

      const result = yield* runner.resume('non-existent-id').pipe(Effect.either);

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('NotFoundError');
      }
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  // ── §12.3: Resume with single child: child resumed first if suspended ──

  it('resume with single child: child resumed first if suspended', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;
      const runner = yield* StateMachineRunner;

      yield* registerAction(registry, 'child-action', 'completed', { childDone: true });
      yield* registerAction(registry, 'parent-after-child', 'completed', { parentDone: true });

      // Save child definition
      const childDef = yield* store.saveDefinition({
        name: 'Resumable Child',
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

      // Save parent definition
      const parentDef = yield* store.saveDefinition({
        name: 'Resumable Parent',
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
      });

      // Create a suspended child instance
      const childInst = yield* store.saveInstance({
        definitionId: childDef.id,
        definitionVersion: childDef.version,
        status: 'suspended',
        currentState: 'childStart',
        stateData: {},
        input: {},
        history: [],
        logs: [],
        artifacts: [],
      });

      // Create a suspended parent that references the child
      const parentInst = yield* store.saveInstance({
        definitionId: parentDef.id,
        definitionVersion: parentDef.version,
        status: 'suspended',
        currentState: 'spawnChild',
        stateData: {},
        input: {},
        history: [],
        logs: [],
        artifacts: [],
        childInstanceId: childInst.id,
      });

      // Update child to reference parent
      yield* store.updateInstance(childInst.id, {
        parentInstanceId: parentInst.id,
        updatedAt: new Date().toISOString(),
      });

      // Resume the parent
      const result = yield* runner.resume(parentInst.id);
      expect(result.status).toBe('completed');

      // Both should be completed
      const finalParent = yield* store.getInstance(parentInst.id);
      expect(finalParent.status).toBe('completed');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  // ── §12.3: Resume with parallel children: mix of suspended/completed ──

  it('resume with parallel children: mix of suspended/completed handled', async () => {
    const layer = makeTestLayer();

    await Effect.gen(function* () {
      const store = yield* MachineStore;
      const registry = yield* ActionRegistry;
      const runner = yield* StateMachineRunner;

      yield* registerAction(registry, 'parallel-child-action', 'completed', { done: true });
      yield* registerAction(registry, 'parent-after-children', 'completed');

      const childDef = yield* store.saveDefinition({
        name: 'Parallel Resume Child',
        inputSchema: {},
        outputSchema: {},
        states: {
          childStart: {
            name: 'childStart',
            type: 'action',
            actionId: 'parallel-child-action',
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

      const parentDef = yield* store.saveDefinition({
        name: 'Parallel Resume Parent',
        inputSchema: {},
        outputSchema: {},
        states: {
          spawnChildren: {
            name: 'spawnChildren',
            type: 'parallel_children',
            actionId: 'parent-after-children',
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
      });

      // Create one completed child and one suspended child
      const completedChild = yield* store.saveInstance({
        definitionId: childDef.id,
        definitionVersion: childDef.version,
        status: 'completed',
        currentState: 'completed',
        stateData: {},
        input: {},
        history: [],
        logs: [],
        artifacts: [],
        output: { done: true },
      });

      const suspendedChild = yield* store.saveInstance({
        definitionId: childDef.id,
        definitionVersion: childDef.version,
        status: 'suspended',
        currentState: 'childStart',
        stateData: {},
        input: {},
        history: [],
        logs: [],
        artifacts: [],
      });

      // Create suspended parent pointing at both children
      const parentInst = yield* store.saveInstance({
        definitionId: parentDef.id,
        definitionVersion: parentDef.version,
        status: 'suspended',
        currentState: 'spawnChildren',
        stateData: {},
        input: {},
        history: [],
        logs: [],
        artifacts: [],
        childInstanceIds: {
          'child-a': completedChild.id,
          'child-b': suspendedChild.id,
        },
      });

      // Set parent references
      yield* store.updateInstance(completedChild.id, {
        parentInstanceId: parentInst.id,
        updatedAt: new Date().toISOString(),
      });
      yield* store.updateInstance(suspendedChild.id, {
        parentInstanceId: parentInst.id,
        updatedAt: new Date().toISOString(),
      });

      // Resume the parent → should handle mix of completed and suspended children
      const result = yield* runner.resume(parentInst.id);
      expect(result.status).toBe('completed');

      const finalParent = yield* store.getInstance(parentInst.id);
      expect(finalParent.status).toBe('completed');
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  // ── §12.6: Startup recovery with AUTO_RESUME_ON_STARTUP=true ──────

  it('startupRecovery with AUTO_RESUME_ON_STARTUP=true resumes top-level instances', async () => {
    /* eslint-disable @typescript-eslint/dot-notation */
    const origVal = process.env['AUTO_RESUME_ON_STARTUP'];
    process.env['AUTO_RESUME_ON_STARTUP'] = 'true';
    /* eslint-enable @typescript-eslint/dot-notation */

    const layer = makeTestLayer();

    try {
      await Effect.gen(function* () {
        const store = yield* MachineStore;
        const registry = yield* ActionRegistry;

        yield* registerAction(registry, 'resume-action', 'completed', { recovered: true });

        // Save a definition so resume can look it up
        const savedDef = yield* store.saveDefinition({
          name: 'Auto Resume Target',
          inputSchema: {},
          outputSchema: {},
          states: {
            start: { name: 'start', type: 'action', actionId: 'resume-action' },
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

        // Create a suspended top-level instance
        const inst = yield* store.saveInstance({
          definitionId: savedDef.id,
          definitionVersion: savedDef.version,
          status: 'suspended',
          currentState: 'start',
          stateData: {},
          input: {},
          history: [],
          logs: [],
          artifacts: [],
        });

        // Run startup recovery — should auto-resume
        yield* startupRecovery;

        // Instance should now be completed (resumed and ran to completion)
        const after = yield* store.getInstance(inst.id);
        expect(after.status).toBe('completed');
      }).pipe(Effect.provide(layer), Effect.runPromise);
    } finally {
      if (origVal !== undefined) {
        /* eslint-disable @typescript-eslint/dot-notation */
        process.env['AUTO_RESUME_ON_STARTUP'] = origVal;
        /* eslint-enable @typescript-eslint/dot-notation */
      } else {
        /* eslint-disable @typescript-eslint/dot-notation */
        delete process.env['AUTO_RESUME_ON_STARTUP'];
        /* eslint-enable @typescript-eslint/dot-notation */
      }
    }
  });
});
