/**
 * ActionRegistry — Effect Service definition (Task 05)
 *
 * Defines the `ActionRegistry` service interface as an Effect `Context.GenericTag`.
 * The registry stores action functions by ID along with metadata (description,
 * schemas). Actions are Effect programs that receive `ActionContext` and return
 * `TransitionResult`.
 *
 * @module
 */

import { Context, Effect, Layer } from 'effect';

import type { ActionFunction, ActionMetadata, NotFoundError } from './types.js';
import { mkNotFoundError } from './types.js';

// ────────────────────────────────────────────────────────────────────────────
// Service Interface
// ────────────────────────────────────────────────────────────────────────────

export interface ActionRegistry {
  /**
   * Register an action function with the given ID and optional metadata.
   * If an action with this ID already exists it will be overwritten.
   */
  register(
    id: string,
    fn: ActionFunction,
    metadata?: Omit<ActionMetadata, 'id'>,
  ): Effect.Effect<void>;

  /**
   * Retrieve an action function and its metadata by ID.
   * Fails with `NotFoundError` if no action with this ID exists.
   */
  get(id: string): Effect.Effect<{ fn: ActionFunction; metadata: ActionMetadata }, NotFoundError>;

  /**
   * List metadata for all registered actions.
   * Function references are omitted — suitable for API consumption.
   */
  list(): Effect.Effect<ActionMetadata[]>;

  /** Quick existence check. */
  has(id: string): Effect.Effect<boolean>;
}

// ────────────────────────────────────────────────────────────────────────────
// Service Tag
// ────────────────────────────────────────────────────────────────────────────

export const ActionRegistry = Context.GenericTag<ActionRegistry>('ActionRegistry');

// ────────────────────────────────────────────────────────────────────────────
// In-Memory Implementation
// ────────────────────────────────────────────────────────────────────────────

function makeInMemoryActionRegistry(): ActionRegistry {
  const entries = new Map<string, { fn: ActionFunction; metadata: ActionMetadata }>();

  return {
    register(id, fn, meta) {
      return Effect.sync(() => {
        const metadata: ActionMetadata = {
          id,
          description: meta?.description,
          inputSchema: meta?.inputSchema,
          outputSchema: meta?.outputSchema,
        };
        entries.set(id, { fn, metadata });
      });
    },

    get(id) {
      return Effect.suspend(() => {
        const entry = entries.get(id);
        if (!entry) {
          return Effect.fail(mkNotFoundError({ entityType: 'action', id }));
        }
        return Effect.succeed(entry);
      });
    },

    list() {
      return Effect.sync(() => [...entries.values()].map((e) => e.metadata));
    },

    has(id) {
      return Effect.sync(() => entries.has(id));
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Layers
// ────────────────────────────────────────────────────────────────────────────

/** Layer that provides a bare (empty) in-memory ActionRegistry. Fresh per provision. */
export const InMemoryActionRegistryLive = Layer.sync(ActionRegistry, makeInMemoryActionRegistry);

/**
 * Layer that provides an ActionRegistry pre-loaded with all built-in actions.
 * Depends on `registerBuiltinActions` from `./actions/index.js`.
 *
 * Usage: `ActionRegistryLive` — import from this module.
 */
export const ActionRegistryLive = Layer.effect(
  ActionRegistry,
  Effect.gen(function* () {
    const registry = makeInMemoryActionRegistry();

    // Dynamically import to avoid circular deps at module level
    const { registerBuiltinActions } = yield* Effect.promise(() => import('./actions/index.js'));

    yield* registerBuiltinActions(registry);

    return registry;
  }),
);
