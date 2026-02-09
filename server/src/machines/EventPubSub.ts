/**
 * MachineEventPubSub — Effect PubSub for machine event publishing (Task 16)
 *
 * Provides a PubSub-based service for publishing `MachineEvent`s during machine
 * execution. Events are consumed by the WebSocket manager (Task 23) to provide
 * real-time updates to connected clients.
 *
 * Pattern follows `ExecutionSemaphore` — a `Context.GenericTag` wrapping an
 * unbounded `PubSub<MachineEvent>`.
 *
 * @module
 */

import { Context, Layer, PubSub } from 'effect';

import type { MachineEvent } from './types.js';

// ────────────────────────────────────────────────────────────────────────────
// Service Tag
// ────────────────────────────────────────────────────────────────────────────

/**
 * Effect service tag for the machine event PubSub.
 *
 * The underlying value is an unbounded `PubSub<MachineEvent>` shared across
 * the entire application. The runner publishes events; WebSocket consumers
 * subscribe.
 */
export const MachineEventPubSub =
  Context.GenericTag<PubSub.PubSub<MachineEvent>>('MachineEventPubSub');

// ────────────────────────────────────────────────────────────────────────────
// Layer (Live implementation)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Live layer that creates an unbounded PubSub for machine events.
 * Provide this layer once at application startup — all runners and WebSocket
 * managers share the same PubSub instance.
 */
export const MachineEventPubSubLive: Layer.Layer<PubSub.PubSub<MachineEvent>> = Layer.effect(
  MachineEventPubSub,
  PubSub.unbounded<MachineEvent>(),
);
