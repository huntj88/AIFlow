# Task 13 — Machine Runner — Global Execution Semaphore

> **Phase**: 1 (Core Engine)
> **Depends on**: Task 09 (runner core), Task 11 (single child), Task 12 (parallel children)
> **Blocks**: Task 17 (tests)

---

## Objective

Implement the global `Semaphore`-based concurrency control for machine execution. The semaphore bounds the number of **actively executing** machines (running an action or processing a transition). The critical design: parents **release their permit before waiting** for children (release-before-wait pattern), preventing deadlock on recursive spawning.

---

## Implementation Notes from Completed Tasks

> These details emerged from Tasks 01–09 and affect this task's implementation.

- **Effect Service pattern**: Use `Context.GenericTag<Semaphore.Semaphore>('ExecutionSemaphore')` — same pattern as `MachineStore` and `ActionRegistry`. Both the tag and the interface can share a variable name.
- **`Semaphore`** is available from `effect` package directly: `import { Semaphore } from 'effect';`.

### Runner Layer does NOT currently depend on the semaphore (Task 09)

`StateMachineRunnerLive` currently depends on: `MachineStore`, `ActionRegistry`, `ArtifactStoreFactory`, `MiddlewareExecutor`. **The semaphore must be added as a new dependency.** Either:

- Add `ExecutionSemaphore` to the `yield*` block in `StateMachineRunnerLive`, or
- Wrap the state loop externally with `semaphore.withPermits(1)(...)`

The state loop in the runner is a single `while` loop inside `Effect.gen`. To wrap individual steps in `withPermits`, the loop body needs to be extracted into a separate function that can be wrapped.

### Active computation scope in the runner (Task 09)

The current loop body includes these steps per state:

1. Checkpoint 2 (persist) — **active**
2. Create StateLogger and ArtifactStore — **active**
3. Build ActionContext — **active**
4. Fetch latest instance for middleware — **active**
5. Run middleware `beforeTransition` — **active**
6. Look up action — **active**
7. Execute action — **active**
8. Validate transition — **active**
9. Run middleware `afterTransition` — **active**
10. Record history, collect logs — **active**
11. Checkpoint 3 (persist) — **active**

All of these are "active computation" and should hold the semaphore permit. The permit is released only when waiting for children (Tasks 11/12).

### Middleware `runOnError` never fails (Task 07)

`MiddlewareExecutor.runOnError()` returns `Effect.Effect<void>` with no error channel — individual hook errors are swallowed. Safe to call inside semaphore-protected blocks.

---

## Steps

### 1. Create the execution semaphore Layer

```typescript
// server/src/machines/ExecutionSemaphore.ts
import { Context, Effect, Layer, Semaphore } from 'effect';

const MAX_CONCURRENT_MACHINES = Number(process.env.MAX_CONCURRENT_MACHINES ?? 50);

const ExecutionSemaphore = Context.GenericTag<Semaphore.Semaphore>('ExecutionSemaphore');

export const ExecutionSemaphoreLive = Layer.effect(
  ExecutionSemaphore,
  Semaphore.make(MAX_CONCURRENT_MACHINES),
);
```

### 2. Integrate semaphore into the state loop

The state loop acquires/releases a permit **per step** — not for the entire machine lifetime:

```typescript
const runStateLoop = (instance, definition) =>
  Effect.gen(function* () {
    const semaphore = yield* ExecutionSemaphore;

    while (!isTerminal(instance.currentState)) {
      // Acquire permit for this active step
      const stepResult = yield* semaphore.withPermits(1)(executeStep(instance, definition));

      if (stepResult.type === 'spawn_child') {
        // Permit is already released (withPermits scope ended)
        // Child acquires its own permit when it runs
        const childResult = yield* runChildMachine(stepResult.childDef, stepResult.childInput);
        instance.stateData = childResult;

        // Now run the parent's actionId (re-acquire in next loop iteration)
      }

      if (stepResult.type === 'spawn_parallel_children') {
        // Permit released. Each child independently acquires a permit.
        const childResults = yield* runParallelChildren(stepResult.children);
        instance.stateData = childResults;
      }

      // Re-acquire happens on next loop iteration via withPermits
    }
  });
```

### 3. Key invariant: permit held ONLY during active computation

A permit is held only while:

- Executing an action function
- Evaluating transitions
- Running middleware
- Persisting checkpoints

A permit is **never** held while:

- Waiting for a single child machine
- Waiting for parallel children
- The machine is suspended

### 4. Verify deadlock prevention scenarios

The implementation must support these scenarios without deadlock:

1. **Linked-list recursion** (depth 51+): Machine A spawns B, B spawns C, ... Only the deepest active machine holds a permit. All ancestors released theirs before waiting.

2. **Fan-out** (10 parallel children): Parent releases its 1 permit, 10 children compete for permits. With 50 permits, all 10 start. With 3 free, 3 start, 7 queue.

3. **Mixed nesting** (fan-out where children also spawn children): Works because every wait-for-child releases the permit first.

### 5. Queuing semantics

When a machine (or child) tries to acquire a semaphore permit and none are available:

- The machine **queues** (does not reject)
- It starts when a permit becomes available
- This is the default `Semaphore.withPermits` behavior in Effect

### 6. Configuration

- `MAX_CONCURRENT_MACHINES` env var (default: 50)
- Bounds **active concurrency**, not total in-flight machines
- A parent waiting for children is not "active" and doesn't hold a permit

---

## Behavior Spec Coverage

- §10.1 — Starting more instances than semaphore permits causes queuing (not rejection)
- §10.1 — Queued machines start as permits become available
- §10.1 — Active count never exceeds permit count
- §10.2 — Parent releases permit before child runs (no deadlock)
- §10.2 — 51+ linked-list machines complete without deadlock
- §10.2 — Fan-out: parent releases permit, children compete; parent doesn't hold one while waiting
- §10.2 — Mixed nesting: parallel children that spawn their own children complete without deadlock

---

## Validation Checklist

- [ ] `server/src/machines/ExecutionSemaphore.ts` creates the semaphore Layer
- [ ] `MAX_CONCURRENT_MACHINES` configurable via env var (default: 50)
- [ ] Permit acquired per step, not per machine lifetime
- [ ] Permit released before waiting for any child machine
- [ ] Permit released before waiting for parallel children
- [ ] Excess machines queue (not reject) when no permits available
- [ ] No deadlock in linked-list recursion scenario
- [ ] No deadlock in fan-out scenario
- [ ] No deadlock in mixed nesting scenario
- [ ] `pnpm --filter @aiflow/server run build` succeeds
