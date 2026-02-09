/**
 * ArtifactStoreFactory — Effect Service definition (Task 08)
 *
 * Defines the `ArtifactStoreFactory` service interface as an Effect `Context.GenericTag`.
 * The factory creates scoped `ArtifactStore` instances per state execution,
 * capturing `instanceId` and `stateName` so that `ArtifactRecord.stateName`
 * is populated automatically on write.
 *
 * @module
 */

import { Context } from 'effect';

import type { ArtifactStore } from '../types.js';

// ────────────────────────────────────────────────────────────────────────────
// Service Interface
// ────────────────────────────────────────────────────────────────────────────

export interface ArtifactStoreFactory {
  /**
   * Create a scoped `ArtifactStore` for a specific state execution.
   *
   * @param instanceId — The machine instance ID
   * @param stateName — The current state name (captured for `ArtifactRecord.stateName`)
   * @param parentInstanceId — Optional parent instance ID for hierarchical storage
   */
  makeScoped(instanceId: string, stateName: string, parentInstanceId?: string): ArtifactStore;
}

// ────────────────────────────────────────────────────────────────────────────
// Service Tag
// ────────────────────────────────────────────────────────────────────────────

export const ArtifactStoreFactory =
  Context.GenericTag<ArtifactStoreFactory>('ArtifactStoreFactory');
