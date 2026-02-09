/**
 * TelemetryMiddleware — Transition timing & span annotations (Task 07)
 *
 * Starts a timing measurement in `beforeTransition` and records the
 * duration as an `Effect.logSpan` annotation in `afterTransition`.
 *
 * This is a logging-only / stub implementation. Full OpenTelemetry
 * integration will be added in Task 31 (Observability).
 *
 * @module
 */

import { Effect } from 'effect';

import type { TransitionMiddleware } from '../types.js';

// ────────────────────────────────────────────────────────────────────────────
// Timing Store
// ────────────────────────────────────────────────────────────────────────────

/**
 * Per-instance+state timing map. Keyed by `${instanceId}:${stateName}`.
 * Cleaned up in `afterTransition`.
 */
const timings = new Map<string, number>();

function timingKey(instanceId: string, stateName: string): string {
  return `${instanceId}:${stateName}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Middleware
// ────────────────────────────────────────────────────────────────────────────

export const TelemetryMiddleware: TransitionMiddleware = {
  name: 'TelemetryMiddleware',

  beforeTransition(ctx) {
    return Effect.sync(() => {
      const key = timingKey(ctx.instance.id, ctx.stateName);
      timings.set(key, Date.now());
    });
  },

  afterTransition(ctx) {
    return Effect.gen(function* () {
      const key = timingKey(ctx.instance.id, ctx.stateName);
      const startTime = timings.get(key);
      const durationMs = startTime !== undefined ? Date.now() - startTime : -1;

      // Clean up timing entry
      timings.delete(key);

      yield* Effect.log(`Transition completed`).pipe(
        Effect.annotateLogs({
          middleware: 'TelemetryMiddleware',
          machineDefId: ctx.definition.id,
          instanceId: ctx.instance.id,
          stateName: ctx.stateName,
          nextState: ctx.result.nextState,
          durationMs: String(durationMs),
          actionId: ctx.definition.states[ctx.stateName].actionId ?? 'unknown',
        }),
      );
    });
  },

  onError(ctx) {
    // Clean up timing entry on error so we don't leak memory
    return Effect.sync(() => {
      const key = timingKey(ctx.instance.id, ctx.stateName);
      timings.delete(key);
    });
  },
};
