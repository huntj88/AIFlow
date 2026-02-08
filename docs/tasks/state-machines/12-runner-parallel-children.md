# Task 12 — Machine Runner — Parallel Children

> **Phase**: 1 (Core Engine)
> **Depends on**: Task 11 (single child spawning)
> **Blocks**: Task 17 (tests)

---

## Objective

Extend the `StateMachineRunner` to handle `parallel_children` state type. The runner spawns N child machines concurrently, waits for all to complete, collects results into a `ParallelChildrenResult`, and then executes the parent state's `actionId` with the collected results.

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

- [ ] `parallel_children` spawns all children concurrently
- [ ] `all_or_interrupt` mode interrupts siblings on first failure
- [ ] `all_settled` mode waits for all children regardless of failures
- [ ] `ParallelChildrenResult` has correct `results` and `childInstanceIds` keying
- [ ] Each child receives its own input from its `inputMapping`
- [ ] Parent's `actionId` executes after all children complete
- [ ] Interrupted children have `status: 'cancelled'`
- [ ] `TransitionRecord` includes `childInstanceIds`
- [ ] `pnpm --filter @aiflow/server run build` succeeds
