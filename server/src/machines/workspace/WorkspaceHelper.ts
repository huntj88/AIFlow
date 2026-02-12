/**
 * Workspace helpers — factory functions for constructing `WorkspaceContext` objects.
 *
 * These are plain objects placed on `ActionContext` as `ctx.workspace` and
 * `ctx.artifactsWorkspace`. The runner creates them at instance start time.
 *
 * @module
 */

import { Effect } from 'effect';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { WorkspaceContext } from '../types.js';

/**
 * Build a WorkspaceContext for the user workspace.
 */
export function makeWorkspaceContext(workspaceRoot: string): WorkspaceContext {
  return {
    root: workspaceRoot,
    resolve: (relativePath: string) => path.resolve(workspaceRoot, relativePath),
  };
}

/**
 * Build a WorkspaceContext for the artifacts workspace.
 *
 * @param artifactRoot - The base artifacts directory (e.g., `./data/artifacts`).
 * @param familyRootInstanceId - The top-level root instance ID.
 */
export function makeArtifactsWorkspaceContext(
  artifactRoot: string,
  familyRootInstanceId: string,
): WorkspaceContext {
  const root = path.resolve(artifactRoot, familyRootInstanceId);
  return {
    root,
    resolve: (relativePath: string) => path.resolve(root, relativePath),
  };
}

/**
 * Compute the artifacts path for an instance.
 * This is the family root directory: `<ARTIFACT_ROOT>/<familyRootInstanceId>/`.
 */
export function computeArtifactsPath(artifactRoot: string, familyRootInstanceId: string): string {
  return path.resolve(artifactRoot, familyRootInstanceId);
}

/**
 * Ensure the artifacts workspace directory exists on disk.
 * Creates recursively; idempotent — safe to call multiple times.
 */
export const ensureArtifactsDir = (artifactsPath: string): Effect.Effect<void> =>
  Effect.promise(() => fs.mkdir(artifactsPath, { recursive: true })).pipe(Effect.asVoid);
