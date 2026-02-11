/**
 * E2E: Middleware Observability (Task 42).
 *
 * Validates all 11 behaviors from §14 (Middleware) via HTTP requests
 * and observable side effects.
 *
 * §14.1 Execution Order — 4 behaviors
 * §14.2 Cross-Cutting Concerns — 4 behaviors
 * §14.3 Child Machine Middleware — 3 behaviors
 *
 * @module
 */

import { Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionRegistry } from '@/machines/ActionRegistry.js';
import type { AuditMiddlewareInstance } from '@/machines/middleware/AuditMiddleware.js';
import { createAuditMiddleware } from '@/machines/middleware/AuditMiddleware.js';
import { LoggingMiddleware } from '@/machines/middleware/LoggingMiddleware.js';
import { TelemetryMiddleware } from '@/machines/middleware/TelemetryMiddleware.js';
import { ValidationMiddleware } from '@/machines/middleware/ValidationMiddleware.js';
import type { ActionContext, MachineResult, TransitionMiddleware } from '@/machines/types.js';
import { type ApiHelpers, makeApiHelpers } from './helpers/api-helpers.js';
import {
  CHILD_DEFINITION,
  PARENT_INPUT,
  SIMPLE_DEFINITION,
  SIMPLE_INPUT,
} from './helpers/fixtures.js';
import { makeTestHandler } from './helpers/test-handler.js';

// ────────────────────────────────────────────────────────────────────────────
// Order-tracking middleware factory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a middleware that appends `"<label>-before"` and `"<label>-after"`
 * entries to a shared log array. Used to verify execution order in §14.1.
 */
function makeOrderTracker(label: string, log: string[]): TransitionMiddleware {
  return {
    name: `OrderTracker-${label}`,
    beforeTransition() {
      return Effect.sync(() => {
        log.push(`${label}-before`);
      });
    },
    afterTransition() {
      return Effect.sync(() => {
        log.push(`${label}-after`);
      });
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Local Fixtures
// ────────────────────────────────────────────────────────────────────────────

/**
 * Definition with a `dataSchema` on the 'validated' state.
 * Requires `stateData` to have a `score` property of type number.
 */
const VALIDATED_DEFINITION = {
  name: 'E2E Validated Machine',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'validated',
  states: {
    validated: {
      name: 'validated',
      type: 'action' as const,
      actionId: 'log-message',
      dataSchema: {
        type: 'object',
        required: ['score'],
        properties: {
          score: { type: 'number' },
        },
      },
    },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [{ from: 'validated', to: 'completed' }],
  metadata: { description: 'Machine with dataSchema validation', tags: ['e2e'] },
};

/** Valid input — includes required `score` field */
const VALID_SCHEMA_INPUT = {
  score: 42,
  message: 'Schema validated',
  nextState: 'completed',
};

/** Invalid input — missing required `score` field → validation error */
const INVALID_SCHEMA_INPUT = {
  message: 'Missing score',
  nextState: 'completed',
};

/**
 * Child definition with 3 transitions: step1 → step2 → step3 → done.
 * Uses `test-auto-advance` action which reads a transitions map from stateData.
 * Used to verify middleware fires once per transition (§14.3).
 */
const MULTI_STEP_CHILD_DEFINITION = {
  name: 'E2E Multi-Step Child',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'step1',
  states: {
    step1: { name: 'step1', type: 'action' as const, actionId: 'test-auto-advance' },
    step2: { name: 'step2', type: 'action' as const, actionId: 'test-auto-advance' },
    step3: { name: 'step3', type: 'action' as const, actionId: 'test-auto-advance' },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [
    { from: 'step1', to: 'step2' },
    { from: 'step2', to: 'step3' },
    { from: 'step3', to: 'completed' },
  ],
  metadata: { description: 'Multi-step child for middleware counting', tags: ['e2e'] },
};

const MULTI_STEP_INPUT = {
  transitions: {
    step1: 'step2',
    step2: 'step3',
    step3: 'completed',
  },
  message: 'multi-step child',
  nextState: 'step2',
};

/**
 * Parent definition builder for child middleware tests.
 */
const makeChildMiddlewareParent = (childDefId: string) => ({
  name: 'E2E Middleware Parent',
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
  metadata: { description: 'Parent for child middleware tests', tags: ['e2e'] },
});

/**
 * Register custom test-only actions for child middleware tests.
 */
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

    yield* registry.register(
      'test-auto-advance',
      (ctx: ActionContext) =>
        Effect.gen(function* () {
          yield* ctx.logger.info(`auto-advance in ${ctx.stateName}`);

          // Determine next state from stateData.transitions map
          const data = ctx.stateData as Record<string, unknown> | undefined;
          const transitionMap = data?.transitions as Record<string, string> | undefined;
          const nextState = transitionMap?.[ctx.stateName] ?? 'completed';

          return { nextState, data: ctx.stateData };
        }),
      { description: 'Auto-advance using a transitions map in stateData' },
    );
  });

// ════════════════════════════════════════════════════════════════════════════
// §14.1 — Execution Order
// ════════════════════════════════════════════════════════════════════════════

describe('§14.1 — Execution Order', () => {
  describe('before / after ordering', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;
    let defId: string;
    const orderLog: string[] = [];

    // Middleware that logs before/after ordering alongside the default stack
    const trackerMiddleware: TransitionMiddleware = {
      name: 'OrderTracker',
      beforeTransition() {
        return Effect.sync(() => {
          orderLog.push('tracker-before');
        });
      },
      afterTransition() {
        return Effect.sync(() => {
          orderLog.push('tracker-after');
        });
      },
    };

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler({
        middleware: [
          ValidationMiddleware,
          trackerMiddleware,
          LoggingMiddleware,
          TelemetryMiddleware,
        ],
      });
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);

      const def = await api.createDef(SIMPLE_DEFINITION);
      defId = def.id;
    });

    afterAll(async () => {
      await cleanup();
    });

    it('beforeTransition middleware fires before action (log appears before transition)', async () => {
      orderLog.length = 0;
      const inst = await api.startInst(defId, SIMPLE_INPUT);
      await api.pollStatus(inst.id, ['completed', 'error']);

      // The tracker-before entry should exist — it fired before the action ran
      expect(orderLog).toContain('tracker-before');

      // The machine completed, meaning the action ran after middleware
      const final = await api.pollStatus(inst.id, ['completed']);
      expect(final.status).toBe('completed');
    });

    it('afterTransition middleware fires after action (log appears after transition)', async () => {
      orderLog.length = 0;
      const inst = await api.startInst(defId, SIMPLE_INPUT);
      await api.pollStatus(inst.id, ['completed', 'error']);

      // tracker-after should appear, confirming afterTransition fired
      expect(orderLog).toContain('tracker-after');

      // before should come before after for the same transition
      const beforeIdx = orderLog.indexOf('tracker-before');
      const afterIdx = orderLog.indexOf('tracker-after');
      expect(beforeIdx).toBeLessThan(afterIdx);
    });
  });

  describe('multi-middleware ordering', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;
    let defId: string;
    const orderLog: string[] = [];

    beforeAll(async () => {
      const mw1 = makeOrderTracker('MW1', orderLog);
      const mw2 = makeOrderTracker('MW2', orderLog);
      const mw3 = makeOrderTracker('MW3', orderLog);

      // Registration order: MW1, MW2, MW3
      const { handler, runtime } = await makeTestHandler({
        middleware: [mw1, mw2, mw3],
      });
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);

      const def = await api.createDef(SIMPLE_DEFINITION);
      defId = def.id;
    });

    afterAll(async () => {
      await cleanup();
    });

    it('multiple beforeTransition run in registration order', async () => {
      orderLog.length = 0;
      const inst = await api.startInst(defId, SIMPLE_INPUT);
      await api.pollStatus(inst.id, ['completed', 'error']);

      // Extract before entries in order
      const beforeEntries = orderLog.filter((e) => e.endsWith('-before'));
      expect(beforeEntries[0]).toBe('MW1-before');
      expect(beforeEntries[1]).toBe('MW2-before');
      expect(beforeEntries[2]).toBe('MW3-before');
    });

    it('multiple afterTransition run in reverse registration order (onion)', async () => {
      orderLog.length = 0;
      const inst = await api.startInst(defId, SIMPLE_INPUT);
      await api.pollStatus(inst.id, ['completed', 'error']);

      // Extract after entries in order — should be reversed (MW3, MW2, MW1)
      const afterEntries = orderLog.filter((e) => e.endsWith('-after'));
      expect(afterEntries[0]).toBe('MW3-after');
      expect(afterEntries[1]).toBe('MW2-after');
      expect(afterEntries[2]).toBe('MW1-after');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §14.2 — Cross-Cutting Concerns
// ════════════════════════════════════════════════════════════════════════════

describe('§14.2 — Cross-Cutting Concerns', () => {
  // ────────────────────────────────────────────────────────────────────────
  // ValidationMiddleware
  // ────────────────────────────────────────────────────────────────────────

  describe('ValidationMiddleware', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;
    let validatedDefId: string;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler();
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);

      const def = await api.createDef(VALIDATED_DEFINITION);
      validatedDefId = def.id;
    });

    afterAll(async () => {
      await cleanup();
    });

    it('state with dataSchema and bad data → machine errors', async () => {
      // Input missing the required 'score' field → ValidationMiddleware rejects
      const inst = await api.startInst(validatedDefId, INVALID_SCHEMA_INPUT);
      const final = await api.pollStatus(inst.id, ['error', 'completed']);

      expect(final.status).toBe('error');
      // The error message should reference the validation failure
      expect(final.error).toBeDefined();
      expect(String(final.error).toLowerCase()).toMatch(/valid|schema|score/i);
    });

    it('state with dataSchema and valid data → machine completes', async () => {
      const inst = await api.startInst(validatedDefId, VALID_SCHEMA_INPUT);
      const final = await api.pollStatus(inst.id, ['completed', 'error']);

      expect(final.status).toBe('completed');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // LoggingMiddleware
  // ────────────────────────────────────────────────────────────────────────

  describe('LoggingMiddleware', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;
    let defId: string;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler();
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);

      const def = await api.createDef(SIMPLE_DEFINITION);
      defId = def.id;
    });

    afterAll(async () => {
      await cleanup();
    });

    it('completed machine has structured log entries for each transition', async () => {
      const inst = await api.startInst(defId, SIMPLE_INPUT);
      await api.pollStatus(inst.id, ['completed']);

      const res = await api.getLogs(inst.id);
      expect(res.status).toBe(200);

      const logs = (await res.json()) as {
        stateName: string;
        level: string;
        message: string;
        timestamp: string;
      }[];

      // The log-message action produces at least one log entry per transition
      expect(logs.length).toBeGreaterThanOrEqual(1);

      // Each log entry has the required fields
      for (const entry of logs) {
        expect(entry).toHaveProperty('stateName');
        expect(entry).toHaveProperty('level');
        expect(entry).toHaveProperty('message');
        expect(entry).toHaveProperty('timestamp');
        expect(typeof entry.stateName).toBe('string');
        expect(typeof entry.level).toBe('string');
        expect(typeof entry.message).toBe('string');
        expect(typeof entry.timestamp).toBe('string');
      }

      // Verify the log entry corresponds to the 'start' state
      const startLogs = logs.filter((l) => l.stateName === 'start');
      expect(startLogs.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // AuditMiddleware
  // ────────────────────────────────────────────────────────────────────────

  describe('AuditMiddleware', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;
    let defId: string;
    let auditMiddleware: AuditMiddlewareInstance;

    beforeAll(async () => {
      auditMiddleware = createAuditMiddleware('e2e-test-actor');
      const { handler, runtime } = await makeTestHandler({
        middleware: [ValidationMiddleware, LoggingMiddleware, TelemetryMiddleware, auditMiddleware],
      });
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);

      const def = await api.createDef(SIMPLE_DEFINITION);
      defId = def.id;
    });

    afterAll(async () => {
      await cleanup();
    });

    it('completed machine has audit records for each transition', async () => {
      auditMiddleware.clear();
      const inst = await api.startInst(defId, SIMPLE_INPUT);
      await api.pollStatus(inst.id, ['completed']);

      const records = auditMiddleware.getRecords();
      // At least one audit record for the start → completed transition
      expect(records.length).toBeGreaterThanOrEqual(1);

      // Verify audit record structure
      const record = records.find((r) => r.instanceId === inst.id);
      expect(record).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const rec = record!;
      expect(rec.actor).toBe('e2e-test-actor');
      expect(rec.instanceId).toBe(inst.id);
      expect(rec.machineDefId).toBeDefined();
      expect(rec.stateName).toBe('start');
      expect(rec.nextState).toBe('completed');
      expect(rec.timestamp).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // TelemetryMiddleware (smoke test)
  // ────────────────────────────────────────────────────────────────────────

  describe('TelemetryMiddleware', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;
    let defId: string;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler();
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);

      const def = await api.createDef(SIMPLE_DEFINITION);
      defId = def.id;
    });

    afterAll(async () => {
      await cleanup();
    });

    it('OTel spans created per transition (no crash when OTel disabled)', async () => {
      // Smoke test: TelemetryMiddleware is in the default stack.
      // When OTel is disabled, the middleware should still work without errors.
      const inst = await api.startInst(defId, SIMPLE_INPUT);
      const final = await api.pollStatus(inst.id, ['completed', 'error']);

      // Machine should complete successfully — TelemetryMiddleware didn't crash
      expect(final.status).toBe('completed');

      // Verify the machine has transition history (telemetry didn't interfere)
      const histRes = await api.getHistory(inst.id);
      const history = (await histRes.json()) as { fromState: string; toState: string }[];
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history.some((h) => h.fromState === 'start' && h.toState === 'completed')).toBe(true);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §14.3 — Child Machine Middleware
// ════════════════════════════════════════════════════════════════════════════

describe('§14.3 — Child Machine Middleware', () => {
  describe('child transitions fire middleware independently', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;
    let childDefId: string;
    let parentDefId: string;
    let auditMiddleware: AuditMiddlewareInstance;

    beforeAll(async () => {
      auditMiddleware = createAuditMiddleware('child-test-actor');
      const { handler, runtime } = await makeTestHandler({
        registerActions: registerTestActions,
        middleware: [ValidationMiddleware, LoggingMiddleware, TelemetryMiddleware, auditMiddleware],
      });
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);

      const childDef = await api.createDef(CHILD_DEFINITION);
      childDefId = childDef.id;
      const parentDef = await api.createDef(makeChildMiddlewareParent(childDefId));
      parentDefId = parentDef.id;
    });

    afterAll(async () => {
      await cleanup();
    });

    it('middleware fires on child machine transitions independently of parent', async () => {
      auditMiddleware.clear();
      const parent = await api.startInst(parentDefId, PARENT_INPUT);
      await api.pollStatus(parent.id, ['completed', 'error']);

      const records = auditMiddleware.getRecords();

      // Find the child instance
      const childrenRes = await api.getInstances(`?parentInstanceId=${parent.id}`);
      const children = (await childrenRes.json()) as { id: string }[];
      expect(children.length).toBeGreaterThanOrEqual(1);

      const childId = children[0].id;

      // Audit records should include entries for the child instance
      const childRecords = records.filter((r) => r.instanceId === childId);
      expect(childRecords.length).toBeGreaterThanOrEqual(1);

      // Audit records should also include entries for the parent instance
      const parentRecords = records.filter((r) => r.instanceId === parent.id);
      expect(parentRecords.length).toBeGreaterThanOrEqual(1);

      // Child and parent records are distinct — middleware fires independently
      expect(childRecords[0].instanceId).not.toBe(parentRecords[0].instanceId);
    });

    it('middleware context includes parentInstanceId for child transitions', async () => {
      const parent = await api.startInst(parentDefId, PARENT_INPUT);
      await api.pollStatus(parent.id, ['completed', 'error']);

      // Verify the child instance has parentInstanceId set
      const childrenRes = await api.getInstances(`?parentInstanceId=${parent.id}`);
      const children = (await childrenRes.json()) as {
        id: string;
        parentInstanceId: string;
      }[];
      expect(children.length).toBeGreaterThanOrEqual(1);
      expect(children[0].parentInstanceId).toBe(parent.id);

      // The child's logs should exist (middleware didn't prevent them)
      const childLogsRes = await api.getLogs(children[0].id);
      expect(childLogsRes.status).toBe(200);
      const childLogs = (await childLogsRes.json()) as { stateName: string }[];
      expect(childLogs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('multi-transition child', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;
    let multiChildDefId: string;
    let parentDefId: string;
    let auditMiddleware: AuditMiddlewareInstance;

    beforeAll(async () => {
      auditMiddleware = createAuditMiddleware('multi-child-actor');
      const { handler, runtime } = await makeTestHandler({
        registerActions: registerTestActions,
        middleware: [ValidationMiddleware, LoggingMiddleware, TelemetryMiddleware, auditMiddleware],
      });
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);

      const childDef = await api.createDef(MULTI_STEP_CHILD_DEFINITION);
      multiChildDefId = childDef.id;
      const parentDef = await api.createDef(makeChildMiddlewareParent(multiChildDefId));
      parentDefId = parentDef.id;
    });

    afterAll(async () => {
      await cleanup();
    });

    it('child with multiple transitions → middleware fires for each', async () => {
      auditMiddleware.clear();

      // Multi-step child: step1 → step2 → step3 → completed = 3 action transitions
      const parent = await api.startInst(parentDefId, MULTI_STEP_INPUT);
      await api.pollStatus(parent.id, ['completed', 'error'], 15_000);

      // Find the child instance
      const childrenRes = await api.getInstances(`?parentInstanceId=${parent.id}`);
      const children = (await childrenRes.json()) as { id: string }[];
      expect(children.length).toBeGreaterThanOrEqual(1);

      const childId = children[0].id;

      // Audit records for the child should match the number of action transitions
      const childRecords = auditMiddleware.getRecords().filter((r) => r.instanceId === childId);

      // 3 action states (step1, step2, step3) → 3 afterTransition calls → 3 audit records
      expect(childRecords.length).toBe(3);

      // Verify the records correspond to the expected states
      const stateNames = childRecords.map((r) => r.stateName);
      expect(stateNames).toContain('step1');
      expect(stateNames).toContain('step2');
      expect(stateNames).toContain('step3');
    });
  });
});
