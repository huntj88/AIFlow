/**
 * MiddlewareExecutor — Middleware chain executor (Task 07)
 *
 * Manages execution of `TransitionMiddleware` hooks in the correct order:
 * - `beforeTransition`: registration order (first registered → first to run)
 * - `afterTransition`: reverse registration order (onion model)
 * - `onError`: all hooks fire; individual errors are logged but never propagate
 *
 * Exposed as an Effect `Context.GenericTag` service so the runner can depend
 * on it via the Effect dependency injection system.
 *
 * @module
 */

import { Context, Effect, Layer } from 'effect';

import type {
  MachineError,
  MiddlewareContext,
  TransitionMiddleware,
  TransitionResult,
} from '../types.js';

// ────────────────────────────────────────────────────────────────────────────
// Service Interface
// ────────────────────────────────────────────────────────────────────────────

export interface MiddlewareExecutor {
  /** Execute all `beforeTransition` hooks in registration order. */
  runBefore(ctx: MiddlewareContext): Effect.Effect<void, MachineError>;

  /** Execute all `afterTransition` hooks in reverse registration order. */
  runAfter(
    ctx: MiddlewareContext & { readonly result: TransitionResult },
  ): Effect.Effect<void, MachineError>;

  /**
   * Execute all `onError` hooks. Errors in individual hooks are logged
   * but never propagate — this method cannot fail.
   */
  runOnError(ctx: MiddlewareContext & { readonly error: MachineError }): Effect.Effect<void>;

  /** Return the current middleware stack (useful for testing). */
  getMiddleware(): readonly TransitionMiddleware[];
}

// ────────────────────────────────────────────────────────────────────────────
// Service Tag
// ────────────────────────────────────────────────────────────────────────────

export const MiddlewareExecutor = Context.GenericTag<MiddlewareExecutor>('MiddlewareExecutor');

// ────────────────────────────────────────────────────────────────────────────
// In-Memory Implementation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a `MiddlewareExecutor` from an ordered array of middleware.
 */
export function makeMiddlewareExecutor(
  middleware: readonly TransitionMiddleware[],
): MiddlewareExecutor {
  return {
    runBefore(ctx) {
      // Execute beforeTransition hooks in registration order
      return Effect.forEach(
        middleware,
        (mw) => {
          if (mw.beforeTransition) {
            return mw.beforeTransition(ctx);
          }
          return Effect.void;
        },
        { discard: true },
      );
    },

    runAfter(ctx) {
      // Execute afterTransition hooks in reverse registration order (onion model)
      const reversed = [...middleware].reverse();
      return Effect.forEach(
        reversed,
        (mw) => {
          if (mw.afterTransition) {
            return mw.afterTransition(ctx);
          }
          return Effect.void;
        },
        { discard: true },
      );
    },

    runOnError(ctx) {
      // Execute all onError hooks; individual errors are logged but never propagate
      return Effect.forEach(
        middleware,
        (mw) => {
          if (mw.onError) {
            return mw
              .onError(ctx)
              .pipe(
                Effect.catchAll((error) =>
                  Effect.log(`onError hook "${mw.name}" threw — swallowing`).pipe(
                    Effect.annotateLogs({ middlewareName: mw.name, swallowedError: String(error) }),
                  ),
                ),
              );
          }
          return Effect.void;
        },
        { discard: true },
      );
    },

    getMiddleware() {
      return middleware;
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Layer
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a Layer providing a `MiddlewareExecutor` from a given middleware stack.
 */
export function makeMiddlewareExecutorLayer(
  middleware: readonly TransitionMiddleware[],
): Layer.Layer<MiddlewareExecutor> {
  return Layer.sync(MiddlewareExecutor, () => makeMiddlewareExecutor(middleware));
}
