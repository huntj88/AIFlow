/**
 * WebSocket client helpers for E2E tests (Task 34).
 *
 * Provides helpers to connect to the live WebSocket server, subscribe to
 * instance events, and collect events with a timeout. Used by Task 44
 * (WebSocket live-updates tests).
 *
 * @module
 */

import { WebSocket } from 'ws';

export interface MachineWsEvent {
  type: string;
  instanceId?: string;
  [k: string]: unknown;
}

/**
 * Open a WebSocket connection to the given URL.
 * Resolves once the connection is open; rejects on error.
 */
export function connectWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => {
      resolve(ws);
    });
    ws.on('error', reject);
  });
}

/**
 * Send a JSON subscription message for a specific instance.
 */
export function subscribe(ws: WebSocket, instanceId: string): void {
  ws.send(JSON.stringify({ type: 'subscribe', instanceId }));
}

/**
 * Collect WebSocket events until a predicate returns `true` or `timeoutMs` elapses.
 * Returns all events collected up to that point.
 */
export function collectEvents(
  ws: WebSocket,
  opts: {
    until?: (event: MachineWsEvent) => boolean;
    timeoutMs?: number;
  } = {},
): Promise<MachineWsEvent[]> {
  const { until, timeoutMs = 10_000 } = opts;
  const events: MachineWsEvent[] = [];

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(events);
    }, timeoutMs);

    const onMessage = (data: Buffer | string) => {
      try {
        const event = JSON.parse(data.toString()) as MachineWsEvent;
        events.push(event);
        if (until?.(event)) {
          cleanup();
          resolve(events);
        }
      } catch {
        // ignore non-JSON messages
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
    };

    ws.on('message', onMessage);
  });
}

/**
 * Close a WebSocket connection and wait for it to finish.
 */
export function closeWs(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.on('close', () => {
      resolve();
    });
    ws.close();
  });
}
