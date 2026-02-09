/**
 * Built-in actions barrel — re-exports & registration (Task 05)
 *
 * Re-exports all built-in action functions and provides a
 * `registerBuiltinActions` helper that registers every built-in
 * action into an `ActionRegistry` instance.
 *
 * @module
 */

import { Effect } from 'effect';

import type { ActionRegistry } from '../ActionRegistry.js';
import { conditionalBranchAction } from './conditional-branch.js';
import { delayAction } from './delay.js';
import { httpRequestAction } from './http-request.js';
import { logMessageAction } from './log-message.js';
import { transformDataAction } from './transform-data.js';

export { conditionalBranchAction } from './conditional-branch.js';
export { delayAction } from './delay.js';
export { httpRequestAction } from './http-request.js';
export { logMessageAction } from './log-message.js';
export { transformDataAction } from './transform-data.js';

/**
 * Register all 5 built-in actions into the given registry.
 */
export const registerBuiltinActions = (registry: ActionRegistry): Effect.Effect<void> =>
  Effect.all(
    [
      registry.register('http-request', httpRequestAction, {
        description: 'Make an HTTP request',
      }),
      registry.register('delay', delayAction, {
        description: 'Wait for a specified duration',
      }),
      registry.register('transform-data', transformDataAction, {
        description: 'Apply JSONPath transform',
      }),
      registry.register('log-message', logMessageAction, {
        description: 'Log a message and pass through',
      }),
      registry.register('conditional-branch', conditionalBranchAction, {
        description: 'Branch based on condition',
      }),
    ],
    { discard: true },
  );
