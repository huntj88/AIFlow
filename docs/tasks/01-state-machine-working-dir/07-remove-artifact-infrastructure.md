# Task 07 — Remove Artifact Infrastructure (Server)

> **Phase**: 4 (Cleanup)
> **Depends on**: Task 01 (type updates — artifact types removed/deprecated),
> Task 05 (runner no longer uses ArtifactStoreFactory)
> **Blocks**: Task 08 (remove artifact API & events)

---

## Objective

Delete the entire server-side artifact infrastructure: `ArtifactStoreFactory`,
`FsArtifactStore`, `ArtifactTreeBuilder`, and all related tests. Remove the
`ArtifactStoreFactory` Effect Service Tag and Layer from the server composition root.

---

## Current State

### Files to delete

```
server/src/machines/artifacts/
  ArtifactStoreFactory.ts    — Effect Service Tag
  FsArtifactStore.ts         — Filesystem implementation (387 lines)
  ArtifactTreeBuilder.ts     — Recursive tree builder
  ArtifactStore.test.ts      — Unit tests
  index.ts                   — Barrel exports
```

### References to remove

- **Runner**: `ArtifactStoreFactory` is (was) an injected dependency. After Task 05,
  the runner no longer uses it, but the Layer composition may still provide it.
- **Server composition root** (`server/src/index.ts` or Layer composition): provides
  `FsArtifactStoreLive` Layer — must be removed.
- **Route handlers** (`server/src/routes/machines/instances.ts`): import
  `ArtifactStoreFactory` for artifact download/list routes — removed in Task 08.
- **Types** (`server/src/machines/types.ts`): `ArtifactStore`, `ArtifactRecord`,
  `ArtifactMetadata`, `ArtifactTree` — should already be removed/deprecated by Task 01.

---

## Steps

### 1. Delete the artifacts directory

Remove the entire `server/src/machines/artifacts/` directory:

```
rm -rf server/src/machines/artifacts/
```

### 2. Remove `FsArtifactStoreLive` from server composition

Find the Layer composition in the server entry point (likely `server/src/index.ts`
or a dedicated Layer file) and remove the `FsArtifactStoreLive` Layer.

Look for patterns like:

```typescript
import { FsArtifactStoreLive } from './machines/artifacts/index.js';
// ...
const mainLayer = Layer.mergeAll(
  InMemoryMachineStoreLive,
  DefaultActionRegistryLive,
  FsArtifactStoreLive, // ← REMOVE THIS
  // ...
);
```

### 3. Remove artifact imports from the runner

If any residual imports remain in `StateMachineRunner.ts` after Task 05:

```typescript
// REMOVE:
import { ArtifactStoreFactory } from './artifacts/index.js';
```

### 4. Verify no remaining imports

Search the codebase for any remaining references to:

- `ArtifactStoreFactory`
- `FsArtifactStore`
- `FsArtifactStoreLive`
- `ArtifactTreeBuilder`
- `buildArtifactTree`

Any remaining references in route handlers will be addressed in Task 08.

### 5. Remove artifact types if not already removed

If Task 01 marked them as `@deprecated` rather than deleting:

- Remove `ArtifactStore` interface from `types.ts`
- Remove `ArtifactRecord` interface from `types.ts`
- Remove `ArtifactMetadata` interface from `types.ts`
- Remove `ArtifactTree` interface from `types.ts`

### 6. Clean up test fixtures

Remove any test fixtures or helpers that create artifact stores:

- Search for `ArtifactStoreFactory` in test files
- Search for `makeScoped` calls in test files
- Update any test Layer compositions that included `FsArtifactStoreLive`

### 7. Remove artifact data directory handling

If there is startup code that creates the `data/artifacts` directory, review
whether it should remain (the workspace helpers now handle directory creation)
or be removed.

The `ARTIFACT_ROOT` env var and base directory are still used by the workspace
helpers — do NOT remove the base config. Only remove the artifact-specific
store/metadata code.

---

## Behavior Spec Coverage

- **§15.6** — No `ArtifactRecord`, `ArtifactStore`, or `ArtifactTree` types exist in the codebase

---

## Validation Checklist

- [x] `server/src/machines/artifacts/` directory is deleted
- [x] `FsArtifactStoreLive` removed from server Layer composition
- [x] No imports of `ArtifactStoreFactory` remain in server code
- [x] No imports of `FsArtifactStore` or `ArtifactTreeBuilder` remain
- [x] Artifact types (`ArtifactStore`, `ArtifactRecord`, `ArtifactMetadata`, `ArtifactTree`)
      removed from `types.ts`
- [x] `pnpm --filter @aiflow/server exec tsc --noEmit` passes
