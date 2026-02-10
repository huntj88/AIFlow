/**
 * E2E: Definition CRUD & Validation (Task 35).
 *
 * Validates all 28 behaviors from §1 (Definition CRUD) and §2 (Definition
 * Validation) via HTTP requests against an in-process handler.
 *
 * @module
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type ApiHelpers, makeApiHelpers } from './helpers/api-helpers.js';
import { makeTestHandler } from './helpers/test-handler.js';

// ────────────────────────────────────────────────────────────────────────────
// Shared valid base definition (all tests build from this)
// ────────────────────────────────────────────────────────────────────────────

const VALID_DEF = {
  name: 'test-def',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'start',
  states: {
    start: { name: 'start', type: 'action' as const, actionId: 'log-message' },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [
    { from: 'start', to: 'completed' },
    { from: 'start', to: 'cancelled' },
    { from: 'start', to: 'error' },
  ],
};

// ════════════════════════════════════════════════════════════════════════════
// §1 — Definition CRUD
// ════════════════════════════════════════════════════════════════════════════

describe('§1 — Definition CRUD', () => {
  // ── §1.1 Create ──────────────────────────────────────────────────────────

  describe('§1.1 Create', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler();
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);
    });

    afterAll(async () => {
      await cleanup();
    });

    it('POST /definitions with valid body → 201 with generated id', async () => {
      const res = await api.postDefinition(VALID_DEF);
      expect(res.status).toBe(201);

      const body = (await res.json()) as { id: string };
      expect(body.id).toBeDefined();
      expect(typeof body.id).toBe('string');
      expect(body.id.length).toBeGreaterThan(0);
    });

    it('created definition has version: 1 and populated timestamps', async () => {
      const res = await api.postDefinition(VALID_DEF);
      expect(res.status).toBe(201);

      const body = (await res.json()) as {
        version: number;
        metadata: { createdAt: string; updatedAt: string };
      };
      expect(body.version).toBe(1);
      expect(body.metadata.createdAt).toBeDefined();
      expect(body.metadata.updatedAt).toBeDefined();
      // Timestamps should be valid ISO strings
      expect(new Date(body.metadata.createdAt).toISOString()).toBe(body.metadata.createdAt);
      expect(new Date(body.metadata.updatedAt).toISOString()).toBe(body.metadata.updatedAt);
    });

    it('created definition appears in GET list', async () => {
      const created = await api.createDef(VALID_DEF);

      const listRes = await api.getDefinitions();
      expect(listRes.status).toBe(200);

      const list = (await listRes.json()) as { id: string }[];
      const ids = list.map((d) => d.id);
      expect(ids).toContain(created.id);
    });

    it('creating with duplicate name succeeds', async () => {
      const first = await api.postDefinition({ ...VALID_DEF, name: 'dup-name' });
      expect(first.status).toBe(201);

      const second = await api.postDefinition({ ...VALID_DEF, name: 'dup-name' });
      expect(second.status).toBe(201);

      const firstBody = (await first.json()) as { id: string };
      const secondBody = (await second.json()) as { id: string };
      expect(firstBody.id).not.toBe(secondBody.id);
    });
  });

  // ── §1.2 Read ────────────────────────────────────────────────────────────

  describe('§1.2 Read', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler();
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);
    });

    afterAll(async () => {
      await cleanup();
    });

    it('GET /definitions/:id returns full definition JSON', async () => {
      const created = await api.createDef(VALID_DEF);

      const res = await api.getDefinition(created.id);
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        id: string;
        name: string;
        version: number;
        initialState: string;
        states: Record<string, unknown>;
        transitions: unknown[];
        inputSchema: unknown;
        outputSchema: unknown;
        metadata: { createdAt: string; updatedAt: string };
      };
      expect(body.id).toBe(created.id);
      expect(body.name).toBe(VALID_DEF.name);
      expect(body.version).toBe(1);
      expect(body.initialState).toBe(VALID_DEF.initialState);
      expect(body.states).toBeDefined();
      expect(body.transitions).toBeDefined();
      expect(body.inputSchema).toBeDefined();
      expect(body.outputSchema).toBeDefined();
      expect(body.metadata.createdAt).toBeDefined();
      expect(body.metadata.updatedAt).toBeDefined();
    });

    it('GET /definitions/:id for non-existent ID → 404', async () => {
      const res = await api.getDefinition('non-existent-id-12345');
      expect(res.status).toBe(404);
    });

    it('GET /definitions returns array of all definitions', async () => {
      // Create two definitions so the list is non-empty
      await api.createDef({ ...VALID_DEF, name: 'list-test-1' });
      await api.createDef({ ...VALID_DEF, name: 'list-test-2' });

      const res = await api.getDefinitions();
      expect(res.status).toBe(200);

      const body = (await res.json()) as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── §1.3 Update ──────────────────────────────────────────────────────────

  describe('§1.3 Update', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler();
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);
    });

    afterAll(async () => {
      await cleanup();
    });

    it('PUT /definitions/:id returns updated definition', async () => {
      const created = await api.createDef(VALID_DEF);

      const updatedPayload = { ...VALID_DEF, name: 'updated-name' };
      const res = await api.putDefinition(created.id, updatedPayload);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { id: string; name: string };
      expect(body.id).toBe(created.id);
      expect(body.name).toBe('updated-name');
    });

    it('update increments version monotonically', async () => {
      const created = await api.createDef(VALID_DEF);
      expect(created.version).toBe(1);

      const res1 = await api.putDefinition(created.id, { ...VALID_DEF, name: 'v2' });
      const body1 = (await res1.json()) as { version: number };
      expect(body1.version).toBe(2);

      const res2 = await api.putDefinition(created.id, { ...VALID_DEF, name: 'v3' });
      const body2 = (await res2.json()) as { version: number };
      expect(body2.version).toBe(3);
    });

    it('update refreshes updatedAt', async () => {
      const created = await api.createDef(VALID_DEF);
      const originalUpdatedAt = (created as unknown as { metadata: { updatedAt: string } }).metadata
        .updatedAt;

      // Small delay to ensure timestamp difference
      await new Promise((r) => setTimeout(r, 50));

      const res = await api.putDefinition(created.id, { ...VALID_DEF, name: 'refreshed' });
      const body = (await res.json()) as { metadata: { updatedAt: string } };

      expect(new Date(body.metadata.updatedAt).getTime()).toBeGreaterThan(
        new Date(originalUpdatedAt).getTime(),
      );
    });

    it('PUT on non-existent ID → 404', async () => {
      const res = await api.putDefinition('non-existent-id-99999', VALID_DEF);
      expect(res.status).toBe(404);
    });
  });

  // ── §1.4 Delete ──────────────────────────────────────────────────────────

  describe('§1.4 Delete', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler();
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);
    });

    afterAll(async () => {
      await cleanup();
    });

    it('DELETE /definitions/:id returns 204', async () => {
      const created = await api.createDef(VALID_DEF);

      const res = await api.deleteDefinition(created.id);
      expect(res.status).toBe(204);
    });

    it('deleted definition → 404 on GET and absent from list', async () => {
      const created = await api.createDef(VALID_DEF);
      await api.deleteDefinition(created.id);

      // GET by id should 404
      const getRes = await api.getDefinition(created.id);
      expect(getRes.status).toBe(404);

      // List should not contain the deleted id
      const listRes = await api.getDefinitions();
      const list = (await listRes.json()) as { id: string }[];
      const ids = list.map((d) => d.id);
      expect(ids).not.toContain(created.id);
    });

    it('DELETE on non-existent ID → 404', async () => {
      const res = await api.deleteDefinition('non-existent-id-delete');
      expect(res.status).toBe(404);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §2 — Definition Validation
// ════════════════════════════════════════════════════════════════════════════

describe('§2 — Definition Validation', () => {
  // ── §2.1 Structural Rules ────────────────────────────────────────────────

  describe('§2.1 Structural Rules', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler();
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);
    });

    afterAll(async () => {
      await cleanup();
    });

    it('Rule 1: initialState not in states → 400', async () => {
      const res = await api.postDefinition({
        ...VALID_DEF,
        initialState: 'nonexistent',
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { message: string; details: string[] };
      expect(body.message).toBeDefined();
      expect(body.details.length).toBeGreaterThanOrEqual(1);
      expect(body.details.some((d) => d.includes('Rule 1'))).toBe(true);
    });

    it('Rule 2: missing required terminal states → 400', async () => {
      const res = await api.postDefinition({
        ...VALID_DEF,
        states: {
          start: { name: 'start', type: 'action' as const, actionId: 'log-message' },
        },
        transitions: [],
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { message: string; details: string[] };
      expect(body.details.some((d) => d.includes('Rule 2'))).toBe(true);
    });

    it('Rule 3: transition from terminal state → 400', async () => {
      const res = await api.postDefinition({
        ...VALID_DEF,
        transitions: [...VALID_DEF.transitions, { from: 'completed', to: 'start' }],
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { message: string; details: string[] };
      expect(body.details.some((d) => d.includes('Rule 3'))).toBe(true);
    });

    it('Rule 4: transition references non-existent state → 400', async () => {
      const res = await api.postDefinition({
        ...VALID_DEF,
        transitions: [
          { from: 'start', to: 'completed' },
          { from: 'start', to: 'cancelled' },
          { from: 'start', to: 'error' },
          { from: 'start', to: 'ghost' },
        ],
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { message: string; details: string[] };
      expect(body.details.some((d) => d.includes('Rule 4'))).toBe(true);
    });

    it('Rule 5: non-terminal with zero outgoing transitions → 400', async () => {
      const res = await api.postDefinition({
        ...VALID_DEF,
        states: {
          ...VALID_DEF.states,
          orphan_action: {
            name: 'orphan_action',
            type: 'action' as const,
            actionId: 'log-message',
          },
        },
        transitions: [
          ...VALID_DEF.transitions,
          { from: 'start', to: 'orphan_action' },
          // orphan_action has no outgoing transition → dead-end
        ],
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { message: string; details: string[] };
      expect(body.details.some((d) => d.includes('Rule 5'))).toBe(true);
    });

    it('Rule 6: unreachable non-terminal state → 400', async () => {
      const res = await api.postDefinition({
        ...VALID_DEF,
        states: {
          ...VALID_DEF.states,
          island: { name: 'island', type: 'action' as const, actionId: 'log-message' },
        },
        transitions: [
          ...VALID_DEF.transitions,
          // island has an outgoing transition but is not reachable from start
          { from: 'island', to: 'completed' },
        ],
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { message: string; details: string[] };
      expect(body.details.some((d) => d.includes('Rule 6'))).toBe(true);
    });

    it('Rule 7: state name does not match key → 400', async () => {
      const res = await api.postDefinition({
        ...VALID_DEF,
        states: {
          ...VALID_DEF.states,
          start: { name: 'wrong-name', type: 'action' as const, actionId: 'log-message' },
        },
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { message: string; details: string[] };
      expect(body.details.some((d) => d.includes('Rule 7'))).toBe(true);
    });
  });

  // ── §2.2 State Type Rules ────────────────────────────────────────────────

  describe('§2.2 State Type Rules', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler();
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);
    });

    afterAll(async () => {
      await cleanup();
    });

    it('Rule 8: action state with unknown actionId → save succeeds (advisory)', async () => {
      const res = await api.postDefinition({
        ...VALID_DEF,
        states: {
          ...VALID_DEF.states,
          start: {
            name: 'start',
            type: 'action' as const,
            actionId: 'completely-unknown-action-xyz',
          },
        },
      });
      // In save mode, unknown actionId is advisory — should still succeed
      expect(res.status).toBe(201);
    });

    it('Rule 9: child_machine missing actionId/childMachineDefId/childInputMapping → 400', async () => {
      const res = await api.postDefinition({
        ...VALID_DEF,
        states: {
          ...VALID_DEF.states,
          start: {
            name: 'start',
            type: 'child_machine' as const,
            // Missing actionId, childMachineDefId, childInputMapping
          },
        },
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { message: string; details: string[] };
      expect(body.details.some((d) => d.includes('Rule 9'))).toBe(true);
    });

    it('Rule 10: parallel_children missing actionId or empty children → 400', async () => {
      const res = await api.postDefinition({
        ...VALID_DEF,
        states: {
          ...VALID_DEF.states,
          start: {
            name: 'start',
            type: 'parallel_children' as const,
            // Missing actionId and empty/missing children
          },
        },
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { message: string; details: string[] };
      expect(body.details.some((d) => d.includes('Rule 10'))).toBe(true);
    });

    it('Rule 11: terminal state with actionId → 400', async () => {
      const res = await api.postDefinition({
        ...VALID_DEF,
        states: {
          ...VALID_DEF.states,
          completed: {
            name: 'completed',
            type: 'terminal' as const,
            actionId: 'log-message',
          },
        },
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { message: string; details: string[] };
      expect(body.details.some((d) => d.includes('Rule 11'))).toBe(true);
    });
  });

  // ── §2.3 Referential Integrity ───────────────────────────────────────────

  describe('§2.3 Referential Integrity', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler();
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);
    });

    afterAll(async () => {
      await cleanup();
    });

    it('Rule 12: cyclic childMachineDefId references → 400', async () => {
      // Create definition A that references itself as child
      // Since we don't know the ID before creation, we use
      // __temp_validation__ which the validator will use for self-ref check
      const res = await api.postDefinition({
        ...VALID_DEF,
        states: {
          ...VALID_DEF.states,
          start: {
            name: 'start',
            type: 'child_machine' as const,
            actionId: 'log-message',
            childMachineDefId: '__temp_validation__',
            childInputMapping: '$.machineInput',
          },
        },
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { message: string; details: string[] };
      expect(body.details.some((d) => d.includes('Rule 12'))).toBe(true);
    });

    it('Rule 13: invalid JSON Schema in inputSchema → 400', async () => {
      const res = await api.postDefinition({
        ...VALID_DEF,
        inputSchema: { type: 'invalid-type' },
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { message: string; details: string[] };
      expect(body.details.some((d) => d.includes('Rule 13'))).toBe(true);
    });

    it('Rule 14: parallel_children with duplicate child keys → 400', async () => {
      const res = await api.postDefinition({
        ...VALID_DEF,
        states: {
          ...VALID_DEF.states,
          start: {
            name: 'start',
            type: 'parallel_children' as const,
            actionId: 'log-message',
            children: [
              { key: 'same_key', machineDefId: 'def-1', inputMapping: '$.machineInput' },
              { key: 'same_key', machineDefId: 'def-2', inputMapping: '$.machineInput' },
            ],
            parallelMode: 'all_settled' as const,
          },
        },
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { message: string; details: string[] };
      expect(body.details.some((d) => d.includes('Rule 14'))).toBe(true);
    });
  });

  // ── §2.4 Validation Error Response ───────────────────────────────────────

  describe('§2.4 Validation Error Response', () => {
    let api: ApiHelpers;
    let cleanup: () => Promise<void>;

    beforeAll(async () => {
      const { handler, runtime } = await makeTestHandler();
      api = makeApiHelpers(handler);
      cleanup = () => runtime.dispose().then(() => undefined);
    });

    afterAll(async () => {
      await cleanup();
    });

    it('returns DefinitionError with message and details[]', async () => {
      const res = await api.postDefinition({
        ...VALID_DEF,
        initialState: 'nonexistent',
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { message: string; details: string[] };
      expect(typeof body.message).toBe('string');
      expect(body.message.length).toBeGreaterThan(0);
      expect(Array.isArray(body.details)).toBe(true);
      expect(body.details.length).toBeGreaterThanOrEqual(1);
      // Each detail should be a string
      for (const detail of body.details) {
        expect(typeof detail).toBe('string');
      }
    });

    it('reports multiple violations together', async () => {
      // Build a definition with multiple simultaneous violations:
      // - initialState references non-existent state (Rule 1)
      // - name mismatch on start (Rule 7)
      // - no terminal states (Rule 2)
      const res = await api.postDefinition({
        ...VALID_DEF,
        initialState: 'nonexistent',
        states: {
          start: { name: 'wrong', type: 'action' as const, actionId: 'log-message' },
        },
        transitions: [],
      });
      expect(res.status).toBe(400);

      const body = (await res.json()) as { message: string; details: string[] };
      expect(body.details.length).toBeGreaterThanOrEqual(2);
    });
  });
});
