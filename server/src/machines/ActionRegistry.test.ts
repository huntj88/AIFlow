/**
 * ActionRegistry — Unit Tests (Task 05)
 *
 * Tests for the `ActionRegistry` service interface: register, get, list, has,
 * and the presence of built-in actions after Layer construction.
 *
 * @module
 */

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  ActionRegistry,
  ActionRegistryLive,
  InMemoryActionRegistryLive,
} from './ActionRegistry.js';
import type { ActionFunction } from './types.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Run an Effect that requires `ActionRegistry`, providing the bare in-memory layer. */
function run<A, E>(effect: Effect.Effect<A, E, ActionRegistry>) {
  return Effect.runSync(Effect.provide(effect, InMemoryActionRegistryLive));
}

/** Run an Effect that requires `ActionRegistry`, providing the live (pre-loaded) layer. */
function runLive<A, E>(effect: Effect.Effect<A, E, ActionRegistry>) {
  return Effect.runPromise(Effect.provide(effect, ActionRegistryLive));
}

/** A no-op action for testing. */
const noopAction: ActionFunction = () => Effect.succeed({ nextState: 'done' });

// ────────────────────────────────────────────────────────────────────────────
// Tests — Registry CRUD
// ────────────────────────────────────────────────────────────────────────────

describe('ActionRegistry', () => {
  it('registers and retrieves an action', () => {
    const result = run(
      Effect.gen(function* () {
        const registry = yield* ActionRegistry;
        yield* registry.register('my-action', noopAction, { description: 'A test action' });
        return yield* registry.get('my-action');
      }),
    );

    expect(result.fn).toBe(noopAction);
    expect(result.metadata.id).toBe('my-action');
    expect(result.metadata.description).toBe('A test action');
  });

  it('returns NotFoundError for non-existent action', () => {
    const result = run(
      Effect.gen(function* () {
        const registry = yield* ActionRegistry;
        return yield* Effect.either(registry.get('nonexistent'));
      }),
    );

    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left._tag).toBe('NotFoundError');
      expect(result.left.entityType).toBe('action');
      expect(result.left.id).toBe('nonexistent');
    }
  });

  it('lists metadata for all registered actions', () => {
    const result = run(
      Effect.gen(function* () {
        const registry = yield* ActionRegistry;
        yield* registry.register('action-a', noopAction, { description: 'A' });
        yield* registry.register('action-b', noopAction, { description: 'B' });
        return yield* registry.list();
      }),
    );

    expect(result).toHaveLength(2);
    const ids = result.map((m) => m.id);
    expect(ids).toContain('action-a');
    expect(ids).toContain('action-b');
  });

  it('has() returns true for registered and false for unregistered', () => {
    const result = run(
      Effect.gen(function* () {
        const registry = yield* ActionRegistry;
        yield* registry.register('present', noopAction);
        const yes = yield* registry.has('present');
        const no = yield* registry.has('absent');
        return { yes, no };
      }),
    );

    expect(result.yes).toBe(true);
    expect(result.no).toBe(false);
  });

  it('overwrites existing action on re-register', () => {
    const action2: ActionFunction = () => Effect.succeed({ nextState: 'other' });

    const result = run(
      Effect.gen(function* () {
        const registry = yield* ActionRegistry;
        yield* registry.register('my-action', noopAction, { description: 'v1' });
        yield* registry.register('my-action', action2, { description: 'v2' });
        return yield* registry.get('my-action');
      }),
    );

    expect(result.fn).toBe(action2);
    expect(result.metadata.description).toBe('v2');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests — Built-in Actions Present After Layer Construction
// ────────────────────────────────────────────────────────────────────────────

describe('ActionRegistryLive (pre-loaded)', () => {
  const BUILTIN_IDS = [
    'http-request',
    'delay',
    'transform-data',
    'log-message',
    'conditional-branch',
  ];

  it('contains all 5 built-in actions', async () => {
    const list = await runLive(
      Effect.gen(function* () {
        const registry = yield* ActionRegistry;
        return yield* registry.list();
      }),
    );

    const ids = list.map((m) => m.id);
    for (const id of BUILTIN_IDS) {
      expect(ids).toContain(id);
    }
    expect(list.length).toBeGreaterThanOrEqual(5);
  });

  it.each(BUILTIN_IDS)('has("%s") returns true', async (id) => {
    const result = await runLive(
      Effect.gen(function* () {
        const registry = yield* ActionRegistry;
        return yield* registry.has(id);
      }),
    );

    expect(result).toBe(true);
  });

  it.each(BUILTIN_IDS)('get("%s") returns a function', async (id) => {
    const entry = await runLive(
      Effect.gen(function* () {
        const registry = yield* ActionRegistry;
        return yield* registry.get(id);
      }),
    );

    expect(typeof entry.fn).toBe('function');
    expect(entry.metadata.id).toBe(id);
    expect(entry.metadata.description).toBeDefined();
  });
});
