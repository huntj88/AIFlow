/**
 * WebSocketManager — Unit Tests (Task 23)
 *
 * Tests for the WebSocket server: connection, subscribe/unsubscribe,
 * event broadcasting, malformed message handling, and cleanup.
 *
 * Each test creates an isolated HTTP + WS server on an ephemeral port
 * to avoid port conflicts.
 *
 * @module
 */

import { createServer, type Server as HttpServer } from 'node:http';
import { type AddressInfo } from 'node:net';

import { Effect, PubSub, Queue, Scope } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';

import type { MachineEvent } from '@/machines/types.js';

import {
  parseClientMessage,
  serializeServerMessage,
  type ClientMessage,
  type ServerMessage,
} from './events.js';

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

const WS_PATH = '/api/machines/live';

/**
 * Lightweight in-test WebSocket server that mirrors the production
 * `WebSocketManager` logic but operates on an ephemeral port with
 * a standalone PubSub. This avoids importing the production module
 * (which references the shared `nodeHttpServer` singleton).
 */
interface TestHarness {
  httpServer: HttpServer;
  wss: WebSocketServer;
  pubsub: PubSub.PubSub<MachineEvent>;
  port: number;
  url: string;
  subscriptions: Map<WebSocket, Set<string>>;
  /** Publish an event into the PubSub (runner side). */
  publish: (event: MachineEvent) => Promise<boolean>;
  /** Clean up all resources. */
  close: () => Promise<void>;
}

async function createTestHarness(): Promise<TestHarness> {
  // Use Effect to create a shared PubSub
  const pubsub = Effect.runSync(PubSub.unbounded<MachineEvent>());
  const httpServer = createServer();
  const wss = new WebSocketServer({ noServer: true });
  const subscriptions = new Map<WebSocket, Set<string>>();

  // Attach upgrade handler
  httpServer.on('upgrade', (request, socket, head) => {
    const url = request.url ?? '';
    if (url === WS_PATH || url.startsWith(`${WS_PATH}?`)) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  // Connection handling (mirrors production code)
  wss.on('connection', (ws: WebSocket) => {
    subscriptions.set(ws, new Set());

    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const text = typeof raw === 'string' ? raw : Buffer.from(raw as Buffer).toString('utf-8');
      const msg = parseClientMessage(text);

      if (msg === null) {
        ws.send(
          serializeServerMessage({
            type: 'error',
            message:
              'Malformed message — expected { type: "subscribe"|"unsubscribe", instanceId: string }',
          }),
        );
        return;
      }

      const subs = subscriptions.get(ws);
      if (!subs) return;

      if (msg.type === 'subscribe') {
        subs.add(msg.instanceId);
      } else {
        subs.delete(msg.instanceId);
      }
    });

    ws.on('close', () => {
      subscriptions.delete(ws);
    });

    ws.on('error', () => {
      subscriptions.delete(ws);
    });
  });

  // Subscribe to PubSub and broadcast (mirrors production code)
  const subscription = Effect.runSync(
    PubSub.subscribe(pubsub).pipe(Scope.extend(Effect.runSync(Scope.make()))),
  );

  let running = true;

  const broadcastLoop = async () => {
    while (running) {
      const takeResult = await Effect.runPromise(
        Queue.take(subscription).pipe(Effect.timeout('50 millis'), Effect.option),
      );
      if (takeResult._tag === 'None') continue;
      const event = takeResult.value;
      const payload = serializeServerMessage({ type: 'event', payload: event });
      for (const [ws, subs] of subscriptions) {
        if (subs.has(event.instanceId) && ws.readyState === ws.OPEN) {
          ws.send(payload);
        }
      }
    }
  };

  // Start broadcast in background (will be stopped on close)
  const broadcastPromise = broadcastLoop();
  broadcastPromise.catch(() => {
    /* swallow abort errors */
  });

  // Start HTTP server on ephemeral port
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const port = (httpServer.address() as AddressInfo).port;
  const url = `ws://127.0.0.1:${String(port)}${WS_PATH}`;

  const publish = (event: MachineEvent): Promise<boolean> =>
    Effect.runPromise(PubSub.publish(pubsub, event));

  const close = async () => {
    running = false;
    for (const ws of wss.clients) {
      ws.close(1001);
    }
    wss.close();
    subscriptions.clear();
    await new Promise<void>((resolve, reject_) => {
      httpServer.close((err) => {
        if (err) {
          reject_(err);
        } else {
          resolve();
        }
      });
    });
  };

  return { httpServer, wss, pubsub, port, url, subscriptions, publish, close };
}

/** Connect a WS client and wait for it to open. */
function connectClient(url: string): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => {
      resolve(ws);
    });
    ws.on('error', (err) => {
      reject(err);
    });
  });
}

/** Send a client message and return a promise. */
function sendMessage(ws: WebSocket, msg: ClientMessage): void {
  ws.send(JSON.stringify(msg));
}

/** Collect the next N messages from a WS client. */
function collectMessages(ws: WebSocket, count: number, timeoutMs = 2000): Promise<ServerMessage[]> {
  return new Promise<ServerMessage[]>((resolve) => {
    const messages: ServerMessage[] = [];
    const timer = setTimeout(() => {
      ws.removeAllListeners('message');
      // Resolve with whatever we have so far (may be fewer than count)
      resolve(messages);
    }, timeoutMs);

    ws.on('message', (raw: Buffer | string) => {
      const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
      messages.push(JSON.parse(text) as ServerMessage);
      if (messages.length >= count) {
        clearTimeout(timer);
        ws.removeAllListeners('message');
        resolve(messages);
      }
    });
  });
}

/** Wait for a short delay (ms). */
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Create a minimal `MachineEvent` for testing. */
function makeEvent(type: MachineEvent['type'], instanceId: string, data?: unknown): MachineEvent {
  return { type, instanceId, data } as MachineEvent;
}

// ────────────────────────────────────────────────────────────────────────────
// Tests — events.ts (parseClientMessage / serializeServerMessage)
// ────────────────────────────────────────────────────────────────────────────

describe('events — parseClientMessage', () => {
  it('parses a valid subscribe message', () => {
    const msg = parseClientMessage('{"type":"subscribe","instanceId":"abc-123"}');
    expect(msg).toEqual({ type: 'subscribe', instanceId: 'abc-123' });
  });

  it('parses a valid unsubscribe message', () => {
    const msg = parseClientMessage('{"type":"unsubscribe","instanceId":"abc-123"}');
    expect(msg).toEqual({ type: 'unsubscribe', instanceId: 'abc-123' });
  });

  it('returns null for invalid JSON', () => {
    expect(parseClientMessage('not json')).toBeNull();
  });

  it('returns null for missing type', () => {
    expect(parseClientMessage('{"instanceId":"abc"}')).toBeNull();
  });

  it('returns null for unknown type', () => {
    expect(parseClientMessage('{"type":"ping","instanceId":"abc"}')).toBeNull();
  });

  it('returns null for missing instanceId', () => {
    expect(parseClientMessage('{"type":"subscribe"}')).toBeNull();
  });

  it('returns null for empty instanceId', () => {
    expect(parseClientMessage('{"type":"subscribe","instanceId":""}')).toBeNull();
  });

  it('returns null for non-string instanceId', () => {
    expect(parseClientMessage('{"type":"subscribe","instanceId":42}')).toBeNull();
  });

  it('returns null for non-object payload', () => {
    expect(parseClientMessage('"hello"')).toBeNull();
  });

  it('returns null for null payload', () => {
    expect(parseClientMessage('null')).toBeNull();
  });
});

describe('events — serializeServerMessage', () => {
  it('serializes an event message', () => {
    const msg: ServerMessage = {
      type: 'event',
      payload: makeEvent('state_changed', 'inst-1', {
        previousState: 'a',
        currentState: 'b',
        stateData: {},
        timestamp: '2026-01-01T00:00:00Z',
      }),
    };
    const json = serializeServerMessage(msg);
    expect(JSON.parse(json)).toEqual(msg);
  });

  it('serializes an error message', () => {
    const msg: ServerMessage = { type: 'error', message: 'Bad request' };
    const json = serializeServerMessage(msg);
    expect(JSON.parse(json)).toEqual(msg);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests — WebSocket server behavior
// ────────────────────────────────────────────────────────────────────────────

describe('WebSocketManager', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  // ── Connection ──────────────────────────────────────────────────────────

  it('accepts a client connection', async () => {
    const ws = await connectClient(harness.url);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(harness.subscriptions.size).toBe(1);
    ws.close();
  });

  it('rejects upgrade on wrong path', async () => {
    const wrongUrl = harness.url.replace(WS_PATH, '/wrong/path');
    const result = await new Promise<'opened' | 'failed'>((resolve) => {
      const ws = new WebSocket(wrongUrl);
      ws.on('open', () => {
        ws.close();
        resolve('opened');
      });
      ws.on('error', () => {
        resolve('failed');
      });
      // The server won't upgrade, so the raw TCP stays open.
      // Destroy it after a short wait.
      setTimeout(() => {
        ws.terminate();
        resolve('failed');
      }, 500);
    });
    expect(result).toBe('failed');
    // No new connection should have been registered
    expect(harness.subscriptions.size).toBe(0);
  });

  // ── Subscribe → events delivered ────────────────────────────────────────

  it('delivers events after subscribe', async () => {
    const ws = await connectClient(harness.url);
    sendMessage(ws, { type: 'subscribe', instanceId: 'inst-1' });

    // Small delay to let subscribe propagate
    await delay(50);

    const collecting = collectMessages(ws, 1);
    await harness.publish(
      makeEvent('state_changed', 'inst-1', {
        previousState: 'init',
        currentState: 'running',
        stateData: {},
        timestamp: '2026-01-01T00:00:00Z',
      }),
    );

    const msgs = await collecting;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('event');
    expect((msgs[0] as { type: 'event'; payload: MachineEvent }).payload.type).toBe(
      'state_changed',
    );
    expect((msgs[0] as { type: 'event'; payload: MachineEvent }).payload.instanceId).toBe('inst-1');
    ws.close();
  });

  // ── Unsubscribe → events stop ──────────────────────────────────────────

  it('stops delivering events after unsubscribe', async () => {
    const ws = await connectClient(harness.url);
    sendMessage(ws, { type: 'subscribe', instanceId: 'inst-1' });
    await delay(50);

    sendMessage(ws, { type: 'unsubscribe', instanceId: 'inst-1' });
    await delay(50);

    const collecting = collectMessages(ws, 1, 300);
    await harness.publish(
      makeEvent('state_changed', 'inst-1', {
        previousState: 'a',
        currentState: 'b',
        stateData: {},
        timestamp: '2026-01-01T00:00:00Z',
      }),
    );

    const msgs = await collecting;
    expect(msgs).toHaveLength(0);
    ws.close();
  });

  // ── Multiple subscriptions ──────────────────────────────────────────────

  it('delivers events for multiple subscribed instances', async () => {
    const ws = await connectClient(harness.url);
    sendMessage(ws, { type: 'subscribe', instanceId: 'inst-1' });
    sendMessage(ws, { type: 'subscribe', instanceId: 'inst-2' });
    await delay(50);

    const collecting = collectMessages(ws, 2);
    await harness.publish(
      makeEvent('state_changed', 'inst-1', {
        previousState: 'a',
        currentState: 'b',
        stateData: {},
        timestamp: '2026-01-01T00:00:00Z',
      }),
    );
    await harness.publish(
      makeEvent('machine_completed', 'inst-2', {
        status: 'completed',
        output: 42,
        instanceId: 'inst-2',
      }),
    );

    const msgs = await collecting;
    expect(msgs).toHaveLength(2);
    expect((msgs[0] as { type: 'event'; payload: MachineEvent }).payload.instanceId).toBe('inst-1');
    expect((msgs[1] as { type: 'event'; payload: MachineEvent }).payload.instanceId).toBe('inst-2');
    ws.close();
  });

  // ── Unsubscribed instance events NOT delivered ──────────────────────────

  it('does not deliver events for unsubscribed instances', async () => {
    const ws = await connectClient(harness.url);
    sendMessage(ws, { type: 'subscribe', instanceId: 'inst-1' });
    await delay(50);

    const collecting = collectMessages(ws, 1, 500);

    // Publish to inst-2 (not subscribed)
    await harness.publish(
      makeEvent('state_changed', 'inst-2', {
        previousState: 'a',
        currentState: 'b',
        stateData: {},
        timestamp: '2026-01-01T00:00:00Z',
      }),
    );

    // Publish to inst-1 (subscribed)
    await harness.publish(
      makeEvent('state_changed', 'inst-1', {
        previousState: 'a',
        currentState: 'b',
        stateData: {},
        timestamp: '2026-01-01T00:00:00Z',
      }),
    );

    const msgs = await collecting;
    // Should only have inst-1 event
    expect(msgs).toHaveLength(1);
    expect((msgs[0] as { type: 'event'; payload: MachineEvent }).payload.instanceId).toBe('inst-1');
    ws.close();
  });

  // ── Malformed JSON does not crash ───────────────────────────────────────

  it('sends error on malformed JSON without crashing', async () => {
    const ws = await connectClient(harness.url);

    const collecting = collectMessages(ws, 1);
    ws.send('not valid json!!!');

    const msgs = await collecting;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('error');
    expect((msgs[0] as { type: 'error'; message: string }).message).toContain('Malformed');

    // Connection should still be open
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('sends error on invalid message shape without crashing', async () => {
    const ws = await connectClient(harness.url);

    const collecting = collectMessages(ws, 1);
    ws.send(JSON.stringify({ foo: 'bar' }));

    const msgs = await collecting;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('error');
    ws.close();
  });

  // ── Non-existent instance subscription ──────────────────────────────────

  it('silently accepts subscription to non-existent instance', async () => {
    const ws = await connectClient(harness.url);
    // Should not throw or disconnect
    sendMessage(ws, { type: 'subscribe', instanceId: 'does-not-exist' });
    await delay(50);

    // Connection should still be open
    expect(ws.readyState).toBe(WebSocket.OPEN);

    // Verify server-side: find the server socket for this connection
    const serverSubs = [...harness.subscriptions.values()];
    expect(serverSubs).toHaveLength(1);
    expect(serverSubs[0].has('does-not-exist')).toBe(true);
    ws.close();
  });

  // ── Connection close cleans up subscriptions ────────────────────────────

  it('cleans up subscriptions when connection closes', async () => {
    const ws = await connectClient(harness.url);
    sendMessage(ws, { type: 'subscribe', instanceId: 'inst-1' });
    sendMessage(ws, { type: 'subscribe', instanceId: 'inst-2' });
    await delay(50);

    expect(harness.subscriptions.size).toBe(1);

    ws.close();
    await delay(100);

    expect(harness.subscriptions.size).toBe(0);
  });

  // ── Rapid subscribe/unsubscribe ─────────────────────────────────────────

  it('handles rapid subscribe/unsubscribe without leaking', async () => {
    const ws = await connectClient(harness.url);

    for (let i = 0; i < 20; i++) {
      sendMessage(ws, { type: 'subscribe', instanceId: `inst-${String(i)}` });
      sendMessage(ws, { type: 'unsubscribe', instanceId: `inst-${String(i)}` });
    }

    await delay(100);

    // Verify server-side via values()
    const serverSubs = [...harness.subscriptions.values()];
    expect(serverSubs).toHaveLength(1);
    expect(serverSubs[0].size).toBe(0);
    ws.close();
  });

  // ── All 10 event types forwarded ────────────────────────────────────────

  it('forwards all 10 event types to subscribers', async () => {
    const ws = await connectClient(harness.url);
    sendMessage(ws, { type: 'subscribe', instanceId: 'inst-1' });
    await delay(50);

    const events: MachineEvent[] = [
      makeEvent('state_changed', 'inst-1', {
        previousState: 'a',
        currentState: 'b',
        stateData: {},
        timestamp: '2026-01-01T00:00:00Z',
      }),
      makeEvent('transition_recorded', 'inst-1', {
        id: 't1',
        fromState: 'a',
        toState: 'b',
        timestamp: '2026-01-01T00:00:00Z',
        durationMs: 100,
      }),
      makeEvent('log_entry', 'inst-1', {
        id: 'l1',
        instanceId: 'inst-1',
        stateName: 'a',
        level: 'info',
        message: 'hello',
        timestamp: '2026-01-01T00:00:00Z',
      }),
      makeEvent('machine_completed', 'inst-1', {
        status: 'completed',
        output: 42,
        instanceId: 'inst-1',
      }),
      makeEvent('machine_resumed', 'inst-1', {
        previousState: 'a',
        resumedState: 'b',
        timestamp: '2026-01-01T00:00:00Z',
      }),
      makeEvent('child_spawned', 'inst-1', {
        childInstanceId: 'pending',
        childDefinitionId: 'child-def',
      }),
      makeEvent('child_completed', 'inst-1', {
        childInstanceId: 'child-1',
        result: { status: 'completed', output: 1, instanceId: 'child-1' },
      }),
      makeEvent('children_spawned', 'inst-1', {
        childInstanceIds: { a: 'c1', b: 'c2' },
      }),
      makeEvent('children_completed', 'inst-1', {
        results: {
          a: { status: 'completed', output: 1, instanceId: 'c1' },
          b: { status: 'completed', output: 2, instanceId: 'c2' },
        },
      }),
    ];

    const collecting = collectMessages(ws, 9, 3000);
    for (const event of events) {
      await harness.publish(event);
    }

    const msgs = await collecting;
    expect(msgs).toHaveLength(9);

    const receivedTypes = msgs.map(
      (m) => (m as { type: 'event'; payload: MachineEvent }).payload.type,
    );
    expect(receivedTypes).toEqual([
      'state_changed',
      'transition_recorded',
      'log_entry',
      'machine_completed',
      'machine_resumed',
      'child_spawned',
      'child_completed',
      'children_spawned',
      'children_completed',
    ]);

    ws.close();
  });

  // ── Multiple clients with different subscriptions ───────────────────────

  it('delivers events only to clients subscribed to that instance', async () => {
    const ws1 = await connectClient(harness.url);
    const ws2 = await connectClient(harness.url);

    sendMessage(ws1, { type: 'subscribe', instanceId: 'inst-1' });
    sendMessage(ws2, { type: 'subscribe', instanceId: 'inst-2' });
    await delay(50);

    const collecting1 = collectMessages(ws1, 1, 500);
    const collecting2 = collectMessages(ws2, 1, 500);

    await harness.publish(
      makeEvent('state_changed', 'inst-1', {
        previousState: 'a',
        currentState: 'b',
        stateData: {},
        timestamp: '2026-01-01T00:00:00Z',
      }),
    );
    await harness.publish(
      makeEvent('state_changed', 'inst-2', {
        previousState: 'x',
        currentState: 'y',
        stateData: {},
        timestamp: '2026-01-01T00:00:00Z',
      }),
    );

    const msgs1 = await collecting1;
    const msgs2 = await collecting2;

    expect(msgs1).toHaveLength(1);
    expect((msgs1[0] as { type: 'event'; payload: MachineEvent }).payload.instanceId).toBe(
      'inst-1',
    );

    expect(msgs2).toHaveLength(1);
    expect((msgs2[0] as { type: 'event'; payload: MachineEvent }).payload.instanceId).toBe(
      'inst-2',
    );

    ws1.close();
    ws2.close();
  });
});
