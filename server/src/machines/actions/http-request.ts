/**
 * Built-in action: http-request (Task 05)
 *
 * Makes an HTTP request using `Effect.tryPromise` wrapping `fetch`.
 * Configuration is passed via `stateData`:
 *   - `url: string` — request URL
 *   - `method?: string` — HTTP method (defaults to GET)
 *   - `headers?: Record<string, string>` — request headers
 *   - `body?: unknown` — request body (serialised as JSON)
 *   - `nextState: string` — state to transition to after success
 *
 * Returns the response body as `data` in the `TransitionResult`.
 * Fails with `ActionError` on network / HTTP errors.
 *
 * @module
 */

import { Effect } from 'effect';

import type { ActionFunction } from '../types.js';
import { mkActionError } from '../types.js';

interface HttpRequestData {
  url?: unknown;
  method?: unknown;
  headers?: Record<string, string>;
  body?: unknown;
  nextState?: unknown;
}

export const httpRequestAction: ActionFunction = (ctx) => {
  const data = ctx.stateData as HttpRequestData | undefined;
  const url = data?.url;
  const method = (typeof data?.method === 'string' ? data.method : undefined) ?? 'GET';
  const headers = data?.headers;
  const body = data?.body;
  const nextState = data?.nextState;

  if (typeof url !== 'string') {
    return Effect.fail(
      mkActionError({
        actionId: 'http-request',
        stateName: ctx.stateName,
        cause: new Error('stateData.url must be a string'),
      }),
    );
  }

  if (typeof nextState !== 'string') {
    return Effect.fail(
      mkActionError({
        actionId: 'http-request',
        stateName: ctx.stateName,
        cause: new Error('stateData.nextState must be a string'),
      }),
    );
  }

  return Effect.gen(function* () {
    yield* ctx.logger.info(`HTTP ${method} ${url}`);

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: body != null ? JSON.stringify(body) : undefined,
        }),
      catch: (cause) =>
        mkActionError({
          actionId: 'http-request',
          stateName: ctx.stateName,
          cause,
        }),
    });

    if (!response.ok) {
      const text = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (cause) =>
          mkActionError({
            actionId: 'http-request',
            stateName: ctx.stateName,
            cause,
          }),
      });

      return yield* Effect.fail(
        mkActionError({
          actionId: 'http-request',
          stateName: ctx.stateName,
          cause: new Error(`HTTP ${String(response.status)}: ${text}`),
        }),
      );
    }

    const responseBody = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) =>
        mkActionError({
          actionId: 'http-request',
          stateName: ctx.stateName,
          cause,
        }),
    });

    yield* ctx.logger.info(`HTTP ${method} ${url} → ${String(response.status)}`);

    return { nextState, data: responseBody };
  });
};
