# Task 14 — Machine Runner — Cancellation

> **Phase**: 1 (Core Engine)
> **Depends on**: Task 09 (runner core), Task 11 (single child), Task 12 (parallel children)
> **Blocks**: Task 17 (tests), Task 20 (API cancel endpoint)

---

## Objective

Implement machine instance cancellation. When `cancel(instanceId)` is called, the runner interrupts the instance's Effect fiber, transitions the instance to the `cancelled` terminal state, and recursively cancels any running children. The runner must track fiber handles for each running instance.

---

## Implementation Notes from Completed Tasks

> These details emerged from Tasks 01–05 and affect this task's implementation.

- **`MachineStore.getInstance`** returns `Effect.Effect<MachineInstance, NotFoundError>`. Use to verify instance status before cancellation.
- **`MachineStore.updateInstance`** takes `Partial<Omit<MachineInstance, 'id' | 'createdAt'>>`. The store auto-refreshes `updatedAt`.
- **Error constructors**: `mkNotFoundError({ entityType: 'instance', id })`, `mkDefinitionError({ message })` for 409 Conflict scenarios.
- **For 409 Conflict** on already-terminal instances: Use `mkDefinitionError({ message: 'Cannot cancel instance with status: completed' })` or create a custom error — the API layer (Task 20) maps `DefinitionError` to 400/409 as needed.

---

## Steps

### 1. Add `cancel()` method to `StateMachineRunner`

```typescript
interface StateMachineRunner {
  // ... existing run() ...
  cancel(instanceId: string): Effect.Effect<void, NotFoundError | DefinitionError>;
}
```

### 2. Track fiber handles

The runner maintains an in-memory `Map<string, Fiber.RuntimeFiber<MachineResult, MachineError>>` mapping instance IDs to their running fibers. This map is NOT persisted — it only exists for the lifetime of the process.

- When `run()` is called, fork the execution as a fiber and store the handle
- When the machine completes (any terminal state), remove the fiber handle
- When the process shuts down, all fiber handles are used for suspension (Task 15)

### 3. Implement `cancel()` logic

1. **Look up instance** from `MachineStore`
2. **Verify cancellable status**:
   - `running` or `waiting_for_child` → proceed with fiber interruption
   - `suspended` → skip fiber interruption (no fiber), directly transition to `cancelled`
   - `completed`, `cancelled`, `error` → return **409 Conflict** (via `DefinitionError` or a specific error)
3. **Interrupt the fiber** via `Fiber.interrupt(fiber)`
   - Effect fiber interruption is cooperative — takes effect at next async yield point
4. **Handle `waiting_for_child` status**:
   - **Single child** (`childInstanceId` set): also cancel the child (recursive call to `cancel`)
   - **Parallel children** (`childInstanceIds` set): cancel all children
5. **Finalizer** (`Effect.onInterrupt`): when the fiber is interrupted:
   - Record the cancellation in `history[]` as a transition to `cancelled`
   - Set `instance.status = 'cancelled'`
   - Set `instance.currentState = 'cancelled'`
   - Persist via `MachineStore.updateInstance`

### 4. Register `Effect.onInterrupt` finalizer in `run()`

When the runner starts executing a machine, register a finalizer that handles cancellation:

```typescript
const runMachine = (instance, definition) =>
  stateLoop(instance, definition).pipe(
    Effect.onInterrupt(() =>
      Effect.gen(function* () {
        yield* store.updateInstance(instance.id, {
          status: 'cancelled',
          currentState: 'cancelled',
          updatedAt: new Date().toISOString(),
          history: [...instance.history, cancellationRecord],
        });
      }),
    ),
  );
```

### 5. Child cancellation events

Each cancelled child machine:

- Records its own `status: 'cancelled'`
- Its own `machine_completed` event is published (Task 16)
- Clients subscribed to child instances see the cancellation

### 6. Cancellation idempotency and conflict rules

| Current Status      | Cancel Result                                 |
| ------------------- | --------------------------------------------- |
| `running`           | ✅ Interrupt fiber → `cancelled`              |
| `waiting_for_child` | ✅ Interrupt fiber + children → `cancelled`   |
| `suspended`         | ✅ Direct transition → `cancelled` (no fiber) |
| `completed`         | ❌ 409 Conflict                               |
| `cancelled`         | ❌ 409 Conflict                               |
| `error`             | ❌ 409 Conflict                               |

---

## Behavior Spec Coverage

- §11.1 — Cancel running instance: returns success; transitions to `cancelled`; `currentState` = `'cancelled'`
- §11.2 — Cancel while `waiting_for_child` (single): child also cancelled; both reach `cancelled`
- §11.3 — Cancel while waiting for parallel children: all children interrupted → `cancelled`
- §11.4 — Cancel suspended instance: direct transition to `cancelled` (no fiber)
- §11.5 — Cancel completed/cancelled/errored → 409 Conflict
- §11.6 — Cancellation recorded in `history[]` as transition to `cancelled`
- §6.1 — `machine_completed` event with `status: 'cancelled'` published (event publishing in Task 16)

---

## Validation Checklist

- [ ] `cancel()` method added to `StateMachineRunner`
- [ ] Fiber handle tracking map maintained for running instances
- [ ] `running` instance → fiber interrupted → `cancelled`
- [ ] `waiting_for_child` → child(ren) also cancelled recursively
- [ ] `suspended` → direct transition (no fiber) → `cancelled`
- [ ] Terminal states → 409 Conflict
- [ ] `Effect.onInterrupt` finalizer persists cancellation state
- [ ] Cancellation recorded in transition history
- [ ] Fiber handles cleaned up after terminal state
- [ ] `pnpm --filter @aiflow/server run build` succeeds
