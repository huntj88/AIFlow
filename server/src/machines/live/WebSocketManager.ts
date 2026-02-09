/**
 * WebSocketManager — Effect Layer for real-time event streaming (Task 23)
 *
 * Wraps the `ws` library as an Effect Service Layer. Attaches to the existing
 * Node.js HTTP server (`nodeHttpServer`) via the `upgrade` event, handling
 * connections on `/api/machines/live`.
 *
 * Clients send subscribe/unsubscribe messages; the server forwards
 * `MachineEvent`s from the `MachineEventPubSub` to subscribed connections.
 *
 * @module
 */

import { Context, Effect, Layer, PubSub, Queue } from 'effect';
import type { WebSocket as WsWebSocket } from 'ws';
import { WebSocketServer } from 'ws';

import { nodeHttpServer } from '@/lib/HttpServer.js';
import { MachineEventPubSub } from '@/machines/EventPubSub.js';
import type { MachineEvent } from '@/machines/types.js';

import { parseClientMessage, serializeServerMessage } from './events.js';

// ────────────────────────────────────────────────────────────────────────────
// Service interface
// ────────────────────────────────────────────────────────────────────────────

/** The WebSocket manager service — lifecycle is managed by the Effect Layer. */
export interface WebSocketManager {
  /** The number of currently connected clients. */
  readonly connectionCount: () => number;
  /** Gracefully close the WebSocket server and all connections. */
  readonly close: () => Effect.Effect<void>;
}

export const WebSocketManager = Context.GenericTag<WebSocketManager>('WebSocketManager');

// ────────────────────────────────────────────────────────────────────────────
// Internal state
// ────────────────────────────────────────────────────────────────────────────

const WS_PATH = '/api/machines/live';

// ────────────────────────────────────────────────────────────────────────────
// Layer implementation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Live layer that creates and manages the WebSocket server.
 *
 * On construction:
 * 1. Creates a `WebSocketServer` in `noServer` mode
 * 2. Attaches an `upgrade` handler on the shared Node HTTP server
 * 3. Subscribes to the `MachineEventPubSub` and starts a background fiber
 *    that reads events and broadcasts them to subscribed clients
 *
 * On teardown (via `Effect.addFinalizer`):
 * 1. Closes all client connections
 * 2. Shuts down the `WebSocketServer`
 */
export const WebSocketManagerLive: Layer.Layer<
  WebSocketManager,
  never,
  PubSub.PubSub<MachineEvent>
> = Layer.scoped(
  WebSocketManager,
  Effect.gen(function* () {
    // ── Per-connection subscription tracking ──────────────────────────
    const subscriptions = new Map<WsWebSocket, Set<string>>();

    // ── WebSocket server (noServer mode) ──────────────────────────────
    const wss = new WebSocketServer({ noServer: true });

    // ── Attach upgrade handler to the shared HTTP server ──────────────
    const upgradeHandler = (
      request: import('node:http').IncomingMessage,
      socket: import('node:stream').Duplex,
      head: Buffer,
    ) => {
      const url = request.url ?? '';
      if (url === WS_PATH || url.startsWith(`${WS_PATH}?`)) {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      } else {
        // Not our path — destroy the socket so it doesn't hang
        socket.destroy();
      }
    };
    nodeHttpServer.on('upgrade', upgradeHandler);

    // ── Connection handling ───────────────────────────────────────────
    wss.on('connection', (ws: WsWebSocket) => {
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

    // ── PubSub subscription — broadcast events to clients ─────────────
    const pubsub = yield* MachineEventPubSub;
    const subscription = yield* PubSub.subscribe(pubsub);

    const broadcastToSubscribers = (event: MachineEvent): void => {
      const payload = serializeServerMessage({ type: 'event', payload: event });

      for (const [ws, subs] of subscriptions) {
        if (subs.has(event.instanceId) && ws.readyState === ws.OPEN) {
          ws.send(payload);
        }
      }
    };

    // Start a background fiber that reads from the subscription queue
    // and broadcasts each event to interested clients.
    yield* Effect.fork(
      Effect.forever(
        Effect.gen(function* () {
          const event = yield* Queue.take(subscription);
          broadcastToSubscribers(event);
        }),
      ),
    );

    // ── Finalizer — clean up on shutdown ──────────────────────────────
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        nodeHttpServer.removeListener('upgrade', upgradeHandler);
        for (const ws of wss.clients) {
          ws.close(1001, 'Server shutting down');
        }
        wss.close();
        subscriptions.clear();
      }),
    );

    // ── Return service interface ──────────────────────────────────────
    return WebSocketManager.of({
      connectionCount: () => subscriptions.size,
      close: () =>
        Effect.sync(() => {
          for (const ws of wss.clients) {
            ws.close(1001, 'Server shutting down');
          }
          wss.close();
          subscriptions.clear();
        }),
    });
  }),
);
