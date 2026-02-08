/**
 * MachineStore — Effect Service definition (Task 04)
 *
 * Defines the `MachineStore` service interface as an Effect `Context.GenericTag`.
 * The store provides persistence for both `StateMachineDefinition` and
 * `MachineInstance` records. The interface is designed so that a durable store
 * (SQLite / Postgres) can be swapped in later without changing consumers.
 *
 * @module
 */

import { Context, Effect } from 'effect';

import type {
  InstanceFilter,
  MachineInstance,
  NotFoundError,
  StateMachineDefinition,
  StoreError,
} from '../types.js';

// ────────────────────────────────────────────────────────────────────────────
// Service Interface
// ────────────────────────────────────────────────────────────────────────────

export interface MachineStore {
  // ── Definitions ──────────────────────────────────────────────────────────

  /**
   * Persist a new definition. The store auto-generates `id` (UUID),
   * sets `version: 1`, and populates `createdAt` / `updatedAt`.
   */
  saveDefinition(
    def: Omit<StateMachineDefinition, 'id' | 'version' | 'metadata'> & {
      metadata?: Partial<StateMachineDefinition['metadata']>;
    },
  ): Effect.Effect<StateMachineDefinition, StoreError>;

  /** Retrieve a definition by ID. */
  getDefinition(id: string): Effect.Effect<StateMachineDefinition, NotFoundError>;

  /** List all stored definitions. */
  listDefinitions(): Effect.Effect<StateMachineDefinition[], StoreError>;

  /**
   * Partially update an existing definition. Increments `version`
   * monotonically and refreshes `updatedAt`.
   */
  updateDefinition(
    id: string,
    patch: Partial<Omit<StateMachineDefinition, 'id' | 'version' | 'metadata'>> & {
      metadata?: Partial<StateMachineDefinition['metadata']>;
    },
  ): Effect.Effect<StateMachineDefinition, NotFoundError>;

  /** Delete a definition by ID. */
  deleteDefinition(id: string): Effect.Effect<void, NotFoundError>;

  // ── Instances ────────────────────────────────────────────────────────────

  /**
   * Persist a new machine instance. The store auto-generates `id`
   * and populates `createdAt` / `updatedAt`.
   */
  saveInstance(
    instance: Omit<MachineInstance, 'id' | 'createdAt' | 'updatedAt'>,
  ): Effect.Effect<MachineInstance, StoreError>;

  /** Retrieve an instance by ID. */
  getInstance(id: string): Effect.Effect<MachineInstance, NotFoundError>;

  /**
   * List instances, optionally filtered by `status`, `definitionId`,
   * `parentInstanceId`, with `limit` / `offset` pagination.
   */
  listInstances(filter?: InstanceFilter): Effect.Effect<MachineInstance[], StoreError>;

  /**
   * Partially update an existing instance. Refreshes `updatedAt`.
   */
  updateInstance(
    id: string,
    patch: Partial<Omit<MachineInstance, 'id' | 'createdAt'>>,
  ): Effect.Effect<MachineInstance, NotFoundError>;
}

// ────────────────────────────────────────────────────────────────────────────
// Service Tag
// ────────────────────────────────────────────────────────────────────────────

export const MachineStore = Context.GenericTag<MachineStore>('MachineStore');
