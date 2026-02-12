# Task 06 — Runner Child Inheritance & Family Root

> **Phase**: 3 (Runner)
> **Depends on**: Task 05 (runner ActionContext wiring)
> **Blocks**: Task 09 (start-instance API), Task 15 (tests)

---

## Objective

Update the runner's child machine spawning logic to correctly propagate
`workspaceRoot`, `familyRootInstanceId`, and `artifactsPath` from parent to
child instances. Both single-child (`child_machine`) and parallel-children
(`parallel_children`) state types must inherit these values.

---

## Current State

The runner's `executeStateLoop` currently handles two child-spawning branches:

1. **`child_machine` state**: Loads the child definition, evaluates the
   `childInputMapping` JSONPath, then recursively calls `runner.run()` with
   `parentInstanceId` and `parentStateName` in `RunOptions`.

2. **`parallel_children` state**: Iterates `children[]`, loads each child
   definition, evaluates each `inputMapping`, spawns all children
   concurrently, collects results.

Neither branch currently passes `workspaceRoot` or `familyRootInstanceId`.

---

## Steps

### 1. Update single-child spawning (`child_machine`)

When spawning a child via `runner.run()`, pass the parent's workspace fields:

```typescript
// In the child_machine branch of executeStateLoop:
const childResult =
  yield *
  runner.run(childDefinition, childInput, {
    parentInstanceId: loopState.instanceId,
    parentStateName: loopState.currentState,
    depth: (loopState.depth ?? 0) + 1,
    // NEW: inherit from parent
    workspaceRoot: loopState.workspaceRoot,
    familyRootInstanceId: loopState.familyRootInstanceId,
  });
```

### 2. Update parallel-children spawning (`parallel_children`)

Same inheritance for each parallel child:

```typescript
// In the parallel_children branch:
for (const childDef of children) {
  const childResult =
    yield *
    runner.run(childDefinition, childInput, {
      parentInstanceId: loopState.instanceId,
      parentStateName: loopState.currentState,
      depth: (loopState.depth ?? 0) + 1,
      // NEW: inherit from parent
      workspaceRoot: loopState.workspaceRoot,
      familyRootInstanceId: loopState.familyRootInstanceId,
    });
}
```

### 3. Update `run()` — handle inherited vs root family ID

In the runner's `run()` method, when creating the instance:

```typescript
// Determine family root:
// - If opts.familyRootInstanceId is set → child instance, inherit it
// - If not set → root instance, use own ID
const familyRootInstanceId = opts.familyRootInstanceId ?? instanceId;

const instance =
  yield *
  store.saveInstance({
    // ... existing fields ...
    workspaceRoot: opts.workspaceRoot,
    familyRootInstanceId,
    artifactsPath: computeArtifactsPath(ARTIFACT_ROOT, familyRootInstanceId),
  });
```

Note that `artifactsPath` always uses `familyRootInstanceId` (the top-level
root's ID), not the child's own ID. This ensures all family members share the
same artifacts workspace root.

### 4. Verify artifacts path is the same for entire family

The `artifactsPath` for parent and all descendants must be identical:

- Root instance: `artifactsPath = <ARTIFACT_ROOT>/<rootInstanceId>/`
- Child instance: `artifactsPath = <ARTIFACT_ROOT>/<rootInstanceId>/` (same)
- Grandchild: `artifactsPath = <ARTIFACT_ROOT>/<rootInstanceId>/` (same)

The `familyRootInstanceId` chain:

- Root sets `familyRootInstanceId = id`
- Child copies from parent's `familyRootInstanceId`
- Grandchild copies from its parent's `familyRootInstanceId` (which is still the root's ID)

### 5. Update `resume()` for children

When resuming a parent that has a suspended child:

- The child's persisted `workspaceRoot` and `familyRootInstanceId` are already
  correct (they were set at spawn time)
- The child's `resume()` should use the persisted values from the child's own
  `MachineInstance`, not from the parent

### 6. Verify workspace helpers use inherited values

In the child's `preamble()`:

```typescript
// The child's LoopState has the inherited values:
const cli = makeCliHelper({
  workspaceRoot: loopState.workspaceRoot, // same as parent's
  artifactsRoot: loopState.artifactsPath, // same as parent's
});
const workspace = makeWorkspaceContext(loopState.workspaceRoot);
const artifactsWorkspace = makeArtifactsWorkspaceContext(
  ARTIFACT_ROOT,
  loopState.familyRootInstanceId, // same as parent's
);
```

This means the child's `ctx.workspace.root` and `ctx.artifactsWorkspace.root`
are identical to the parent's.

---

## Behavior Spec Coverage

- **§4.1** — `familyRootInstanceId` equals own ID for root instances
- **§4.1** — `artifactsPath` points to `<ARTIFACT_ROOT>/<familyRootInstanceId>/`
- **§8.5** — Child inherits parent's `workspaceRoot`, `familyRootInstanceId`, `artifactsPath`
- **§8.5** — Child's `ctx.workspace.root` = parent's `ctx.workspace.root`
- **§8.5** — Child's `ctx.artifactsWorkspace.root` = parent's `ctx.artifactsWorkspace.root`
- **§9.6** — All parallel children inherit parent's workspace and family root
- **§15.2** — Artifacts workspace root is the same for all instances in the same family
- **§15.4** — Child can access parent artifacts via shared family root

---

## Validation Checklist

- [x] Single-child spawning passes `workspaceRoot` and `familyRootInstanceId` in `RunOptions`
- [x] Parallel-children spawning passes the same values for each child
- [x] Root instance: `familyRootInstanceId = id`
- [x] Child instance: `familyRootInstanceId` = parent's `familyRootInstanceId`
- [x] `artifactsPath` is identical for parent and all descendants
- [x] Child's `ctx.workspace.root` equals parent's workspace root
- [x] Child's `ctx.artifactsWorkspace.root` equals parent's artifacts workspace root
- [x] Resume uses persisted workspace fields from child's own instance
- [ ] `pnpm --filter @aiflow/server exec tsc --noEmit` passes <!-- Blocked: downstream route consumers (instances.ts, artifacts.ts) not yet updated — fixed in Tasks 07-10 -->
