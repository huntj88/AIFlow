# Task 04 — Workspace Helpers

> **Phase**: 2 (Infrastructure)
> **Depends on**: Task 01 (server type updates — `WorkspaceContext` interface)
> **Blocks**: Task 05 (runner ActionContext wiring)

---

## Objective

Implement factory functions that construct `WorkspaceContext` objects for both the
user workspace and the artifacts workspace. These are plain objects (not Effect
Services) — the runner creates them and places them on `ActionContext` as
`ctx.workspace` and `ctx.artifactsWorkspace`.

---

## Design Constraints (from feature spec)

1. `workspace.root` is the absolute `workspaceRoot` path provided at instance start.
2. `workspace.resolve('path/to/file')` returns an absolute path within the workspace root.
3. `artifactsWorkspace.root` is `<ARTIFACT_ROOT>/<familyRootInstanceId>/` — a single
   shared directory for the entire family.
4. `artifactsWorkspace.resolve('report.json')` returns an absolute path within the
   family root.
5. **No path traversal enforcement** — the roots are advisory only. Actions may
   write to any path.
6. The artifacts workspace directory is **created on disk** when the root instance starts.

---

## Steps

### 1. Create `server/src/machines/workspace/WorkspaceHelper.ts`

```typescript
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
```

### 2. Create `server/src/machines/workspace/index.ts`

Barrel export:

```typescript
export {
  makeWorkspaceContext,
  makeArtifactsWorkspaceContext,
  computeArtifactsPath,
} from './WorkspaceHelper.js';
```

### 3. Artifacts directory creation

Add an Effect-based utility to ensure the artifacts workspace directory exists on disk:

> **Decision 2:** Use an Effect wrapper so it composes naturally into the runner's
> Effect pipeline without manual wrapping at the call site.

```typescript
import { Effect } from 'effect';
import * as fs from 'node:fs/promises';

export const ensureArtifactsDir = (artifactsPath: string): Effect.Effect<void> =>
  Effect.promise(() => fs.mkdir(artifactsPath, { recursive: true })).pipe(Effect.asVoid);
```

### 4. Unit tests — `server/src/machines/workspace/WorkspaceHelper.test.ts`

Test cases:

- **`makeWorkspaceContext` — root**: returns the provided absolute path
- **`makeWorkspaceContext` — resolve**: resolves relative paths against root
  - `resolve('file.txt')` → `<root>/file.txt`
  - `resolve('sub/dir/file.txt')` → `<root>/sub/dir/file.txt`
  - `resolve('../escape')` → resolves to a path outside root (no enforcement)
- **`makeArtifactsWorkspaceContext` — root**: returns `<artifactRoot>/<familyRootInstanceId>/`
- **`makeArtifactsWorkspaceContext` — resolve**: resolves relative paths
  - `resolve('report.json')` → `<root>/report.json`
  - `resolve('children/child-123/file.json')` → `<root>/children/child-123/file.json`
- **`computeArtifactsPath`**: returns the family root path
- **`ensureArtifactsDir`**: creates the directory on disk; idempotent (second call
  succeeds without error)
- **Same family root for parent and child**: both `makeArtifactsWorkspaceContext`
  calls with the same `familyRootInstanceId` produce the same `root`

---

## Behavior Spec Coverage

- **§15.1** — `ctx.workspace.root` returns the absolute workspace path; `resolve()` works
- **§15.2** — `ctx.artifactsWorkspace.root` returns the family root; `resolve()` works
- **§15.3** — No path traversal restrictions (resolve allows `../`)
- **§15.4** — Shared family root for all instances in same family (same `familyRootInstanceId`)

---

## Validation Checklist

- [ ] `makeWorkspaceContext()` returns correct `root` and `resolve()`
- [ ] `makeArtifactsWorkspaceContext()` returns correct `root` and `resolve()`
- [ ] `computeArtifactsPath()` returns `<ARTIFACT_ROOT>/<familyRootInstanceId>`
- [ ] `ensureArtifactsDir()` creates directory recursively
- [ ] No path traversal enforcement — `resolve('../x')` returns a valid path
- [ ] Unit tests pass: `pnpm --filter @aiflow/server run test`
