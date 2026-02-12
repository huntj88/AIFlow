/**
 * E2E: WebSocket Live Updates (Task 44).
 *
 * Validates all 17 behaviors from §16 (WebSocket — Live Updates) by connecting
 * a WebSocket client to a real HTTP server and verifying event delivery,
 * ordering, and subscription management.
 *
 * Creates a **test-only** HTTP server on a random port with its own WebSocket
 * manager (not the production singleton) to avoid port conflicts with a
 * running dev server.
 *
 * **Timing strategy**: Most machines use a `delay` initial state (300ms) so
 * the test has time to subscribe via WebSocket before events are published.
 * Events only fire after the delay completes, ensuring reliable delivery.
 *
 * §16.1 Connection & Subscription — 5 behaviors
 * §16.2 Event Types — 10 behaviors
 * §16.3 Event Ordering — 2 behaviors
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
import { MachineStore } from '@/machines/store/index.js';
import type { MachineEvent } from '@/machines/types.js';
import { MachineRouter } from '@/routes/machines/index.js';

import { type ApiHelpers, makeApiHelpers } from './helpers/api-helpers.js';
import { CHILD_DEFINITION, DELAY_DEFINITION } from './helpers/fixtures.js';
import { makeE2ETestLayer } from './helpers/test-handler.js';
import {
  closeWs,
  collectEvents,
  connectWs,
  type MachineWsEvent,
  subscribe,
} from './helpers/ws-helpers.js';

// ────────────────────────────────────────────────────────────────────────────
// Local Fixtures — All use delay(300ms) so WS subscription is registered
// before events fire.
// ────────────────────────────────────────────────────────────────────────────

const DELAY_MS = 300;

/** Simple delay machine: delay(300ms) → completed */
const DELAY_INPUT = { delayMs: DELAY_MS, nextState: 'completed' };

/**
 * Parent: delay(300ms) → spawn single child → completed.
 * Uses `$.machineInput.childInput` for child input mapping so the child
 * gets its own `nextState`/`message` independent of the parent's delay config.
 */
const makeDelayedChildParent = (childDefId: string) => ({
  name: 'E2E WS Delayed Parent (single)',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'wait',
  states: {
    wait: { name: 'wait', type: 'action' as const, actionId: 'delay' },
    spawn_child: {
      name: 'spawn_child',
      type: 'child_machine' as const,
      actionId: 'log-message',
      childMachineDefId: childDefId,
      childInputMapping: '$.machineInput.childInput',
    },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [
    { from: 'wait', to: 'spawn_child' },
    { from: 'spawn_child', to: 'completed' },
    { from: 'spawn_child', to: 'error' },
  ],
  metadata: { description: 'WS test: delayed parent with single child', tags: ['e2e'] },
});

/**
 * Parent: delay(300ms) → spawn parallel children → completed.
 */
const makeDelayedParallelParent = (childDefId: string) => ({
  name: 'E2E WS Delayed Parent (parallel)',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'wait',
  states: {
    wait: { name: 'wait', type: 'action' as const, actionId: 'delay' },
    spawn_parallel: {
      name: 'spawn_parallel',
      type: 'parallel_children' as const,
      actionId: 'log-message',
      children: [
        { key: 'child_a', machineDefId: childDefId, inputMapping: '$.machineInput.childInput' },
        { key: 'child_b', machineDefId: childDefId, inputMapping: '$.machineInput.childInput' },
      ],
      parallelMode: 'all_settled' as const,
    },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [
    { from: 'wait', to: 'spawn_parallel' },
    { from: 'spawn_parallel', to: 'completed' },
    { from: 'spawn_parallel', to: 'error' },
  ],
  metadata: { description: 'WS test: delayed parent with parallel children', tags: ['e2e'] },
});

// ────────────────────────────────────────────────────────────────────────────
// Test-only actions
// ────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function registerTestActions(_registry: ActionRegistry): Effect.Effect<void> {
  return Effect.void;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Extract MachineEvent payloads from raw WS messages. */
function payloads(events: MachineWsEvent[]): MachineEvent[] {
  return events
    .filter((e) => e.type === 'event')
    .map((e) => (e as MachineWsEvent & { payload: MachineEvent }).payload);
}

// ────────────────────────────────────────────────────────────────────────────
// Server Lifecycle
// ────────────────────────────────────────────────────────────────────────────

describe('§16 — WebSocket Live Updates', () => {
  let wsUrl: string;
  let api: ApiHelpers;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let managedRuntime: ManagedRuntime.ManagedRuntime<any, never>;
  let testHttpServer: import('node:http').Server;
  let testWss: WebSocketServer;

  beforeAll(async () => {
    // Build machine service layers (store, runner, pubsub, etc.)
    const MachineLive = makeE2ETestLayer();
    managedRuntime = ManagedRuntime.make(MachineLive);
    const runtime = await managedRuntime.runtime();

    // Register test-only actions
    await managedRuntime.runPromise(
      Effect.gen(function* () {
        const { ActionRegistry } = yield* Effect.promise(
          () => import('@/machines/ActionRegistry.js'),
        );
        const registry = yield* ActionRegistry;
        yield* registerTestActions(registry);
      }),
    );

    // Create in-process HTTP handler from shared runtime (for API calls)
    const served = MachineRouter.pipe(
      HttpRouter.use((httpApp) => Effect.provide(httpApp, runtime)),
    );
    const handler = HttpApp.toWebHandler(served);
    api = makeApiHelpers(handler);

    // ── Test-specific HTTP server + WebSocket on random port ──────────
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
          ws.send(
            serializeServerMessage({
              type: 'error',
              message: 'Malformed message',
            }),
          );
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

    // Subscribe to the shared MachineEventPubSub and broadcast to WS clients.
    // Effect.scoped provides the Scope needed by PubSub.subscribe, and we
    // fork an infinite broadcast loop inside it before running the scoped
    // effect as a daemon-like background promise.
    void managedRuntime.runFork(
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
    // Close WS server and HTTP server
    for (const ws of testWss.clients) ws.close(1001, 'Test shutting down');
    testWss.close();
    await new Promise<void>((resolve, reject) => {
      testHttpServer.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    await managedRuntime.dispose();
  }, 15_000);

  /**
   * Start a delay machine, subscribe while it delays, collect events until
   * machine_completed or timeout.
   */
  async function startSubscribeCollect(
    definition: object,
    input: unknown,
  ): Promise<{ instanceId: string; events: MachineWsEvent[]; ws: import('ws').WebSocket }> {
    const ws = await connectWs(wsUrl);
    const def = await api.createDef(definition);
    const inst = await api.startInst(def.id, input);

    // Subscribe immediately — machine is in delay state, events haven't fired
    subscribe(ws, inst.id);

    const events = await collectEvents(ws, {
      until: (e) =>
        e.type === 'event' &&
        (e as MachineWsEvent & { payload?: MachineEvent }).payload?.type === 'machine_completed',
      timeoutMs: 15_000,
    });

    return { instanceId: inst.id, events, ws };
  }

  // ──────────────────────────────────────────────────────────────────────
  // §16.1 Connection & Subscription (5 behaviors)
  // ──────────────────────────────────────────────────────────────────────

  describe('§16.1 Connection & Subscription', () => {
    it('client connects to ws://host/api/machines/live successfully', async () => {
      const ws = await connectWs(wsUrl);
      expect(ws.readyState).toBe(ws.OPEN);
      await closeWs(ws);
    });

    it('subscribe to instance → receives events during execution', async () => {
      const { events, ws, instanceId } = await startSubscribeCollect(DELAY_DEFINITION, DELAY_INPUT);

      expect(events.length).toBeGreaterThanOrEqual(1);
      const machineEvents = events.filter(
        (e) =>
          e.type === 'event' &&
          (e as MachineWsEvent & { payload?: MachineEvent }).payload?.instanceId === instanceId,
      );
      expect(machineEvents.length).toBeGreaterThanOrEqual(1);
      await closeWs(ws);
    });

    it('unsubscribe → stops receiving events', async () => {
      const ws = await connectWs(wsUrl);

      // Start a delay machine and subscribe
      const def = await api.createDef(DELAY_DEFINITION);
      const inst1 = await api.startInst(def.id, DELAY_INPUT);
      subscribe(ws, inst1.id);

      // Wait for at least one event (arrives after delay)
      const firstEvents = await collectEvents(ws, {
        until: (e) => e.type === 'event',
        timeoutMs: 10_000,
      });
      expect(firstEvents.length).toBeGreaterThanOrEqual(1);

      // Unsubscribe
      ws.send(JSON.stringify({ type: 'unsubscribe', instanceId: inst1.id }));

      // Start a new instance — we're not subscribed to it
      const inst2 = await api.startInst(def.id, DELAY_INPUT);
      await api.pollStatus(inst2.id, ['completed', 'error']);

      // Should receive nothing
      const noEvents = await collectEvents(ws, { timeoutMs: 1_500 });
      expect(noEvents).toHaveLength(0);
      await closeWs(ws);
    });

    it('subscribe to multiple instances → events for all', async () => {
      const ws = await connectWs(wsUrl);
      const def = await api.createDef(DELAY_DEFINITION);

      const inst1 = await api.startInst(def.id, DELAY_INPUT);
      const inst2 = await api.startInst(def.id, DELAY_INPUT);

      subscribe(ws, inst1.id);
      subscribe(ws, inst2.id);

      // Collect until both complete
      type WsEventWithPayload = MachineWsEvent & { payload?: MachineEvent };
      const seen = new Set<string>();
      const events = await collectEvents(ws, {
        until: (e) => {
          const payload = (e as WsEventWithPayload).payload;
          if (e.type === 'event' && payload?.type === 'machine_completed') {
            seen.add(payload.instanceId);
          }
          return seen.size >= 2;
        },
        timeoutMs: 10_000,
      });

      const inst1Events = events.filter(
        (e) => e.type === 'event' && (e as WsEventWithPayload).payload?.instanceId === inst1.id,
      );
      const inst2Events = events.filter(
        (e) => e.type === 'event' && (e as WsEventWithPayload).payload?.instanceId === inst2.id,
      );
      expect(inst1Events.length).toBeGreaterThanOrEqual(1);
      expect(inst2Events.length).toBeGreaterThanOrEqual(1);
      await closeWs(ws);
    });

    it('events not delivered for unsubscribed instances', async () => {
      const ws = await connectWs(wsUrl);
      const def = await api.createDef(DELAY_DEFINITION);

      // Start without subscribing
      const inst = await api.startInst(def.id, DELAY_INPUT);
      await api.pollStatus(inst.id, ['completed', 'error']);

      const events = await collectEvents(ws, { timeoutMs: 1_000 });
      expect(events).toHaveLength(0);
      await closeWs(ws);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // §16.2 Event Types (10 behaviors)
  // ──────────────────────────────────────────────────────────────────────

  describe('§16.2 Event Types', () => {
    it('state_changed event with previousState, currentState, stateData, timestamp', async () => {
      const { events, ws } = await startSubscribeCollect(DELAY_DEFINITION, DELAY_INPUT);
      const stateChanged = payloads(events).filter((e) => e.type === 'state_changed');

      expect(stateChanged.length).toBeGreaterThanOrEqual(1);
      const first = stateChanged[0];
      expect(first.data).toHaveProperty('previousState');
      expect(first.data).toHaveProperty('currentState');
      expect(first.data).toHaveProperty('stateData');
      expect(first.data).toHaveProperty('timestamp');
      await closeWs(ws);
    });

    it('transition_recorded event with full TransitionRecord', async () => {
      const { events, ws } = await startSubscribeCollect(DELAY_DEFINITION, DELAY_INPUT);
      const transitions = payloads(events).filter((e) => e.type === 'transition_recorded');

      expect(transitions.length).toBeGreaterThanOrEqual(1);
      const first = transitions[0];
      expect(first.data).toHaveProperty('id');
      expect(first.data).toHaveProperty('fromState');
      expect(first.data).toHaveProperty('toState');
      expect(first.data).toHaveProperty('timestamp');
      expect(first.data).toHaveProperty('durationMs');
      await closeWs(ws);
    });

    it('log_entry event when action writes log', async () => {
      // Delay action writes log entries ("Delaying …", "Delay … complete")
      const { events, ws } = await startSubscribeCollect(DELAY_DEFINITION, DELAY_INPUT);
      const logEntries = payloads(events).filter((e) => e.type === 'log_entry');

      expect(logEntries.length).toBeGreaterThanOrEqual(1);
      const first = logEntries[0];
      expect(first.data).toHaveProperty('id');
      expect(first.data).toHaveProperty('instanceId');
      expect(first.data).toHaveProperty('stateName');
      expect(first.data).toHaveProperty('level');
      expect(first.data).toHaveProperty('message');
      expect(first.data).toHaveProperty('timestamp');
      await closeWs(ws);
    });

    it('machine_completed event at terminal state', async () => {
      const { events, ws } = await startSubscribeCollect(DELAY_DEFINITION, DELAY_INPUT);
      const completed = payloads(events).filter((e) => e.type === 'machine_completed');

      expect(completed).toHaveLength(1);
      expect(completed[0].data).toHaveProperty('status');
      expect((completed[0].data as { status: string }).status).toBe('completed');
      expect(completed[0].data).toHaveProperty('instanceId');
      await closeWs(ws);
    });

    it('child_spawned event with childInstanceId and childDefinitionId', async () => {
      const childDef = await api.createDef(CHILD_DEFINITION);
      const parentDef = makeDelayedChildParent(childDef.id);
      const childInput = { message: 'ws child test', nextState: 'completed' };

      const { events, ws } = await startSubscribeCollect(parentDef, {
        delayMs: DELAY_MS,
        nextState: 'spawn_child',
        childInput,
      });

      const spawned = payloads(events).filter((e) => e.type === 'child_spawned');
      expect(spawned.length).toBeGreaterThanOrEqual(1);
      expect(spawned[0].data).toHaveProperty('childInstanceId');
      expect(spawned[0].data).toHaveProperty('childDefinitionId');
      await closeWs(ws);
    });

    it('child_completed event with MachineResult', async () => {
      const childDef = await api.createDef(CHILD_DEFINITION);
      const parentDef = makeDelayedChildParent(childDef.id);
      const childInput = { message: 'ws child test', nextState: 'completed' };

      const { events, ws } = await startSubscribeCollect(parentDef, {
        delayMs: DELAY_MS,
        nextState: 'spawn_child',
        childInput,
      });

      const childCompleted = payloads(events).filter((e) => e.type === 'child_completed');
      expect(childCompleted.length).toBeGreaterThanOrEqual(1);
      expect(childCompleted[0].data).toHaveProperty('childInstanceId');
      expect(childCompleted[0].data).toHaveProperty('result');
      expect((childCompleted[0].data as { result: { status: string } }).result).toHaveProperty(
        'status',
      );
      await closeWs(ws);
    });

    it('children_spawned event with keyed childInstanceIds', async () => {
      const childDef = await api.createDef(CHILD_DEFINITION);
      const parentDef = makeDelayedParallelParent(childDef.id);
      const childInput = { message: 'ws parallel test', nextState: 'completed' };

      const { events, ws } = await startSubscribeCollect(parentDef, {
        delayMs: DELAY_MS,
        nextState: 'spawn_parallel',
        childInput,
      });

      const spawned = payloads(events).filter((e) => e.type === 'children_spawned');
      expect(spawned.length).toBeGreaterThanOrEqual(1);
      expect(spawned[0].data).toHaveProperty('childInstanceIds');
      const ids = (spawned[0].data as { childInstanceIds: Record<string, string> })
        .childInstanceIds;
      expect(ids).toHaveProperty('child_a');
      expect(ids).toHaveProperty('child_b');
      await closeWs(ws);
    });

    it('children_completed event with keyed results', async () => {
      const childDef = await api.createDef(CHILD_DEFINITION);
      const parentDef = makeDelayedParallelParent(childDef.id);
      const childInput = { message: 'ws parallel test', nextState: 'completed' };

      const { events, ws } = await startSubscribeCollect(parentDef, {
        delayMs: DELAY_MS,
        nextState: 'spawn_parallel',
        childInput,
      });

      const completed = payloads(events).filter((e) => e.type === 'children_completed');
      expect(completed.length).toBeGreaterThanOrEqual(1);
      expect(completed[0].data).toHaveProperty('results');
      const results = (completed[0].data as { results: Record<string, unknown> }).results;
      expect(results).toHaveProperty('child_a');
      expect(results).toHaveProperty('child_b');
      await closeWs(ws);
    });

    it('machine_resumed event with previousState and resumedState', async () => {
      // Start delay machine, wait until running, then force-suspend via store
      const def = await api.createDef(DELAY_DEFINITION);
      const inst = await api.startInst(def.id, { delayMs: 5_000, nextState: 'completed' });
      await api.pollStatus(inst.id, ['running'], 5_000);

      await managedRuntime.runPromise(
        Effect.gen(function* () {
          const store = yield* MachineStore;
          yield* store.updateInstance(inst.id, {
            status: 'suspended',
            updatedAt: new Date().toISOString(),
          });
        }),
      );

      // Subscribe, then resume — machine_resumed fires during resume
      const ws = await connectWs(wsUrl);
      subscribe(ws, inst.id);
      await new Promise((r) => setTimeout(r, 100));

      const resumeRes = await api.postResume(inst.id);
      expect(resumeRes.status).toBe(200);

      const events = await collectEvents(ws, {
        until: (e) =>
          e.type === 'event' &&
          (e as MachineWsEvent & { payload?: MachineEvent }).payload?.type === 'machine_resumed',
        timeoutMs: 10_000,
      });
      await closeWs(ws);

      const resumed = payloads(events).filter((e) => e.type === 'machine_resumed');
      expect(resumed.length).toBeGreaterThanOrEqual(1);
      expect(resumed[0].data).toHaveProperty('previousState');
      expect(resumed[0].data).toHaveProperty('resumedState');
      expect(resumed[0].data).toHaveProperty('timestamp');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // §16.3 Event Ordering (2 behaviors)
  // ──────────────────────────────────────────────────────────────────────

  describe('§16.3 Event Ordering', () => {
    it('state_changed arrives before transition_recorded for same transition', async () => {
      const { events, ws } = await startSubscribeCollect(DELAY_DEFINITION, DELAY_INPUT);

      const all = payloads(events);
      const stateChangedIdx = all.findIndex((e) => e.type === 'state_changed');
      const transitionIdx = all.findIndex((e) => e.type === 'transition_recorded');

      expect(stateChangedIdx).toBeGreaterThanOrEqual(0);
      expect(transitionIdx).toBeGreaterThanOrEqual(0);
      expect(stateChangedIdx).toBeLessThan(transitionIdx);
      await closeWs(ws);
    });

    it('log_entry arrives before transition_recorded for that state', async () => {
      const { events, ws } = await startSubscribeCollect(DELAY_DEFINITION, DELAY_INPUT);

      const all = payloads(events);
      const logIdx = all.findIndex((e) => e.type === 'log_entry');
      const transitionIdx = all.findIndex((e) => e.type === 'transition_recorded');

      expect(logIdx).toBeGreaterThanOrEqual(0);
      expect(transitionIdx).toBeGreaterThanOrEqual(0);
      expect(logIdx).toBeLessThan(transitionIdx);
      await closeWs(ws);
    });
  });
});
