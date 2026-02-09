/**
 * Built-in action: delay (Task 05)
 *
 * Waits for a configurable duration then transitions.
 * Configuration via `stateData`:
 *   - `delayMs: number` — milliseconds to wait
 *   - `nextState: string` — state to transition to after the delay
 *
 * Uses `Effect.sleep` which is interruptible — cooperates with
 * cancellation (Task 14).
 *
 * @module
 */

import { Duration, Effect } from 'effect';

import type { ActionFunction } from '../types.js';
import { mkActionError } from '../types.js';

interface DelayData {
  delayMs?: unknown;
  nextState?: unknown;
}

export const delayAction: ActionFunction = (ctx) => {
  const data = ctx.stateData as DelayData | undefined;
  const delayMs = data?.delayMs;
  const nextState = data?.nextState;

  if (typeof delayMs !== 'number' || delayMs < 0) {
    return Effect.fail(
      mkActionError({
        actionId: 'delay',
        stateName: ctx.stateName,
        cause: new Error('stateData.delayMs must be a non-negative number'),
      }),
    );
  }

  if (typeof nextState !== 'string') {
    return Effect.fail(
      mkActionError({
        actionId: 'delay',
        stateName: ctx.stateName,
        cause: new Error('stateData.nextState must be a string'),
      }),
    );
  }

  return Effect.gen(function* () {
    yield* ctx.logger.info(`Delaying ${String(delayMs)}ms`);
    yield* Effect.sleep(Duration.millis(delayMs));
    yield* ctx.logger.info(`Delay of ${String(delayMs)}ms complete`);
    return { nextState, data: ctx.stateData };
  });
};
