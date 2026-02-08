/**
 * InMemoryMachineStore — In-memory implementation (Task 04)
 *
 * Uses two `Map`s to store definitions and instances. Deep-clones
 * objects on read/write to prevent mutation bugs. Suitable for
 * development and testing; swap for a durable Layer in production.
 *
 * @module
 */

import { Effect, Layer } from 'effect';

import type { InstanceFilter, MachineInstance, StateMachineDefinition } from '../types.js';
import { mkNotFoundError, mkStoreError } from '../types.js';
import type { MachineStore } from './MachineStore.js';
import { MachineStore as MachineStoreTag } from './MachineStore.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Deep-clone via structured clone (available in Node ≥ 17). */
function clone<T>(value: T): T {
  return structuredClone(value);
}

function isoNow(): string {
  return new Date().toISOString();
}

// ────────────────────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────────────────────

function makeInMemoryMachineStore(): MachineStore {
  const definitions = new Map<string, StateMachineDefinition>();
  const instances = new Map<string, MachineInstance>();

  return {
    // ── Definitions ──────────────────────────────────────────────────────

    saveDefinition(input) {
      return Effect.try({
        try: () => {
          const now = isoNow();
          const def: StateMachineDefinition = {
            ...input,
            id: crypto.randomUUID(),
            version: 1,
            metadata: {
              createdAt: input.metadata?.createdAt ?? now,
              updatedAt: input.metadata?.updatedAt ?? now,
              description: input.metadata?.description,
              tags: input.metadata?.tags,
            },
          };
          definitions.set(def.id, clone(def));
          return clone(def);
        },
        catch: (cause) => mkStoreError({ operation: 'saveDefinition', cause }),
      });
    },

    getDefinition(id) {
      return Effect.suspend(() => {
        const def = definitions.get(id);
        if (!def) {
          return Effect.fail(mkNotFoundError({ entityType: 'definition', id }));
        }
        return Effect.succeed(clone(def));
      });
    },

    listDefinitions() {
      return Effect.try({
        try: () => [...definitions.values()].map(clone),
        catch: (cause) => mkStoreError({ operation: 'listDefinitions', cause }),
      });
    },

    updateDefinition(id, patch) {
      return Effect.suspend(() => {
        const existing = definitions.get(id);
        if (!existing) {
          return Effect.fail(mkNotFoundError({ entityType: 'definition', id }));
        }

        const now = isoNow();
        const updated: StateMachineDefinition = {
          ...existing,
          ...patch,
          id: existing.id, // immutable
          version: existing.version + 1,
          metadata: {
            ...existing.metadata,
            ...patch.metadata,
            createdAt: existing.metadata.createdAt, // immutable
            updatedAt: now,
          },
        };

        definitions.set(id, clone(updated));
        return Effect.succeed(clone(updated));
      });
    },

    deleteDefinition(id) {
      return Effect.suspend(() => {
        if (!definitions.has(id)) {
          return Effect.fail(mkNotFoundError({ entityType: 'definition', id }));
        }
        definitions.delete(id);
        return Effect.void;
      });
    },

    // ── Instances ────────────────────────────────────────────────────────

    saveInstance(input) {
      return Effect.try({
        try: () => {
          const now = isoNow();
          const inst: MachineInstance = {
            ...input,
            id: crypto.randomUUID(),
            createdAt: now,
            updatedAt: now,
          };
          instances.set(inst.id, clone(inst));
          return clone(inst);
        },
        catch: (cause) => mkStoreError({ operation: 'saveInstance', cause }),
      });
    },

    getInstance(id) {
      return Effect.suspend(() => {
        const inst = instances.get(id);
        if (!inst) {
          return Effect.fail(mkNotFoundError({ entityType: 'instance', id }));
        }
        return Effect.succeed(clone(inst));
      });
    },

    listInstances(filter?: InstanceFilter) {
      return Effect.try({
        try: () => {
          let result = [...instances.values()];

          if (filter?.status) {
            result = result.filter((i) => i.status === filter.status);
          }
          if (filter?.definitionId) {
            result = result.filter((i) => i.definitionId === filter.definitionId);
          }
          if (filter?.parentInstanceId) {
            result = result.filter((i) => i.parentInstanceId === filter.parentInstanceId);
          }

          // Pagination
          const offset = filter?.offset ?? 0;
          if (offset > 0) {
            result = result.slice(offset);
          }
          if (filter?.limit !== undefined && filter.limit >= 0) {
            result = result.slice(0, filter.limit);
          }

          return result.map(clone);
        },
        catch: (cause) => mkStoreError({ operation: 'listInstances', cause }),
      });
    },

    updateInstance(id, patch) {
      return Effect.suspend(() => {
        const existing = instances.get(id);
        if (!existing) {
          return Effect.fail(mkNotFoundError({ entityType: 'instance', id }));
        }

        const now = isoNow();
        const updated: MachineInstance = {
          ...existing,
          ...patch,
          id: existing.id, // immutable
          createdAt: existing.createdAt, // immutable
          updatedAt: now,
        };

        instances.set(id, clone(updated));
        return Effect.succeed(clone(updated));
      });
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Layer
// ────────────────────────────────────────────────────────────────────────────

/**
 * An Effect `Layer` that provides an in-memory `MachineStore`.
 * Each `Layer.build` creates a fresh isolated store.
 */
export const InMemoryMachineStoreLive: Layer.Layer<MachineStore> = Layer.sync(
  MachineStoreTag,
  makeInMemoryMachineStore,
);
