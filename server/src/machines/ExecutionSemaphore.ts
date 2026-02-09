/**
 * ExecutionSemaphore — Global concurrency control for machine execution (Task 13)
 *
 * Provides a configurable `Semaphore`-based service that bounds the number of
 * **actively executing** machines. A permit is held only while a machine is
 * performing active computation (running an action, evaluating transitions,
 * persisting checkpoints). Parents **release their permit before waiting** for
 * child machines (release-before-wait pattern), preventing deadlock on
 * recursive / fan-out spawning.
 *
 * Configuration: `MAX_CONCURRENT_MACHINES` env var (default 50).
 *
 * @module
 */

import { Context, Effect, Layer } from 'effect';

// ────────────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/dot-notation */
const MAX_CONCURRENT_MACHINES = Number(process.env['MAX_CONCURRENT_MACHINES'] ?? 50);
/* eslint-enable @typescript-eslint/dot-notation */

// ────────────────────────────────────────────────────────────────────────────
// Service Tag
// ────────────────────────────────────────────────────────────────────────────

/**
 * Effect service tag for the global execution semaphore.
 *
 * The underlying value is an `effect` `Semaphore` with
 * `MAX_CONCURRENT_MACHINES` permits.
 */
export const ExecutionSemaphore = Context.GenericTag<Effect.Semaphore>('ExecutionSemaphore');

// ────────────────────────────────────────────────────────────────────────────
// Layer (Live implementation)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Live layer that creates the execution semaphore with the configured number
 * of permits.  Provide this layer once at application startup — all runners
 * share the same semaphore instance.
 */
export const ExecutionSemaphoreLive: Layer.Layer<Effect.Semaphore> = Layer.effect(
  ExecutionSemaphore,
  Effect.makeSemaphore(MAX_CONCURRENT_MACHINES),
);
