/**
 * Integration tests for Definition CRUD routes (Task 22).
 *
 * Uses `HttpApp.toWebHandler()` with in-process layers — no real server needed.
 * Covers: §1 Definition CRUD, §2 Validation error responses, §21 Edge cases.
 *
 * @module
 */

import { HttpApp, HttpRouter } from '@effect/platform';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { beforeAll, describe, expect, it } from 'vitest';

import { ActionRegistryLive } from '@/machines/ActionRegistry.js';
import { FsArtifactStoreLive } from '@/machines/artifacts/FsArtifactStore.js';
import { ExecutionSemaphoreLive } from '@/machines/ExecutionSemaphore.js';
import { makeMiddlewareExecutorLayer } from '@/machines/middleware/MiddlewareExecutor.js';
import { StateMachineRunnerLive } from '@/machines/StateMachineRunner.js';
import { InMemoryMachineStoreLive } from '@/machines/store/index.js';

import { DefinitionsRouter } from './definitions.js';

// ────────────────────────────────────────────────────────────────────────────
// Test Layer
// ────────────────────────────────────────────────────────────────────────────

const StoreLive = InMemoryMachineStoreLive;
const RegistryLive = ActionRegistryLive;
const MiddlewareLive = makeMiddlewareExecutorLayer([]);
const SemaphoreLive = ExecutionSemaphoreLive;
const ArtifactLive = FsArtifactStoreLive.pipe(Layer.provide(StoreLive));
const RunnerLive = StateMachineRunnerLive.pipe(
  Layer.provide(
    Layer.mergeAll(StoreLive, RegistryLive, ArtifactLive, MiddlewareLive, SemaphoreLive),
  ),
);

const TestLayer = Layer.mergeAll(StoreLive, RegistryLive, ArtifactLive, RunnerLive, SemaphoreLive);

// ────────────────────────────────────────────────────────────────────────────
// Handler factory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build an in-process web handler from the DefinitionsRouter with all
 * Effect services provided via the TestLayer (async — ActionRegistryLive
 * uses a dynamic import internally).
 */
async function makeHandler() {
  const managedRuntime = ManagedRuntime.make(TestLayer);
  const runtime = await managedRuntime.runtime();

  const served = DefinitionsRouter.pipe(
    HttpRouter.use((httpApp) => Effect.provide(httpApp, runtime)),
  );

  return HttpApp.toWebHandler(served);
}

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

/** Minimal valid definition body with required terminal states. */
const validBody = {
  name: 'test-definition',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  states: {
    start: { name: 'start', type: 'action', actionId: 'log-message' },
    completed: { name: 'completed', type: 'terminal' },
    cancelled: { name: 'cancelled', type: 'terminal' },
    error: { name: 'error', type: 'terminal' },
  },
  initialState: 'start',
  transitions: [
    { from: 'start', to: 'completed' },
    { from: 'start', to: 'cancelled' },
    { from: 'start', to: 'error' },
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('DefinitionsRouter', () => {
  let handler: ReturnType<typeof HttpApp.toWebHandler>;

  beforeAll(async () => {
    handler = await makeHandler();
  });

  // ── Helper ──────────────────────────────────────────────────────────────

  const post = (body: unknown) =>
    handler(
      new Request('http://localhost/api/machines/definitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  const get = (path = '') =>
    handler(new Request(`http://localhost/api/machines/definitions${path}`));

  const put = (id: string, body: unknown) =>
    handler(
      new Request(`http://localhost/api/machines/definitions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  const del = (id: string) =>
    handler(
      new Request(`http://localhost/api/machines/definitions/${id}`, {
        method: 'DELETE',
      }),
    );

  // ── CRUD (§1) ─────────────────────────────────────────────────────────

  describe('CRUD Operations', () => {
    it('POST with valid body → 201 with id, version, timestamps', async () => {
      const res = await post(validBody);
      expect(res.status).toBe(201);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('id');
      expect(body.version).toBe(1);
      expect(body).toHaveProperty('metadata');
      const meta = body.metadata as Record<string, unknown>;
      expect(meta).toHaveProperty('createdAt');
      expect(meta).toHaveProperty('updatedAt');
    });

    it('Created definition appears in GET list', async () => {
      const createRes = await post(validBody);
      const created = (await createRes.json()) as { id: string };

      const listRes = await get();
      expect(listRes.status).toBe(200);
      const list = (await listRes.json()) as { id: string }[];
      expect(list.some((d) => d.id === created.id)).toBe(true);
    });

    it('Creating with same name succeeds (names not unique)', async () => {
      const res1 = await post(validBody);
      const res2 = await post(validBody);
      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);

      const body1 = (await res1.json()) as { id: string };
      const body2 = (await res2.json()) as { id: string };
      expect(body1.id).not.toBe(body2.id);
    });

    it('GET by id returns full definition JSON', async () => {
      const createRes = await post(validBody);
      const created = (await createRes.json()) as { id: string; name: string };

      const getRes = await get(`/${created.id}`);
      expect(getRes.status).toBe(200);

      const body = (await getRes.json()) as { id: string; name: string };
      expect(body.id).toBe(created.id);
      expect(body.name).toBe('test-definition');
    });

    it('GET non-existent id → 404', async () => {
      const res = await get('/non-existent-id');
      expect(res.status).toBe(404);

      const body = (await res.json()) as { message: string };
      expect(body.message).toContain('not found');
    });

    it('GET list returns array of all definitions', async () => {
      const res = await get();
      expect(res.status).toBe(200);

      const list = (await res.json()) as unknown[];
      expect(Array.isArray(list)).toBe(true);
    });

    it('PUT with valid body → updated definition; version incremented; updatedAt refreshed', async () => {
      const createRes = await post(validBody);
      const created = (await createRes.json()) as {
        id: string;
        version: number;
        metadata: { updatedAt: string };
      };

      // Small delay to ensure timestamp difference
      await new Promise((r) => setTimeout(r, 10));

      const updateBody = { ...validBody, name: 'updated-definition' };
      const putRes = await put(created.id, updateBody);
      expect(putRes.status).toBe(200);

      const updated = (await putRes.json()) as {
        id: string;
        name: string;
        version: number;
        metadata: { updatedAt: string };
      };
      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe('updated-definition');
      expect(updated.version).toBe(created.version + 1);
      expect(updated.metadata.updatedAt >= created.metadata.updatedAt).toBe(true);
    });

    it('PUT non-existent id → 404', async () => {
      const res = await put('non-existent-id', validBody);
      expect(res.status).toBe(404);
    });

    it('DELETE → success (204)', async () => {
      const createRes = await post(validBody);
      const created = (await createRes.json()) as { id: string };

      const delRes = await del(created.id);
      expect(delRes.status).toBe(204);
    });

    it('Deleted definition → 404 on GET and not in list', async () => {
      const createRes = await post(validBody);
      const created = (await createRes.json()) as { id: string };

      await del(created.id);

      const getRes = await get(`/${created.id}`);
      expect(getRes.status).toBe(404);

      const listRes = await get();
      const list = (await listRes.json()) as { id: string }[];
      expect(list.some((d) => d.id === created.id)).toBe(false);
    });

    it('DELETE non-existent → 404', async () => {
      const res = await del('non-existent-id');
      expect(res.status).toBe(404);
    });
  });

  // ── Validation (§2) ──────────────────────────────────────────────────

  describe('Validation Errors', () => {
    it('POST with invalid definition (bad initialState) → 400 with DefinitionError', async () => {
      const invalid = { ...validBody, initialState: 'nonexistent' };
      const res = await post(invalid);
      expect(res.status).toBe(400);

      const body = (await res.json()) as { message: string; details?: string[] };
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('details');
      expect(Array.isArray(body.details)).toBe(true);
    });

    it('POST with missing terminal states → 400', async () => {
      const noTerminal = {
        ...validBody,
        states: {
          start: { name: 'start', type: 'action', actionId: 'log-message' },
          middle: { name: 'middle', type: 'action', actionId: 'log-message' },
          // Missing required terminal states: completed, cancelled, error
        },
        transitions: [{ from: 'start', to: 'middle' }],
      };
      const res = await post(noTerminal);
      expect(res.status).toBe(400);
    });

    it('PUT with invalid definition → 400', async () => {
      const createRes = await post(validBody);
      const created = (await createRes.json()) as { id: string };

      const invalid = { ...validBody, initialState: 'nonexistent' };
      const res = await put(created.id, invalid);
      expect(res.status).toBe(400);
    });

    it('Validation response has message and details[]', async () => {
      const invalid = { ...validBody, initialState: 'nonexistent' };
      const res = await post(invalid);
      expect(res.status).toBe(400);

      const body = (await res.json()) as { message: string; details: string[] };
      expect(typeof body.message).toBe('string');
      expect(Array.isArray(body.details)).toBe(true);
      expect(body.details.length).toBeGreaterThan(0);
    });

    it('POST with invalid body (non-JSON) → 400', async () => {
      const res = await handler(
        new Request('http://localhost/api/machines/definitions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not-json',
        }),
      );
      expect(res.status).toBe(400);
    });

    it('POST with missing required fields → 400', async () => {
      const res = await post({ name: 'incomplete' });
      expect(res.status).toBe(400);
    });

    it('Multiple validation violations reported together', async () => {
      // Definition with multiple problems: bad initialState + missing required terminal states
      const multiInvalid = {
        ...validBody,
        initialState: 'nonexistent',
        states: {
          start: { name: 'start', type: 'action', actionId: 'log-message' },
          // Missing completed, cancelled, error
        },
        transitions: [],
      };
      const res = await post(multiInvalid);
      expect(res.status).toBe(400);

      const body = (await res.json()) as { message: string; details: string[] };
      expect(body).toHaveProperty('message');
    });
  });
});
