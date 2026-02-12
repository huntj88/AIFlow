# Task 05 — Runner ActionContext Wiring

> **Phase**: 3 (Runner)
> **Depends on**: Task 03 (CLI helper), Task 04 (workspace helpers), Task 01 (type updates)
> **Blocks**: Task 06 (child inheritance), Task 15 (tests)

---

## Objective

Update the `StateMachineRunner` to construct the new `ActionContext` with `cli`,
`workspace`, and `artifactsWorkspace` instead of `artifacts`. The runner already
builds `ActionContext` per state — this task replaces the `ArtifactStore` plumbing
with workspace helpers and the CLI helper.

---

## Current State (from runner implementation)

The runner's internal `preamble()` helper currently:

1. Creates a scoped `StateLogger`
2. Creates a scoped `ArtifactStore` via `ArtifactStoreFactory.makeScoped()`
3. Wraps the artifact store to publish `artifact_created` events on write
4. Builds `ActionContext` with `artifacts: wrappedArtifactStore`

The `LoopState` internal type tracks mutable context for the state loop,
including references to the machine instance.

---

## Steps

### 1. Update `LoopState` (internal runner type)

Add workspace-related fields to the mutable loop state so they are available
throughout the state loop:

```typescript
interface LoopState {
  // ... existing fields ...
  workspaceRoot: string;
  familyRootInstanceId: string;
  artifactsPath: string;
}
```

These are populated when the instance is created (in `run()`) or loaded (in `resume()`).

### 2. Update `preamble()` — replace ArtifactStore with workspace helpers

Replace the artifact store creation with workspace and CLI helper construction:

```typescript
// BEFORE (current):
const artifactFactory = yield * ArtifactStoreFactory;
const rawStore = artifactFactory.makeScoped(instanceId, stateName, parentInstanceId);
const artifacts: ArtifactStore = {
  /* wrapper that publishes artifact_created */
};

// AFTER (new):
import { makeCliHelper } from './cli/index.js';
import { makeWorkspaceContext, makeArtifactsWorkspaceContext } from './workspace/index.js';

const cli = makeCliHelper({
  workspaceRoot: loopState.workspaceRoot,
  artifactsRoot: loopState.artifactsPath,
});
const workspace = makeWorkspaceContext(loopState.workspaceRoot);
const artifactsWorkspace = makeArtifactsWorkspaceContext(
  ARTIFACT_ROOT, // base directory from env
  loopState.familyRootInstanceId,
);
```

### 3. Update `ActionContext` construction

Replace the `artifacts` field with the three new fields:

```typescript
// BEFORE:
const ctx: ActionContext = {
  machineInstanceId: loopState.instanceId,
  machineDefId: loopState.definitionId,
  stateName: loopState.currentState,
  stateData: loopState.stateData,
  machineInput: loopState.input,
  parentContext: loopState.parentContext,
  logger: stateLogger,
  artifacts: wrappedArtifactStore,
};

// AFTER:
const ctx: ActionContext = {
  machineInstanceId: loopState.instanceId,
  machineDefId: loopState.definitionId,
  stateName: loopState.currentState,
  stateData: loopState.stateData,
  machineInput: loopState.input,
  parentContext: loopState.parentContext,
  logger: stateLogger,
  cli,
  workspace,
  artifactsWorkspace,
};
```

### 4. Remove `ArtifactStoreFactory` dependency

Remove the `ArtifactStoreFactory` from the runner's injected dependencies:

- Remove it from the Layer constructor
- Remove the `yield* ArtifactStoreFactory` call in `preamble()`
- Remove any `artifact_created` event publishing in the artifact store wrapper
- Remove the import of `ArtifactStoreFactory`

### 5. Remove `artifact_created` event publishing

The runner currently publishes `artifact_created` events when the wrapped
artifact store's `write()` method is called. Remove this entirely — there is
no artifact tracking in the new model.

### 6. Update `run()` — populate workspace fields on instance creation

When creating the initial `MachineInstance` in `run()`:

```typescript
// Instance creation (Checkpoint 1):
const instance =
  yield *
  store.saveInstance({
    definitionId: def.id,
    definitionVersion: def.version,
    status: 'running',
    currentState: def.initialState,
    stateData: input,
    input,
    history: [],
    logs: [],
    // REMOVED: artifacts: [],
    workspaceRoot: opts.workspaceRoot, // NEW — from RunOptions
    familyRootInstanceId: instanceId, // NEW — root instance = self
    artifactsPath: computeArtifactsPath(ARTIFACT_ROOT, instanceId), // NEW
  });
```

### 7. Update `RunOptions`

Add `workspaceRoot` and `familyRootInstanceId` to `RunOptions`:

```typescript
interface RunOptions {
  timeoutMs?: number;
  parentInstanceId?: string;
  parentStateName?: string;
  depth?: number;
  workspaceRoot: string; // NEW — required
  familyRootInstanceId?: string; // NEW — set for child instances
}
```

For root instances, `familyRootInstanceId` defaults to the instance's own ID.
For child instances, it's inherited from the parent (see Task 06).

### 8. Create artifacts directory on root instance start

When creating a root instance (no `parentInstanceId`), ensure the artifacts
directory exists:

```typescript
yield * ensureArtifactsDir(computeArtifactsPath(ARTIFACT_ROOT, instanceId));
```

### 9. Update `resume()` — populate workspace fields from persisted instance

When resuming, the `workspaceRoot`, `familyRootInstanceId`, and `artifactsPath`
are already persisted on the `MachineInstance`. Populate `LoopState` from them:

```typescript
const loopState: LoopState = {
  // ... existing fields from persisted instance ...
  workspaceRoot: instance.workspaceRoot,
  familyRootInstanceId: instance.familyRootInstanceId,
  artifactsPath: instance.artifactsPath,
};
```

### 10. Get `ARTIFACT_ROOT` from environment

Use the existing `ARTIFACT_ROOT` environment variable (or default `./data/artifacts`)
that was used by the old `FsArtifactStore`:

```typescript
const ARTIFACT_ROOT = process.env.ARTIFACT_ROOT ?? './data/artifacts';
```

---

## Behavior Spec Coverage

- **§4.1** — Instance created with `workspaceRoot`, `familyRootInstanceId`, `artifactsPath`
- **§15.1** — `ctx.workspace.root` and `ctx.workspace.resolve()` available to actions
- **§15.2** — `ctx.artifactsWorkspace.root` and `ctx.artifactsWorkspace.resolve()` available
- **§15.3** — No restrictions on artifact file operations
- **§16.1–16.3** — `ctx.cli` available to actions with correct env vars and cwd

---

## Validation Checklist

- [ ] `ActionContext` constructed with `cli`, `workspace`, `artifactsWorkspace` — no `artifacts`
- [ ] `ArtifactStoreFactory` no longer injected into the runner
- [ ] No `artifact_created` events published
- [ ] `LoopState` tracks `workspaceRoot`, `familyRootInstanceId`, `artifactsPath`
- [ ] `RunOptions` includes `workspaceRoot` (required) and `familyRootInstanceId` (optional)
- [ ] Root instance creation sets `familyRootInstanceId = id`
- [ ] Artifacts directory created on disk for root instances
- [ ] Resume loads workspace fields from persisted instance
- [ ] `pnpm --filter @aiflow/server exec tsc --noEmit` passes
