# Task 08 — Artifact Store

> **Phase**: 1 (Core Engine)
> **Depends on**: Task 01 (types)
> **Blocks**: Task 09 (runner core), Task 20 (API artifacts)

---

## Objective

Implement the `ArtifactStoreFactory` Effect Service and the filesystem-backed `ArtifactStore` implementation. The artifact store provides sandboxed file operations scoped to each machine instance, with hierarchical storage mirroring parent-child instance relationships. Security: all path traversal attempts are rejected.

---

## Steps

### 1. Create `server/src/machines/artifacts/ArtifactStoreFactory.ts`

Define the Effect Service Tag:

```typescript
interface ArtifactStoreFactory {
  makeScoped(instanceId: string, stateName: string, parentInstanceId?: string): ArtifactStore;
}
```

The factory differs from the typical Effect singleton — the runner creates a new scoped `ArtifactStore` per state execution. The `stateName` is captured so `ArtifactRecord.stateName` is populated on write.

### 2. Create `server/src/machines/artifacts/FsArtifactStore.ts`

Filesystem-backed implementation using `node:fs/promises`:

#### Directory structure

```
<ARTIFACT_ROOT>/
  <instanceId>/
    report.pdf
    children/
      <childInstanceId>/
        results.csv
        children/
          <grandchildId>/
            ...
```

- `ARTIFACT_ROOT` configurable via env var (default: `./data/artifacts`)
- Instance with a `parentInstanceId` → nested under `<ARTIFACT_ROOT>/<parentId>/children/<instanceId>/`
- Instance without parent → `<ARTIFACT_ROOT>/<instanceId>/`

#### Security — Path traversal prevention

Before any file operation, validate the filename:

- Reject filenames containing `../`
- Reject filenames starting with `/` (absolute paths)
- Reject filenames containing `\` (Windows path separators)
- Resolve the full path and verify it starts with the instance's directory

#### Methods

- `write(name, content, metadata?)` — Creates directories as needed, writes file, returns `ArtifactRecord` with `name`, `instanceId`, `stateName`, `size`, `createdAt`
- `read(name)` — Reads file content, returns `Buffer`; fails with `NotFoundError` if missing
- `list()` — Lists artifact files in this instance's directory (not children)
- `readChild(childInstanceId, name)` — Validates `childInstanceId` is a descendant (walk `parentInstanceId` chain via store), then reads from child's artifact directory. Rejects with `NotFoundError` if not a descendant.
- `listChild(childInstanceId)` — Lists artifacts from a child instance
- `resolvePath(name)` — Returns absolute filesystem path for an artifact

### 3. Create `server/src/machines/artifacts/ArtifactTreeBuilder.ts`

Utility to build the recursive `ArtifactTree` from an instance and its descendants:

```typescript
const buildArtifactTree = (
  instanceId: string,
  store: MachineStore,
): Effect.Effect<ArtifactTree, NotFoundError>
```

- Loads the instance
- Collects `artifacts[]` from the instance
- Finds all child instances via `listInstances({ parentInstanceId: instanceId })`
- Recursively builds `ArtifactTree` for each child
- Returns the tree structure

### 4. Layer

```typescript
export const FsArtifactStoreLive = Layer.succeed(ArtifactStoreFactory, { ... });
```

### 5. Unit tests — `server/src/machines/artifacts/ArtifactStore.test.ts`

- Write and read a file
- `ArtifactRecord` has correct `name`, `instanceId`, `stateName`, `size`, `createdAt`
- List returns all written artifacts
- Read non-existent file → error
- Write with `../` in filename → rejected
- Write with absolute path → rejected
- `readChild` with valid child → success
- `readChild` with non-descendant ID → `NotFoundError`
- `listChild` returns child's artifacts
- Parent artifacts at `<ARTIFACT_ROOT>/<parentId>/`
- Child artifacts at `<ARTIFACT_ROOT>/<parentId>/children/<childId>/`
- Grandchild nesting works correctly
- `ArtifactTreeBuilder` builds correct recursive tree

---

## Behavior Spec Coverage

- §15.1 — Write creates file on disk at correct path; `ArtifactRecord` has correct fields
- §15.1 — Read retrieves file content; list returns instance artifacts
- §15.2 — `../` rejected; absolute path rejected; non-descendant readChild rejected
- §15.3 — Parent reads child artifact after child completes; reads parallel children's artifacts
- §15.4 — `?tree=true` returns recursive `ArtifactTree` (tree builder tested here; API in Task 20)
- §15.5 — Directory structure: parent at root, child under `children/`, grandchild nested further

---

## Validation Checklist

- [ ] `server/src/machines/artifacts/ArtifactStoreFactory.ts` defines Effect Service Tag
- [ ] `server/src/machines/artifacts/FsArtifactStore.ts` implements filesystem operations
- [ ] `server/src/machines/artifacts/ArtifactTreeBuilder.ts` builds recursive tree
- [ ] Path traversal (`../`, absolute paths) is rejected
- [ ] Directory structure mirrors instance hierarchy
- [ ] `readChild` validates descendant relationship via store
- [ ] `ARTIFACT_ROOT` is configurable via environment variable
- [ ] Unit tests pass for write, read, list, security, and tree
- [ ] `pnpm --filter @aiflow/server run test` passes
