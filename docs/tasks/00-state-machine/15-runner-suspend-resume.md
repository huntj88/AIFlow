# Task 15 — Machine Runner — Suspension, Resume & Startup Recovery

> **Phase**: 1 (Core Engine)
> **Depends on**: Task 09 (runner core), Task 14 (cancellation — fiber tracking)
> **Blocks**: Task 17 (tests), Task 20 (API resume endpoint)

---

## Objective

Implement graceful shutdown (suspend all running instances), the resume protocol (re-enter interrupted state), and optional startup recovery (auto-resume suspended instances). This is the most complex runner feature — it relies on the persistence checkpoints from Task 09 and the fiber tracking from Task 14.

---

## Implementation Notes from Completed Tasks

> These details emerged from Tasks 01–09 and affect this task's implementation.

- **`MachineStore.listInstances`** supports `{ status: 'suspended' }` filter for startup recovery. Also supports `parentInstanceId` filter to find children.
- **`MachineStore.getDefinition`** returns `Effect.Effect<StateMachineDefinition, NotFoundError>`. Use to verify definition still exists and version matches.
- **`MachineStore.updateInstance`** takes `Partial<Omit<MachineInstance, 'id' | 'createdAt'>>`. The store auto-refreshes `updatedAt`.
- **Error constructors**: `mkNotFoundError({ entityType: 'definition' | 'instance', id })`, `mkDefinitionError({ message: 'definition version changed' })`.
- **Server entry** (`server/src/index.ts`): Currently uses `NodeRuntime.runMain` with `ServerLoggerLive`. Shutdown handlers for SIGTERM/SIGINT need to integrate with this existing startup pattern.

### Runner `currentState` is the key to resume (Task 09)

The runner persists `currentState` and `stateData` at **Checkpoint 2** (before action execution). On suspension, the instance will have `currentState` pointing to the state whose action was interrupted. Resume needs to re-enter this state and re-execute the action.

The `history[]` array contains all **completed** transitions. Any transition in history was fully persisted (Checkpoint 3). Resume must NOT re-execute states that have a transition record in history.

### `StateLoggerFactory` is created per-state (Task 09)

The runner creates `createStateLoggerFactory()` inside each loop iteration. On resume, a fresh factory is created for the resumed state — previous log entries were already persisted on the instance.

### Fiber tracking from Task 14 is prerequisite

`suspendAll()` depends on the fiber handle map from Task 14. Each running instance's fiber can be interrupted. The `Effect.onInterrupt` finalizer (from Task 14) needs to be extended to distinguish `'suspended'` from `'cancelled'`.

### `StateMachineRunner` interface additions

After this task, the interface will have all three methods:

```typescript
interface StateMachineRunner {
  run(definition, input, opts?): Effect.Effect<MachineResult, MachineError>;
  cancel(instanceId: string): Effect.Effect<void, NotFoundError | DefinitionError>;
  resume(instanceId: string): Effect.Effect<MachineResult, MachineError>;
  suspendAll(): Effect.Effect<void, MachineError>;
}
```

---

## Steps

### 1. Graceful Shutdown — `suspendAll()`

Add `suspendAll()` to `StateMachineRunner`:

```typescript
suspendAll(): Effect.Effect<void, MachineError>
```

When the server receives `SIGTERM` / `SIGINT`:

1. **Stop accepting new `run()` requests** — set a flag that rejects new calls
2. **For each in-flight instance** (from the fiber handle map):
   a. Interrupt the fiber via `Fiber.interrupt`
   b. The `Effect.onInterrupt` finalizer sets status to `'suspended'` (NOT `'cancelled'`)
   c. If the instance has running children, they are also suspended recursively
3. **Wait for all finalizers** to complete, bounded by `SHUTDOWN_TIMEOUT_MS` (default: 10s, configurable via env var)
4. Proceed with server shutdown

**Critical distinction**: `'suspended'` ≠ `'cancelled'`. Suspended instances are intended to be resumed. Cancelled instances are permanently terminated by explicit user request.

### 2. Modify `Effect.onInterrupt` finalizer

The finalizer from Task 14 needs to distinguish cancellation from suspension. Use a shared `Ref<'cancel' | 'suspend'>` or inspect the cause:

```typescript
Effect.onInterrupt(() =>
  Effect.gen(function* () {
    const reason = isShuttingDown ? 'suspended' : 'cancelled';
    yield* store.updateInstance(instance.id, {
      status: reason,
      currentState: instance.currentState, // Keep at interrupted state
      updatedAt: new Date().toISOString(),
    });
  }),
);
```

Or use separate interrupt mechanisms — `cancel()` uses `Fiber.interrupt` while shutdown uses a `Deferred` signal that the state loop checks.

### 3. Resume Protocol — `resume(instanceId)`

Add `resume()` to `StateMachineRunner`:

```typescript
resume(instanceId: string): Effect.Effect<MachineResult, MachineError>
```

Steps:

1. **Load instance** from store; verify `status === 'suspended'`
   - Any other status → 409 Conflict
2. **Load definition** by `definitionId`
   - If deleted → `NotFoundError`
   - If current version ≠ `instance.definitionVersion` → `DefinitionError` ("definition version changed")
3. **Re-validate definition** (same as fresh `run()`)
4. **Handle child resumption first**:
   - If `childInstanceId` is set (single child):
     - Check child status. If `suspended` → recursively `resume(childInstanceId)` first
     - If child already completed → use stored `MachineResult`
   - If `childInstanceIds` is set (parallel children):
     - Check each child's status. Suspended → resume. Completed → use stored result.
     - Wait for all children to reach terminal state
5. **Set instance status** back to `'running'`
6. **Re-enter `currentState`** — re-execute the state's action as if entering for the first time
   - The persisted `currentState` points to the state whose action was interrupted
   - For `child_machine`/`parallel_children` states where children have now completed: pick up at post-child action execution with `stateData` = child result(s)
   - Already-completed transitions (in `history[]`) are NOT re-executed
7. **Continue normal state loop** from there
8. **Publish `machine_resumed` event** (Task 16)

### 4. Startup Recovery

Implement automatic resume on startup, controlled by `AUTO_RESUME_ON_STARTUP` env var (default: `false`):

```typescript
const startupRecovery = (): Effect.Effect<void, MachineError> =>
  Effect.gen(function* () {
    if (process.env.AUTO_RESUME_ON_STARTUP !== 'true') return;

    const suspended = yield* store.listInstances({ status: 'suspended' });

    // Top-level instances only (no parentInstanceId, or parent not suspended)
    const topLevel = suspended.filter(
      (i) => !i.parentInstanceId || !suspended.some((s) => s.id === i.parentInstanceId),
    );

    // Sort by updatedAt (oldest first)
    topLevel.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

    // Resume sequentially during startup
    for (const instance of topLevel) {
      yield* runner
        .resume(instance.id)
        .pipe(
          Effect.catchAll((error) =>
            store.updateInstance(instance.id, { status: 'error', error: String(error) }),
          ),
        );
    }
  });
```

Rules:

- Only top-level instances are resumed directly (children are resumed by parent's protocol)
- Sorted by `updatedAt` (oldest first)
- Instances that fail to resume (deleted definition, version mismatch) → moved to `'error'` status
- When `AUTO_RESUME_ON_STARTUP=false`, suspended instances remain until manually resumed

### 5. Wire shutdown handler into server

Register `SIGTERM` and `SIGINT` handlers that call `runner.suspendAll()` before the process exits.

---

## Behavior Spec Coverage

- §12.1 — On SIGTERM/SIGINT, running instances suspended (not cancelled)
- §12.1 — `waiting_for_child` instances also suspended; children suspended recursively
- §12.1 — Suspended ≠ cancelled (distinct statuses)
- §12.1 — Server waits for finalizers up to `SHUTDOWN_TIMEOUT_MS`
- §12.2 — Resume suspended instance: status → running → terminal
- §12.2 — Re-enters `currentState`, re-executes action; completed transitions not re-executed
- §12.2 — `machine_resumed` event published
- §12.3 — Resume with single child: child resumed first if suspended; child result used if completed
- §12.4 — Resume with parallel children: mix of suspended/completed children handled
- §12.5 — Resume non-suspended → 409 Conflict
- §12.5 — Resume with changed definition version → `DefinitionError`
- §12.5 — Resume with deleted definition → `NotFoundError`
- §12.6 — `AUTO_RESUME_ON_STARTUP=true`: auto-resume top-level instances, oldest first
- §12.6 — Child instances resumed by parent's protocol (not independently)
- §12.6 — Failed resume → `'error'` status
- §12.6 — `AUTO_RESUME_ON_STARTUP=false`: instances remain suspended
- §13 — Checkpoint 5: status set to `'suspended'` during graceful shutdown

---

## Validation Checklist

- [x] `suspendAll()` method interrupts all in-flight fibers and sets status to `'suspended'`
- [x] `resume()` method implements the full resume protocol
- [x] Resume verifies `status === 'suspended'` (409 for other statuses)
- [x] Resume checks definition exists and version matches
- [x] Resume handles child resumption recursively
- [x] Already-completed transitions are not re-executed
- [x] Startup recovery controlled by `AUTO_RESUME_ON_STARTUP` env var
- [x] Top-level instances resumed first; children via parent protocol
- [x] SIGTERM/SIGINT handlers wired to call `suspendAll()`
- [x] `SHUTDOWN_TIMEOUT_MS` configurable (default: 10s)
- [x] `pnpm --filter @aiflow/server run build` succeeds
