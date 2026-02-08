/**
 * InMemoryMachineStore — Unit Tests (Task 04)
 *
 * Tests for all `MachineStore` interface methods using the in-memory
 * implementation. Covers definitions, instances, filtering, pagination,
 * version auto-increment, deep-clone isolation, and error cases.
 *
 * @module
 */

import { Effect, Either } from 'effect';
import { describe, expect, it } from 'vitest';

import type { MachineInstance } from '../types.js';
import { InMemoryMachineStoreLive } from './InMemoryMachineStore.js';
import { MachineStore } from './MachineStore.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Run an Effect that requires `MachineStore`, providing the in-memory layer. */
function run<A, E>(effect: Effect.Effect<A, E, MachineStore>) {
  return Effect.runSync(Effect.provide(effect, InMemoryMachineStoreLive));
}

/** Minimal valid definition input (fields that the caller provides). */
function defInput(overrides?: Record<string, unknown>) {
  return {
    name: 'test-machine',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    states: {
      start: { name: 'start', type: 'action' as const, actionId: 'noop' },
      completed: { name: 'completed', type: 'terminal' as const },
      cancelled: { name: 'cancelled', type: 'terminal' as const },
      error: { name: 'error', type: 'terminal' as const },
    },
    initialState: 'start',
    transitions: [{ from: 'start', to: 'completed' }],
    ...overrides,
  };
}

/** Minimal valid instance input (fields that the caller provides). */
function instanceInput(
  overrides?: Partial<Omit<MachineInstance, 'id' | 'createdAt' | 'updatedAt'>>,
): Omit<MachineInstance, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    definitionId: 'def-001',
    definitionVersion: 1,
    status: 'running',
    currentState: 'start',
    stateData: {},
    input: { foo: 'bar' },
    history: [],
    logs: [],
    artifacts: [],
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Definition Tests
// ────────────────────────────────────────────────────────────────────────────

describe('InMemoryMachineStore — Definitions', () => {
  it('saves and retrieves a definition', () => {
    const store = run(MachineStore);
    const saved = Effect.runSync(store.saveDefinition(defInput()));
    const got = Effect.runSync(store.getDefinition(saved.id));
    expect(got.name).toBe('test-machine');
    expect(got.id).toBe(saved.id);
  });

  it('auto-generates id, version: 1, and timestamps on save', () => {
    const store = run(MachineStore);
    const saved = Effect.runSync(store.saveDefinition(defInput()));

    expect(saved.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(saved.version).toBe(1);
    expect(saved.metadata.createdAt).toBeTruthy();
    expect(saved.metadata.updatedAt).toBeTruthy();
  });

  it('updateDefinition increments version and refreshes updatedAt', () => {
    const store = run(MachineStore);
    const saved = Effect.runSync(store.saveDefinition(defInput()));
    const originalUpdatedAt = saved.metadata.updatedAt;

    const updated = Effect.runSync(store.updateDefinition(saved.id, { name: 'renamed' }));

    expect(updated.version).toBe(2);
    expect(updated.name).toBe('renamed');
    expect(updated.metadata.createdAt).toBe(saved.metadata.createdAt);
    // updatedAt should be refreshed (≥ original)
    expect(new Date(updated.metadata.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(originalUpdatedAt).getTime(),
    );
  });

  it('getDefinition for non-existent id returns NotFoundError', () => {
    const store = run(MachineStore);
    const result = Effect.runSync(Effect.either(store.getDefinition('nonexistent')));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('NotFoundError');
      expect(result.left.entityType).toBe('definition');
      expect(result.left.id).toBe('nonexistent');
    }
  });

  it('deleteDefinition removes it so it is no longer retrievable', () => {
    const store = run(MachineStore);
    const saved = Effect.runSync(store.saveDefinition(defInput()));

    Effect.runSync(store.deleteDefinition(saved.id));

    const result = Effect.runSync(Effect.either(store.getDefinition(saved.id)));
    expect(Either.isLeft(result)).toBe(true);
  });

  it('deleteDefinition for non-existent id returns NotFoundError', () => {
    const store = run(MachineStore);
    const result = Effect.runSync(Effect.either(store.deleteDefinition('nonexistent')));
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('NotFoundError');
    }
  });

  it('listDefinitions returns all saved definitions', () => {
    const store = run(MachineStore);
    Effect.runSync(store.saveDefinition(defInput({ name: 'alpha' })));
    Effect.runSync(store.saveDefinition(defInput({ name: 'beta' })));
    Effect.runSync(store.saveDefinition(defInput({ name: 'gamma' })));

    const list = Effect.runSync(store.listDefinitions());
    expect(list).toHaveLength(3);
    expect(list.map((d) => d.name).sort()).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('allows creating definitions with the same name (names not unique)', () => {
    const store = run(MachineStore);
    const a = Effect.runSync(store.saveDefinition(defInput({ name: 'dup' })));
    const b = Effect.runSync(store.saveDefinition(defInput({ name: 'dup' })));

    expect(a.id).not.toBe(b.id);
    expect(a.name).toBe(b.name);
  });

  it('updateDefinition for non-existent id returns NotFoundError', () => {
    const store = run(MachineStore);
    const result = Effect.runSync(
      Effect.either(store.updateDefinition('nonexistent', { name: 'x' })),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('NotFoundError');
    }
  });

  it('deep-clones on save so external mutation is isolated', () => {
    const store = run(MachineStore);
    const input = defInput();
    const saved = Effect.runSync(store.saveDefinition(input));

    // Mutate input after save — should not affect stored copy
    (input as Record<string, unknown>).name = 'MUTATED';

    const got = Effect.runSync(store.getDefinition(saved.id));
    expect(got.name).toBe('test-machine');
  });

  it('deep-clones on read so returned mutation is isolated', () => {
    const store = run(MachineStore);
    const saved = Effect.runSync(store.saveDefinition(defInput()));
    const read1 = Effect.runSync(store.getDefinition(saved.id));

    // Mutate the read object
    (read1 as unknown as Record<string, unknown>).name = 'MUTATED';

    // Read again — should be unchanged
    const read2 = Effect.runSync(store.getDefinition(saved.id));
    expect(read2.name).toBe('test-machine');
  });

  it('updateDefinition preserves metadata.createdAt', () => {
    const store = run(MachineStore);
    const saved = Effect.runSync(store.saveDefinition(defInput()));

    const updated = Effect.runSync(
      store.updateDefinition(saved.id, {
        metadata: { description: 'new desc' },
      }),
    );

    expect(updated.metadata.createdAt).toBe(saved.metadata.createdAt);
    expect(updated.metadata.description).toBe('new desc');
  });

  it('updateDefinition preserves id across updates', () => {
    const store = run(MachineStore);
    const saved = Effect.runSync(store.saveDefinition(defInput()));

    const updated = Effect.runSync(store.updateDefinition(saved.id, { name: 'new-name' }));

    expect(updated.id).toBe(saved.id);
  });

  it('successive updates increment version correctly', () => {
    const store = run(MachineStore);
    const saved = Effect.runSync(store.saveDefinition(defInput()));
    expect(saved.version).toBe(1);

    const v2 = Effect.runSync(store.updateDefinition(saved.id, { name: 'v2' }));
    expect(v2.version).toBe(2);

    const v3 = Effect.runSync(store.updateDefinition(saved.id, { name: 'v3' }));
    expect(v3.version).toBe(3);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Instance Tests
// ────────────────────────────────────────────────────────────────────────────

describe('InMemoryMachineStore — Instances', () => {
  it('saves and retrieves an instance', () => {
    const store = run(MachineStore);
    const saved = Effect.runSync(store.saveInstance(instanceInput()));
    const got = Effect.runSync(store.getInstance(saved.id));

    expect(got.id).toBe(saved.id);
    expect(got.definitionId).toBe('def-001');
    expect(got.status).toBe('running');
  });

  it('auto-generates id and timestamps on save', () => {
    const store = run(MachineStore);
    const saved = Effect.runSync(store.saveInstance(instanceInput()));

    expect(saved.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(saved.createdAt).toBeTruthy();
    expect(saved.updatedAt).toBeTruthy();
  });

  it('updateInstance with partial patch works', () => {
    const store = run(MachineStore);
    const saved = Effect.runSync(store.saveInstance(instanceInput()));

    const updated = Effect.runSync(
      store.updateInstance(saved.id, {
        status: 'completed',
        currentState: 'completed',
        output: { result: 42 },
      }),
    );

    expect(updated.status).toBe('completed');
    expect(updated.currentState).toBe('completed');
    expect(updated.output).toEqual({ result: 42 });
    // Original fields preserved
    expect(updated.definitionId).toBe('def-001');
    expect(updated.createdAt).toBe(saved.createdAt);
  });

  it('updateInstance refreshes updatedAt', () => {
    const store = run(MachineStore);
    const saved = Effect.runSync(store.saveInstance(instanceInput()));
    const originalUpdatedAt = saved.updatedAt;

    const updated = Effect.runSync(store.updateInstance(saved.id, { status: 'completed' }));

    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(originalUpdatedAt).getTime(),
    );
  });

  it('getInstance for non-existent id returns NotFoundError', () => {
    const store = run(MachineStore);
    const result = Effect.runSync(Effect.either(store.getInstance('nonexistent')));
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('NotFoundError');
      expect(result.left.entityType).toBe('instance');
    }
  });

  it('updateInstance for non-existent id returns NotFoundError', () => {
    const store = run(MachineStore);
    const result = Effect.runSync(
      Effect.either(store.updateInstance('nonexistent', { status: 'completed' })),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('NotFoundError');
    }
  });

  it('updateInstance preserves id and createdAt', () => {
    const store = run(MachineStore);
    const saved = Effect.runSync(store.saveInstance(instanceInput()));

    const updated = Effect.runSync(
      store.updateInstance(saved.id, { status: 'error', error: 'boom' }),
    );

    expect(updated.id).toBe(saved.id);
    expect(updated.createdAt).toBe(saved.createdAt);
  });

  // ── List with filters ────────────────────────────────────────────────

  describe('listInstances filtering', () => {
    function setupStore() {
      const store = run(MachineStore);
      const i1 = Effect.runSync(
        store.saveInstance(
          instanceInput({
            definitionId: 'def-A',
            status: 'running',
            parentInstanceId: 'parent-1',
          }),
        ),
      );
      const i2 = Effect.runSync(
        store.saveInstance(
          instanceInput({
            definitionId: 'def-A',
            status: 'completed',
          }),
        ),
      );
      const i3 = Effect.runSync(
        store.saveInstance(
          instanceInput({
            definitionId: 'def-B',
            status: 'running',
            parentInstanceId: 'parent-1',
          }),
        ),
      );
      const i4 = Effect.runSync(
        store.saveInstance(
          instanceInput({
            definitionId: 'def-B',
            status: 'error',
          }),
        ),
      );
      return { store, i1, i2, i3, i4 };
    }

    it('returns all instances when no filter', () => {
      const { store } = setupStore();
      const list = Effect.runSync(store.listInstances());
      expect(list).toHaveLength(4);
    });

    it('filters by status', () => {
      const { store } = setupStore();
      const running = Effect.runSync(store.listInstances({ status: 'running' }));
      expect(running).toHaveLength(2);
      expect(running.every((i) => i.status === 'running')).toBe(true);
    });

    it('filters by definitionId', () => {
      const { store } = setupStore();
      const defA = Effect.runSync(store.listInstances({ definitionId: 'def-A' }));
      expect(defA).toHaveLength(2);
      expect(defA.every((i) => i.definitionId === 'def-A')).toBe(true);
    });

    it('filters by parentInstanceId', () => {
      const { store } = setupStore();
      const children = Effect.runSync(store.listInstances({ parentInstanceId: 'parent-1' }));
      expect(children).toHaveLength(2);
      expect(children.every((i) => i.parentInstanceId === 'parent-1')).toBe(true);
    });

    it('supports limit pagination', () => {
      const { store } = setupStore();
      const page = Effect.runSync(store.listInstances({ limit: 2 }));
      expect(page).toHaveLength(2);
    });

    it('supports offset pagination', () => {
      const { store } = setupStore();
      const all = Effect.runSync(store.listInstances());
      const offset = Effect.runSync(store.listInstances({ offset: 2 }));
      expect(offset).toHaveLength(2);
      expect(offset[0].id).toBe(all[2].id);
    });

    it('supports limit + offset together', () => {
      const { store } = setupStore();
      const all = Effect.runSync(store.listInstances());
      const page = Effect.runSync(store.listInstances({ offset: 1, limit: 2 }));
      expect(page).toHaveLength(2);
      expect(page[0].id).toBe(all[1].id);
      expect(page[1].id).toBe(all[2].id);
    });

    it('combines status filter with pagination', () => {
      const { store } = setupStore();
      const page = Effect.runSync(store.listInstances({ status: 'running', limit: 1 }));
      expect(page).toHaveLength(1);
      expect(page[0].status).toBe('running');
    });
  });

  // ── Deep clone isolation ─────────────────────────────────────────────

  it('deep-clones on save so external mutation is isolated', () => {
    const store = run(MachineStore);
    const input = instanceInput();
    const saved = Effect.runSync(store.saveInstance(input));

    // Mutate input after save
    (input as Record<string, unknown>).status = 'error';

    const got = Effect.runSync(store.getInstance(saved.id));
    expect(got.status).toBe('running');
  });

  it('deep-clones on read so returned mutation is isolated', () => {
    const store = run(MachineStore);
    const saved = Effect.runSync(store.saveInstance(instanceInput()));
    const read1 = Effect.runSync(store.getInstance(saved.id));

    (read1 as unknown as Record<string, unknown>).status = 'error';

    const read2 = Effect.runSync(store.getInstance(saved.id));
    expect(read2.status).toBe('running');
  });
});
