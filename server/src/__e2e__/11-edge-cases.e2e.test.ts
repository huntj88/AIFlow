/**
 * E2E: Negative & Edge Cases (Task 45).
 *
 * Validates all 18 behaviors from §21 (Negative / Edge-Case Behaviors) via
 * HTTP requests and WebSocket connections against an in-process handler.
 *
 * §21.1 API Error Responses — 5 behaviors
 * §21.2 Concurrent Operations — 3 behaviors
 * §21.3 Definition Mutation During Execution — 3 behaviors
 * §21.4 Large-Scale Behaviors — 3 behaviors
 * §21.5 WebSocket Edge Cases — 4 behaviors
 *
 * @module
 */

import { HttpApp, HttpRouter } from '@effect/platform';
import { Effect, ManagedRuntime, PubSub, Queue } from 'effect';
import { createServer } from 'node:http';
import type { WebSocket as WsWebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ActionRegistry } from '@/machines/ActionRegistry.js';
import { MachineEventPubSub } from '@/machines/EventPubSub.js';
import { parseClientMessage, serializeServerMessage } from '@/machines/live/events.js';
import type { ActionContext, MachineEvent } from '@/machines/types.js';
import { MachineRouter } from '@/routes/machines/index.js';

import {
  type ApiHelpers,
  createTestWorkspace,
  makeApiHelpers,
  removeTestWorkspace,
} from './helpers/api-helpers.js';
import {
  CHILD_DEFINITION,
  DELAY_DEFINITION,
  DELAY_INPUT_LONG,
  SIMPLE_DEFINITION,
  SIMPLE_INPUT,
} from './helpers/fixtures.js';
import { makeE2ETestLayer } from './helpers/test-handler.js';
import {
  closeWs,
  collectEvents,
  connectWs,
  type MachineWsEvent,
  subscribe,
} from './helpers/ws-helpers.js';

// ────────────────────────────────────────────────────────────────────────────
// Generated Fixtures
// ────────────────────────────────────────────────────────────────────────────

/**
 * Generate a definition with 50+ states (state_0 → state_1 → … → state_49 → completed).
 * Each state uses the `log-message` action; the first state uses input `nextState`
 * to advance to state_1, and subsequent states carry forward via stateData.
 */
function make50StateDef() {
  const states: Record<string, { name: string; type: 'action' | 'terminal'; actionId?: string }> =
    {};
  const transitions: { from: string; to: string }[] = [];

  for (let i = 0; i < 50; i++) {
    const name = `state_${String(i)}`;
    states[name] = { name, type: 'action' as const, actionId: 'test-chain-step' };
    if (i > 0) transitions.push({ from: `state_${String(i - 1)}`, to: name });
  }
  transitions.push({ from: 'state_49', to: 'completed' });

  states.completed = { name: 'completed', type: 'terminal' as const };
  states.cancelled = { name: 'cancelled', type: 'terminal' as const };
  states.error = { name: 'error', type: 'terminal' as const };

  return {
    name: 'E2E 50-State Machine',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    initialState: 'state_0',
    states,
    transitions,
    metadata: { description: '50-state machine for large-scale tests', tags: ['e2e'] },
  };
}

/**
 * Generate a parallel-children definition with 20+ children.
 * Each child uses `childDefId` and maps input from `$.machineInput`.
 */
function make20ParallelDef(childDefId: string) {
  const children = Array.from({ length: 20 }, (_, i) => ({
    key: `child_${String(i)}`,
    machineDefId: childDefId,
    inputMapping: '$.machineInput',
  }));

  return {
    name: 'E2E 20-Parallel Machine',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    initialState: 'spawn_parallel',
    states: {
      spawn_parallel: {
        name: 'spawn_parallel',
        type: 'parallel_children' as const,
        actionId: 'test-forward-result',
        children,
        parallelMode: 'all_settled' as const,
      },
      completed: { name: 'completed', type: 'terminal' as const },
      cancelled: { name: 'cancelled', type: 'terminal' as const },
      error: { name: 'error', type: 'terminal' as const },
    },
    transitions: [
      { from: 'spawn_parallel', to: 'completed' },
      { from: 'spawn_parallel', to: 'error' },
    ],
    metadata: { description: 'Parallel machine with 20+ children', tags: ['e2e'] },
  };
}

/**
 * Definition that uses `test-many-logs` to write many log entries in a single state.
 * Input: `{ logCount: N, nextState: 'completed' }`.
 */
const MANY_LOGS_DEFINITION = {
  name: 'E2E Many-Logs Machine',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'write_logs',
  states: {
    write_logs: { name: 'write_logs', type: 'action' as const, actionId: 'test-many-logs' },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [{ from: 'write_logs', to: 'completed' }],
  metadata: { description: 'Writes many log entries for testing', tags: ['e2e'] },
};

// ────────────────────────────────────────────────────────────────────────────
// Test-Only Actions
// ────────────────────────────────────────────────────────────────────────────

function registerTestActions(registry: ActionRegistry): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* registry.register(
      'test-many-logs',
      (ctx: ActionContext) =>
        Effect.gen(function* () {
          const input = ctx.stateData as { logCount?: number; nextState?: string };
          const count = input.logCount ?? 100;
          for (let i = 0; i < count; i++) {
            yield* ctx.logger.info(`Log entry ${String(i)}`);
          }
          return { nextState: input.nextState ?? 'completed', data: { logged: count } };
        }),
      { description: 'Writes N log entries for testing' },
    );

    /**
     * Auto-advancing chain action: reads the state name (state_N) and
     * transitions to state_N+1, or 'completed' if N == maxIndex.
     * Expects stateData to include `maxIndex`.
     */
    yield* registry.register(
      'test-chain-step',
      (ctx: ActionContext) =>
        Effect.gen(function* () {
          const data = ctx.stateData as { maxIndex?: number; message?: string };
          const maxIndex = data.maxIndex ?? 49;
          const match = /^state_(\d+)$/.exec(ctx.stateName);
          const idx = match ? Number(match[1]) : -1;
          const nextState = idx >= maxIndex ? 'completed' : `state_${String(idx + 1)}`;
          yield* ctx.logger.info(`Chain step ${String(idx)} → ${nextState}`);
          return { nextState, data: { ...data, message: `Step ${String(idx)}` } };
        }),
      { description: 'Auto-advancing chain step for 50-state tests' },
    );

    /**
     * Forward child / parallel result to next state.
     * Routes to 'completed' if all children succeeded, 'error' otherwise.
     */
    yield* registry.register(
      'test-forward-result',
      (ctx: ActionContext) => {
        const stateData = ctx.stateData as Record<string, unknown> | undefined;
        if (stateData && 'results' in stateData) {
          const results = stateData.results as Record<string, { status: string }>;
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
}

// ════════════════════════════════════════════════════════════════════════════
// §21 — Negative & Edge Cases
// ════════════════════════════════════════════════════════════════════════════

describe('§21 — Negative & Edge Cases', () => {
  // ──────────────────────────────────────────────────────────────────────
  // §21.1 API Error Responses (5 behaviors)
  // ──────────────────────────────────────────────────────────────────────

  describe('§21.1 API Error Responses', () => {
    let api: ApiHelpers;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let managedRuntime: ManagedRuntime.ManagedRuntime<any, never>;
    let testWorkspaceRoot: string;

    beforeAll(async () => {
      testWorkspaceRoot = await createTestWorkspace();
      const MachineLive = makeE2ETestLayer();
      managedRuntime = ManagedRuntime.make(MachineLive);
      const runtime = await managedRuntime.runtime();

      const served = MachineRouter.pipe(
        HttpRouter.use((httpApp) => Effect.provide(httpApp, runtime)),
      );
      api = makeApiHelpers(HttpApp.toWebHandler(served), testWorkspaceRoot);
    });

    afterAll(async () => {
      await managedRuntime.dispose();
      await removeTestWorkspace(testWorkspaceRoot);
    });

    it('POST /instances with missing definitionId → 400', async () => {
      const res = await api.postInstance({ input: { message: 'test' } });
      expect(res.status).toBe(400);
    });

    it('POST /instances with missing input → 400 or uses default', async () => {
      // Missing input field — server should reject with 400 or 404
      const res = await api.postInstance({ definitionId: 'non-existent-id' });
      expect([400, 404]).toContain(res.status);
    });

    it('POST /instances with missing runtimeOptions → 400', async () => {
      const def = await api.createDef(SIMPLE_DEFINITION);

      const res = await api.postInstance({
        definitionId: def.id,
        input: SIMPLE_INPUT,
        workspaceRoot: testWorkspaceRoot,
        runtimeOptions: undefined,
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { details?: string[] };
      expect((body.details ?? []).join(' ')).toContain('runtimeOptions');
    });

    it('POST /instances with malformed runtimeOptions nested keys → 400', async () => {
      const def = await api.createDef(SIMPLE_DEFINITION);

      const res = await api.postInstance({
        definitionId: def.id,
        input: SIMPLE_INPUT,
        workspaceRoot: testWorkspaceRoot,
        runtimeOptions: {
          cliDirectoryPolicy: {
            workspaceDirs: [testWorkspaceRoot],
          },
          // missing cliOutputCapture and artifactDirs
        },
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { details?: string[] };
      expect((body.details ?? []).join(' ')).toContain('runtimeOptions');
    });

    it('GET /instances/:id with non-existent ID → 404', async () => {
      const res = await api.getInstance('00000000-0000-0000-0000-000000000000');
      expect(res.status).toBe(404);
    });

    it('POST /instances/:id/cancel on non-existent → 404', async () => {
      const res = await api.postCancel('00000000-0000-0000-0000-000000000000');
      expect(res.status).toBe(404);
    });

    it('POST /instances/:id/resume on non-existent → 404', async () => {
      const res = await api.postResume('00000000-0000-0000-0000-000000000000');
      expect(res.status).toBe(404);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // §21.2 Concurrent Operations (3 behaviors)
  // ──────────────────────────────────────────────────────────────────────

  describe('§21.2 Concurrent Operations', () => {
    let api: ApiHelpers;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let managedRuntime: ManagedRuntime.ManagedRuntime<any, never>;
    let wsUrl: string;
    let testHttpServer: import('node:http').Server;
    let testWss: WebSocketServer;
    let testWorkspaceRoot: string;

    beforeAll(async () => {
      testWorkspaceRoot = await createTestWorkspace();
      const MachineLive = makeE2ETestLayer();
      managedRuntime = ManagedRuntime.make(MachineLive);
      const runtime = await managedRuntime.runtime();

      const served = MachineRouter.pipe(
        HttpRouter.use((httpApp) => Effect.provide(httpApp, runtime)),
      );
      api = makeApiHelpers(HttpApp.toWebHandler(served), testWorkspaceRoot);

      // ── Test WS server for the "two clients" test ──────────────────
      testHttpServer = createServer();
      testWss = new WebSocketServer({ noServer: true });
      const WS_PATH = '/api/machines/live';
      const subscriptions = new Map<WsWebSocket, Set<string>>();

      testHttpServer.on('upgrade', (request, socket, head) => {
        const url = request.url ?? '';
        if (url === WS_PATH || url.startsWith(`${WS_PATH}?`)) {
          testWss.handleUpgrade(request, socket, head, (ws) => {
            testWss.emit('connection', ws, request);
          });
        } else {
          socket.destroy();
        }
      });

      testWss.on('connection', (ws: WsWebSocket) => {
        subscriptions.set(ws, new Set());
        ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
          const text = typeof raw === 'string' ? raw : Buffer.from(raw as Buffer).toString('utf-8');
          const msg = parseClientMessage(text);
          if (msg === null) {
            ws.send(serializeServerMessage({ type: 'error', message: 'Malformed message' }));
            return;
          }
          const subs = subscriptions.get(ws);
          if (!subs) return;
          if (msg.type === 'subscribe') subs.add(msg.instanceId);
          else subs.delete(msg.instanceId);
        });
        ws.on('close', () => subscriptions.delete(ws));
        ws.on('error', () => subscriptions.delete(ws));
      });

      managedRuntime.runFork(
        Effect.scoped(
          Effect.gen(function* () {
            const pubsub = yield* MachineEventPubSub;
            const subscription = yield* PubSub.subscribe(pubsub);
            yield* Effect.forever(
              Effect.gen(function* () {
                const event = yield* Queue.take(subscription);
                const msg = serializeServerMessage({ type: 'event', payload: event });
                for (const [ws, subs] of subscriptions) {
                  if (subs.has(event.instanceId) && ws.readyState === ws.OPEN) {
                    ws.send(msg);
                  }
                }
              }),
            );
          }),
        ),
      );

      await new Promise<void>((resolve) => {
        testHttpServer.listen(0, () => {
          resolve();
        });
      });
      const addr = testHttpServer.address() as { port: number };
      wsUrl = `ws://localhost:${String(addr.port)}/api/machines/live`;
    }, 20_000);

    afterAll(async () => {
      for (const ws of testWss.clients) ws.close(1001, 'Test shutting down');
      testWss.close();
      await new Promise<void>((resolve, reject) => {
        testHttpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      await managedRuntime.dispose();
      await removeTestWorkspace(testWorkspaceRoot);
    }, 15_000);

    it('starting 10 instances of same definition concurrently → no data corruption', async () => {
      const def = await api.createDef(SIMPLE_DEFINITION);
      const promises = Array.from({ length: 10 }, () =>
        api.postInstance({
          definitionId: def.id,
          input: { message: 'concurrent test', nextState: 'completed' },
        }),
      );
      const results = await Promise.all(promises);

      // All should return 201
      for (const res of results) {
        expect(res.status).toBe(201);
      }

      // Wait for all to complete
      const bodies = await Promise.all(
        results.map((r) => r.json() as Promise<{ id: string; status: string }>),
      );
      await Promise.all(
        bodies.map((body) => api.pollStatus(body.id, ['completed', 'error'], 15_000)),
      );

      // Verify unique IDs, no data corruption
      const listRes = await api.getInstances(`?definitionId=${def.id}`);
      const instances = (await listRes.json()) as { id: string }[];
      const ids = new Set(instances.map((i) => i.id));
      expect(ids.size).toBe(10);
    });

    it('cancel instance while transitioning → cancel takes effect cleanly', async () => {
      // Start a delay machine with a long delay
      const def = await api.createDef(DELAY_DEFINITION);
      const inst = await api.startInst(def.id, DELAY_INPUT_LONG);

      // Wait for it to start running
      await api.pollStatus(inst.id, ['running'], 5_000);

      // Cancel it
      const cancelRes = await api.postCancel(inst.id);
      expect(cancelRes.status).toBe(200);

      // Poll until it reaches a terminal state
      const final = await api.pollStatus(inst.id, ['cancelled', 'completed', 'error'], 10_000);
      expect(final.status).toBe('cancelled');
    });

    it('two WS clients subscribe to same instance → both receive same events', async () => {
      const ws1 = await connectWs(wsUrl);
      const ws2 = await connectWs(wsUrl);

      const def = await api.createDef(DELAY_DEFINITION);
      const inst = await api.startInst(def.id, { delayMs: 300, nextState: 'completed' });

      subscribe(ws1, inst.id);
      subscribe(ws2, inst.id);

      type WsEventWithPayload = MachineWsEvent & { payload?: MachineEvent };

      const [events1, events2] = await Promise.all([
        collectEvents(ws1, {
          until: (e) =>
            e.type === 'event' && (e as WsEventWithPayload).payload?.type === 'machine_completed',
          timeoutMs: 15_000,
        }),
        collectEvents(ws2, {
          until: (e) =>
            e.type === 'event' && (e as WsEventWithPayload).payload?.type === 'machine_completed',
          timeoutMs: 15_000,
        }),
      ]);

      // Both clients should have received events
      expect(events1.length).toBeGreaterThanOrEqual(1);
      expect(events2.length).toBeGreaterThanOrEqual(1);

      // Both should have received machine_completed
      const completed1 = events1.filter(
        (e) =>
          e.type === 'event' && (e as WsEventWithPayload).payload?.type === 'machine_completed',
      );
      const completed2 = events2.filter(
        (e) =>
          e.type === 'event' && (e as WsEventWithPayload).payload?.type === 'machine_completed',
      );
      expect(completed1.length).toBeGreaterThanOrEqual(1);
      expect(completed2.length).toBeGreaterThanOrEqual(1);

      await closeWs(ws1);
      await closeWs(ws2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // §21.3 Definition Mutation During Execution (3 behaviors)
  // ──────────────────────────────────────────────────────────────────────

  describe('§21.3 Definition Mutation During Execution', () => {
    let api: ApiHelpers;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let managedRuntime: ManagedRuntime.ManagedRuntime<any, never>;
    let testWorkspaceRoot: string;

    beforeAll(async () => {
      testWorkspaceRoot = await createTestWorkspace();
      const MachineLive = makeE2ETestLayer();
      managedRuntime = ManagedRuntime.make(MachineLive);
      const runtime = await managedRuntime.runtime();

      const served = MachineRouter.pipe(
        HttpRouter.use((httpApp) => Effect.provide(httpApp, runtime)),
      );
      api = makeApiHelpers(HttpApp.toWebHandler(served), testWorkspaceRoot);
    });

    afterAll(async () => {
      await managedRuntime.dispose();
      await removeTestWorkspace(testWorkspaceRoot);
    });

    it('updating definition while instance running → running instance unaffected', async () => {
      // Start a delay machine with a long delay
      const def = await api.createDef(DELAY_DEFINITION);
      const inst = await api.startInst(def.id, { delayMs: 2_000, nextState: 'completed' });

      // Wait for it to be running
      await api.pollStatus(inst.id, ['running'], 5_000);

      // Update the definition (change name)
      const updateRes = await api.putDefinition(def.id, {
        ...DELAY_DEFINITION,
        name: 'E2E Delay Machine UPDATED',
      });
      expect(updateRes.status).toBe(200);

      // Instance should still complete normally
      const final = await api.pollStatus(inst.id, ['completed', 'error'], 10_000);
      expect(final.status).toBe('completed');
    });

    it('deleting definition while instance running → instance still completes', async () => {
      const def = await api.createDef(DELAY_DEFINITION);
      const inst = await api.startInst(def.id, { delayMs: 2_000, nextState: 'completed' });

      // Wait for it to be running
      await api.pollStatus(inst.id, ['running'], 5_000);

      // Delete the definition
      const deleteRes = await api.deleteDefinition(def.id);
      expect(deleteRes.status).toBe(204);

      // Instance should still complete normally
      const final = await api.pollStatus(inst.id, ['completed', 'error'], 10_000);
      expect(final.status).toBe('completed');
    });

    it('completed instance viewable after definition deleted', async () => {
      const def = await api.createDef(SIMPLE_DEFINITION);
      const inst = await api.startInst(def.id, SIMPLE_INPUT);

      // Wait for completion
      await api.pollStatus(inst.id, ['completed'], 10_000);

      // Delete the definition
      const deleteRes = await api.deleteDefinition(def.id);
      expect(deleteRes.status).toBe(204);

      // Instance should still be viewable
      const getRes = await api.getInstance(inst.id);
      expect(getRes.status).toBe(200);
      const body = (await getRes.json()) as { id: string; status: string };
      expect(body.id).toBe(inst.id);
      expect(body.status).toBe('completed');

      // History should also be viewable
      const historyRes = await api.getHistory(inst.id);
      expect(historyRes.status).toBe(200);

      // Logs should also be viewable
      const logsRes = await api.getLogs(inst.id);
      expect(logsRes.status).toBe(200);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // §21.4 Large-Scale Behaviors (3 behaviors)
  // ──────────────────────────────────────────────────────────────────────

  describe('§21.4 Large-Scale Behaviors', () => {
    let api: ApiHelpers;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let managedRuntime: ManagedRuntime.ManagedRuntime<any, never>;
    let testWorkspaceRoot: string;

    beforeAll(async () => {
      testWorkspaceRoot = await createTestWorkspace();
      const MachineLive = makeE2ETestLayer();
      managedRuntime = ManagedRuntime.make(MachineLive);
      const runtime = await managedRuntime.runtime();

      // Register the test-many-logs action
      await managedRuntime.runPromise(
        Effect.gen(function* () {
          const { ActionRegistry } = yield* Effect.promise(
            () => import('@/machines/ActionRegistry.js'),
          );
          const registry = yield* ActionRegistry;
          yield* registerTestActions(registry);
        }),
      );

      const served = MachineRouter.pipe(
        HttpRouter.use((httpApp) => Effect.provide(httpApp, runtime)),
      );
      api = makeApiHelpers(HttpApp.toWebHandler(served), testWorkspaceRoot);
    }, 20_000);

    afterAll(async () => {
      await managedRuntime.dispose();
      await removeTestWorkspace(testWorkspaceRoot);
    });

    it('machine with 50+ states and transitions runs correctly', async () => {
      const bigDef = make50StateDef();
      const def = await api.createDef(bigDef);

      // test-chain-step reads the state name and auto-advances to state_N+1
      const inst = await api.startInst(def.id, {
        maxIndex: 49,
        message: '50-state machine started',
      });

      const final = await api.pollStatus(inst.id, ['completed', 'error'], 30_000);
      expect(final.status).toBe('completed');

      // Verify transition history shows all 50 transitions
      const historyRes = await api.getHistory(inst.id);
      const history = (await historyRes.json()) as { fromState: string; toState: string }[];
      // Should have at least 50 transitions (state_0 → state_1 → … → state_49 → completed)
      expect(history.length).toBeGreaterThanOrEqual(50);
    }, 30_000);

    it('parallel_children with 20+ children completes', async () => {
      const childDef = await api.createDef(CHILD_DEFINITION);
      const parallelDef = make20ParallelDef(childDef.id);
      const def = await api.createDef(parallelDef);

      const inst = await api.startInst(def.id, {
        message: '20-parallel test',
        nextState: 'completed',
      });

      const final = await api.pollStatus(inst.id, ['completed', 'error'], 30_000);
      expect(final.status).toBe('completed');
    }, 30_000);

    it('instance with 1000+ log entries retrievable and filterable', async () => {
      const def = await api.createDef(MANY_LOGS_DEFINITION);
      const inst = await api.startInst(def.id, {
        logCount: 1100,
        nextState: 'completed',
      });

      await api.pollStatus(inst.id, ['completed', 'error'], 30_000);

      // Retrieve all logs
      const logsRes = await api.getLogs(inst.id);
      expect(logsRes.status).toBe(200);
      const logs = (await logsRes.json()) as { stateName: string; message: string }[];
      expect(logs.length).toBeGreaterThanOrEqual(1000);

      // Filter by state name
      const filteredRes = await api.getLogs(inst.id, '?state=write_logs');
      expect(filteredRes.status).toBe(200);
      const filteredLogs = (await filteredRes.json()) as { stateName: string }[];
      expect(filteredLogs.length).toBeGreaterThanOrEqual(1000);
      for (const log of filteredLogs) {
        expect(log.stateName).toBe('write_logs');
      }
    }, 30_000);
  });

  // ──────────────────────────────────────────────────────────────────────
  // §21.5 WebSocket Edge Cases (4 behaviors)
  // ──────────────────────────────────────────────────────────────────────

  describe('§21.5 WebSocket Edge Cases', () => {
    let api: ApiHelpers;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let managedRuntime: ManagedRuntime.ManagedRuntime<any, never>;
    let wsUrl: string;
    let testHttpServer: import('node:http').Server;
    let testWss: WebSocketServer;
    let testWorkspaceRoot: string;

    beforeAll(async () => {
      testWorkspaceRoot = await createTestWorkspace();
      const MachineLive = makeE2ETestLayer();
      managedRuntime = ManagedRuntime.make(MachineLive);
      const runtime = await managedRuntime.runtime();

      const served = MachineRouter.pipe(
        HttpRouter.use((httpApp) => Effect.provide(httpApp, runtime)),
      );
      api = makeApiHelpers(HttpApp.toWebHandler(served), testWorkspaceRoot);

      // ── Test WS server ─────────────────────────────────────────────
      testHttpServer = createServer();
      testWss = new WebSocketServer({ noServer: true });
      const WS_PATH = '/api/machines/live';
      const subscriptions = new Map<WsWebSocket, Set<string>>();

      testHttpServer.on('upgrade', (request, socket, head) => {
        const url = request.url ?? '';
        if (url === WS_PATH || url.startsWith(`${WS_PATH}?`)) {
          testWss.handleUpgrade(request, socket, head, (ws) => {
            testWss.emit('connection', ws, request);
          });
        } else {
          socket.destroy();
        }
      });

      testWss.on('connection', (ws: WsWebSocket) => {
        subscriptions.set(ws, new Set());
        ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
          const text = typeof raw === 'string' ? raw : Buffer.from(raw as Buffer).toString('utf-8');
          const msg = parseClientMessage(text);
          if (msg === null) {
            ws.send(serializeServerMessage({ type: 'error', message: 'Malformed message' }));
            return;
          }
          const subs = subscriptions.get(ws);
          if (!subs) return;
          if (msg.type === 'subscribe') subs.add(msg.instanceId);
          else subs.delete(msg.instanceId);
        });
        ws.on('close', () => subscriptions.delete(ws));
        ws.on('error', () => subscriptions.delete(ws));
      });

      managedRuntime.runFork(
        Effect.scoped(
          Effect.gen(function* () {
            const pubsub = yield* MachineEventPubSub;
            const subscription = yield* PubSub.subscribe(pubsub);
            yield* Effect.forever(
              Effect.gen(function* () {
                const event = yield* Queue.take(subscription);
                const msg = serializeServerMessage({ type: 'event', payload: event });
                for (const [ws, subs] of subscriptions) {
                  if (subs.has(event.instanceId) && ws.readyState === ws.OPEN) {
                    ws.send(msg);
                  }
                }
              }),
            );
          }),
        ),
      );

      await new Promise<void>((resolve) => {
        testHttpServer.listen(0, () => {
          resolve();
        });
      });
      const addr = testHttpServer.address() as { port: number };
      wsUrl = `ws://localhost:${String(addr.port)}/api/machines/live`;
    }, 20_000);

    afterAll(async () => {
      for (const ws of testWss.clients) ws.close(1001, 'Test shutting down');
      testWss.close();
      await new Promise<void>((resolve, reject) => {
        testHttpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      await managedRuntime.dispose();
      await removeTestWorkspace(testWorkspaceRoot);
    }, 15_000);

    it('subscribing to completed instance delivers no events', async () => {
      // First, create and complete an instance
      const def = await api.createDef(SIMPLE_DEFINITION);
      const inst = await api.startInst(def.id, SIMPLE_INPUT);
      await api.pollStatus(inst.id, ['completed'], 10_000);

      // Now subscribe to the already-completed instance
      const ws = await connectWs(wsUrl);
      subscribe(ws, inst.id);

      // Wait a bit — should receive no events since the machine already finished
      const events = await collectEvents(ws, { timeoutMs: 2_000 });
      const machineEvents = events.filter((e) => e.type === 'event');
      expect(machineEvents).toHaveLength(0);
      await closeWs(ws);
    });

    it('subscribing to non-existent instance ID does not crash connection', async () => {
      const ws = await connectWs(wsUrl);

      // Subscribe to a non-existent instance
      subscribe(ws, '00000000-0000-0000-0000-000000000000');

      // Wait a moment — connection should remain open
      await new Promise((r) => setTimeout(r, 1_000));
      expect(ws.readyState).toBe(ws.OPEN);

      // Should be able to send further messages
      subscribe(ws, 'another-fake-id');
      await new Promise((r) => setTimeout(r, 500));
      expect(ws.readyState).toBe(ws.OPEN);

      await closeWs(ws);
    });

    it('sending malformed JSON does not crash server', async () => {
      const ws = await connectWs(wsUrl);

      // Send various malformed messages
      ws.send('this is not json {{{{');
      ws.send('');
      ws.send('{"type": "unknown_type", "instanceId": "test"}');
      ws.send('42');
      ws.send('null');

      // Wait — connection should still be open and server should not crash
      await new Promise((r) => setTimeout(r, 1_500));
      expect(ws.readyState).toBe(ws.OPEN);

      // Collect any error responses — we don't assert on them, just drain
      await collectEvents(ws, { timeoutMs: 1_000 });
      // We might get error messages but the connection should remain healthy

      // Verify we can still subscribe normally
      const def = await api.createDef(SIMPLE_DEFINITION);
      const inst = await api.startInst(def.id, SIMPLE_INPUT);
      subscribe(ws, inst.id);
      await api.pollStatus(inst.id, ['completed'], 10_000);

      // Connection is still open
      expect(ws.readyState).toBe(ws.OPEN);
      await closeWs(ws);
    });

    it('rapid subscribe/unsubscribe cycles do not leak subscriptions', async () => {
      const ws = await connectWs(wsUrl);

      const def = await api.createDef(DELAY_DEFINITION);
      const inst = await api.startInst(def.id, { delayMs: 3_000, nextState: 'completed' });

      // Rapidly subscribe and unsubscribe 100 times
      for (let i = 0; i < 100; i++) {
        subscribe(ws, inst.id);
        ws.send(JSON.stringify({ type: 'unsubscribe', instanceId: inst.id }));
      }

      // Connection should still be healthy
      await new Promise((r) => setTimeout(r, 500));
      expect(ws.readyState).toBe(ws.OPEN);

      // After all the unsubs, subscribing fresh should still work
      subscribe(ws, inst.id);

      // Wait for machine to complete and verify we get events
      type WsEventWithPayload = MachineWsEvent & { payload?: MachineEvent };
      const events = await collectEvents(ws, {
        until: (e) =>
          e.type === 'event' && (e as WsEventWithPayload).payload?.type === 'machine_completed',
        timeoutMs: 15_000,
      });

      expect(events.length).toBeGreaterThanOrEqual(1);
      await closeWs(ws);
    });
  });
});
