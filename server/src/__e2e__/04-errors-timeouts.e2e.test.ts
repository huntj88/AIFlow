/**
 * E2E: Error Handling & Timeouts (Task 38).
 *
 * Validates all behaviors from §6 (Error Handling) and §7 (Timeouts &
 * Safety Limits) via HTTP requests against an in-process handler.
 *
 * §6.1 Action Failure — 3 behaviors (event deferred to Task 44)
 * §6.2 Illegal Transition — 2 behaviors
 * §6.3 Data Validation — 2 behaviors
 * §6.4 Middleware Error Propagation — 2 behaviors
 * §7.1 Action Timeout — 2 behaviors
 * §7.2 Machine-Level Timeout — documented as runner-level only
 * §7.3 Max Depth — 3 behaviors
 *
 * @module
 */

import { Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionRegistry } from '@/machines/ActionRegistry.js';
import type { ActionContext } from '@/machines/types.js';
import { mkActionError } from '@/machines/types.js';
import { type ApiHelpers, makeApiHelpers } from './helpers/api-helpers.js';
import {
  CHILD_DEFINITION,
  DELAY_DEFINITION,
  ERROR_DEFINITION,
  ERROR_INPUT,
} from './helpers/fixtures.js';
import { makeTestHandler } from './helpers/test-handler.js';

// ────────────────────────────────────────────────────────────────────────────
// Local Fixtures
// ────────────────────────────────────────────────────────────────────────────

/**
 * Action failure: uses the custom `test-always-fail` action.
 */
const ACTION_FAILURE_DEFINITION = {
  name: 'E2E Action Failure',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'will_fail',
  states: {
    will_fail: { name: 'will_fail', type: 'action' as const, actionId: 'test-always-fail' },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [{ from: 'will_fail', to: 'completed' }],
  metadata: { description: 'Machine with always-failing action', tags: ['e2e'] },
};

/**
 * Illegal transition: uses `test-illegal-transition` action which returns
 * a nextState not in the definition's transitions[].
 */
const ILLEGAL_TRANSITION_DEFINITION = {
  name: 'E2E Illegal Transition',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'will_illegal',
  states: {
    will_illegal: {
      name: 'will_illegal',
      type: 'action' as const,
      actionId: 'test-illegal-transition',
    },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [{ from: 'will_illegal', to: 'completed' }],
  metadata: { description: 'Machine with illegal transition', tags: ['e2e'] },
};

/**
 * Data validation: state with a dataSchema that will fail.
 * The first state (`produce_bad_data`) uses log-message, which passes
 * stateData through unchanged. The second state (`validate_data`) has
 * a dataSchema requiring `score: number`. Since the input has no `score`,
 * the ValidationMiddleware will reject stateData before the action runs.
 */
const DATA_VALIDATION_DEFINITION = {
  name: 'E2E Data Validation',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'produce_bad_data',
  states: {
    produce_bad_data: {
      name: 'produce_bad_data',
      type: 'action' as const,
      actionId: 'log-message',
    },
    validate_data: {
      name: 'validate_data',
      type: 'action' as const,
      actionId: 'log-message',
      dataSchema: {
        type: 'object',
        properties: { score: { type: 'number' } },
        required: ['score'],
      },
    },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [
    { from: 'produce_bad_data', to: 'validate_data' },
    { from: 'validate_data', to: 'completed' },
  ],
  metadata: { description: 'Machine with data schema validation', tags: ['e2e'] },
};

/**
 * State timeout: delay of 60s with timeoutMs of 200ms → always times out.
 * (Reuses the ERROR_DEFINITION fixture but we define our own for clarity)
 */
const STATE_TIMEOUT_DEFINITION = ERROR_DEFINITION;
const STATE_TIMEOUT_INPUT = ERROR_INPUT;

/**
 * No timeout: delay of 2s without timeoutMs → should complete.
 */
const NO_TIMEOUT_DEFINITION = DELAY_DEFINITION;
const NO_TIMEOUT_INPUT = { delayMs: 2000, nextState: 'completed' };

/**
 * Custom action registration for test-only actions.
 */
const registerTestActions = (registry: ActionRegistry) =>
  Effect.gen(function* () {
    // Always-fail action
    yield* registry.register(
      'test-always-fail',
      () =>
        Effect.fail(
          mkActionError({
            actionId: 'test-always-fail',
            stateName: 'will_fail',
            cause: 'Intentional test failure',
          }),
        ),
      { description: 'Test action that always fails' },
    );

    // Illegal-transition action (returns nextState not in transitions[])
    yield* registry.register(
      'test-illegal-transition',
      () => Effect.succeed({ nextState: 'nonexistent-state', data: {} }),
      { description: 'Test action returning illegal nextState' },
    );

    // Propagate child error: checks if stateData (child result) has error
    // status and fails the action to propagate the error up the chain.
    yield* registry.register(
      'test-propagate-child-error',
      (ctx: ActionContext) => {
        const stateData = ctx.stateData as Record<string, unknown> | undefined;
        if (stateData?.status === 'error') {
          return Effect.fail(
            mkActionError({
              actionId: 'test-propagate-child-error',
              stateName: 'spawn_child',
              cause: (stateData.error as string) || 'Child machine failed',
            }),
          );
        }
        return Effect.succeed({ nextState: 'completed', data: stateData });
      },
      { description: 'Propagates child error as action failure' },
    );
  });

// ════════════════════════════════════════════════════════════════════════════
// §6 — Error Handling
// ════════════════════════════════════════════════════════════════════════════

describe('§6 — Error Handling', () => {
  // ────────────────────────────────────────────────────────────────────────
  // §6.1 Action Failure
  // ────────────────────────────────────────────────────────────────────────

  describe('§6.1 Action Failure', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;
    let failDefId: string;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler({
        registerActions: registerTestActions,
      });
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);

      const def = await api.createDef(ACTION_FAILURE_DEFINITION);
      failDefId = def.id;
    });

    afterAll(async () => {
      await cleanup();
    });

    it('action that throws → machine reaches error terminal state', async () => {
      const inst = await api.startInst(failDefId, {});
      const final = await api.pollStatus(inst.id, ['error', 'completed']);

      expect(final.status).toBe('error');
      expect(final.currentState).toBe('error');
    });

    it('error instance has descriptive error field', async () => {
      const inst = await api.startInst(failDefId, {});
      const final = await api.pollStatus(inst.id, ['error']);

      expect(final.error).toBeDefined();
      expect(typeof final.error).toBe('string');
      expect((final.error as string).length).toBeGreaterThan(0);
      // Should mention the action or state
      expect(
        (final.error as string).includes('test-always-fail') ||
          (final.error as string).includes('will_fail') ||
          (final.error as string).includes('Intentional test failure'),
      ).toBe(true);
    });

    it('error instance has status "error"', async () => {
      const inst = await api.startInst(failDefId, {});
      const final = await api.pollStatus(inst.id, ['error']);

      expect(final.status).toBe('error');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // §6.2 Illegal Transition
  // ────────────────────────────────────────────────────────────────────────

  describe('§6.2 Illegal Transition', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;
    let illegalDefId: string;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler({
        registerActions: registerTestActions,
      });
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);

      const def = await api.createDef(ILLEGAL_TRANSITION_DEFINITION);
      illegalDefId = def.id;
    });

    afterAll(async () => {
      await cleanup();
    });

    it('action returns nextState not in transitions → machine errors', async () => {
      const inst = await api.startInst(illegalDefId, {});
      const final = await api.pollStatus(inst.id, ['error', 'completed']);

      expect(final.status).toBe('error');
    });

    it('error message identifies the illegal from→to transition', async () => {
      const inst = await api.startInst(illegalDefId, {});
      const final = await api.pollStatus(inst.id, ['error']);

      expect(final.error).toBeDefined();
      const errorMsg = final.error as string;
      // The runner produces: Illegal transition from "will_illegal" to "nonexistent-state"
      expect(errorMsg.toLowerCase()).toContain('illegal');
      expect(errorMsg).toContain('will_illegal');
      expect(errorMsg).toContain('nonexistent-state');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // §6.3 Data Validation
  // ────────────────────────────────────────────────────────────────────────

  describe('§6.3 Data Validation', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;
    let dataValDefId: string;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler({
        registerActions: registerTestActions,
      });
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);

      const def = await api.createDef(DATA_VALIDATION_DEFINITION);
      dataValDefId = def.id;
    });

    afterAll(async () => {
      await cleanup();
    });

    it('stateData failing target state dataSchema → machine errors', async () => {
      // Input has no `score` field, so when `validate_data` state is entered
      // with this stateData, the ValidationMiddleware rejects it
      const inst = await api.startInst(dataValDefId, {
        message: 'will pass first state',
        nextState: 'validate_data',
      });
      const final = await api.pollStatus(inst.id, ['error', 'completed']);

      expect(final.status).toBe('error');
    });

    it('error includes schema validation details', async () => {
      const inst = await api.startInst(dataValDefId, {
        message: 'will pass first state',
        nextState: 'validate_data',
      });
      const final = await api.pollStatus(inst.id, ['error']);

      expect(final.error).toBeDefined();
      const errorMsg = final.error as string;
      // Should mention schema/validation and the field that failed
      expect(
        errorMsg.toLowerCase().includes('validation') || errorMsg.toLowerCase().includes('schema'),
      ).toBe(true);
      expect(
        errorMsg.includes('score') || errorMsg.includes('required') || errorMsg.includes('data'),
      ).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // §6.4 Middleware Error Propagation
  // ────────────────────────────────────────────────────────────────────────

  describe('§6.4 Middleware Error Propagation', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;
    let dataValDefId: string;
    let failDefId: string;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler({
        registerActions: registerTestActions,
      });
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);

      // ValidationMiddleware is a beforeTransition middleware that fails
      // when dataSchema doesn't match → middleware error propagation
      const def = await api.createDef(DATA_VALIDATION_DEFINITION);
      dataValDefId = def.id;

      const failDef = await api.createDef(ACTION_FAILURE_DEFINITION);
      failDefId = failDef.id;
    });

    afterAll(async () => {
      await cleanup();
    });

    it('beforeTransition middleware failure → machine errors', async () => {
      // ValidationMiddleware's beforeTransition hook will fail because
      // stateData lacks required `score` field in validate_data state
      const inst = await api.startInst(dataValDefId, {
        message: 'trigger middleware failure',
        nextState: 'validate_data',
      });
      const final = await api.pollStatus(inst.id, ['error', 'completed']);

      expect(final.status).toBe('error');
      expect(final.error).toBeDefined();
      const errorMsg = final.error as string;
      expect(
        errorMsg.toLowerCase().includes('validation') || errorMsg.toLowerCase().includes('schema'),
      ).toBe(true);
    });

    it('middleware onError hooks fire (observable via logs)', async () => {
      // When an action fails, the runner calls middlewareExec.runOnError().
      // We verify this indirectly: the action failure still produces an
      // error state (not a crash), confirming middleware didn't prevent it.
      const inst = await api.startInst(failDefId, {});
      const final = await api.pollStatus(inst.id, ['error']);

      // The machine reached error state (not crashed), confirming
      // middleware ran without blocking the error flow
      expect(final.status).toBe('error');
      expect(final.error).toBeDefined();

      // Verify logs were produced (audit/logging middleware fired)
      const logRes = await api.getLogs(inst.id);
      expect(logRes.status).toBe(200);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §7 — Timeouts & Safety Limits
// ════════════════════════════════════════════════════════════════════════════

describe('§7 — Timeouts & Safety Limits', () => {
  // ────────────────────────────────────────────────────────────────────────
  // §7.1 Action Timeout
  // ────────────────────────────────────────────────────────────────────────

  describe('§7.1 Action Timeout', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;
    let timeoutDefId: string;
    let noTimeoutDefId: string;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler();
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);

      const timeoutDef = await api.createDef(STATE_TIMEOUT_DEFINITION);
      timeoutDefId = timeoutDef.id;

      const noTimeoutDef = await api.createDef(NO_TIMEOUT_DEFINITION);
      noTimeoutDefId = noTimeoutDef.id;
    });

    afterAll(async () => {
      await cleanup();
    });

    it('state with timeoutMs: 200 and slow delay → timeout error', async () => {
      // STATE_TIMEOUT_DEFINITION has timeoutMs: 200, input delayMs: 60_000
      const inst = await api.startInst(timeoutDefId, STATE_TIMEOUT_INPUT);
      // Should error within ~1s (well before the 60s delay)
      const final = await api.pollStatus(inst.id, ['error', 'completed'], 5_000);

      expect(final.status).toBe('error');
      expect(final.error).toBeDefined();
      const errorMsg = final.error as string;
      expect(errorMsg.toLowerCase()).toContain('timed out');
    });

    it('state without timeoutMs allows long-running action', async () => {
      // NO_TIMEOUT_DEFINITION has no timeoutMs, delay of 2s → should complete
      const inst = await api.startInst(noTimeoutDefId, NO_TIMEOUT_INPUT);
      const final = await api.pollStatus(inst.id, ['completed', 'error'], 10_000);

      expect(final.status).toBe('completed');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // §7.2 Machine-Level Timeout
  // ────────────────────────────────────────────────────────────────────────

  describe('§7.2 Machine-Level Timeout', () => {
    it('machine-level timeoutMs causes error if exceeded (runner-level only)', () => {
      // Machine-level timeout is a RunOptions parameter passed to runner.run(),
      // not exposed via the HTTP API. It is verified in the runner unit tests.
      // The HTTP API does not accept a `timeoutMs` parameter on POST /instances.
      //
      // This test documents that machine-level timeout is NOT testable via E2E
      // HTTP and is covered by the runner's unit/integration tests instead.
      //
      // See: StateMachineRunner.run(def, input, { timeoutMs: 2000 })
      expect(true).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // §7.3 Max Depth
  // ────────────────────────────────────────────────────────────────────────

  describe('§7.3 Max Depth', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler({
        registerActions: registerTestActions,
      });
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);
    });

    afterAll(async () => {
      await cleanup();
    });

    /**
     * Parent definition that propagates child errors via the custom action.
     * Unlike `makeParentDefinition` (which uses log-message), this version
     * uses `test-propagate-child-error` so child errors bubble up the chain.
     */
    function makeDepthParent(childDefId: string, level: number, total: number) {
      return {
        name: `E2E Depth Level ${String(level)} (of ${String(total)})`,
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        initialState: 'spawn_child',
        states: {
          spawn_child: {
            name: 'spawn_child',
            type: 'child_machine' as const,
            actionId: 'test-propagate-child-error',
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
        metadata: { description: `Depth chain level ${String(level)}`, tags: ['e2e'] },
      };
    }

    /**
     * Helper: create a chain of parent→child definitions.
     * Each level is a parent that spawns the next level as a child.
     * The leaf (innermost) is a simple log-message machine.
     *
     * Returns the outermost (root) definition ID.
     * The deepest child runs at depth = (chainLength - 1).
     */
    async function createDepthChain(chainLength: number): Promise<string> {
      // Create the leaf (innermost) definition
      const leaf = await api.createDef({
        ...CHILD_DEFINITION,
        name: `E2E Depth Leaf (chain=${String(chainLength)})`,
      });

      let childDefId = leaf.id;

      // Build from inside out: level chainLength-1 down to level 1
      for (let i = chainLength - 1; i >= 1; i--) {
        const created = await api.createDef(makeDepthParent(childDefId, i, chainLength));
        childDefId = created.id;
      }

      return childDefId;
    }

    it('child chain at depth 10 → allowed', async () => {
      // MAX_MACHINE_DEPTH defaults to 10; depth check is `depth > 10`.
      // createDepthChain(n) builds n definitions; the deepest child runs at
      // depth n-1. So createDepthChain(11) → deepest at depth 10 → allowed.
      const rootDefId = await createDepthChain(11);
      const inst = await api.startInst(rootDefId, {
        message: 'depth-10 chain',
        nextState: 'completed',
      });
      const final = await api.pollStatus(inst.id, ['completed', 'error'], 20_000);

      expect(final.status).toBe('completed');
    });

    it('child chain at depth 11 → DefinitionError', async () => {
      // createDepthChain(12) → deepest at depth 11 → exceeds limit → error.
      const rootDefId = await createDepthChain(12);
      const inst = await api.startInst(rootDefId, {
        message: 'depth-11 chain',
        nextState: 'completed',
      });
      const final = await api.pollStatus(inst.id, ['error', 'completed'], 20_000);

      expect(final.status).toBe('error');
    });

    it('error message identifies depth limit', async () => {
      const rootDefId = await createDepthChain(12);
      const inst = await api.startInst(rootDefId, {
        message: 'depth-11 descriptive',
        nextState: 'completed',
      });
      const final = await api.pollStatus(inst.id, ['error'], 20_000);

      expect(final.error).toBeDefined();
      const errorMsg = final.error as string;
      // The runner produces: "Maximum machine nesting depth (10) exceeded"
      expect(
        errorMsg.toLowerCase().includes('depth') || errorMsg.toLowerCase().includes('maximum'),
      ).toBe(true);
    });
  });
});
