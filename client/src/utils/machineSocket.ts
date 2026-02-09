/**
 * WebSocket client for real-time machine event streaming (Task 25)
 *
 * Connects to `ws://host/api/machines/live`, manages per-instance subscriptions,
 * dispatches incoming events to registered callbacks, and reconnects with
 * exponential backoff on disconnect.
 *
 * @module
 */

import type { MachineEvent } from '../types/machines';

// ────────────────────────────────────────────────────────────────────────────
// Protocol types (mirrors server/src/machines/live/events.ts)
// ────────────────────────────────────────────────────────────────────────────

/** Messages the client sends to the server. */
type ClientMessage =
  | { readonly type: 'subscribe'; readonly instanceId: string }
  | { readonly type: 'unsubscribe'; readonly instanceId: string };

/** Messages the server sends to the client. */
type ServerMessage =
  | { readonly type: 'event'; readonly payload: MachineEvent }
  | { readonly type: 'error'; readonly message: string };

// ────────────────────────────────────────────────────────────────────────────
// Backoff configuration
// ────────────────────────────────────────────────────────────────────────────

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;

// ────────────────────────────────────────────────────────────────────────────
// MachineSocketClient interface
// ────────────────────────────────────────────────────────────────────────────

export type MachineEventCallback = (event: MachineEvent) => void;

export interface MachineSocketClient {
  /** Open the WebSocket connection. Safe to call multiple times — no-ops if already connected. */
  connect(): void;

  /** Close the connection and stop reconnection attempts. */
  disconnect(): void;

  /**
   * Subscribe to events for a specific machine instance.
   *
   * Returns an unsubscribe function. When the last callback for an instance is
   * removed, an `unsubscribe` message is sent to the server.
   */
  subscribe(instanceId: string, callback: MachineEventCallback): () => void;

  /**
   * Remove all callbacks for a specific instance and send `unsubscribe` to the
   * server.
   */
  unsubscribe(instanceId: string): void;

  /** Whether the WebSocket is currently in the OPEN state. */
  readonly connected: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Implementation
// ────────────────────────────────────────────────────────────────────────────

function createMachineSocket(): MachineSocketClient {
  /** Active WebSocket connection (or `null` when disconnected). */
  let ws: WebSocket | null = null;

  /** Whether the user explicitly called `disconnect()`. */
  let intentionalClose = false;

  /** Current backoff delay for reconnection. */
  let backoffMs = INITIAL_BACKOFF_MS;

  /** Handle for the pending reconnection timer. */
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** instanceId → set of callbacks. */
  const subscriptions = new Map<string, Set<MachineEventCallback>>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function getWsUrl(): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/api/machines/live`;
  }

  function send(msg: ClientMessage): void {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  /** Re-subscribe to all tracked instances (called after reconnect). */
  function resubscribeAll(): void {
    for (const instanceId of subscriptions.keys()) {
      send({ type: 'subscribe', instanceId });
    }
  }

  function scheduleReconnect(): void {
    if (intentionalClose) return;
    if (reconnectTimer !== null) return; // already scheduled

    console.warn(`[machineSocket] reconnecting in ${String(backoffMs)}ms …`);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
      // Increase backoff for next potential failure
      backoffMs = Math.min(backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
    }, backoffMs);
  }

  function resetBackoff(): void {
    backoffMs = INITIAL_BACKOFF_MS;
  }

  // ── Event handlers ───────────────────────────────────────────────────────

  function handleOpen(): void {
    resetBackoff();
    resubscribeAll();
  }

  function handleClose(): void {
    ws = null;
    scheduleReconnect();
  }

  function handleError(): void {
    // The browser fires `onerror` then `onclose`; reconnection is handled in
    // `handleClose`. We just log here.
    console.error('[machineSocket] connection error');
  }

  function handleMessage(event: MessageEvent): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(event.data as string) as ServerMessage;
    } catch {
      console.warn('[machineSocket] received non-JSON message', event.data);
      return;
    }

    if (msg.type === 'error') {
      console.warn('[machineSocket] server error:', msg.message);
      return;
    }

    const { payload } = msg;
    const callbacks = subscriptions.get(payload.instanceId);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(payload);
        } catch (err) {
          console.error('[machineSocket] callback error', err);
        }
      }
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  function connect(): void {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return; // already connected or connecting
    }

    intentionalClose = false;

    ws = new WebSocket(getWsUrl());
    ws.addEventListener('open', handleOpen);
    ws.addEventListener('close', handleClose);
    ws.addEventListener('error', handleError);
    ws.addEventListener('message', handleMessage);
  }

  function disconnect(): void {
    intentionalClose = true;

    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (ws) {
      ws.removeEventListener('open', handleOpen);
      ws.removeEventListener('close', handleClose);
      ws.removeEventListener('error', handleError);
      ws.removeEventListener('message', handleMessage);
      ws.close();
      ws = null;
    }

    resetBackoff();
  }

  function subscribe(instanceId: string, callback: MachineEventCallback): () => void {
    let callbacks = subscriptions.get(instanceId);
    if (!callbacks) {
      callbacks = new Set();
      subscriptions.set(instanceId, callbacks);
      // First subscriber for this instance — tell the server.
      send({ type: 'subscribe', instanceId });
    }
    callbacks.add(callback);

    // Auto-connect if not already connected
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      connect();
    }

    // Return unsubscribe function
    return () => {
      const cbs = subscriptions.get(instanceId);
      if (!cbs) return;
      cbs.delete(callback);
      if (cbs.size === 0) {
        subscriptions.delete(instanceId);
        send({ type: 'unsubscribe', instanceId });
      }
    };
  }

  function unsubscribe(instanceId: string): void {
    subscriptions.delete(instanceId);
    send({ type: 'unsubscribe', instanceId });
  }

  return {
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    get connected() {
      return ws?.readyState === WebSocket.OPEN;
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Singleton export
// ────────────────────────────────────────────────────────────────────────────

/** Global WebSocket client for machine events. */
export const machineSocket: MachineSocketClient = createMachineSocket();
