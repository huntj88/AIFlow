# Task 12 — Machine Runner — Parallel Children

> **Phase**: 1 (Core Engine)
> **Depends on**: Task 11 (single child spawning)
> **Blocks**: Task 17 (tests)

---

## Objective

Extend the `StateMachineRunner` to handle `parallel_children` state type. The runner spawns N child machines concurrently, waits for all to complete, collects results into a `ParallelChildrenResult`, and then executes the parent state's `actionId` with the collected results.

---

## Implementation Notes from Completed Tasks

> These details emerged from Tasks 06–09 and affect this task's implementation.

### Runner state loop branching (Task 09 → modified in Task 11)

By Task 11, the state loop will have a type-based branch (`action` / `child_machine` / `parallel_children`). This task adds the `parallel_children` branch. Follow the same pattern established in Task 11.

### Runner `run()` returns `MachineResult` (fixed in Task 10)

By Task 10, `run()` should return `MachineResult` on both success and error (never fail the Effect for action errors). This means each child's `run()` call always resolves to a `MachineResult`, making `all_settled` straightforward — use `Effect.forEach` and each child returns a result. For `all_or_interrupt`, catch `MachineError` failures from validation/store errors and interrupt siblings.

### `ArtifactStoreFactory.makeScoped` is synchronous (Task 08)

`makeScoped(instanceId, stateName, parentInstanceId?)` returns an `ArtifactStore` directly (not an Effect). Each child gets its own scoped store with the parent instance ID for hierarchical directory layout.

### `MiddlewareExecutor` runs independently per state (Task 07)

Middleware fires per state transition. Each child machine runs its own middleware hooks. The parent's middleware runs when the parent's action executes after children complete.

---

## Steps

### 1. Implement `parallel_children` handling in the state loop

When `currentState.type === 'parallel_children'`:

1. **Evaluate each child's `inputMapping`** via `jsonpath-plus` against `{ stateData, machineInput, stateName }`
2. **Set parent status** to `'waiting_for_child'`
3. **Set parent `childInstanceIds`** — `Record<string, string>` mapping each child's `key` to its instance ID (persisted for resume)
4. **Spawn all children** concurrently:

   ```typescript
   const children = state.children!; // ChildSpawnDefinition[]

   // Based on parallelMode:
   if (state.parallelMode === 'all_settled') {
     // Use Effect.allSettled — wait for all regardless of failures
     const results =
       yield *
       Effect.forEach(children, (child) => runChild(child).pipe(Effect.either), {
         concurrency: 'unbounded',
       });
   } else {
     // Default: 'all_or_interrupt' — first failure interrupts the rest
     const results =
       yield *
       Effect.all(
         children.map((child) => runChild(child)),
         { concurrency: 'unbounded' },
       );
   }
   ```

5. **Collect results** into `ParallelChildrenResult`:

   ```typescript
   {
     results: Record<string, MachineResult>,  // keyed by child.key
     childInstanceIds: Record<string, string>, // keyed by child.key
   }
   ```

6. **Execute parent's `actionId`** with `ctx.stateData = parallelChildrenResult`
7. **Continue parent's state loop** based on action's `TransitionResult`

### 2. Implement `all_or_interrupt` mode (default)

- Use Effect's fiber model: spawn each child as a fiber
- If any child errors, interrupt remaining child fibers
- Interrupted children end with `status: 'cancelled'`
- Parent receives partial results (one error, others cancelled)
- The parent's action decides the transition based on results

### 3. Implement `all_settled` mode

- Use `Effect.forEach` with `Effect.either` to capture both success and failure
- All children run to completion regardless of individual failures
- Parent receives all results: some completed, some errored
- No child is interrupted due to another child's failure

### 4. Different children receive different inputs

Each child in `children[]` has its own `inputMapping` JSONPath expression. Evaluate each against the parent's context to produce different inputs for different children (e.g., regional data slices).

### 5. Key uniqueness and result keying

- Results are keyed by `ChildSpawnDefinition.key`
- Keys are validated as unique by the Definition Validator (Rule 14, Task 03)
- The action identifies which child produced which result by key

### 6. Record parallel children info in `TransitionRecord`

The parent's `TransitionRecord` for the `parallel_children` state includes:

- `childInstanceIds` — `Record<string, string>` mapping key → instanceId

---

## Behavior Spec Coverage

- §9.1 — `parallel_children` spawns N children, all visible in instances
- §9.1 — Parent's `childInstanceIds` keyed by child `key`
- §9.1 — All children run and complete; results keyed by `key`
- §9.1 — Parent's `actionId` runs after all complete; each result has `status: 'completed'`
- §9.2 — `all_or_interrupt`: one error → remaining interrupted (cancelled); parent gets partial results
- §9.3 — `all_settled`: one error → remaining continue; parent gets all results
- §9.4 — Each child's `inputMapping` extracts correct input; different children get different inputs
- §9.5 — Results keyed by `key`; no collisions; action identifies results by key

---

## Validation Checklist

- [x] `parallel_children` spawns all children concurrently
- [x] `all_or_interrupt` mode interrupts siblings on first failure
- [x] `all_settled` mode waits for all children regardless of failures
- [x] `ParallelChildrenResult` has correct `results` and `childInstanceIds` keying
- [x] Each child receives its own input from its `inputMapping`
- [x] Parent's `actionId` executes after all children complete
- [x] Interrupted children have `status: 'cancelled'`
- [x] `TransitionRecord` includes `childInstanceIds`
- [x] `pnpm --filter @aiflow/server run build` succeeds
