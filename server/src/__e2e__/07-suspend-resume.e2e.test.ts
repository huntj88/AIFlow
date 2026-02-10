/**
 * E2E: Suspend, Resume & Persistence Checkpoints (Task 41).
 *
 * Validates behaviors from §12 (Resumability & Graceful Shutdown) and §13
 * (Persistence Checkpoints) via HTTP requests against an in-process handler.
 *
 * §12.2 Resume — Happy Path — 5 behaviors (event deferred to Task 44)
 * §12.3 Resume — With Single Child — 3 behaviors
 * §12.4 Resume — With Parallel Children — 3 behaviors
 * §12.5 Resume — Rejection — 3 behaviors (6 sub-cases)
 * §12.1 Graceful Shutdown — 6 behaviors (partially testable in-process)
 * §13   Persistence Checkpoints — CP1, CP3, CP4, CP5
 *
 * @module
 */

import { Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionRegistry } from '@/machines/ActionRegistry.js';
import { StateMachineRunner } from '@/machines/StateMachineRunner.js';
import { MachineStore } from '@/machines/store/index.js';
import type { ActionContext, MachineInstance, MachineResult } from '@/machines/types.js';
import { type ApiHelpers, makeApiHelpers } from './helpers/api-helpers.js';
import {
  DELAY_DEFINITION,
  DELAY_INPUT_LONG,
  DELAY_INPUT_SHORT,
  PARENT_INPUT,
  SIMPLE_DEFINITION,
  SIMPLE_INPUT,
} from './helpers/fixtures.js';
import { makeTestHandler } from './helpers/test-handler.js';

// ────────────────────────────────────────────────────────────────────────────
// Local Fixtures
// ────────────────────────────────────────────────────────────────────────────

/**
 * Multi-state machine: step1(log-message) → step2(delay) → completed.
 * Used to verify resume re-enters currentState and skips completed transitions.
 *
 * Both built-in actions read `nextState` from `stateData` and pass stateData
 * through unchanged, so we limit to 2 action states so a single `nextState`
 * value at step2 (`'completed'`) correctly finishes the machine.
 */
const MULTI_STATE_DEFINITION = {
  name: 'E2E Multi-State (Suspend/Resume)',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'step1',
  states: {
    step1: { name: 'step1', type: 'action' as const, actionId: 'log-message' },
    step2: { name: 'step2', type: 'action' as const, actionId: 'delay' },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [
    { from: 'step1', to: 'step2' },
    { from: 'step2', to: 'completed' },
  ],
  metadata: { description: 'Multi-state for suspend/resume tests', tags: ['e2e'] },
};

/**
 * Slow child definition — delay action for parent-child suspend tests.
 */
const SLOW_CHILD_DEFINITION = {
  name: 'E2E Slow Child (Suspend)',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'child_wait',
  states: {
    child_wait: { name: 'child_wait', type: 'action' as const, actionId: 'delay' },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [{ from: 'child_wait', to: 'completed' }],
  metadata: { description: 'Slow child for suspend tests', tags: ['e2e'] },
};

/**
 * Parent definition that spawns a child_machine.
 */
const makeSlowParentDef = (childDefId: string) => ({
  name: 'E2E Slow Parent (Suspend)',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'spawn_child',
  states: {
    spawn_child: {
      name: 'spawn_child',
      type: 'child_machine' as const,
      actionId: 'test-forward-result',
      childMachineDefId: childDefId,
      childInputMapping: '$.machineInput',
    },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [
    { from: 'spawn_child', to: 'completed' },
    { from: 'spawn_child', to: 'error' },
  ],
  metadata: { description: 'Parent with slow child for suspend tests', tags: ['e2e'] },
});

/**
 * Parallel parent definition builder.
 */
const makeParallelSlowParentDef = (
  childDefs: { key: string; defId: string }[],
  mode: 'all_settled' | 'all_or_interrupt' = 'all_settled',
) => ({
  name: `E2E Parallel Slow Parent (Suspend, ${mode})`,
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'spawn_parallel',
  states: {
    spawn_parallel: {
      name: 'spawn_parallel',
      type: 'parallel_children' as const,
      actionId: 'test-forward-result',
      children: childDefs.map((c) => ({
        key: c.key,
        machineDefId: c.defId,
        inputMapping: '$.machineInput',
      })),
      parallelMode: mode,
    },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [
    { from: 'spawn_parallel', to: 'completed' },
    { from: 'spawn_parallel', to: 'error' },
  ],
  metadata: { description: `Parallel parent for suspend tests (${mode})`, tags: ['e2e'] },
});

// ────────────────────────────────────────────────────────────────────────────
// Custom Test Actions
// ────────────────────────────────────────────────────────────────────────────

const registerTestActions = (registry: ActionRegistry) =>
  Effect.gen(function* () {
    yield* registry.register(
      'test-forward-result',
      (ctx: ActionContext) => {
        const stateData = ctx.stateData as Record<string, unknown> | undefined;

        if (stateData && 'results' in stateData) {
          const results = stateData.results as Record<string, MachineResult>;
          const allCompleted = Object.values(results).every((r) => r.status === 'completed');
          return Effect.succeed({
            nextState: allCompleted ? 'completed' : 'error',
            data: stateData,
          });
        }

        if (stateData && 'status' in stateData) {
          return Effect.succeed({
            nextState: stateData.status === 'completed' ? 'completed' : 'error',
            data: stateData,
          });
        }

        return Effect.succeed({ nextState: 'completed', data: stateData });
      },
      { description: 'Forwards child/parallel result to next state' },
    );
  });

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

type TestRuntime = Awaited<ReturnType<typeof makeTestHandler>>['runtime'];

/** Suspend all running instances through the runner's suspendAll(). */
async function suspendViaRunner(runtime: TestRuntime) {
  await runtime.runPromise(
    Effect.gen(function* () {
      const runner = yield* StateMachineRunner;
      yield* runner.suspendAll();
    }),
  );
}

/**
 * Set instance fields in the store directly. Useful for constructing
 * pre-suspended state without racing with running fibers.
 */
async function updateStore(
  runtime: TestRuntime,
  instanceId: string,
  updates: Partial<MachineInstance>,
) {
  await runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* MachineStore;
      yield* store.updateInstance(instanceId, updates);
    }),
  );
}

// ════════════════════════════════════════════════════════════════════════════
// §12 — Resumability
// ════════════════════════════════════════════════════════════════════════════

describe('§12 — Resumability', () => {
  // ────────────────────────────────────────────────────────────────────────
  // §12.2 Resume — Happy Path
  // ────────────────────────────────────────────────────────────────────────

  describe('§12.2 Resume — Happy Path', () => {
    it('POST /instances/:id/resume on suspended instance → 200', async () => {
      const { handler, runtime } = await makeTestHandler();
      const api = makeApiHelpers(handler);

      const def = await api.createDef(DELAY_DEFINITION);
      const inst = await api.startInst(def.id, DELAY_INPUT_SHORT);
      await api.pollStatus(inst.id, ['running'], 5_000);

      await updateStore(runtime, inst.id, {
        status: 'suspended',
        updatedAt: new Date().toISOString(),
      });

      const resumeRes = await api.postResume(inst.id);
      expect(resumeRes.status).toBe(200);

      await runtime.dispose();
    });

    it('resumed instance changes to running then reaches terminal state', async () => {
      const { handler, runtime } = await makeTestHandler();
      const api = makeApiHelpers(handler);

      const def = await api.createDef(DELAY_DEFINITION);
      const inst = await api.startInst(def.id, DELAY_INPUT_SHORT);
      await api.pollStatus(inst.id, ['running'], 5_000);

      await updateStore(runtime, inst.id, {
        status: 'suspended',
        updatedAt: new Date().toISOString(),
      });

      const resumeRes = await api.postResume(inst.id);
      expect(resumeRes.status).toBe(200);

      const final = await api.pollStatus(inst.id, ['completed', 'error'], 10_000);
      expect(final.status).toBe('completed');

      await runtime.dispose();
    });

    it('runner re-enters currentState and re-executes action', async () => {
      const { handler, runtime } = await makeTestHandler();
      const api = makeApiHelpers(handler);

      const def = await api.createDef(MULTI_STATE_DEFINITION);
      const inst = await api.startInst(def.id, {
        message: 'step1 log',
        nextState: 'step2',
        delayMs: 30_000,
      });

      // Wait for it to reach step2
      const deadline = Date.now() + 5_000;
      let current: { status: string; currentState: string } | undefined;
      while (Date.now() < deadline) {
        const res = await api.getInstance(inst.id);
        current = (await res.json()) as { status: string; currentState: string };
        if (current.currentState === 'step2') break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(current?.currentState).toBe('step2');

      // Suspend and set short delay for resume.
      // nextState='completed' is correct for step2→completed transition.
      await updateStore(runtime, inst.id, {
        status: 'suspended',
        stateData: { delayMs: 200, nextState: 'completed' },
        updatedAt: new Date().toISOString(),
      });

      const resumeRes = await api.postResume(inst.id);
      expect(resumeRes.status).toBe(200);

      const final = await api.pollStatus(inst.id, ['completed'], 10_000);
      expect(final.status).toBe('completed');

      // Verify history includes step2→completed transition (from resume)
      const histRes = await api.getHistory(inst.id);
      const history = (await histRes.json()) as { fromState: string; toState: string }[];
      const step2ToCompleted = history.find(
        (h) => h.fromState === 'step2' && h.toState === 'completed',
      );
      expect(step2ToCompleted).toBeDefined();

      await runtime.dispose();
    });

    it('already-completed transitions are not re-executed', async () => {
      const { handler, runtime } = await makeTestHandler();
      const api = makeApiHelpers(handler);

      const def = await api.createDef(MULTI_STATE_DEFINITION);
      const inst = await api.startInst(def.id, {
        message: 'step1 log',
        nextState: 'step2',
        delayMs: 30_000,
      });

      // Wait for step2
      const deadline = Date.now() + 5_000;
      let current: { status: string; currentState: string } | undefined;
      while (Date.now() < deadline) {
        const res = await api.getInstance(inst.id);
        current = (await res.json()) as { status: string; currentState: string };
        if (current.currentState === 'step2') break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(current?.currentState).toBe('step2');

      // Count step1 transitions before suspend
      const histBefore = await api.getHistory(inst.id);
      const historyBefore = (await histBefore.json()) as { fromState: string }[];
      const step1Count = historyBefore.filter((h) => h.fromState === 'step1').length;

      // Suspend with short delay; nextState='completed' for step2→completed
      await updateStore(runtime, inst.id, {
        status: 'suspended',
        stateData: { delayMs: 200, nextState: 'completed' },
        updatedAt: new Date().toISOString(),
      });

      const resumeRes = await api.postResume(inst.id);
      expect(resumeRes.status).toBe(200);

      await api.pollStatus(inst.id, ['completed'], 10_000);

      // step1 should NOT be re-executed
      const histAfter = await api.getHistory(inst.id);
      const historyAfter = (await histAfter.json()) as { fromState: string }[];
      const step1CountAfter = historyAfter.filter((h) => h.fromState === 'step1').length;
      expect(step1CountAfter).toBe(step1Count);

      await runtime.dispose();
    });

    it('machine runs to completion from resumed state', async () => {
      const { handler, runtime } = await makeTestHandler();
      const api = makeApiHelpers(handler);

      const def = await api.createDef(DELAY_DEFINITION);
      const inst = await api.startInst(def.id, DELAY_INPUT_SHORT);
      await api.pollStatus(inst.id, ['running'], 5_000);

      await updateStore(runtime, inst.id, {
        status: 'suspended',
        updatedAt: new Date().toISOString(),
      });

      const resumeRes = await api.postResume(inst.id);
      expect(resumeRes.status).toBe(200);

      const final = await api.pollStatus(inst.id, ['completed'], 10_000);
      expect(final.status).toBe('completed');

      await runtime.dispose();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // §12.3 Resume — With Single Child
  // ────────────────────────────────────────────────────────────────────────

  describe('§12.3 Resume — With Single Child', () => {
    it('resuming parent with suspended child → child resumed first', async () => {
      // Strategy: start parent + slow child, wait for waiting_for_child,
      // manually set both to suspended with childInstanceId set on parent,
      // then resume parent via HTTP.
      const { handler, runtime } = await makeTestHandler({
        registerActions: registerTestActions,
      });
      const api = makeApiHelpers(handler);

      const childDef = await api.createDef(SLOW_CHILD_DEFINITION);
      const parentDef = await api.createDef(makeSlowParentDef(childDef.id));
      const parentInst = await api.startInst(parentDef.id, {
        ...PARENT_INPUT,
        delayMs: 30_000,
        nextState: 'completed',
      });

      await api.pollStatus(parentInst.id, ['waiting_for_child'], 5_000);

      // Find child via parentInstanceId query
      const childrenRes = await api.getInstances(`?parentInstanceId=${parentInst.id}`);
      const children = (await childrenRes.json()) as { id: string }[];
      expect(children.length).toBeGreaterThanOrEqual(1);
      const childId = children[0].id;

      await api.pollStatus(childId, ['running'], 5_000);

      // Set child to suspended with short delay for resume
      await updateStore(runtime, childId, {
        status: 'suspended',
        stateData: { delayMs: 300, nextState: 'completed' },
        updatedAt: new Date().toISOString(),
      });

      // Set parent to suspended with childInstanceId
      await updateStore(runtime, parentInst.id, {
        status: 'suspended',
        childInstanceId: childId,
        updatedAt: new Date().toISOString(),
      });

      // Resume parent via HTTP — should resume child first
      const resumeRes = await api.postResume(parentInst.id);
      expect(resumeRes.status).toBe(200);

      // Both should eventually complete
      const parentFinal = await api.pollStatus(parentInst.id, ['completed', 'error'], 15_000);
      expect(parentFinal.status).toBe('completed');

      const childFinal = await api.pollStatus(childId, ['completed', 'error'], 10_000);
      expect(childFinal.status).toBe('completed');

      await runtime.dispose();
    });

    it('child completes then parent continues', async () => {
      // Parent is suspended at child_machine state, child already completed.
      // On resume, parent should see completed child and proceed.
      const { handler, runtime } = await makeTestHandler({
        registerActions: registerTestActions,
      });
      const api = makeApiHelpers(handler);

      const childDef = await api.createDef(SLOW_CHILD_DEFINITION);
      const parentDef = await api.createDef(makeSlowParentDef(childDef.id));

      const parentInst = await api.startInst(parentDef.id, {
        ...PARENT_INPUT,
        delayMs: 30_000,
        nextState: 'completed',
      });
      await api.pollStatus(parentInst.id, ['waiting_for_child'], 5_000);

      // Find child
      const childrenRes = await api.getInstances(`?parentInstanceId=${parentInst.id}`);
      const children = (await childrenRes.json()) as { id: string }[];
      expect(children.length).toBeGreaterThanOrEqual(1);
      const childId = children[0].id;

      await api.pollStatus(childId, ['running'], 5_000);

      // Manually set child to completed
      await updateStore(runtime, childId, {
        status: 'completed',
        currentState: 'completed',
        output: { message: 'child done' },
        updatedAt: new Date().toISOString(),
      });

      // Suspend parent with childInstanceId
      await updateStore(runtime, parentInst.id, {
        status: 'suspended',
        childInstanceId: childId,
        updatedAt: new Date().toISOString(),
      });

      // Resume parent
      const resumeRes = await api.postResume(parentInst.id);
      expect(resumeRes.status).toBe(200);

      const final = await api.pollStatus(parentInst.id, ['completed', 'error'], 10_000);
      expect(final.status).toBe('completed');

      await runtime.dispose();
    });

    it('already-completed child is not re-run', async () => {
      const { handler, runtime } = await makeTestHandler({
        registerActions: registerTestActions,
      });
      const api = makeApiHelpers(handler);

      const childDef = await api.createDef(SLOW_CHILD_DEFINITION);
      const parentDef = await api.createDef(makeSlowParentDef(childDef.id));

      const parentInst = await api.startInst(parentDef.id, {
        ...PARENT_INPUT,
        delayMs: 30_000,
        nextState: 'completed',
      });
      await api.pollStatus(parentInst.id, ['waiting_for_child'], 5_000);

      // Find child
      const childrenRes = await api.getInstances(`?parentInstanceId=${parentInst.id}`);
      const children = (await childrenRes.json()) as { id: string }[];
      const childId = children[0].id;

      await api.pollStatus(childId, ['running'], 5_000);

      // Manually complete the child
      await updateStore(runtime, childId, {
        status: 'completed',
        currentState: 'completed',
        output: { message: 'child done' },
        updatedAt: new Date().toISOString(),
      });

      // Get child history length
      const childHistBefore = await api.getHistory(childId);
      const histBefore = (await childHistBefore.json()) as unknown[];
      const histLenBefore = histBefore.length;

      // Suspend parent with childInstanceId
      await updateStore(runtime, parentInst.id, {
        status: 'suspended',
        childInstanceId: childId,
        updatedAt: new Date().toISOString(),
      });

      // Resume parent
      const resumeRes = await api.postResume(parentInst.id);
      expect(resumeRes.status).toBe(200);

      await api.pollStatus(parentInst.id, ['completed', 'error'], 10_000);

      // Child history should NOT have grown — child was not re-run
      const childHistAfter = await api.getHistory(childId);
      const histAfter = (await childHistAfter.json()) as unknown[];
      expect(histAfter.length).toBe(histLenBefore);

      await runtime.dispose();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // §12.4 Resume — With Parallel Children
  // ────────────────────────────────────────────────────────────────────────

  describe('§12.4 Resume — With Parallel Children', () => {
    it('suspended children resumed, completed children skipped', async () => {
      const { handler, runtime } = await makeTestHandler({
        registerActions: registerTestActions,
      });
      const api = makeApiHelpers(handler);

      // Two slow children
      const child1Def = await api.createDef(SLOW_CHILD_DEFINITION);
      const child2Def = await api.createDef(SLOW_CHILD_DEFINITION);

      const parentDef = await api.createDef(
        makeParallelSlowParentDef([
          { key: 'fast', defId: child1Def.id },
          { key: 'slow', defId: child2Def.id },
        ]),
      );

      const parentInst = await api.startInst(parentDef.id, {
        ...PARENT_INPUT,
        delayMs: 30_000,
        nextState: 'completed',
      });

      await api.pollStatus(parentInst.id, ['waiting_for_child'], 5_000);

      // Find children
      const childrenRes = await api.getInstances(`?parentInstanceId=${parentInst.id}`);
      const children = (await childrenRes.json()) as { id: string }[];
      expect(children.length).toBe(2);

      // Wait for both to be running
      for (const c of children) {
        await api.pollStatus(c.id, ['running'], 5_000);
      }

      const childId1 = children[0].id;
      const childId2 = children[1].id;

      // Set child1=completed, child2=suspended, parent=suspended with childInstanceIds
      await updateStore(runtime, childId1, {
        status: 'completed',
        currentState: 'completed',
        output: { message: 'fast child done' },
        updatedAt: new Date().toISOString(),
      });
      await updateStore(runtime, childId2, {
        status: 'suspended',
        stateData: { delayMs: 300, nextState: 'completed' },
        updatedAt: new Date().toISOString(),
      });
      await updateStore(runtime, parentInst.id, {
        status: 'suspended',
        childInstanceIds: { fast: childId1, slow: childId2 },
        updatedAt: new Date().toISOString(),
      });

      // Resume parent
      const resumeRes = await api.postResume(parentInst.id);
      expect(resumeRes.status).toBe(200);

      const parentFinal = await api.pollStatus(parentInst.id, ['completed', 'error'], 15_000);
      expect(['completed', 'error']).toContain(parentFinal.status);

      // Completed child should still be completed
      const c1Final = (await (await api.getInstance(childId1)).json()) as { status: string };
      expect(c1Final.status).toBe('completed');

      await runtime.dispose();
    });

    it('parent waits for all children to reach terminal', async () => {
      const { handler, runtime } = await makeTestHandler({
        registerActions: registerTestActions,
      });
      const api = makeApiHelpers(handler);

      const child1Def = await api.createDef(SLOW_CHILD_DEFINITION);
      const child2Def = await api.createDef(SLOW_CHILD_DEFINITION);

      const parentDef = await api.createDef(
        makeParallelSlowParentDef([
          { key: 'c1', defId: child1Def.id },
          { key: 'c2', defId: child2Def.id },
        ]),
      );

      const parentInst = await api.startInst(parentDef.id, {
        ...PARENT_INPUT,
        delayMs: 30_000,
        nextState: 'completed',
      });

      await api.pollStatus(parentInst.id, ['waiting_for_child'], 5_000);

      // Find children
      const childrenRes = await api.getInstances(`?parentInstanceId=${parentInst.id}`);
      const children = (await childrenRes.json()) as { id: string }[];
      expect(children.length).toBe(2);

      for (const c of children) {
        await api.pollStatus(c.id, ['running'], 5_000);
      }

      // Set both children to suspended with short delay, parent to suspended
      await updateStore(runtime, children[0].id, {
        status: 'suspended',
        stateData: { delayMs: 300, nextState: 'completed' },
        updatedAt: new Date().toISOString(),
      });
      await updateStore(runtime, children[1].id, {
        status: 'suspended',
        stateData: { delayMs: 300, nextState: 'completed' },
        updatedAt: new Date().toISOString(),
      });
      await updateStore(runtime, parentInst.id, {
        status: 'suspended',
        childInstanceIds: { c1: children[0].id, c2: children[1].id },
        updatedAt: new Date().toISOString(),
      });

      // Resume parent
      const resumeRes = await api.postResume(parentInst.id);
      expect(resumeRes.status).toBe(200);

      // Parent should eventually complete
      const parentFinal = await api.pollStatus(parentInst.id, ['completed', 'error'], 15_000);
      expect(['completed', 'error']).toContain(parentFinal.status);

      await runtime.dispose();
    });

    it('ParallelChildrenResult mixes pre-completed and just-resumed', async () => {
      const { handler, runtime } = await makeTestHandler({
        registerActions: registerTestActions,
      });
      const api = makeApiHelpers(handler);

      const child1Def = await api.createDef(SLOW_CHILD_DEFINITION);
      const child2Def = await api.createDef(SLOW_CHILD_DEFINITION);

      const parentDef = await api.createDef(
        makeParallelSlowParentDef([
          { key: 'fast', defId: child1Def.id },
          { key: 'slow', defId: child2Def.id },
        ]),
      );

      const parentInst = await api.startInst(parentDef.id, {
        ...PARENT_INPUT,
        delayMs: 30_000,
        nextState: 'completed',
      });

      await api.pollStatus(parentInst.id, ['waiting_for_child'], 5_000);

      // Find children
      const childrenRes = await api.getInstances(`?parentInstanceId=${parentInst.id}`);
      const children = (await childrenRes.json()) as { id: string }[];
      expect(children.length).toBe(2);

      for (const c of children) {
        await api.pollStatus(c.id, ['running'], 5_000);
      }

      const childId1 = children[0].id;
      const childId2 = children[1].id;

      // child1=completed (pre-completed), child2=suspended (will be resumed)
      await updateStore(runtime, childId1, {
        status: 'completed',
        currentState: 'completed',
        output: { message: 'pre-completed' },
        updatedAt: new Date().toISOString(),
      });
      await updateStore(runtime, childId2, {
        status: 'suspended',
        stateData: { delayMs: 300, nextState: 'completed' },
        updatedAt: new Date().toISOString(),
      });
      await updateStore(runtime, parentInst.id, {
        status: 'suspended',
        childInstanceIds: { fast: childId1, slow: childId2 },
        updatedAt: new Date().toISOString(),
      });

      // Resume parent
      const resumeRes = await api.postResume(parentInst.id);
      expect(resumeRes.status).toBe(200);

      // Parent should complete (mixes pre-completed and just-resumed)
      const parentFinal = await api.pollStatus(parentInst.id, ['completed', 'error'], 15_000);
      expect(['completed', 'error']).toContain(parentFinal.status);

      await runtime.dispose();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // §12.5 Resume — Rejection
  // ────────────────────────────────────────────────────────────────────────

  describe('§12.5 Resume — Rejection', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;
    let runtime: Awaited<ReturnType<typeof makeTestHandler>>['runtime'];
    let simpleDefId: string;
    let delayDefId: string;

    beforeAll(async () => {
      const result = await makeTestHandler();
      api = makeApiHelpers(result.handler);
      runtime = result.runtime;
      cleanup = () => result.runtime.dispose().then(() => undefined);

      const simpleDef = await api.createDef(SIMPLE_DEFINITION);
      simpleDefId = simpleDef.id;
      const delayDef = await api.createDef(DELAY_DEFINITION);
      delayDefId = delayDef.id;
    });

    afterAll(async () => {
      await cleanup();
    });

    it('resume running instance → 409', async () => {
      const inst = await api.startInst(delayDefId, DELAY_INPUT_LONG);
      await api.pollStatus(inst.id, ['running'], 5_000);

      const res = await api.postResume(inst.id);
      expect(res.status).toBe(409);

      const body = (await res.json()) as { message: string };
      expect(body.message).toContain('running');
    });

    it('resume completed instance → 409', async () => {
      const inst = await api.startInst(simpleDefId, SIMPLE_INPUT);
      await api.pollStatus(inst.id, ['completed'], 5_000);

      const res = await api.postResume(inst.id);
      expect(res.status).toBe(409);

      const body = (await res.json()) as { message: string };
      expect(body.message).toContain('completed');
    });

    it('resume cancelled instance → 409', async () => {
      const inst = await api.startInst(delayDefId, DELAY_INPUT_LONG);
      await api.pollStatus(inst.id, ['running'], 5_000);

      const cancelRes = await api.postCancel(inst.id);
      expect(cancelRes.status).toBe(200);
      await api.pollStatus(inst.id, ['cancelled'], 5_000);

      const res = await api.postResume(inst.id);
      expect(res.status).toBe(409);

      const body = (await res.json()) as { message: string };
      expect(body.message).toContain('cancelled');
    });

    it('resume errored instance → 409', async () => {
      const errorDef = await api.createDef({
        name: 'E2E Error (Resume Reject)',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        initialState: 'will_timeout',
        states: {
          will_timeout: {
            name: 'will_timeout',
            type: 'action' as const,
            actionId: 'delay',
            timeoutMs: 200,
          },
          completed: { name: 'completed', type: 'terminal' as const },
          cancelled: { name: 'cancelled', type: 'terminal' as const },
          error: { name: 'error', type: 'terminal' as const },
        },
        transitions: [{ from: 'will_timeout', to: 'completed' }],
        metadata: { description: 'Error machine for resume rejection', tags: ['e2e'] },
      });

      const inst = await api.startInst(errorDef.id, { delayMs: 60_000, nextState: 'completed' });
      await api.pollStatus(inst.id, ['error'], 5_000);

      const res = await api.postResume(inst.id);
      expect(res.status).toBe(409);

      const body = (await res.json()) as { message: string };
      expect(body.message).toContain('error');
    });

    it('resume with changed definition version → DefinitionError', async () => {
      const inst = await api.startInst(delayDefId, DELAY_INPUT_LONG);
      await api.pollStatus(inst.id, ['running'], 5_000);

      await updateStore(runtime, inst.id, {
        status: 'suspended',
        updatedAt: new Date().toISOString(),
      });

      // Update definition (bumps version)
      const putRes = await api.putDefinition(delayDefId, {
        ...DELAY_DEFINITION,
        metadata: { description: 'Updated version', tags: ['e2e', 'updated'] },
      });
      expect(putRes.status).toBe(200);

      const res = await api.postResume(inst.id);
      expect(res.status).toBe(409);

      const body = (await res.json()) as { message: string };
      expect(body.message).toContain('version');
    });

    it('resume with deleted definition → NotFoundError', async () => {
      const oneOff = await api.createDef({
        ...DELAY_DEFINITION,
        name: 'E2E One-Off (Resume Delete)',
      });

      const inst = await api.startInst(oneOff.id, DELAY_INPUT_LONG);
      await api.pollStatus(inst.id, ['running'], 5_000);

      await updateStore(runtime, inst.id, {
        status: 'suspended',
        updatedAt: new Date().toISOString(),
      });

      const delRes = await api.deleteDefinition(oneOff.id);
      expect(delRes.status).toBe(204);

      const res = await api.postResume(inst.id);
      expect(res.status).toBe(404);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §12.1 — Graceful Shutdown (partially testable in-process)
// ════════════════════════════════════════════════════════════════════════════

describe('§12.1 — Graceful Shutdown (in-process)', () => {
  it('suspendAll → running instances become suspended', async () => {
    const { handler, runtime } = await makeTestHandler();
    const api = makeApiHelpers(handler);

    const def = await api.createDef(DELAY_DEFINITION);
    const inst = await api.startInst(def.id, DELAY_INPUT_LONG);
    await api.pollStatus(inst.id, ['running'], 5_000);

    await suspendViaRunner(runtime);

    const res = await api.getInstance(inst.id);
    const data = (await res.json()) as { status: string };
    expect(data.status).toBe('suspended');

    await runtime.dispose();
  });

  it('suspendAll → waiting_for_child parents also suspended', async () => {
    const { handler, runtime } = await makeTestHandler({
      registerActions: registerTestActions,
    });
    const api = makeApiHelpers(handler);

    const childDef = await api.createDef(SLOW_CHILD_DEFINITION);
    const parentDef = await api.createDef(makeSlowParentDef(childDef.id));
    const parentInst = await api.startInst(parentDef.id, {
      ...PARENT_INPUT,
      delayMs: 30_000,
      nextState: 'completed',
    });

    await api.pollStatus(parentInst.id, ['waiting_for_child'], 5_000);

    await suspendViaRunner(runtime);

    const res = await api.getInstance(parentInst.id);
    const data = (await res.json()) as { status: string };
    expect(data.status).toBe('suspended');

    await runtime.dispose();
  });

  it('suspendAll → children of suspended parents also suspended', async () => {
    const { handler, runtime } = await makeTestHandler({
      registerActions: registerTestActions,
    });
    const api = makeApiHelpers(handler);

    const childDef = await api.createDef(SLOW_CHILD_DEFINITION);
    const parentDef = await api.createDef(makeSlowParentDef(childDef.id));
    const parentInst = await api.startInst(parentDef.id, {
      ...PARENT_INPUT,
      delayMs: 30_000,
      nextState: 'completed',
    });

    await api.pollStatus(parentInst.id, ['waiting_for_child'], 5_000);

    // Find child via parentInstanceId query
    const childrenRes = await api.getInstances(`?parentInstanceId=${parentInst.id}`);
    const children = (await childrenRes.json()) as { id: string }[];
    expect(children.length).toBeGreaterThanOrEqual(1);
    const childId = children[0].id;
    await api.pollStatus(childId, ['running'], 5_000);

    await suspendViaRunner(runtime);

    const childRes = await api.getInstance(childId);
    const childData = (await childRes.json()) as { status: string };
    expect(childData.status).toBe('suspended');

    await runtime.dispose();
  });

  it('suspended status ≠ cancelled', async () => {
    const { handler, runtime } = await makeTestHandler();
    const api = makeApiHelpers(handler);

    const def = await api.createDef(DELAY_DEFINITION);
    const inst = await api.startInst(def.id, DELAY_INPUT_LONG);
    await api.pollStatus(inst.id, ['running'], 5_000);

    await suspendViaRunner(runtime);

    const res = await api.getInstance(inst.id);
    const data = (await res.json()) as { status: string };
    expect(data.status).toBe('suspended');
    expect(data.status).not.toBe('cancelled');

    await runtime.dispose();
  });

  it('GET /instances shows suspended instances after shutdown', async () => {
    const { handler, runtime } = await makeTestHandler();
    const api = makeApiHelpers(handler);

    const def = await api.createDef(DELAY_DEFINITION);
    const inst1 = await api.startInst(def.id, DELAY_INPUT_LONG);
    const inst2 = await api.startInst(def.id, DELAY_INPUT_LONG);
    await api.pollStatus(inst1.id, ['running'], 5_000);
    await api.pollStatus(inst2.id, ['running'], 5_000);

    await suspendViaRunner(runtime);

    const res = await api.getInstances('?status=suspended');
    const body = (await res.json()) as { id: string; status: string }[];
    expect(body.length).toBeGreaterThanOrEqual(2);
    for (const inst of body) {
      expect(inst.status).toBe('suspended');
    }

    await runtime.dispose();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §13 — Persistence Checkpoints
// ════════════════════════════════════════════════════════════════════════════

describe('§13 — Persistence Checkpoints', () => {
  it('CP1: immediately after start → running, currentState=initial', async () => {
    const { handler, runtime } = await makeTestHandler();
    const api = makeApiHelpers(handler);

    const def = await api.createDef(DELAY_DEFINITION);
    const inst = await api.startInst(def.id, DELAY_INPUT_LONG);

    const running = (await api.pollStatus(inst.id, ['running'], 5_000)) as {
      status: string;
      currentState: string;
    };

    expect(running.status).toBe('running');
    expect(running.currentState).toBe('waiting'); // DELAY_DEFINITION initial state

    await runtime.dispose();
  });

  it('CP3: after transition → history appended, currentState advanced', async () => {
    const { handler, runtime } = await makeTestHandler();
    const api = makeApiHelpers(handler);

    const def = await api.createDef(MULTI_STATE_DEFINITION);
    const inst = await api.startInst(def.id, {
      message: 'cp3 test',
      nextState: 'step2',
      delayMs: 30_000,
      // Note: step1 (log-message) uses nextState='step2' to transition
    });

    // Wait until it reaches step2
    const deadline = Date.now() + 5_000;
    let current: { status: string; currentState: string } | undefined;
    while (Date.now() < deadline) {
      const res = await api.getInstance(inst.id);
      current = (await res.json()) as { status: string; currentState: string };
      if (current.currentState === 'step2') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(current?.currentState).toBe('step2');

    const histRes = await api.getHistory(inst.id);
    const history = (await histRes.json()) as { fromState: string; toState: string }[];
    expect(history.length).toBeGreaterThanOrEqual(1);
    const t = history.find((h) => h.fromState === 'step1' && h.toState === 'step2');
    expect(t).toBeDefined();

    await runtime.dispose();
  });

  it('CP4: terminal → status set, output or error populated', async () => {
    const { handler, runtime } = await makeTestHandler();
    const api = makeApiHelpers(handler);

    // Successful completion
    const def = await api.createDef(SIMPLE_DEFINITION);
    const inst = await api.startInst(def.id, SIMPLE_INPUT);
    const final = (await api.pollStatus(inst.id, ['completed'], 5_000)) as {
      status: string;
      output: unknown;
      currentState: string;
    };

    expect(final.status).toBe('completed');
    expect(final.currentState).toBe('completed');
    expect(final.output).toBeDefined();

    // Error case
    const errDef = await api.createDef({
      name: 'E2E Error (CP4)',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      initialState: 'will_timeout',
      states: {
        will_timeout: {
          name: 'will_timeout',
          type: 'action' as const,
          actionId: 'delay',
          timeoutMs: 200,
        },
        completed: { name: 'completed', type: 'terminal' as const },
        cancelled: { name: 'cancelled', type: 'terminal' as const },
        error: { name: 'error', type: 'terminal' as const },
      },
      transitions: [{ from: 'will_timeout', to: 'completed' }],
      metadata: { description: 'Error CP4 test', tags: ['e2e'] },
    });
    const errInst = await api.startInst(errDef.id, { delayMs: 60_000, nextState: 'completed' });
    const errFinal = (await api.pollStatus(errInst.id, ['error'], 5_000)) as {
      status: string;
      error: string;
      currentState: string;
    };

    expect(errFinal.status).toBe('error');
    expect(errFinal.currentState).toBe('error');
    expect(errFinal.error).toBeDefined();
    expect(typeof errFinal.error).toBe('string');

    await runtime.dispose();
  });

  it('CP5: suspension → status=suspended, currentState=interrupted state', async () => {
    const { handler, runtime } = await makeTestHandler();
    const api = makeApiHelpers(handler);

    const def = await api.createDef(DELAY_DEFINITION);
    const inst = await api.startInst(def.id, DELAY_INPUT_LONG);
    await api.pollStatus(inst.id, ['running'], 5_000);

    const runningRes = await api.getInstance(inst.id);
    const running = (await runningRes.json()) as { currentState: string };
    expect(running.currentState).toBe('waiting');

    await suspendViaRunner(runtime);

    const suspRes = await api.getInstance(inst.id);
    const susp = (await suspRes.json()) as { status: string; currentState: string };
    expect(susp.status).toBe('suspended');
    expect(susp.currentState).toBe('waiting');

    await runtime.dispose();
  });
});
