# Task 11 — Machine Runner — Single Child Machine Spawning

> **Phase**: 1 (Core Engine)
> **Depends on**: Task 09 (runner core), Task 10 (errors & timeouts)
> **Blocks**: Task 12 (parallel children), Task 17 (tests)

---

## Objective

Extend the `StateMachineRunner` to handle `child_machine` state type. When the runner encounters a state with `type: 'child_machine'`, it evaluates the `childInputMapping` JSONPath expression, spawns a child machine instance, suspends the parent until the child completes, then executes the parent's `actionId` with the child result as `stateData`.

~~**New server dependency**: `jsonpath-plus` (for evaluating JSONPath expressions).~~

---

## Implementation Notes from Completed Tasks

> These details emerged from Tasks 01–09 and affect this task's implementation.

- **`jsonpath-plus` is ALREADY installed** as a dependency from Task 05 (`transform-data` action). `@types/jsonpath-plus` is also already a devDependency. **Skip Step 1 (install).**
- Import as: `import { JSONPath } from 'jsonpath-plus';` — same as in `server/src/machines/actions/transform-data.ts`.
- **`MachineStore.saveInstance`** takes `Omit<MachineInstance, 'id' | 'createdAt' | 'updatedAt'>` — the store generates `id`, `createdAt`, `updatedAt`. The child instance should include `parentInstanceId: instance.id`.
- **`MachineStore.updateInstance`** takes `Partial<Omit<MachineInstance, 'id' | 'createdAt'>>`. Use this to set `status: 'waiting_for_child'` and `childInstanceId` on the parent.
- **`MachineStore.getDefinition`** returns `Effect.Effect<StateMachineDefinition, NotFoundError>`. Use to load the child definition by `childMachineDefId`.
- **Error constructors**: `mkActionError({ actionId, stateName, cause })`, `mkNotFoundError({ entityType: 'definition', id })` — imported from `'../machines/types.js'`.

### Critical: Runner state loop only handles `action` type (Task 09)

The current state loop in `StateMachineRunner.ts` assumes every non-terminal state is an `action` type. It directly accesses `stateDef.actionId` and fails if missing. **The loop must be extended with a type-based branch:**

```typescript
while (definition.states[currentState].type !== 'terminal') {
  const stateDef = definition.states[currentState];

  if (stateDef.type === 'child_machine') {
    // → child machine spawning logic (this task)
  } else if (stateDef.type === 'parallel_children') {
    // → parallel children logic (Task 12)
  } else {
    // → existing action execution logic
  }
}
```

### Critical: Runner `run()` failure mode (Task 09 → fix in Task 10)

**Currently, the runner's `run()` Effect FAILS on action errors** (via `Effect.fail(machineError)`) instead of returning `MachineResult.error`. Task 10 must fix this so that `run()` always returns a `MachineResult`, because the parent needs to receive child `MachineResult.error` as `stateData` — not catch a failed Effect.

After Task 10 fixes this, a child error will produce `MachineResult { status: 'error' }` which the parent action can inspect and decide the transition.

### `parentContext` and artifact scoping already wired (Task 09)

The runner already builds `parentContext` from `opts?.parentInstanceId` and `opts.parentStateName` and passes it in the `ActionContext`. Artifacts are already scoped with `artifactFactory.makeScoped(instanceId, currentState, opts?.parentInstanceId)` — child machines automatically get parent-scoped artifact directories.

### Import style: relative imports

All files in `server/src/machines/` use **relative imports** (e.g., `'./types.js'`, `'../store/MachineStore.js'`), NOT `@/` aliases. Follow the same pattern.

---

## Steps

### 1. ~~Install `jsonpath-plus`~~ (Already installed — skip)

`jsonpath-plus` and `@types/jsonpath-plus` were already added in Task 05. No action needed.

### 2. Implement child machine spawning in the state loop

When `currentState.type === 'child_machine'`:

1. **Evaluate `childInputMapping`** via `jsonpath-plus`:

   ```typescript
   import { JSONPath } from 'jsonpath-plus';
   const childInput = JSONPath({
     path: state.childInputMapping,
     json: { stateData, machineInput: instance.input, stateName: instance.currentState },
   });
   ```

   - If the JSONPath expression is invalid or returns no result, fail with `ActionError` (not silently produce null)
   - JSONPath root `$` is `{ stateData, machineInput, stateName }`

2. **Set parent status** to `'waiting_for_child'`

3. **Set parent `childInstanceId`** to the child's ID (persisted for resume)

4. **Spawn child machine** — recursive call to `runner.run()`:

   ```typescript
   const childResult =
     yield *
     runner.run(childDefinition, childInput, {
       parentInstanceId: instance.id,
       parentStateName: instance.currentState,
       depth: (opts.depth ?? 0) + 1,
     });
   ```

5. **On child completion**:
   - Set parent `stateData` to the child's `MachineResult`
   - Clear parent `childInstanceId`
   - Execute the parent state's `actionId` with `ctx.stateData = childResult`
   - The action inspects the child result and returns a `TransitionResult`
   - Continue the parent's state loop normally

### 3. Load child definition

Load the child's `StateMachineDefinition` from the `MachineStore` by `childMachineDefId`:

- If not found → fail with `NotFoundError`
- Validate the child definition before running

### 4. Wire `parentContext` in child's `ActionContext`

When running a child machine, each action in the child receives `ctx.parentContext`:

```typescript
parentContext: {
  parentInstanceId: instance.id,
  parentStateName: currentStateName,
}
```

### 5. Record child info in `TransitionRecord`

The parent's `TransitionRecord` for the `child_machine` state should include:

- `childInstanceId` — the child's instance ID
- `childDefinitionId` — the child's definition ID

The child's `TransitionRecord` entries include their own `childInstanceId` and `childDefinitionId` if they in turn spawn children.

### 6. Handle child failure

If the child machine errors:

- The parent's action receives a `MachineResult` with `status: 'error'`
- The parent action can inspect the error and decide the transition (e.g., route to error or retry)
- The parent does NOT automatically fail — it's up to the action to decide

---

## Behavior Spec Coverage

- §8.1 — `child_machine` state spawns child instance with `parentInstanceId`
- §8.1 — Parent status becomes `'waiting_for_child'`; `childInstanceId` is set
- §8.1 — Child completes → parent's `stateData` = child's `MachineResult`
- §8.1 — Parent's `actionId` runs after child completes; parent continues
- §8.1 — Both parent and child end as `completed`
- §8.2 — `childInputMapping` JSONPath correctly extracts child input
- §8.2 — Invalid JSONPath causes parent to error (not silently null)
- §8.3 — Child error → parent action receives `MachineResult` with `status: 'error'`
- §8.4 — Child action's `ctx.parentContext` has `parentInstanceId` and `parentStateName`
- §8.4 — Child's `TransitionRecord` includes `childInstanceId` and `childDefinitionId`
- §8.4 — Parent's `TransitionRecord` for child_machine state includes `childInstanceId`

---

## Validation Checklist

- [x] ~~`jsonpath-plus` is added to server dependencies~~ (already present from Task 05)
- [x] `childInputMapping` JSONPath expression evaluates correctly
- [x] Invalid JSONPath expression → error (not null)
- [x] Parent status changes to `'waiting_for_child'` during child execution
- [x] Child instance has `parentInstanceId` set to parent's ID
- [x] Child result flows into parent's `stateData`
- [x] Parent's `actionId` executes after child completion
- [x] `ctx.parentContext` is populated in child actions
- [x] `TransitionRecord` captures child instance/definition IDs
- [x] Depth is incremented for child machine (`opts.depth + 1`)
- [x] `pnpm --filter @aiflow/server run build` succeeds
