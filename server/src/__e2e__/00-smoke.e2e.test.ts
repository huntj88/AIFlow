/**
 * E2E Infrastructure Smoke Test (Task 34).
 *
 * Validates that the shared test infrastructure (handler factory, API helpers,
 * fixtures) works correctly before the full E2E suite is built out (Tasks 35–45).
 *
 * Tests:
 *  - Handler factory creates a working in-process handler
 *  - Definition CRUD via API helpers
 *  - Instance start + poll to completion
 *  - Tests are isolated (fresh handler per describe)
 *
 * @module
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type ApiHelpers, makeApiHelpers } from './helpers/api-helpers.js';
import { SIMPLE_DEFINITION, SIMPLE_INPUT } from './helpers/fixtures.js';
import { makeTestHandler } from './helpers/test-handler.js';

// ────────────────────────────────────────────────────────────────────────────
// Smoke: Definition CRUD
// ────────────────────────────────────────────────────────────────────────────

describe('E2E Infrastructure — Definition CRUD', () => {
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

  it('creates a definition and retrieves it', async () => {
    const created = await api.createDef(SIMPLE_DEFINITION);
    expect(created.id).toBeDefined();
    expect(created.version).toBe(1);

    const res = await api.getDefinition(created.id);
    expect(res.status).toBe(200);

    const fetched = (await res.json()) as { id: string; name: string };
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe(SIMPLE_DEFINITION.name);
  });

  it('lists definitions', async () => {
    // There's at least one from the previous test (tests within a describe share state)
    const res = await api.getDefinitions();
    expect(res.status).toBe(200);

    const body = (await res.json()) as unknown[];
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it('updates a definition', async () => {
    const created = await api.createDef({
      ...SIMPLE_DEFINITION,
      name: 'Updatable Machine',
    });

    const res = await api.putDefinition(created.id, {
      ...SIMPLE_DEFINITION,
      name: 'Updated Machine',
    });
    expect(res.status).toBe(200);

    const updated = (await res.json()) as { name: string; version: number };
    expect(updated.name).toBe('Updated Machine');
    expect(updated.version).toBe(2);
  });

  it('deletes a definition', async () => {
    const created = await api.createDef({
      ...SIMPLE_DEFINITION,
      name: 'Deletable Machine',
    });

    const res = await api.deleteDefinition(created.id);
    expect(res.status).toBe(204);

    const getRes = await api.getDefinition(created.id);
    expect(getRes.status).toBe(404);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Smoke: Instance Lifecycle
// ────────────────────────────────────────────────────────────────────────────

describe('E2E Infrastructure — Instance Lifecycle', () => {
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

  it('starts an instance and polls to completion', async () => {
    const def = await api.createDef(SIMPLE_DEFINITION);
    const inst = await api.startInst(def.id, SIMPLE_INPUT);

    expect(inst.id).toBeDefined();
    expect(inst.status).toBeDefined();

    const final = await api.pollStatus(inst.id, ['completed', 'error']);
    expect(final.status).toBe('completed');
  });

  it('retrieves instance history after completion', async () => {
    const def = await api.createDef(SIMPLE_DEFINITION);
    const inst = await api.startInst(def.id, SIMPLE_INPUT);
    await api.pollStatus(inst.id, ['completed', 'error']);

    const res = await api.getHistory(inst.id);
    expect(res.status).toBe(200);

    const history = (await res.json()) as unknown[];
    expect(history.length).toBeGreaterThanOrEqual(1);
  });

  it('retrieves instance logs after completion', async () => {
    const def = await api.createDef(SIMPLE_DEFINITION);
    const inst = await api.startInst(def.id, SIMPLE_INPUT);
    await api.pollStatus(inst.id, ['completed', 'error']);

    const res = await api.getLogs(inst.id);
    expect(res.status).toBe(200);

    const logs = (await res.json()) as unknown[];
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Smoke: Actions Registry
// ────────────────────────────────────────────────────────────────────────────

describe('E2E Infrastructure — Actions', () => {
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

  it('lists registered actions', async () => {
    const res = await api.getActions();
    expect(res.status).toBe(200);

    const actions = (await res.json()) as { id: string }[];
    expect(actions.length).toBeGreaterThanOrEqual(1);

    // Built-in actions should be present
    const ids = actions.map((a) => a.id);
    expect(ids).toContain('log-message');
    expect(ids).toContain('delay');
  });
});
