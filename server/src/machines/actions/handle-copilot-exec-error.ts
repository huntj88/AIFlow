/**
 * Built-in action: handle-copilot-exec-error
 *
 * Simple error-path action for Copilot workflows. Logs incoming error payload,
 * then transitions to `nextState` (defaults to `completed`).
 *
 * @module
 */

import { Effect } from 'effect';

import type { ActionFunction } from '../types.js';

interface HandleCopilotExecErrorInput {
  readonly nextState?: unknown;
}

export const handleCopilotExecErrorAction: ActionFunction = (ctx) =>
  Effect.gen(function* () {
    const data = (ctx.stateData ?? {}) as HandleCopilotExecErrorInput;
    const nextState =
      typeof data.nextState === 'string' && data.nextState.length > 0
        ? data.nextState
        : 'completed';

    yield* ctx.logger.warn('Handling copilot execution error', ctx.stateData);

    return {
      nextState,
      data: ctx.stateData,
    };
  });
