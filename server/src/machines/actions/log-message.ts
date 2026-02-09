/**
 * Built-in action: log-message (Task 05)
 *
 * Logs a message using `ctx.logger` and passes data through.
 * Configuration via `stateData`:
 *   - `message: string` — the message to log
 *   - `level?: 'debug' | 'info' | 'warn' | 'error'` — log level (defaults to 'info')
 *   - `nextState: string` — state to transition to
 *
 * @module
 */

import { Effect } from 'effect';

import type { ActionFunction } from '../types.js';
import { mkActionError } from '../types.js';

const VALID_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type LogLevel = (typeof VALID_LEVELS)[number];

interface LogMessageData {
  message?: unknown;
  level?: unknown;
  nextState?: unknown;
}

export const logMessageAction: ActionFunction = (ctx) => {
  const data = ctx.stateData as LogMessageData | undefined;
  const message = typeof data?.message === 'string' ? data.message : undefined;
  const level =
    (VALID_LEVELS.includes(data?.level as LogLevel) ? (data?.level as LogLevel) : undefined) ??
    'info';
  const nextState = typeof data?.nextState === 'string' ? data.nextState : undefined;

  if (typeof message !== 'string') {
    return Effect.fail(
      mkActionError({
        actionId: 'log-message',
        stateName: ctx.stateName,
        cause: new Error('stateData.message must be a string'),
      }),
    );
  }

  if (typeof nextState !== 'string') {
    return Effect.fail(
      mkActionError({
        actionId: 'log-message',
        stateName: ctx.stateName,
        cause: new Error('stateData.nextState must be a string'),
      }),
    );
  }

  if (!VALID_LEVELS.includes(level)) {
    return Effect.fail(
      mkActionError({
        actionId: 'log-message',
        stateName: ctx.stateName,
        cause: new Error(`stateData.level must be one of: ${VALID_LEVELS.join(', ')}`),
      }),
    );
  }

  return Effect.gen(function* () {
    yield* ctx.logger[level](message, ctx.stateData);
    return { nextState, data: ctx.stateData };
  });
};
