/**
 * WebSocket event serialization & client message types (Task 23)
 *
 * Defines the message protocol between the WebSocket server and connected
 * clients. Clients send `ClientMessage`s (subscribe/unsubscribe); the server
 * sends `ServerMessage`s (machine events or errors).
 *
 * @module
 */

import type { MachineEvent } from '../types.js';

// ────────────────────────────────────────────────────────────────────────────
// Client → Server messages
// ────────────────────────────────────────────────────────────────────────────

/** Subscribe to events for a specific machine instance. */
export interface SubscribeMessage {
  readonly type: 'subscribe';
  readonly instanceId: string;
}

/** Unsubscribe from events for a specific machine instance. */
export interface UnsubscribeMessage {
  readonly type: 'unsubscribe';
  readonly instanceId: string;
}

/** Union of all messages a client may send to the server. */
export type ClientMessage = SubscribeMessage | UnsubscribeMessage;

// ────────────────────────────────────────────────────────────────────────────
// Server → Client messages
// ────────────────────────────────────────────────────────────────────────────

/** A machine event forwarded to a subscribed client. */
export interface EventServerMessage {
  readonly type: 'event';
  readonly payload: MachineEvent;
}

/** An error message sent to the client (e.g. malformed JSON). */
export interface ErrorServerMessage {
  readonly type: 'error';
  readonly message: string;
}

/** Union of all messages the server may send to a client. */
export type ServerMessage = EventServerMessage | ErrorServerMessage;

// ────────────────────────────────────────────────────────────────────────────
// Serialization helpers
// ────────────────────────────────────────────────────────────────────────────

/** Serialize a `ServerMessage` to a JSON string for sending over the wire. */
export function serializeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

/**
 * Parse a raw WebSocket message into a `ClientMessage`.
 *
 * Returns `null` if the message is not valid JSON or does not match the
 * expected shape.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const obj = parsed as Record<string, unknown>;
    if (obj.type !== 'subscribe' && obj.type !== 'unsubscribe') return null;
    if (typeof obj.instanceId !== 'string' || obj.instanceId.length === 0) return null;

    return { type: obj.type, instanceId: obj.instanceId };
  } catch {
    return null;
  }
}
