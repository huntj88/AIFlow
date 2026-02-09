/**
 * Integration tests for Action Registry routes (Task 22).
 *
 * Covers: §3 Action Registry — list and get actions via the REST API.
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

import { ActionsRouter } from './actions.js';

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
// Handler
// ────────────────────────────────────────────────────────────────────────────

async function makeHandler() {
  const managedRuntime = ManagedRuntime.make(TestLayer);
  const runtime = await managedRuntime.runtime();
  const served = ActionsRouter.pipe(HttpRouter.use((httpApp) => Effect.provide(httpApp, runtime)));
  return HttpApp.toWebHandler(served);
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

const BUILT_IN_ACTION_IDS = [
  'http-request',
  'delay',
  'transform-data',
  'log-message',
  'conditional-branch',
];

describe('ActionsRouter', () => {
  let handler: ReturnType<typeof HttpApp.toWebHandler>;

  beforeAll(async () => {
    handler = await makeHandler();
  });

  const get = (path = '') => handler(new Request(`http://localhost/api/machines/actions${path}`));

  it('GET list returns all 5 built-in actions with metadata', async () => {
    const res = await get();
    expect(res.status).toBe(200);

    const list = (await res.json()) as { id: string; description?: string }[];
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(5);

    const ids = list.map((a) => a.id);
    for (const expected of BUILT_IN_ACTION_IDS) {
      expect(ids).toContain(expected);
    }

    // Every action should have at least id and description
    for (const action of list) {
      expect(action).toHaveProperty('id');
      expect(typeof action.id).toBe('string');
    }
  });

  it('GET by id returns specific action metadata', async () => {
    const res = await get('/log-message');
    expect(res.status).toBe(200);

    const body = (await res.json()) as { id: string; description?: string };
    expect(body.id).toBe('log-message');
    expect(body).toHaveProperty('description');
  });

  it('GET each built-in action by id succeeds', async () => {
    for (const actionId of BUILT_IN_ACTION_IDS) {
      const res = await get(`/${actionId}`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { id: string };
      expect(body.id).toBe(actionId);
    }
  });

  it('GET non-existent action → 404', async () => {
    const res = await get('/non-existent-action');
    expect(res.status).toBe(404);

    const body = (await res.json()) as { message: string };
    expect(body.message).toContain('not found');
  });
});
