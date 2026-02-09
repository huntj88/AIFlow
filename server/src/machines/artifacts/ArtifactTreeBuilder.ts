/**
 * ArtifactTreeBuilder — Recursive artifact tree construction (Task 08)
 *
 * Builds a recursive `ArtifactTree` from an instance and all its descendants.
 * Walks the instance hierarchy via `MachineStore.listInstances` and collects
 * artifact records from each instance.
 *
 * @module
 */

import { Effect } from 'effect';

import type { ArtifactTree, NotFoundError, StoreError } from '../types.js';
import type { MachineStore } from '../store/MachineStore.js';

// ────────────────────────────────────────────────────────────────────────────
// Builder
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a recursive `ArtifactTree` for the given instance and all
 * of its descendants.
 *
 * @param instanceId — The root instance to start from
 * @param store — `MachineStore` for instance lookups
 * @returns The `ArtifactTree` structure
 */
export const buildArtifactTree = (
  instanceId: string,
  store: MachineStore,
): Effect.Effect<ArtifactTree, NotFoundError | StoreError> =>
  Effect.gen(function* () {
    // Load the instance
    const instance = yield* store.getInstance(instanceId);

    // Collect artifacts from the instance
    const artifacts = instance.artifacts;

    // Find all direct child instances
    const children = yield* store.listInstances({ parentInstanceId: instanceId });

    // Recursively build tree for each child
    const childTrees: ArtifactTree[] = [];
    for (const child of children) {
      const childTree = yield* buildArtifactTree(child.id, store);
      childTrees.push(childTree);
    }

    // Derive a definition name from the instance
    // (We use definitionId as a fallback since we don't load the definition here)
    const definitionName = instance.definitionId;

    return {
      instanceId: instance.id,
      definitionName,
      artifacts,
      children: childTrees,
    };
  });
