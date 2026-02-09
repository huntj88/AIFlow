/**
 * Built-in action: transform-data (Task 05)
 *
 * Applies a JSONPath expression to `stateData` and returns the result.
 * Configuration via `stateData`:
 *   - `expression: string` — JSONPath expression
 *   - `nextState: string` — state to transition to
 *
 * Uses `jsonpath-plus` for evaluation.
 *
 * @module
 */

import { Effect } from 'effect';
import { JSONPath } from 'jsonpath-plus';

import type { ActionFunction } from '../types.js';
import { mkActionError } from '../types.js';

interface TransformData {
  expression?: unknown;
  nextState?: unknown;
}

export const transformDataAction: ActionFunction = (ctx) => {
  const data = ctx.stateData as TransformData | undefined;
  const expression = data?.expression as string | undefined;
  const nextState = data?.nextState as string | undefined;

  if (typeof expression !== 'string') {
    return Effect.fail(
      mkActionError({
        actionId: 'transform-data',
        stateName: ctx.stateName,
        cause: new Error('stateData.expression must be a string'),
      }),
    );
  }

  if (typeof nextState !== 'string') {
    return Effect.fail(
      mkActionError({
        actionId: 'transform-data',
        stateName: ctx.stateName,
        cause: new Error('stateData.nextState must be a string'),
      }),
    );
  }

  return Effect.gen(function* () {
    yield* ctx.logger.info(`Transforming data with expression: ${expression}`);

    const result: unknown = yield* Effect.try({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      try: () => JSONPath({ path: expression, json: ctx.stateData as object }),
      catch: (cause) =>
        mkActionError({
          actionId: 'transform-data',
          stateName: ctx.stateName,
          cause,
        }),
    });

    yield* ctx.logger.info('Transform complete');
    return { nextState, data: result };
  });
};
