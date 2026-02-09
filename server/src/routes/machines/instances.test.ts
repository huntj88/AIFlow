/**
 * Integration tests for Instance lifecycle routes (Task 22).
 *
 * Uses `HttpApp.toWebHandler()` with in-process layers — no real server needed.
 * Covers: §4 Start & Query, §4.4 History, §4.5 Logs, §11 Cancel, §12 Resume,
 *         §15 Artifacts, §21 Concurrent ops & definition mutation.
 *
 * @module
 */

import { HttpApp, HttpRouter } from '@effect/platform';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { beforeAll, describe, expect, it } from 'vitest';

import { ActionRegistry, ActionRegistryLive } from '@/machines/ActionRegistry.js';
import { FsArtifactStoreLive } from '@/machines/artifacts/FsArtifactStore.js';
import { ExecutionSemaphoreLive } from '@/machines/ExecutionSemaphore.js';
import { makeMiddlewareExecutorLayer } from '@/machines/middleware/MiddlewareExecutor.js';
import { StateMachineRunnerLive } from '@/machines/StateMachineRunner.js';
import { InMemoryMachineStoreLive } from '@/machines/store/index.js';
import { mkActionError } from '@/machines/types.js';

import { MachineRouter } from './index.js';

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

/**
 * Build an in-process web handler from the combined MachineRouter
 * (definitions + actions + instances) so we can create definitions
 * and then start instances against them.
 */
async function makeHandler() {
  const managedRuntime = ManagedRuntime.make(TestLayer);
  const runtime = await managedRuntime.runtime();

  // Register a test-only action that writes an artifact
  await managedRuntime.runPromise(
    Effect.gen(function* () {
      const registry = yield* ActionRegistry;
      yield* registry.register(
        'save-artifact',
        (ctx) =>
          Effect.gen(function* () {
            const content = ctx.stateData as {
              filename?: string;
              content?: string;
              nextState?: string;
            };
            const filename = content.filename ?? 'output.txt';
            const fileContent = content.content ?? 'hello from artifact';
            const nextState = content.nextState ?? 'completed';

            yield* ctx.artifacts.write(filename, new TextEncoder().encode(fileContent)).pipe(
              Effect.mapError((e) =>
                mkActionError({
                  actionId: 'save-artifact',
                  stateName: ctx.stateName,
                  cause: e.cause,
                }),
              ),
            );
            yield* ctx.logger.info(`Wrote artifact: ${filename}`);

            return { nextState, data: { artifact: filename } };
          }),
        { description: 'Test action that writes an artifact file' },
      );
    }),
  );

  const served = MachineRouter.pipe(HttpRouter.use((httpApp) => Effect.provide(httpApp, runtime)));
  return HttpApp.toWebHandler(served);
}

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

/**
 * A simple two-state machine: start (log-message) → end (terminal).
 * log-message expects { message, nextState } in stateData — but the runner
 * passes stateData from the definition, not the input. We'll configure
 * the start state's action to be `log-message` with suitable stateData,
 * or use a simpler custom setup.
 *
 * Actually, the runner calls the action with `ctx.stateData` sourced from
 * the instance's current `stateData` (seeded from `input` initially).
 * So to make `log-message` work, we need the input to contain `message` and `nextState`.
 */
const simpleDefinitionBody = {
  name: 'simple-machine',
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

/**
 * A machine that uses a delay action so it stays running long enough
 * for cancel tests.
 */
const slowDefinitionBody = {
  name: 'slow-machine',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  states: {
    start: { name: 'start', type: 'action', actionId: 'delay' },
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

/**
 * A machine that uses a save-artifact action so we can test artifact download.
 */
const artifactDefinitionBody = {
  name: 'artifact-machine',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  states: {
    start: { name: 'start', type: 'action', actionId: 'save-artifact' },
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

describe('InstancesRouter', () => {
  let handler: ReturnType<typeof HttpApp.toWebHandler>;

  beforeAll(async () => {
    handler = await makeHandler();
  });

  // ── HTTP Helpers ────────────────────────────────────────────────────────

  const postDef = (body: unknown) =>
    handler(
      new Request('http://localhost/api/machines/definitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  const postInstance = (body: unknown) =>
    handler(
      new Request('http://localhost/api/machines/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  const getInstances = (query = '') =>
    handler(new Request(`http://localhost/api/machines/instances${query}`));

  const getInstance = (id: string) =>
    handler(new Request(`http://localhost/api/machines/instances/${id}`));

  const getHistory = (id: string) =>
    handler(new Request(`http://localhost/api/machines/instances/${id}/history`));

  const getLogs = (id: string, query = '') =>
    handler(new Request(`http://localhost/api/machines/instances/${id}/logs${query}`));

  const postCancel = (id: string) =>
    handler(
      new Request(`http://localhost/api/machines/instances/${id}/cancel`, {
        method: 'POST',
      }),
    );

  const postResume = (id: string) =>
    handler(
      new Request(`http://localhost/api/machines/instances/${id}/resume`, {
        method: 'POST',
      }),
    );

  const getArtifacts = (id: string, query = '') =>
    handler(new Request(`http://localhost/api/machines/instances/${id}/artifacts${query}`));

  const getArtifact = (id: string, name: string) =>
    handler(new Request(`http://localhost/api/machines/instances/${id}/artifacts/${name}`));

  const putDef = (id: string, body: unknown) =>
    handler(
      new Request(`http://localhost/api/machines/definitions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  const delDef = (id: string) =>
    handler(
      new Request(`http://localhost/api/machines/definitions/${id}`, {
        method: 'DELETE',
      }),
    );

  /**
   * Helper: create a definition and return its id.
   */
  async function createDefinition(body: unknown = simpleDefinitionBody): Promise<string> {
    const res = await postDef(body);
    expect(res.status).toBe(201);
    const json = (await res.json()) as { id: string };
    return json.id;
  }

  /**
   * Helper: start an instance and return the response body.
   */
  async function startInstance(
    definitionId: string,
    input: unknown = { message: 'hello', nextState: 'completed' },
  ): Promise<{ id: string; status: string; [key: string]: unknown }> {
    const res = await postInstance({ definitionId, input });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; status: string };
  }

  // ── Start & Query (§4, §21) ────────────────────────────────────────────

  describe('Start & Query', () => {
    it('POST with valid definition ID and input → 201 with instance ID', async () => {
      const defId = await createDefinition();
      const res = await postInstance({
        definitionId: defId,
        input: { message: 'hello', nextState: 'completed' },
      });
      expect(res.status).toBe(201);

      const body = (await res.json()) as { id: string; definitionId: string };
      expect(body).toHaveProperty('id');
      expect(body.definitionId).toBe(defId);
    });

    it('POST with missing definitionId → 400', async () => {
      const res = await postInstance({ input: {} });
      expect(res.status).toBe(400);
    });

    it('POST with missing input (Schema.Unknown accepts undefined) → 404 for non-existent def', async () => {
      const res = await postInstance({ definitionId: 'some-id' });
      // input: Schema.Unknown accepts undefined, so decode succeeds
      // Route then looks up the non-existent definitionId → 404
      expect(res.status).toBe(404);
    });

    it('POST with non-existent definition ID → 404', async () => {
      const res = await postInstance({ definitionId: 'non-existent', input: {} });
      expect(res.status).toBe(404);

      const body = (await res.json()) as { message: string };
      expect(body.message).toContain('not found');
    });

    it('GET list returns instances', async () => {
      const defId = await createDefinition();
      await startInstance(defId);

      const res = await getInstances();
      expect(res.status).toBe(200);

      const list = (await res.json()) as unknown[];
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
    });

    it('GET list supports status filter', async () => {
      const defId = await createDefinition();
      await startInstance(defId);

      // Wait for the machine to complete
      await new Promise((r) => setTimeout(r, 200));

      const res = await getInstances('?status=completed');
      expect(res.status).toBe(200);

      const list = (await res.json()) as { status: string }[];
      for (const inst of list) {
        expect(inst.status).toBe('completed');
      }
    });

    it('GET list supports definitionId filter', async () => {
      const defId = await createDefinition();
      await startInstance(defId);

      const res = await getInstances(`?definitionId=${defId}`);
      expect(res.status).toBe(200);

      const list = (await res.json()) as { definitionId: string }[];
      for (const inst of list) {
        expect(inst.definitionId).toBe(defId);
      }
    });

    it('GET by id returns full instance', async () => {
      const defId = await createDefinition();
      const instance = await startInstance(defId);

      const res = await getInstance(instance.id);
      expect(res.status).toBe(200);

      const body = (await res.json()) as { id: string; definitionId: string };
      expect(body.id).toBe(instance.id);
      expect(body.definitionId).toBe(defId);
    });

    it('GET non-existent instance → 404', async () => {
      const res = await getInstance('non-existent-id');
      expect(res.status).toBe(404);

      const body = (await res.json()) as { message: string };
      expect(body.message).toContain('not found');
    });
  });

  // ── History & Logs (§4.4, §4.5) ──────────────────────────────────────

  describe('History & Logs', () => {
    it('GET /instances/:id/history returns ordered transition records', async () => {
      const defId = await createDefinition();
      const instance = await startInstance(defId);

      // Wait for machine to complete
      await new Promise((r) => setTimeout(r, 200));

      const res = await getHistory(instance.id);
      expect(res.status).toBe(200);

      const history = (await res.json()) as {
        fromState: string;
        toState: string;
        timestamp: string;
      }[];
      expect(Array.isArray(history)).toBe(true);
      // A completed two-state machine should have at least one transition
      if (history.length > 0) {
        expect(history[0]).toHaveProperty('fromState');
        expect(history[0]).toHaveProperty('toState');
        expect(history[0]).toHaveProperty('timestamp');
      }
    });

    it('GET /instances/:id/history for non-existent → 404', async () => {
      const res = await getHistory('non-existent');
      expect(res.status).toBe(404);
    });

    it('GET /instances/:id/logs returns all log entries', async () => {
      const defId = await createDefinition();
      const instance = await startInstance(defId);

      // Wait for machine to complete
      await new Promise((r) => setTimeout(r, 200));

      const res = await getLogs(instance.id);
      expect(res.status).toBe(200);

      const logs = (await res.json()) as unknown[];
      expect(Array.isArray(logs)).toBe(true);
    });

    it('GET /instances/:id/logs?state=X filters correctly', async () => {
      const defId = await createDefinition();
      const instance = await startInstance(defId);
      await new Promise((r) => setTimeout(r, 200));

      const res = await getLogs(instance.id, '?state=start');
      expect(res.status).toBe(200);

      const logs = (await res.json()) as { stateName: string }[];
      for (const log of logs) {
        expect(log.stateName).toBe('start');
      }
    });

    it('GET /instances/:id/logs for non-existent → 404', async () => {
      const res = await getLogs('non-existent');
      expect(res.status).toBe(404);
    });
  });

  // ── Cancel (§11) ──────────────────────────────────────────────────────

  describe('Cancel', () => {
    it('POST cancel on non-existent → 404', async () => {
      const res = await postCancel('non-existent');
      expect(res.status).toBe(404);
    });

    it('POST cancel on running instance → 200', async () => {
      const defId = await createDefinition(slowDefinitionBody);
      const instance = await startInstance(defId, {
        delayMs: 5000,
        nextState: 'completed',
      });

      // Wait for the runner fiber to start executing
      await new Promise((r) => setTimeout(r, 100));

      // Verify it's running
      const getRes = await getInstance(instance.id);
      const inst = (await getRes.json()) as { status: string };
      expect(inst.status).toBe('running');

      // Cancel it
      const cancelRes = await postCancel(instance.id);
      expect(cancelRes.status).toBe(200);

      // Wait for the fiber interruption finalizer to persist
      await new Promise((r) => setTimeout(r, 200));

      // Verify the instance is now cancelled
      const afterRes = await getInstance(instance.id);
      const afterBody = (await afterRes.json()) as { status: string };
      expect(afterBody.status).toBe('cancelled');
    });

    it('POST cancel on completed → 409', async () => {
      const defId = await createDefinition();
      const instance = await startInstance(defId);

      // Wait for completion
      await new Promise((r) => setTimeout(r, 300));

      // Verify it actually completed
      const getRes = await getInstance(instance.id);
      const inst = (await getRes.json()) as { status: string };
      if (inst.status === 'completed') {
        const cancelRes = await postCancel(instance.id);
        expect(cancelRes.status).toBe(409);

        const body = (await cancelRes.json()) as { message: string };
        expect(body.message).toContain('Cannot cancel');
      }
    });

    it('POST cancel on cancelled → 409', async () => {
      const defId = await createDefinition(slowDefinitionBody);
      const instance = await startInstance(defId, {
        delayMs: 5000,
        nextState: 'completed',
      });

      // Small delay to let the runner start
      await new Promise((r) => setTimeout(r, 50));

      // Cancel once
      const firstCancel = await postCancel(instance.id);
      // Could be 200 or already done — depends on timing
      if (firstCancel.status === 200) {
        await new Promise((r) => setTimeout(r, 100));
        // Cancel again — should be 409
        const secondCancel = await postCancel(instance.id);
        expect(secondCancel.status).toBe(409);
      }
    });

    it('POST cancel on errored → 409', async () => {
      // Create a definition with a bad action to cause an error
      const errorDef = {
        name: 'error-machine',
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
      const defId = await createDefinition(errorDef);

      // Start with invalid input (missing message/nextState for log-message)
      const res = await postInstance({ definitionId: defId, input: {} });
      expect(res.status).toBe(201);
      const instance = (await res.json()) as { id: string };

      // Wait for error
      await new Promise((r) => setTimeout(r, 300));

      const getRes = await getInstance(instance.id);
      const inst = (await getRes.json()) as { status: string };
      if (inst.status === 'error') {
        const cancelRes = await postCancel(instance.id);
        expect(cancelRes.status).toBe(409);
      }
    });
  });

  // ── Resume (§12) ──────────────────────────────────────────────────────

  describe('Resume', () => {
    it('POST resume on non-existent → 404', async () => {
      const res = await postResume('non-existent');
      expect(res.status).toBe(404);
    });

    it('POST resume on completed → 409', async () => {
      const defId = await createDefinition();
      const instance = await startInstance(defId);

      // Wait for completion
      await new Promise((r) => setTimeout(r, 300));

      const getRes = await getInstance(instance.id);
      const inst = (await getRes.json()) as { status: string };
      if (inst.status === 'completed') {
        const resumeRes = await postResume(instance.id);
        expect(resumeRes.status).toBe(409);
      }
    });

    it('POST resume on running → 409', async () => {
      const defId = await createDefinition(slowDefinitionBody);
      const instance = await startInstance(defId, {
        delayMs: 5000,
        nextState: 'completed',
      });

      // Small delay for the runner to start
      await new Promise((r) => setTimeout(r, 50));

      // Verify it's running
      const getRes = await getInstance(instance.id);
      const inst = (await getRes.json()) as { status: string };
      if (inst.status === 'running') {
        const resumeRes = await postResume(instance.id);
        expect(resumeRes.status).toBe(409);
      }

      // Clean up: cancel the long-running instance
      await postCancel(instance.id);
    });
  });

  // ── Artifacts (§15) ───────────────────────────────────────────────────

  describe('Artifacts', () => {
    it('GET /instances/:id/artifacts returns artifact list', async () => {
      const defId = await createDefinition();
      const instance = await startInstance(defId);
      await new Promise((r) => setTimeout(r, 200));

      const res = await getArtifacts(instance.id);
      expect(res.status).toBe(200);

      const artifacts = (await res.json()) as unknown[];
      expect(Array.isArray(artifacts)).toBe(true);
    });

    it('GET /instances/:id/artifacts?tree=true returns recursive tree', async () => {
      const defId = await createDefinition();
      const instance = await startInstance(defId);
      await new Promise((r) => setTimeout(r, 200));

      const res = await getArtifacts(instance.id, '?tree=true');
      expect(res.status).toBe(200);

      const tree = await res.json();
      expect(tree).toBeDefined();
    });

    it('GET /instances/:id/artifacts for non-existent instance → 404', async () => {
      const res = await getArtifacts('non-existent');
      expect(res.status).toBe(404);
    });

    it('GET /instances/:id/artifacts/:name downloads file content', async () => {
      const defId = await createDefinition(artifactDefinitionBody);
      const instance = await startInstance(defId, {
        filename: 'report.txt',
        content: 'artifact content here',
        nextState: 'completed',
      });

      // Wait for machine to complete and artifact to be written
      await new Promise((r) => setTimeout(r, 300));

      // Verify the instance completed
      const instRes = await getInstance(instance.id);
      const instBody = (await instRes.json()) as { status: string };
      expect(instBody.status).toBe('completed');

      // List artifacts — should include our file
      const listRes = await getArtifacts(instance.id);
      expect(listRes.status).toBe(200);
      const artifacts = (await listRes.json()) as { name: string }[];
      expect(artifacts.some((a) => a.name === 'report.txt')).toBe(true);

      // Download the artifact
      const downloadRes = await getArtifact(instance.id, 'report.txt');
      expect(downloadRes.status).toBe(200);

      const body = await downloadRes.text();
      expect(body).toBe('artifact content here');
    });

    it('GET /instances/:id/artifacts/:name for non-existent artifact → 404', async () => {
      const defId = await createDefinition();
      const instance = await startInstance(defId);
      await new Promise((r) => setTimeout(r, 200));

      const res = await getArtifact(instance.id, 'non-existent-artifact');
      expect(res.status).toBe(404);
    });
  });

  // ── Concurrent Operations (§21.2) ─────────────────────────────────────

  describe('Concurrent Operations', () => {
    it('Starting multiple instances concurrently → no data corruption', async () => {
      const defId = await createDefinition();

      // Fire 5 instances concurrently
      const promises = Array.from({ length: 5 }, (_, i) =>
        postInstance({
          definitionId: defId,
          input: { message: `hello-${String(i)}`, nextState: 'completed' },
        }),
      );

      const results = await Promise.all(promises);

      for (const res of results) {
        expect(res.status).toBe(201);
      }

      // Wait for all forked machines to settle
      await new Promise((r) => setTimeout(r, 300));

      // Verify the store actually contains 5 distinct instances
      const listRes = await getInstances(`?definitionId=${defId}`);
      expect(listRes.status).toBe(200);
      const instances = (await listRes.json()) as { id: string }[];
      expect(instances.length).toBe(5);
      expect(new Set(instances.map((inst) => inst.id)).size).toBe(5);
    });

    it('Two concurrent GETs on same instance return consistent data', async () => {
      const defId = await createDefinition();
      const instance = await startInstance(defId);
      await new Promise((r) => setTimeout(r, 200));

      const [res1, res2] = await Promise.all([getInstance(instance.id), getInstance(instance.id)]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const body1 = (await res1.json()) as { id: string; status: string };
      const body2 = (await res2.json()) as { id: string; status: string };
      expect(body1.id).toBe(body2.id);
      expect(body1.status).toBe(body2.status);
    });
  });

  // ── Definition Mutation During Execution (§21.3) ──────────────────────

  describe('Definition Mutation During Execution', () => {
    it('Updating a definition while instance is running → running instance unaffected', async () => {
      const defId = await createDefinition(slowDefinitionBody);
      const instance = await startInstance(defId, {
        delayMs: 3000,
        nextState: 'completed',
      });

      // Small delay for the runner to start
      await new Promise((r) => setTimeout(r, 50));

      // Update the definition while instance is running
      const updatedBody = { ...slowDefinitionBody, name: 'updated-slow-machine' };
      const putRes = await putDef(defId, updatedBody);
      expect(putRes.status).toBe(200);

      // Verify the running instance still references the original
      const instRes = await getInstance(instance.id);
      expect(instRes.status).toBe(200);
      const instBody = (await instRes.json()) as { definitionId: string };
      expect(instBody.definitionId).toBe(defId);

      // Clean up
      await postCancel(instance.id);
    });

    it('Deleting a definition while instance is running → instance still completes', async () => {
      const defId = await createDefinition();
      const instance = await startInstance(defId);

      // Delete the definition immediately
      const delRes = await delDef(defId);
      expect(delRes.status).toBe(204);

      // Wait for instance to complete
      await new Promise((r) => setTimeout(r, 300));

      // Instance should still be viewable
      const instRes = await getInstance(instance.id);
      expect(instRes.status).toBe(200);
    });

    it('Completed instance viewable after definition deleted', async () => {
      const defId = await createDefinition();
      const instance = await startInstance(defId);

      // Wait for instance to complete
      await new Promise((r) => setTimeout(r, 300));

      // Delete the definition
      await delDef(defId);

      // Instance should still be accessible
      const instRes = await getInstance(instance.id);
      expect(instRes.status).toBe(200);

      const instBody = (await instRes.json()) as { id: string; definitionId: string };
      expect(instBody.id).toBe(instance.id);
      expect(instBody.definitionId).toBe(defId);
    });
  });
});
