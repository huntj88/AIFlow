# Task 17 — Core Engine Test Suite

> **Phase**: 1 (Core Engine)
> **Depends on**: Tasks 01–16 (all core engine tasks)
> **Blocks**: Phase 2 (REST API)

---

## Objective

Write comprehensive unit and integration tests for the entire core engine. Tests are co-located with source files following the project convention. This task ensures all behavior spec sections §1–§15 (server-side) are covered before moving to the API layer. Each test file should use Effect's test utilities and the `InMemoryMachineStore`.

---

## Implementation Notes from Completed Tasks

> These details emerged from Tasks 01–09 and affect test setup.

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

### Existing test patterns

See `server/src/machines/DefinitionValidator.test.ts`, `ActionRegistry.test.ts`, `store/InMemoryMachineStore.test.ts`, and `actions/actions.test.ts` for established test patterns and helpers.

### Critical: Layer composition for runner tests (Tasks 06–09)

The `StateMachineRunnerLive` Layer requires **four dependencies**:

1. `MachineStore` — use `InMemoryMachineStoreLive`
2. `ActionRegistry` — use `InMemoryActionRegistryLive` (register custom test actions)
3. `ArtifactStoreFactory` — use `FsArtifactStoreLive` (which itself requires `MachineStore`)
4. `MiddlewareExecutor` — use `makeMiddlewareExecutorLayer([])` (empty middleware for most tests)

**There is no `MiddlewareExecutorLive` export.** Use the factory function:

```typescript
import { makeMiddlewareExecutorLayer } from '../middleware/MiddlewareExecutor.js';
const TestMiddlewareLayer = makeMiddlewareExecutorLayer([]); // no middleware
```

Layer composition example:

```typescript
const TestLayer = StateMachineRunnerLive.pipe(
  Layer.provide(InMemoryMachineStoreLive),
  Layer.provide(InMemoryActionRegistryLive),
  Layer.provide(FsArtifactStoreLive), // depends on MachineStore
  Layer.provide(makeMiddlewareExecutorLayer([])),
);
```

Note: `FsArtifactStoreLive` has type `Layer.Layer<ArtifactStoreFactory, never, MachineStore>` — it requires `MachineStore` in its environment. Use `Layer.provideMerge` or ensure `InMemoryMachineStoreLive` is provided to both the runner and the artifact store.

### `stateData` in the first state is set to `input` (Task 09)

**Correction to §4.2 test expectation:** The runner sets `stateData = input` for the first state (both in the `ActionContext` and the persisted instance). The first action receives `ctx.stateData === input` AND `ctx.machineInput === input`. The task spec coverage says "stateData in first state is empty/undefined" but the actual implementation passes `input` as initial `stateData`. **Tests should verify `ctx.stateData === input` in the first state.**

### `run()` failure mode — depends on Task 10 fix

Currently `run()` Effect **fails** on action errors (returns `Effect.fail(machineError)`). After Task 10 fixes this, `run()` should return `MachineResult.error` instead. Tests should use `Effect.either` or `Effect.exit` to inspect outcomes:

```typescript
// Before Task 10 fix:
const exit = yield * runner.run(def, input).pipe(Effect.exit);
// exit is Exit.Failure with MachineError for action errors

// After Task 10 fix:
const result = yield * runner.run(def, input);
// result is MachineResult { status: 'error', ... } for action errors
```

### `StateLoggerFactory` is per-state, not a service (Task 06)

The runner creates a new `createStateLoggerFactory()` inside each loop iteration. In tests, you observe logs via the persisted `instance.logs` array (fetched from the store after completion), not by inspecting the factory directly.

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

- [ ] Simple linear machine (A → B → C → completed) runs to completion
- [ ] Instance has `status: 'completed'` and populated `output`
- [ ] Output matches final action's transition `data`
- [ ] Initial state action receives `machineInput`; `stateData` in first state is undefined
- [ ] When action returns `{ nextState, data }`, next state receives `data` as `stateData`
- [ ] Each action receives correct `ctx.stateName`, `ctx.machineInstanceId`, `ctx.machineDefId`

#### Transition History (§4.4)

- [ ] `history` is an ordered array of `TransitionRecord`s
- [ ] Each record has `fromState`, `toState`, `timestamp`, `durationMs`, `actionId`
- [ ] History length equals number of transitions
- [ ] Records are in chronological order

#### Logs (§4.5)

- [ ] Logs contain all `LogEntry` records emitted during execution
- [ ] Each entry has `stateName`, `level`, `message`, `timestamp`
- [ ] `ctx.logger.info(...)` produces `level: 'info'`; `ctx.logger.error(...)` produces `level: 'error'`

#### Branching (§5)

- [ ] Action inspects `stateData` and returns different `nextState` → machine follows different paths
- [ ] Machine can reach `completed` via multiple valid paths
- [ ] Machine can reach `error` terminal from any non-terminal state

#### Error Handling (§6)

- [ ] Action failure (throws/fails) → machine transitions to `error` terminal
- [ ] Instance `error` field contains descriptive message; `status: 'error'`
- [ ] Illegal transition (nextState not in transitions[]) → `DefinitionError`
- [ ] stateData fails dataSchema validation → error with schema details
- [ ] `beforeTransition` middleware failure → error terminal; `onError` hooks fire

#### Timeouts & Depth (§7)

- [ ] State with `timeoutMs: 500` + slow action → timeout error
- [ ] State without `timeoutMs` → no timeout
- [ ] Machine-level timeout → error if not completed in time
- [ ] Depth 10 allowed; depth 11 rejected with `DefinitionError`

#### Input Validation (§4.3)

- [ ] Input violating `inputSchema` → error (machine never created)
- [ ] Valid input proceeds normally
- [ ] Non-existent definition ID → `NotFoundError`

#### Single Child Machine (§8)

- [ ] `child_machine` state spawns child with `parentInstanceId`
- [ ] Parent `status: 'waiting_for_child'`; `childInstanceId` set
- [ ] Child completes → parent `stateData` = child `MachineResult`
- [ ] Parent `actionId` runs after child; parent continues to terminal
- [ ] Both parent and child `status: 'completed'`
- [ ] `childInputMapping` correctly extracts child input
- [ ] Invalid JSONPath → parent error (not null)
- [ ] Child error → parent action receives error result; action decides transition
- [ ] `ctx.parentContext` populated in child actions
- [ ] `TransitionRecord` includes `childInstanceId`/`childDefinitionId`

#### Parallel Children (§9)

- [ ] `parallel_children` spawns N children; all visible in store
- [ ] Parent `childInstanceIds` keyed by `key`
- [ ] All children complete → `ParallelChildrenResult` correct
- [ ] `all_or_interrupt`: one error → remaining interrupted (cancelled)
- [ ] `all_settled`: one error → remaining continue; all results collected
- [ ] Each child receives correct input from its `inputMapping`

#### Concurrency & Semaphore (§10)

- [ ] More instances than permits → excess queue (not reject)
- [ ] Queued machines start as permits free up
- [ ] Linked-list of 51+ machines (single child each) → no deadlock
- [ ] Fan-out with 10 parallel children → no deadlock
- [ ] Mixed nesting → no deadlock

#### Cancellation (§11)

- [ ] Cancel running instance → `cancelled` terminal; history records cancellation
- [ ] Cancel while waiting for single child → both cancelled
- [ ] Cancel while waiting for parallel children → all cancelled
- [ ] Cancel suspended instance → direct transition to cancelled
- [ ] Cancel completed/cancelled/errored → 409 Conflict

#### Suspension & Resume (§12)

- [ ] Suspend all in-flight instances → `status: 'suspended'`
- [ ] Resume suspended instance → runs to completion
- [ ] Completed transitions not re-executed after resume
- [ ] Resume with single child: child resumed first if suspended
- [ ] Resume with parallel children: mix of suspended/completed handled
- [ ] Resume non-suspended → 409 Conflict
- [ ] Resume with changed definition version → `DefinitionError`
- [ ] Resume with deleted definition → `NotFoundError`
- [ ] Startup recovery: `AUTO_RESUME_ON_STARTUP=true` resumes top-level instances

#### Persistence Checkpoints (§13)

- [ ] Checkpoint 1: after start → `status: 'running'`, `currentState` = initial
- [ ] Checkpoint 2: before action → `currentState` and `stateData` persisted
- [ ] Checkpoint 3: after transition → `history` appended, `currentState` advanced
- [ ] Checkpoint 4: terminal → `status` final, `output`/`error` populated
- [ ] Checkpoint 5: suspension → `status: 'suspended'`

#### Middleware (§14)

- [ ] `beforeTransition` fires before each action
- [ ] `afterTransition` fires after each action, in reverse order
- [ ] Middleware fires on child machine transitions independently
- [ ] `MiddlewareContext.instance.parentInstanceId` distinguishes child from parent

#### Artifacts (§15)

- [ ] Action writes artifact → file exists on disk; `ArtifactRecord` on instance
- [ ] Parent reads child artifact after child completes
- [ ] Parallel children artifacts accessible from parent

### 2. Additional test files (if not already tested in earlier tasks)

- [ ] `server/src/machines/DefinitionValidator.test.ts` — (Task 03)
- [ ] `server/src/machines/ActionRegistry.test.ts` — (Task 05)
- [ ] `server/src/machines/middleware/middleware.test.ts` — (Task 07)
- [ ] `server/src/machines/artifacts/ArtifactStore.test.ts` — (Task 08)
- [ ] `server/src/machines/store/InMemoryMachineStore.test.ts` — (Task 04)

---

## Behavior Spec Coverage

This task provides comprehensive coverage of **all server-side behavior spec sections**: §1–§15 (except §16 WebSocket, which is Phase 3). It also covers the negative/edge-case behaviors from §21 that are testable at the unit/integration level.

---

## Validation Checklist

- [ ] All test files compile and pass
- [ ] Linear, branching, child, parallel, and error scenarios covered
- [ ] Cancellation and resume scenarios covered
- [ ] Semaphore deadlock-freedom tested
- [ ] Persistence checkpoints verified
- [ ] `pnpm --filter @aiflow/server run test` passes with all tests green
- [ ] Test coverage is meaningful (not just happy path)
