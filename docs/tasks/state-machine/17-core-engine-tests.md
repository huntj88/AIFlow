# Task 17 — Core Engine Test Suite

> **Phase**: 1 (Core Engine)
> **Depends on**: Tasks 01–16 (all core engine tasks)
> **Blocks**: Phase 2 (REST API)

---

## Objective

Write comprehensive unit and integration tests for the entire core engine. Tests are co-located with source files following the project convention. This task ensures all behavior spec sections §1–§15 (server-side) are covered before moving to the API layer. Each test file should use Effect's test utilities and the `InMemoryMachineStore`.

---

## Implementation Notes from Completed Tasks

> These details emerged from Tasks 01–15 and affect test setup.

### Layer names for test composition

- **`InMemoryMachineStoreLive`** — from `'../store/InMemoryMachineStore.js'` or `'../store/index.js'`
- **`ActionRegistryLive`** — pre-loaded with 5 built-in actions (from `'../ActionRegistry.js'`)
- **`InMemoryActionRegistryLive`** — bare empty registry (from `'../ActionRegistry.js'`)

Tests that need built-in actions use `ActionRegistryLive`; tests that want to register custom test actions use `InMemoryActionRegistryLive`.

### Store method signatures for test setup

```typescript
// saveDefinition takes Omit<> — store generates id, version, timestamps:
const def = yield* store.saveDefinition({
  name: 'test', inputSchema: {}, outputSchema: {},
  states: { ... }, initialState: 'init', transitions: [...],
  metadata: { description: 'test def' },
});
// def.id, def.version (1), def.metadata.createdAt are auto-populated

// saveInstance takes Omit<> — store generates id, createdAt, updatedAt:
const inst = yield* store.saveInstance({
  definitionId: def.id, definitionVersion: def.version,
  status: 'running', currentState: 'init', stateData: {},
  input: {}, history: [], logs: [], artifacts: [],
});
```

### Error constructors in assertions

Use `mk*` constructors: `mkActionError`, `mkDefinitionError`, `mkValidationError`, `mkNotFoundError`, `mkStoreError` — all from `'../types.js'`. Match on `_tag` for error assertions:

```typescript
Expect the effect to fail with an error where error._tag === 'DefinitionError'
```

### Existing test patterns (established in Task 17 implementation)

See `server/src/machines/DefinitionValidator.test.ts`, `ActionRegistry.test.ts`, `store/InMemoryMachineStore.test.ts`, `actions/actions.test.ts`, `StateMachineRunner.test.ts`, and `StateMachineRunner.suspend-resume.test.ts` for established test patterns and helpers.

### Critical: Layer composition for runner tests — **FIVE** dependencies (Tasks 06–15)

The `StateMachineRunnerLive` Layer requires **five dependencies** (not four — `ExecutionSemaphore` was added in Task 13):

1. `MachineStore` — use `InMemoryMachineStoreLive`
2. `ActionRegistry` — use `InMemoryActionRegistryLive` (register custom test actions)
3. `ArtifactStoreFactory` — use `FsArtifactStoreLive` (which itself requires `MachineStore`)
4. `MiddlewareExecutor` — use `makeMiddlewareExecutorLayer([])` (empty middleware for most tests)
5. `ExecutionSemaphore` — use `ExecutionSemaphoreLive` (from `'../ExecutionSemaphore.js'`)

**There is no `MiddlewareExecutorLive` export.** Use the factory function:

```typescript
import { makeMiddlewareExecutorLayer } from '../middleware/MiddlewareExecutor.js';
const TestMiddlewareLayer = makeMiddlewareExecutorLayer([]); // no middleware
```

**Actual working test layer composition** (from the existing test files):

```typescript
import { ExecutionSemaphoreLive } from './ExecutionSemaphore.js';

const makeTestLayer = (middleware: readonly TransitionMiddleware[] = []) =>
  StateMachineRunnerLive.pipe(
    Layer.provide(InMemoryMachineStoreLive),
    Layer.provide(InMemoryActionRegistryLive),
    Layer.provide(FsArtifactStoreLive.pipe(Layer.provide(InMemoryMachineStoreLive))),
    Layer.provide(middleware.length > 0 ? makeMiddlewareExecutorLayer(middleware) : NoMiddleware),
    Layer.provide(ExecutionSemaphoreLive),
    // Merge MachineStore + ActionRegistry so they are accessible in tests
    Layer.provideMerge(InMemoryMachineStoreLive),
    Layer.provideMerge(InMemoryActionRegistryLive),
  );
```

Note: `FsArtifactStoreLive` has type `Layer.Layer<ArtifactStoreFactory, never, MachineStore>` — it requires `MachineStore` in its environment. The pattern `FsArtifactStoreLive.pipe(Layer.provide(InMemoryMachineStoreLive))` satisfies this. The `Layer.provideMerge` calls at the end expose `MachineStore` and `ActionRegistry` to test code via `yield* MachineStore` and `yield* ActionRegistry`.

### `stateData` in the first state is set to `input` (Task 09 — CONFIRMED)

The runner sets `stateData = input` for the first state (both in the `ActionContext` and the persisted instance). The first action receives `ctx.stateData === input` AND `ctx.machineInput === input`. **Tests should verify `ctx.stateData === input` in the first state.**

### `run()` returns `MachineResult` on ALL outcomes (Task 10 — CONFIRMED)

`run()` returns `MachineResult` for both success and error via a mutable `errorResult` pattern:

```typescript
// Action errors → MachineResult returned (Effect does NOT fail):
const result = yield * runner.run(def, input);
// result is MachineResult { status: 'error', error: '...', instanceId: '...' }

// Validation errors (bad inputSchema) → Effect FAILS with MachineError:
const exit = yield * runner.run(def, badInput).pipe(Effect.either);
// exit._tag === 'Left', exit.left._tag === 'ValidationError'
```

Note: `run()` still fails the Effect for pre-execution validation errors (`ValidationError`, `DefinitionError`, depth exceeded) and store errors. Only in-loop action errors return `MachineResult.error`.

### `StateLoggerFactory` is per-state, not a service (Task 06)

The runner creates a new `createStateLoggerFactory()` inside each loop iteration. In tests, you observe logs via the persisted `instance.logs` array (fetched from the store after completion), not by inspecting the factory directly.

### Test helper factories (established in existing test files)

The existing `StateMachineRunner.test.ts` has these helper functions already:

- `registerAction(registry, actionId, nextState, data?)` — simple pass-through action
- `registerBranchAction(registry, actionId, fn)` — custom branching logic
- `registerFailAction(registry, actionId)` — always-failing action
- `registerDelayAction(registry, actionId, delayMs, nextState)` — slow action for timeout tests
- `registerLoggingAction(registry, actionId, nextState, messages)` — action that writes logs
- `makeLinearDef(overrides?)` — A → B → C → completed
- `makeSimpleDef(overrides?)` — start → completed
- `makeBranchingDef(overrides?)` — init → (branch-a | branch-b) → completed | error

### Suspension & resume tests are in a SEPARATE file

`StateMachineRunner.suspend-resume.test.ts` contains all §12 tests (suspend, resume, startup recovery). The main `StateMachineRunner.test.ts` covers §4–§11, §13–§15.

---

## Test Files & Coverage

### 1. `server/src/machines/StateMachineRunner.test.ts`

This is the primary test file. Create test helper factories for building valid definitions:

```typescript
// Helper: build a simple linear definition (A → B → C → completed)
const makeLinearDefinition = (opts?) => ({ ... });

// Helper: build a branching definition
const makeBranchingDefinition = (opts?) => ({ ... });

// Helper: build a parent-child definition
const makeParentChildDefinition = (opts?) => ({ ... });
```

#### Linear Execution (§4)

- [x] Simple linear machine (A → B → C → completed) runs to completion
- [x] Instance has `status: 'completed'` and populated `output`
- [x] Output matches final action's transition `data`
- [x] Initial state action receives `machineInput`; `stateData` in first state is undefined
- [x] When action returns `{ nextState, data }`, next state receives `data` as `stateData`
- [x] Each action receives correct `ctx.stateName`, `ctx.machineInstanceId`, `ctx.machineDefId`

#### Transition History (§4.4)

- [x] `history` is an ordered array of `TransitionRecord`s
- [x] Each record has `fromState`, `toState`, `timestamp`, `durationMs`, `actionId`
- [x] History length equals number of transitions
- [x] Records are in chronological order

#### Logs (§4.5)

- [x] Logs contain all `LogEntry` records emitted during execution
- [x] Each entry has `stateName`, `level`, `message`, `timestamp`
- [x] `ctx.logger.info(...)` produces `level: 'info'`; `ctx.logger.error(...)` produces `level: 'error'`

#### Branching (§5)

- [x] Action inspects `stateData` and returns different `nextState` → machine follows different paths
- [x] Machine can reach `completed` via multiple valid paths
- [x] Machine can reach `error` terminal from any non-terminal state

#### Error Handling (§6)

- [x] Action failure (throws/fails) → machine transitions to `error` terminal
- [x] Instance `error` field contains descriptive message; `status: 'error'`
- [x] Illegal transition (nextState not in transitions[]) → `DefinitionError`
- [x] stateData fails dataSchema validation → error with schema details
- [x] `beforeTransition` middleware failure → error terminal; `onError` hooks fire

#### Timeouts & Depth (§7)

- [x] State with `timeoutMs: 500` + slow action → timeout error
- [x] State without `timeoutMs` → no timeout
- [x] Machine-level timeout → error if not completed in time
- [x] Depth 10 allowed; depth 11 rejected with `DefinitionError`

#### Input Validation (§4.3)

- [x] Input violating `inputSchema` → error (machine never created)
- [x] Valid input proceeds normally
- [x] Non-existent definition ID → `NotFoundError`

#### Single Child Machine (§8)

- [x] `child_machine` state spawns child with `parentInstanceId`
- [x] Parent `status: 'waiting_for_child'`; `childInstanceId` set
- [x] Child completes → parent `stateData` = child `MachineResult`
- [x] Parent `actionId` runs after child; parent continues to terminal
- [x] Both parent and child `status: 'completed'`
- [x] `childInputMapping` correctly extracts child input
- [x] Invalid JSONPath → parent error (not null)
- [x] Child error → parent action receives error result; action decides transition
- [x] `ctx.parentContext` populated in child actions
- [x] `TransitionRecord` includes `childInstanceId`/`childDefinitionId`

#### Parallel Children (§9)

- [x] `parallel_children` spawns N children; all visible in store
- [x] Parent `childInstanceIds` keyed by `key`
- [x] All children complete → `ParallelChildrenResult` correct
- [x] `all_or_interrupt`: one error → remaining interrupted (cancelled)
- [x] `all_settled`: one error → remaining continue; all results collected
- [x] Each child receives correct input from its `inputMapping`

#### Concurrency & Semaphore (§10)

- [x] More instances than permits → excess queue (not reject)
- [x] Queued machines start as permits free up
- [x] Linked-list of 51+ machines (single child each) → no deadlock
- [x] Fan-out with 10 parallel children → no deadlock
- [x] Mixed nesting → no deadlock

#### Cancellation (§11)

- [x] Cancel running instance → `cancelled` terminal; history records cancellation
- [x] Cancel while waiting for single child → both cancelled
- [x] Cancel while waiting for parallel children → all cancelled
- [x] Cancel suspended instance → direct transition to cancelled
- [x] Cancel completed/cancelled/errored → 409 Conflict

#### Suspension & Resume (§12)

- [x] Suspend all in-flight instances → `status: 'suspended'`
- [x] Resume suspended instance → runs to completion
- [x] Completed transitions not re-executed after resume
- [x] Resume with single child: child resumed first if suspended
- [x] Resume with parallel children: mix of suspended/completed handled
- [x] Resume non-suspended → 409 Conflict
- [x] Resume with changed definition version → `DefinitionError`
- [x] Resume with deleted definition → `NotFoundError`
- [x] Startup recovery: `AUTO_RESUME_ON_STARTUP=true` resumes top-level instances

#### Persistence Checkpoints (§13)

- [x] Checkpoint 1: after start → `status: 'running'`, `currentState` = initial
- [x] Checkpoint 2: before action → `currentState` and `stateData` persisted
- [x] Checkpoint 3: after transition → `history` appended, `currentState` advanced
- [x] Checkpoint 4: terminal → `status` final, `output`/`error` populated
- [x] Checkpoint 5: suspension → `status: 'suspended'`

#### Middleware (§14)

- [x] `beforeTransition` fires before each action
- [x] `afterTransition` fires after each action, in reverse order
- [x] Middleware fires on child machine transitions independently
- [x] `MiddlewareContext.instance.parentInstanceId` distinguishes child from parent

#### Artifacts (§15)

- [x] Action writes artifact → file exists on disk; `ArtifactRecord` on instance
- [x] Parent reads child artifact after child completes
- [x] Parallel children artifacts accessible from parent

### 2. Additional test files (if not already tested in earlier tasks)

- [x] `server/src/machines/DefinitionValidator.test.ts` — (Task 03)
- [x] `server/src/machines/ActionRegistry.test.ts` — (Task 05)
- [x] `server/src/machines/middleware/middleware.test.ts` — (Task 07)
- [x] `server/src/machines/artifacts/ArtifactStore.test.ts` — (Task 08)
- [x] `server/src/machines/store/InMemoryMachineStore.test.ts` — (Task 04)

---

## Behavior Spec Coverage

This task provides comprehensive coverage of **all server-side behavior spec sections**: §1–§15 (except §16 WebSocket, which is Phase 3). It also covers the negative/edge-case behaviors from §21 that are testable at the unit/integration level.

---

## Validation Checklist

- [x] All test files compile and pass
- [x] Linear, branching, child, parallel, and error scenarios covered
- [x] Cancellation and resume scenarios covered
- [x] Semaphore deadlock-freedom tested
- [x] Persistence checkpoints verified
- [x] `pnpm --filter @aiflow/server run test` passes with all tests green
- [x] Test coverage is meaningful (not just happy path)
