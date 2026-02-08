# Task 09 — Composable Finite State Machines

## Feature Specification

### Overview

A system of **composable, server-executed finite state machines (FSMs)** inspired by
[huntj88/Flow](https://github.com/huntj88/Flow). State machines are defined as data,
executed on the server as a series of async operations, and rendered/edited on the
client with live state visualization, transition history, and per-state log viewing.

### Core Concepts (mapped from Kotlin Flow → TypeScript)

| Kotlin Flow Concept                      | AIFlow Equivalent                                  | Description                                                     |
| ---------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| `FlowController<Input, Output>`          | `StateMachineDefinition`                           | Declarative description of states, transitions, and I/O types   |
| `BusinessFlowController`                 | Server-side `StateMachineRunner`                   | Headless execution engine on the server                         |
| `onStateName(state): Promise<FromState>` | `ActionFunction`                                   | Named Effect program that runs when a state is entered          |
| `state.toNextState(data)`                | `TransitionResult`                                 | Return value from an action that declares the next state + data |
| `FlowResult<T>` (Completed / Back)       | `MachineResult<T>` (Completed / Cancelled / Error) | Terminal result of a machine                                    |
| Child `flow(controller, input)`          | `spawnChild(machineDefId, input)`                  | Launch a child machine, suspend parent until child completes    |
| Multiple child `flow()` calls            | `parallel_children` state type                     | Launch N child machines concurrently, wait for all to complete  |
| Code generation from PlantUML            | Client-side visual editor + JSON definition        | Define machines visually, stored as JSON                        |

---

### 1. State Machine Definition (Data Model)

A **StateMachineDefinition** is a JSON document that fully describes an FSM:

```typescript
interface StateMachineDefinition {
  id: string; // UUID
  name: string; // Human-readable name
  version: number; // Monotonically increasing
  inputSchema: JsonSchema; // JSON Schema for machine input
  outputSchema: JsonSchema; // JSON Schema for machine output
  states: Record<string, StateDefinition>;
  initialState: string; // Key into `states`
  transitions: TransitionRule[]; // Allowed transitions
  metadata: {
    createdAt: string;
    updatedAt: string;
    description?: string;
    tags?: string[];
  };
}

interface StateDefinition {
  name: string; // Same as the key
  type: 'action' | 'child_machine' | 'parallel_children' | 'terminal';
  actionId?: string; // Required for 'action', 'child_machine', and 'parallel_children'.
  // For 'action': runs immediately on state entry.
  // For 'child_machine' / 'parallel_children': runs AFTER child(ren)
  //   complete, receiving child result(s) as stateData.
  // Must be omitted for 'terminal'.
  childMachineDefId?: string; // For 'child_machine': reference to another StateMachineDefinition
  childInputMapping?: string; // JSONPath expression (via `jsonpath-plus`) to extract from parent context
  children?: ChildSpawnDefinition[]; // For 'parallel_children': list of children to spawn concurrently
  description?: string;
  dataSchema?: JsonSchema; // Schema for data this state carries
  timeoutMs?: number; // Optional timeout for action execution (ms). Runner wraps in Effect.timeout.
}

/** Defines one child machine to spawn within a `parallel_children` state. */
interface ChildSpawnDefinition {
  key: string; // Unique key within this state (used to key results)
  machineDefId: string; // Reference to a StateMachineDefinition
  inputMapping: string; // JSONPath expression to extract child input from parent context
}

interface TransitionRule {
  from: string; // State name
  to: string; // State name
  label?: string; // Optional edge label for diagram rendering (e.g., "success", "retry")
  description?: string;
}

/**
 * JSON Schema object (Draft 2020-12 or compatible).
 * Validated at runtime via `ajv`. Typed as a generic record here;
 * use `ajv`'s `JSONSchemaType<T>` for stricter compile-time checking
 * where the target type T is known.
 */
type JsonSchema = Record<string, unknown>;
```

> **JSONPath vs JSON Schema** — This spec uses two distinct "JSON-something" technologies.
> `jsonpath-plus` is for **data extraction** (evaluating `childInputMapping` expressions
> to pull child input from parent context). `ajv` + JSON Schema is for **data validation**
> (checking that `stateData` conforms to a schema). They serve orthogonal purposes.

**Terminal states**: Every definition **must** include exactly three terminal states keyed
as `"completed"`, `"cancelled"`, and `"error"`. These are auto-validated by the runner on
startup — definitions missing any of the three are rejected. Terminal states have
`type: 'terminal'` and no `actionId`. The runner's main loop exits when it transitions
into any terminal state. (Analogous to `FlowResult.Completed` and `FlowResult.Back` in
Kotlin Flow, with `error` for unrecoverable failures.)

#### Definition Validation

The following rules are enforced at two points: **at save time** (when a definition is
created/updated via the REST API) and **at run time** (when the runner loads a definition
before execution). Most rules are fully enforceable at both points. Rule 8 is
**advisory at save time** since the `ActionRegistry` is mutable runtime state — an action
may be registered or unregistered between save and execution. Run-time validation is
always mandatory; invalid definitions are rejected with `DefinitionError`.

1. `initialState` must reference an existing key in `states`
2. All three required terminal states (`completed`, `cancelled`, `error`) must exist
   with `type: 'terminal'`
3. No transitions may originate **from** a terminal state
4. Every `from` and `to` in `transitions[]` must reference an existing state
5. Every non-terminal state must have at least one outgoing transition in `transitions[]`
6. No orphan states — every state must be reachable from `initialState` via transitions
7. `StateDefinition.name` must match its key in the `states` record
8. `action` states must have an `actionId` that references a registered action
   _(advisory at save time — the `ActionRegistry` may change between save and execution;
   mandatory at run time)_
9. `child_machine` states must have `actionId`, `childMachineDefId`, and `childInputMapping`
10. `parallel_children` states must have `actionId` and a non-empty `children[]`
11. `terminal` states must **not** have `actionId`, `childMachineDefId`, or `children`
12. `childMachineDefId` references (and `children[].machineDefId`) must not form cycles
    (e.g., machine A → child B → child A)
13. `inputSchema`, `outputSchema`, and all `dataSchema` values must be valid JSON Schema
    documents (structural check via `ajv.validateSchema()`)
14. All `key` values within a `parallel_children` state's `children[]` must be unique

#### MachineResult

The terminal result of a machine execution:

```typescript
type MachineResult<T = unknown> =
  | { status: 'completed'; output: T; instanceId: string }
  | { status: 'cancelled'; instanceId: string }
  | { status: 'error'; error: string; instanceId: string };
```

#### Error Types

Machine-specific error types for the Effect error channel:

```typescript
/** Top-level tagged union for all machine errors. */
type MachineError = ActionError | ValidationError | StoreError | NotFoundError | DefinitionError;

/** An action function failed during execution. */
interface ActionError {
  readonly _tag: 'ActionError';
  readonly actionId: string;
  readonly stateName: string;
  readonly cause: unknown;
}

/** Schema or data validation failed. */
interface ValidationError {
  readonly _tag: 'ValidationError';
  readonly message: string;
  readonly path?: string;
}

/** Persistence operation failed. */
interface StoreError {
  readonly _tag: 'StoreError';
  readonly operation: string;
  readonly cause: unknown;
}

/** A definition or instance was not found. */
interface NotFoundError {
  readonly _tag: 'NotFoundError';
  readonly entityType: 'definition' | 'instance' | 'action';
  readonly id: string;
}

/** The definition itself is invalid (orphan states, missing terminals, etc.).
 *  Also used at runtime when an action returns an illegal `nextState` that
 *  violates the definition's `transitions[]`. */
interface DefinitionError {
  readonly _tag: 'DefinitionError';
  readonly message: string;
  readonly details?: string[];
}
```

All error types use the `_tag` discriminant pattern for idiomatic Effect
`Effect.catchTag` / `Match.tag` usage throughout the codebase.

#### MachineEvent

Events emitted by the runner to the Effect `PubSub` for live client updates.
The `WebSocketManager` (Phase 3) subscribes to the `PubSub` and forwards events
to connected clients filtered by their subscribed instance IDs.

```typescript
type MachineEvent =
  | {
      type: 'state_changed';
      instanceId: string;
      data: { previousState: string; currentState: string; stateData: unknown; timestamp: string };
    }
  | { type: 'transition_recorded'; instanceId: string; data: TransitionRecord }
  | { type: 'log_entry'; instanceId: string; data: LogEntry }
  | { type: 'machine_completed'; instanceId: string; data: MachineResult }
  | {
      type: 'machine_resumed';
      instanceId: string;
      data: { previousState: string; resumedState: string; timestamp: string };
    }
  | {
      type: 'child_spawned';
      instanceId: string;
      data: { childInstanceId: string; childDefinitionId: string };
    }
  | {
      type: 'child_completed';
      instanceId: string;
      data: { childInstanceId: string; result: MachineResult };
    }
  | {
      type: 'children_spawned';
      instanceId: string;
      data: { childInstanceIds: Record<string, string> };
    }
  | {
      type: 'children_completed';
      instanceId: string;
      data: { results: Record<string, MachineResult> };
    }
  | { type: 'artifact_created'; instanceId: string; data: ArtifactRecord };
```

---

### 2. Action Functions (Server-Side)

Each state of type `'action'` references a named **ActionFunction** registered on the server.
Actions are the "what happens at this state" — they are Effect programs that receive
context and return a transition decision. Using `Effect` (instead of plain `Promise`)
gives actions typed errors, structured concurrency, interruption, logging spans, and
seamless integration with the runner's own Effect pipeline.

```typescript
import { Effect } from 'effect';

// Signature of every action function
type ActionFunction = (ctx: ActionContext) => Effect.Effect<TransitionResult, ActionError>;

interface ActionContext {
  machineInstanceId: string; // The running instance
  machineDefId: string; // The definition being run
  stateName: string; // Current state
  stateData: unknown; // Data carried into this state
  machineInput: unknown; // Original input to the machine
  parentContext?: {
    // Present if this is a child machine
    parentInstanceId: string;
    parentStateName: string;
  };
  logger: StateLogger; // Scoped logger for this state
  artifacts: ArtifactStore; // Scoped artifact store for this instance (see §9)
}

// What an action returns to declare the next state
interface TransitionResult {
  nextState: string; // Must be an allowed transition from current state
  data?: unknown; // Data to carry into the next state
}

/** Scoped logger for a single state execution. */
interface StateLogger {
  debug(message: string, data?: unknown): Effect.Effect<void, never>;
  info(message: string, data?: unknown): Effect.Effect<void, never>;
  warn(message: string, data?: unknown): Effect.Effect<void, never>;
  error(message: string, data?: unknown): Effect.Effect<void, never>;
}
```

> **Note on services:** There is no `ServiceContainer` bag object. The `ActionFunction`
> type has `R = never` (no Effect service requirements) so that the `ActionRegistry` can
> store all actions with a uniform type. Actions that need shared services (HTTP clients,
> database connections, etc.) must **self-provide** them internally — e.g., wrap calls in
> `Effect.provide(MyServiceLive)` or use `Effect.tryPromise` for Promise-based APIs.
> Common utilities (HTTP client, config) can be bundled into a helper Layer that actions
> import and provide themselves. This keeps the registry type-simple while still allowing
> rich service access.

Actions are **registered by ID** in an `ActionRegistry` on the server. The client can
browse the registry when wiring up state machine definitions.

```typescript
// Built-in example actions
actionRegistry.register('http-request', httpRequestAction);
actionRegistry.register('delay', delayAction);
actionRegistry.register('transform-data', transformDataAction);
actionRegistry.register('log-message', logMessageAction);
actionRegistry.register('conditional-branch', conditionalBranchAction);
```

Users can add custom actions to the registry (server code), and they become available
to all state machine definitions.

---

### 3. Machine Execution (Server Runner)

The **StateMachineRunner** is the core execution engine on the server.

```
┌──────────────────────────────────────────────────────────────┐
│  StateMachineRunner                                          │
│                                                              │
│  run(definition, input) → Effect<MachineResult, MachineError>│
│                                                              │
│  1. Validate input against inputSchema (Effect Schema)       │
│  2. Create MachineInstance record (via MachineStore)          │
│  3. Enter initialState                                       │
│  4. Loop:                                                    │
│     a. Run middleware chain (beforeTransition)                │
│     b. Execute the state:                                    │
│        - 'action': run actionId immediately                  │
│        - 'child_machine': spawn child → suspend → on         │
│          completion set stateData to child result → run      │
│          actionId                                            │
│        - 'parallel_children': spawn all children → suspend → │
│          on completion set stateData to collected results →   │
│          run actionId                                        │
│     c. Validate nextState is a legal transition per          │
│        transitions[] (fail with DefinitionError if not)      │
│     d. Run middleware chain (afterTransition)                 │
│     e. Record transition in history                          │
│     █ Checkpoint 3: persist history + logs + stateData       │
│     f. Publish event to Effect PubSub                        │
│     g. If result is terminal → resolve machine result        │
│        █ Checkpoint 4: persist final status + output/error   │
│     h. Else → transition to next state, continue loop        │
│  5. Return MachineResult                                     │
│                                                              │
│  resume():                                                   │
│  1. Load suspended instance from MachineStore                │
│  2. Load + validate definition (version must match)          │
│  3. Recursively resume any suspended children                │
│  4. Re-enter currentState (re-execute its action)            │
│  5. Continue at run() step 4 (normal loop)                   │
└──────────────────────────────────────────────────────────────┘
```

#### Child Machine Spawning (Single)

When a state has `type: 'child_machine'`, the runner:

1. Evaluates `childInputMapping` (JSONPath via `jsonpath-plus`) against the parent's
   current context to produce the child's input
2. Sets the parent instance's `status` to `'waiting_for_child'`
3. Releases the parent's semaphore permit (see "Global Execution Semaphore")
4. Instantiates and runs the child machine (recursive call to the runner) —
   the parent **suspends** here until the child reaches a terminal state
5. On child completion, re-acquires the semaphore permit
6. Sets `stateData` to the child's `MachineResult`
7. Executes the state's `actionId` — the action receives the child result in
   `ctx.stateData` and returns a `TransitionResult` deciding the next state

The `actionId` is **required** on `child_machine` states. The action is the
transition logic — it inspects the child's result and chooses the next state.
This mirrors Kotlin Flow's `onStateName` handler calling
`this.flow(ChildController::class.java, input)`, awaiting the result, and then
returning the next state.

#### Parallel Child Machine Spawning

When a state has `type: 'parallel_children'`, the runner spawns **multiple child
machines concurrently** and waits for **all** of them to complete before continuing.

1. For each entry in `children[]`, evaluate `inputMapping` against the parent's context
2. Create all child `MachineInstance` records (status: `running`)
3. Submit all children to the global execution `Semaphore` via `Effect.forEach` with
   `{ concurrency: 'unbounded' }` — the Semaphore itself limits how many actually run
   at once. Children that can't acquire a permit **queue** and start when a slot frees up.
4. Wait for all children to resolve (using `Effect.all` semantics — all must complete)
5. Collect results into a `Record<string, MachineResult>` keyed by each child's `key`
6. The collected results become the state's `stateData` for the transition action

The parent's `status` is set to `'waiting_for_child'` while the children execute,
and `childInstanceIds` on the `MachineInstance` tracks all running children (keyed by
each child's `key` from `ChildSpawnDefinition`).

```typescript
/** What the action receives as `ctx.stateData` after parallel children complete. */
interface ParallelChildrenResult {
  results: Record<string, MachineResult>; // Keyed by ChildSpawnDefinition.key
  childInstanceIds: Record<string, string>; // key → instanceId mapping
}
```

**Error semantics:** If any child errors or is cancelled, the remaining children are
**interrupted** (via Effect fiber interruption) and the parent receives the partial
results. The action function can inspect each child's status and decide the transition.
To change this to "wait for all even on failure", use `Effect.allSettled` semantics
instead — this is configurable per state via a `parallelMode` field:

```typescript
interface StateDefinition {
  // ... existing fields ...
  parallelMode?: 'all_or_interrupt' | 'all_settled'; // Default: 'all_or_interrupt'
}
```

- `'all_or_interrupt'` (default) — If any child fails, interrupt the rest immediately.
  The action receives partial results with the failed child's error.
- `'all_settled'` — Wait for every child to finish regardless of individual failures.
  The action receives all results (some may be errors).

#### Global Execution Semaphore

A single global `Semaphore` bounds the number of machines **actively executing** (running
an action or processing a transition) at any given time. The key word is _actively_ —
a parent that is suspended waiting for children is **not** doing work and must **release
its permit** before waiting, then **re-acquire** when the children finish.

Without this release-before-wait design, recursive spawning deadlocks. Consider a
linked-list of 51 machines (each spawns one child): all 50 permits would be held by
waiting parents, and machine 51 could never start — classic resource deadlock.

```typescript
import { Effect, Semaphore } from 'effect';

// Created once at Layer construction, shared across all runners
const executionSemaphore = Semaphore.make(maxConcurrentMachines); // default: 50

// The state loop acquires/releases the permit per step, NOT for the entire lifetime:
const runStateLoop = (instance, definition) =>
  Effect.gen(function* () {
    while (!isTerminal(instance.currentState)) {
      // Acquire permit for this active step
      const result = yield* Semaphore.withPermits(
        executionSemaphore,
        1,
      )(executeStep(instance, definition));

      if (result.type === 'spawn_child') {
        // Permit is already released (withPermits scope ended).
        // Child will acquire its own permit when it runs.
        const childResult = yield* runChildMachine(result.childDef, result.childInput);
        instance.stateData = childResult;
      }

      if (result.type === 'spawn_parallel_children') {
        // Permit released. Each child independently acquires a permit.
        const childResults = yield* runParallelChildren(result.children);
        instance.stateData = childResults;
      }

      // Re-acquire happens on next loop iteration via withPermits
    }
  });
```

**Invariant**: A permit is held only while a machine is _actively computing_ (executing
an action function, evaluating transitions). It is **never** held while waiting for
child machines. This means:

- **Linked-list recursion** (depth 51+): Only 1 permit is held at a time (the deepest
  active machine). All ancestors have released their permits while waiting. No deadlock.
- **Fan-out** (10 parallel children): Parent releases its 1 permit, 10 children compete
  for permits. If the semaphore has 50 permits, all 10 start immediately. If only 3 are
  free, 3 start and 7 queue — but no deadlock since the parent isn't holding one.
- **Mixed nesting** (fan-out where children also spawn children): Works correctly because
  every wait-for-child releases the permit first.

The semaphore permit count is configurable via the `MAX_CONCURRENT_MACHINES` environment
variable (default: 50). It bounds **active concurrency**, not total in-flight machines.

#### Machine Instance (Runtime State)

```typescript
interface MachineInstance {
  id: string; // UUID
  definitionId: string;
  definitionVersion: number;
  status: 'running' | 'completed' | 'cancelled' | 'error' | 'waiting_for_child' | 'suspended';
  currentState: string;
  stateData: unknown; // Data in the current state
  input: unknown; // Original input
  output?: unknown; // Final output (when completed)
  error?: string; // Error message (when errored)
  parentInstanceId?: string; // If this is a child machine
  childInstanceId?: string; // If currently waiting on a single child
  childInstanceIds?: Record<string, string>; // key → instanceId; if waiting on parallel children
  history: TransitionRecord[];
  logs: LogEntry[];
  artifacts: ArtifactRecord[]; // Files generated during this instance's run
  createdAt: string;
  updatedAt: string;
}

interface TransitionRecord {
  id: string;
  fromState: string;
  toState: string;
  data?: unknown; // Data carried in the transition
  timestamp: string;
  durationMs: number; // How long the action took
  actionId?: string; // Which action was executed
  childInstanceId?: string; // If a single child machine was spawned
  childDefinitionId?: string; // Definition ID of spawned child (for debugging)
  childInstanceIds?: Record<string, string>; // key → instanceId; if parallel children were spawned
  middlewareResults?: Record<string, unknown>; // Data from middleware
}

interface LogEntry {
  id: string;
  instanceId: string;
  stateName: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: unknown;
  timestamp: string;
}
```

#### Cancellation

When `POST /api/machines/instances/:id/cancel` is called, the runner:

1. Looks up the instance and verifies it is in a cancellable status (`running` or
   `waiting_for_child`). Instances already in a terminal state return a 409 Conflict.
2. **Interrupts** the instance's Effect fiber via `Fiber.interrupt`. Effect fiber
   interruption is cooperative — it takes effect at the next async yield point, which
   is the standard Effect concurrency model.
3. If the instance is `waiting_for_child`:
   - **Single child**: the child's fiber is also interrupted (recursive cancellation).
   - **Parallel children**: all children's fibers are interrupted.
4. Interrupted fibers unwind cleanly — `Effect.onInterrupt` finalizers run, allowing
   the runner to record the cancellation in the transition history and update the
   instance status.
5. The instance transitions to the `cancelled` terminal state.
6. A `machine_completed` event (with status `cancelled`) is published to the PubSub.

Child machines that are cancelled by their parent record their own status as `cancelled`
and fire their own `machine_completed` events, so clients subscribed to child instances
receive updates. The runner tracks each instance's fiber handle in memory (not persisted)
to support cancellation and suspension dispatch.

#### Resumability

The runner supports **resuming** machine instances that were interrupted by server
shutdown or crash. This ensures long-running machines are not lost when the server
restarts. Resume works by re-entering the last state whose action did not complete.

##### Persistence Checkpoints

To support resumability, the runner persists the `MachineInstance` to the `MachineStore`
at defined **checkpoint** points during execution:

1. **Instance creation** — Immediately after creating the `MachineInstance` record
   (status: `running`, currentState: `initialState`).
2. **Before entering each state** — After updating `currentState` and `stateData`
   but **before** executing the action. This is the critical checkpoint: if the server
   crashes during action execution, the instance's persisted `currentState` reflects
   the state whose action did not complete.
3. **After each completed transition** — `history[]` is appended with the
   `TransitionRecord`, `logs[]` updated, `stateData` set to the transition result's
   `data`. This captures completed work.
4. **On terminal state** — Final status, output/error written.
5. **On suspend** — Status set to `'suspended'` during graceful shutdown.

The minimum data that must be persisted per checkpoint for resumability:

| Field               | Checkpoint | Purpose                                                 |
| ------------------- | ---------- | ------------------------------------------------------- |
| `id`                | 1          | Instance identity                                       |
| `definitionId`      | 1          | Which definition to reload on resume                    |
| `definitionVersion` | 1          | Exact version the instance was started with             |
| `status`            | 1–5        | Distinguishes resumable (`suspended`) from terminal     |
| `currentState`      | 2          | The state to re-enter on resume                         |
| `stateData`         | 2, 3       | Data the current state needs (action input)             |
| `input`             | 1          | Original machine input (needed by `ActionContext`)      |
| `output`            | 4          | Terminal output (if completed)                          |
| `error`             | 4          | Terminal error message (if errored)                     |
| `parentInstanceId`  | 1          | Reconstructs parent-child hierarchy on resume           |
| `childInstanceId`   | 2          | Identifies suspended single child to resume first       |
| `childInstanceIds`  | 2          | Identifies suspended parallel children                  |
| `history`           | 3          | Completed transitions (avoids re-executing done states) |
| `logs`              | 3          | Preserves log entries across restarts                   |
| `artifacts`         | 3          | Artifact metadata (files already on disk)               |
| `createdAt`         | 1          | Original creation time                                  |
| `updatedAt`         | 1–5        | Last checkpoint time                                    |

> **Note on the in-memory store:** The `InMemoryMachineStore` (Phase 1) satisfies the
> `MachineStore` interface but does **not** survive process restarts — resumability
> requires a durable store (SQLite/Postgres). The in-memory store is sufficient for
> development and testing of the resume protocol itself (suspend → resume within a
> single process lifetime). True crash recovery requires swapping in a durable
> `MachineStore` implementation.

##### Graceful Shutdown

When the server receives a shutdown signal (`SIGTERM`, `SIGINT`), the runner:

1. Stops accepting new `run()` requests.
2. For each in-flight instance (status `running` or `waiting_for_child`):
   a. **Interrupts** the instance's Effect fiber (same mechanism as cancellation).
   b. The `Effect.onInterrupt` finalizer sets the instance status to `'suspended'`
   (not `'cancelled'`) and persists it via `MachineStore.updateInstance`.
   c. If the instance has running children, they are also suspended recursively —
   each child's status is set to `'suspended'` independently.
3. Waits for all finalizers to complete (bounded by a shutdown timeout, default: 10s,
   configurable via `SHUTDOWN_TIMEOUT_MS` env var).
4. Proceeds with server shutdown.

The distinction between `'suspended'` and `'cancelled'` is critical: suspended instances
are **intended to be resumed**, while cancelled instances are **permanently terminated**
by explicit user request.

##### Resume Protocol

When `POST /api/machines/instances/:id/resume` is called (or on automatic startup
recovery), the runner:

1. Loads the `MachineInstance` from the store and verifies `status === 'suspended'`.
   Instances in any other status return 409 Conflict.
2. Loads the `StateMachineDefinition` by `definitionId`. If the definition has been
   deleted or its current version differs from `definitionVersion`, the resume fails
   with `DefinitionError` (the definition may have changed incompatibly).
3. Re-validates the definition (same validation as a fresh `run()`).
4. **Handles child resumption first:**
   - If `childInstanceId` is set (single child was in progress), the runner checks
     the child's status. If `suspended`, it recursively resumes the child first. The
     parent remains `waiting_for_child` until the child completes. If the child already
     reached a terminal state before shutdown, its `MachineResult` is read from the
     store and used directly.
   - If `childInstanceIds` is set (parallel children were in progress), each child's
     status is checked. Suspended children are resumed; children already in a terminal
     state are not re-run. The parent waits for all children to reach a terminal state.
5. Sets instance status back to `'running'`.
6. **Re-enters `currentState`** — the runner re-executes the state as if entering it
   for the first time. The persisted `currentState` is the state whose action did not
   finish (thanks to checkpoint 2 being written _before_ action execution). For
   `child_machine` / `parallel_children` states where children have now completed
   (either they finished before shutdown or were just resumed), the runner picks up
   at the post-child action execution with `stateData` set to the child result(s).
7. The normal state loop continues from there.
8. A `machine_resumed` event is published to the PubSub.

```
┌──────────────────────────────────────────────────────────────────┐
│  Resume Protocol                                                 │
│                                                                  │
│  Store: instance.currentState = "ProcessData" (suspended)        │
│         instance.history = [GatherData → ProcessData]            │
│                                                                  │
│  1. Load instance (status: suspended) ✓                          │
│  2. Load definition (version match) ✓                            │
│  3. Validate definition ✓                                        │
│  4. Check children: childInstanceId set?                         │
│     ├─ child suspended → resume child first                      │
│     └─ child completed → use stored result                       │
│  5. Set status → running                                         │
│  6. Re-enter "ProcessData" → execute action                      │
│     (action sees stateData from checkpoint 2)                    │
│  7. Continue state loop: ProcessData → next → ... → terminal     │
│  8. Publish machine_resumed event                                │
└──────────────────────────────────────────────────────────────────┘
```

##### Action Idempotency

Because resume re-executes the action for `currentState`, actions that have
**side effects** (HTTP requests, database writes, file creation) should be designed
for **idempotency** or **at-least-once** semantics. The `ActionContext` provides
enough information for actions to detect whether their work was already partially done:

- `ctx.artifacts.list()` — Check if an output file already exists before writing
- `ctx.stateData` — May contain markers from a previous partial run
- External systems — Use idempotency keys derived from
  `ctx.machineInstanceId + ctx.stateName`

The runner does **not** guarantee exactly-once execution of actions. It guarantees that
a resumed machine will not **skip** a state or **re-execute** states that already
completed successfully (completed transitions are recorded in `history[]` and the runner
resumes from `currentState`, not `initialState`).

##### Startup Recovery

On server startup, the runner can optionally scan the `MachineStore` for instances
with `status === 'suspended'` and automatically resume them. This is controlled by
the `AUTO_RESUME_ON_STARTUP` environment variable (default: `false`). When enabled:

1. The runner queries `listInstances({ status: 'suspended' })`.
2. **Top-level instances first**: only instances with no `parentInstanceId` (or whose
   parent is not itself suspended) are resumed directly. Child instances are resumed
   by their parent's resume protocol (step 4 above), preserving the hierarchy.
3. Instances are sorted by `updatedAt` (oldest first) to respect original ordering.
4. Each top-level instance is resumed sequentially during startup (to avoid overwhelming
   the server). Once all are submitted, the semaphore governs concurrent execution
   as normal.
5. Instances that fail to resume (e.g., definition deleted, version mismatch) are moved
   to `'error'` status with a descriptive error message.

When `AUTO_RESUME_ON_STARTUP` is `false`, suspended instances remain in the store
and must be resumed manually via the REST API. The dashboard (§6c) shows suspended
instances with a "Resume" button.

---

### 4. Middleware System

Middleware wraps every state transition for cross-cutting concerns.
All middleware hooks return `Effect` for consistency with the rest of the server.

```typescript
import { Effect } from 'effect';

interface TransitionMiddleware {
  name: string;
  beforeTransition?: (ctx: MiddlewareContext) => Effect.Effect<void, MachineError>;
  afterTransition?: (
    ctx: MiddlewareContext & { result: TransitionResult },
  ) => Effect.Effect<void, MachineError>;
  onError?: (ctx: MiddlewareContext & { error: MachineError }) => Effect.Effect<void, never>;
}

interface MiddlewareContext {
  instance: MachineInstance;
  stateName: string;
  stateData: unknown;
  definition: StateMachineDefinition;
}
```

#### Middleware Registration

Middleware is registered **globally on the `StateMachineRunner`** at Layer construction time.
The runner accepts an ordered array of `TransitionMiddleware` — execution follows registration
order (first registered = first to run `beforeTransition`, last to run `afterTransition`,
like an onion). Middleware **cannot** short-circuit a transition; it can only observe, validate,
or fail with an error (which sends the machine to the error terminal state).

The middleware chain applies to **every transition in every machine**, including child machines
and parallel children. Child machines use the same runner instance (and therefore the same
middleware array) as the parent. If a child machine executes 5 transitions, each middleware
fires 5 times for that child — independently of the parent's transitions. The
`MiddlewareContext` carries the specific `instance` and `stateName`, so middleware can
distinguish parent from child transitions via `instance.parentInstanceId`.

```typescript
// At Layer construction
const RunnerLive = StateMachineRunner.layer({
  middleware: [ValidationMiddleware, LoggingMiddleware, TelemetryMiddleware, AuditMiddleware],
});
```

**Built-in middleware:**

- **ValidationMiddleware** — Validates stateData against the state's `dataSchema` (a JSON
  Schema document) via `ajv` before entering (fails with `ValidationError` if invalid)
- **LoggingMiddleware** — Structured logs for each state via `Effect.log` with annotations
- **TelemetryMiddleware** — Records timing per transition as OpenTelemetry spans via
  `Effect.logSpan` (which integrates with the OpenTelemetry tracer). Emits metrics
  (transition count, duration histogram, error rate) to the configured OTLP exporter.
- **AuditMiddleware** — Immutable audit log of every transition with actor, timestamp, data

---

### 5. API Layer

#### REST API (CRUD & queries)

| Method   | Path                                              | Description                      |
| -------- | ------------------------------------------------- | -------------------------------- |
| `GET`    | `/api/machines/definitions`                       | List all machine definitions     |
| `POST`   | `/api/machines/definitions`                       | Create a new definition          |
| `GET`    | `/api/machines/definitions/:id`                   | Get a definition                 |
| `PUT`    | `/api/machines/definitions/:id`                   | Update a definition              |
| `DELETE` | `/api/machines/definitions/:id`                   | Delete a definition              |
| `GET`    | `/api/machines/actions`                           | List registered action functions |
| `GET`    | `/api/machines/actions/:id`                       | Get action function metadata     |
| `POST`   | `/api/machines/instances`                         | Start a new machine instance     |
| `GET`    | `/api/machines/instances`                         | List instances (with filters)    |
| `GET`    | `/api/machines/instances/:id`                     | Get instance state + history     |
| `GET`    | `/api/machines/instances/:id/history`             | Get transition history           |
| `GET`    | `/api/machines/instances/:id/logs`                | Get logs for an instance         |
| `GET`    | `/api/machines/instances/:id/logs?state=X`        | Get logs filtered by state       |
| `POST`   | `/api/machines/instances/:id/cancel`              | Cancel a running instance        |
| `POST`   | `/api/machines/instances/:id/resume`              | Resume a suspended instance      |
| `GET`    | `/api/machines/instances/:id/artifacts`           | List artifacts for an instance   |
| `GET`    | `/api/machines/instances/:id/artifacts/:name`     | Download an artifact file        |
| `GET`    | `/api/machines/instances/:id/artifacts?tree=true` | Artifact tree (incl. children)   |

#### WebSocket API (live updates)

Clients connect to `ws://host/api/machines/live` and subscribe to instance events:

```typescript
// Client → Server
{ type: 'subscribe', instanceId: string }
{ type: 'unsubscribe', instanceId: string }

// Server → Client
{ type: 'state_changed', instanceId: string, data: {
    previousState: string;
    currentState: string;
    stateData: unknown;
    timestamp: string;
}}
{ type: 'transition_recorded', instanceId: string, data: TransitionRecord }
{ type: 'log_entry', instanceId: string, data: LogEntry }
{ type: 'machine_completed', instanceId: string, data: MachineResult }
{ type: 'child_spawned', instanceId: string, data: { childInstanceId: string, childDefinitionId: string } }
{ type: 'child_completed', instanceId: string, data: { childInstanceId: string, result: MachineResult } }
{ type: 'children_spawned', instanceId: string, data: {
    childInstanceIds: Record<string, string>; // key → instanceId
}}
{ type: 'children_completed', instanceId: string, data: {
    results: Record<string, MachineResult>;   // key → result
}}
{ type: 'artifact_created', instanceId: string, data: ArtifactRecord }
{ type: 'machine_resumed', instanceId: string, data: {
    previousState: string;   // state at time of suspend
    resumedState: string;    // state being re-entered
    timestamp: string;
}}
```

---

### 6. Client UI

#### 6a. Machine Definition Editor

- Visual **node-and-edge graph** editor for defining states and transitions
- Panel to select an action function from the registry for each state
- Panel to configure child machine references
- JSON Schema editors for input/output types
- Import/export definitions as JSON
- Validate definition before saving (all transitions legal, no orphan states, schemas valid)

#### 6b. Machine Instance Viewer

- **State diagram** rendered from the definition, with the **current state highlighted**
- Transition history as a timeline/table showing: from → to, data, duration, timestamp
- **Logs panel** filterable by state, level, time range
- Child machine tree showing parent-child relationships (click to navigate)
- **Artifacts panel** — file-explorer-style tree view of generated files across the
  instance hierarchy; click to download or preview. Updated live via WebSocket
  `artifact_created` events.
- Action args/results displayed per transition
- Live updates via WebSocket — diagram and history update in real time

#### 6c. Dashboard

- List of all definitions (with create/edit/delete)
- List of running / suspended / recent instances
- Suspended instances show a **Resume** button (calls `POST /api/machines/instances/:id/resume`)
- Quick-start: pick a definition, provide input, launch

---

### 7. Composability Model

The key insight from Kotlin Flow is that a state in a parent machine can **delegate to
an entire child machine**. The parent suspends, the child runs to completion, and the
child's result flows back into the parent's transition logic.

#### Single Child

```
┌─ Parent Machine ──────────────────────────┐
│                                           │
│  [GatherData] ──→ [ProcessData] ──→ ...   │
│       │                 ▲                 │
│       │  spawns         │ child result    │
│       ▼                 │                 │
│  ┌─ Child Machine ──────┤                 │
│  │ [Validate] → [Enrich] → [Done]        │
│  └────────────────────────────────────────│
│                                           │
└───────────────────────────────────────────┘
```

A state definition for this:

```json
{
  "name": "ProcessData",
  "type": "child_machine",
  "actionId": "process-child-result",
  "childMachineDefId": "validation-pipeline-v2",
  "childInputMapping": "$.stateData.rawRecords"
}
```

The runner spawns the child machine and suspends. When the child completes, the
runner sets `stateData` to the child's `MachineResult` and executes the state's
`actionId`. The action inspects the result and decides the transition:

```typescript
import { Effect } from 'effect';

// actionId: 'process-child-result' — runs after the child machine completes
const processChildResult = (ctx: ActionContext): Effect.Effect<TransitionResult, ActionError> =>
  Effect.gen(function* () {
    const childResult = ctx.stateData as MachineResult<{ validCount: number }>;
    if (childResult.status === 'completed' && childResult.output.validCount > 0) {
      return { nextState: 'SaveResults', data: childResult };
    }
    return { nextState: 'HandleError', data: { reason: 'No valid records' } };
  });
```

#### Parallel Children

A state can also fan out to **multiple child machines** that execute concurrently.
The parent waits for all to complete before continuing.

```
┌─ Parent Machine ─────────────────────────────────────┐
│                                                      │
│  [PrepareData] ──→ [ProcessAll] ──→ [Aggregate] → ...│
│                         │                ▲           │
│              spawns N   │                │ all done  │
│              children   │                │           │
│                    ┌────┴────┐           │           │
│                    │ (queue) │           │           │
│                    └────┬────┘           │           │
│          ┌──────────────┼──────────────┐ │           │
│          ▼              ▼              ▼ │           │
│   ┌─ Child A ─┐  ┌─ Child B ─┐  ┌─ Child C ─┐      │
│   │ [S1]→[S2] │  │ [S1]→[S2] │  │ [S1]→[S2] │      │
│   │   →[Done] │  │   →[Done] │  │   →[Done] │      │
│   └───────────┘  └───────────┘  └───────────┘      │
│          │              │              │             │
│          └──────────────┴──────────────┘             │
│                    collected as                       │
│               ParallelChildrenResult ────────────────┘
│                                                      │
└──────────────────────────────────────────────────────┘

  Parent releases its Semaphore permit before waiting.
  Children each acquire their own permit; excess queue until a slot opens.
  No deadlock: no permit is held by a waiting parent.
```

A state definition for parallel children:

```json
{
  "name": "ProcessAll",
  "type": "parallel_children",
  "actionId": "aggregate-results",
  "children": [
    {
      "key": "validate-us",
      "machineDefId": "validation-pipeline-v2",
      "inputMapping": "$.stateData.usRecords"
    },
    {
      "key": "validate-eu",
      "machineDefId": "validation-pipeline-v2",
      "inputMapping": "$.stateData.euRecords"
    },
    {
      "key": "validate-apac",
      "machineDefId": "validation-pipeline-v2",
      "inputMapping": "$.stateData.apacRecords"
    }
  ],
  "parallelMode": "all_settled"
}
```

After all children complete, the state's `actionId` runs with the collected results:

```typescript
import { Effect } from 'effect';

const aggregateResults = (ctx: ActionContext): Effect.Effect<TransitionResult, ActionError> =>
  Effect.gen(function* () {
    const { results, childInstanceIds } = ctx.stateData as ParallelChildrenResult;

    // Check if all children completed successfully
    const allCompleted = Object.values(results).every((r) => r.status === 'completed');
    if (!allCompleted) {
      const failed = Object.entries(results)
        .filter(([, r]) => r.status !== 'completed')
        .map(([key]) => key);
      return { nextState: 'HandleError', data: { failedRegions: failed } };
    }

    // Read artifacts from each child
    const usReport = yield* ctx.artifacts.readChild(
      childInstanceIds['validate-us'],
      'validation-results.csv',
    );

    yield* ctx.artifacts.write('combined-report.csv', usReport, {
      description: 'Combined validation report',
    });

    return { nextState: 'Deliver', data: { regionCount: Object.keys(results).length } };
  });
```

---

### 8. Non-Functional Requirements

- **Persistence**: In-memory store initially, with a clean interface for plugging in
  SQLite/Postgres later. Definitions and instances are stored server-side. The runner
  writes **persistence checkpoints** at defined points during execution (instance
  creation, before each state entry, after each transition, on terminal/suspend) —
  see §3 "Persistence Checkpoints". A durable `MachineStore` implementation is required
  for resumability across server restarts.
- **Resumability**: Machine instances interrupted by server shutdown are marked
  `'suspended'` and can be resumed — the runner re-enters the last state whose action
  did not complete. Child machines are resumed recursively before their parent. Actions
  should be designed for idempotency since resume re-executes the interrupted action.
  Automatic resume on startup is opt-in via `AUTO_RESUME_ON_STARTUP` env var. See §3
  "Resumability".
- **Artifact storage**: Generated files are written to the local filesystem in a
  hierarchy that mirrors instance parent/child relationships. Artifact metadata
  (name, size, state, timestamp) is tracked on the `MachineInstance`. The filesystem
  path is configurable via `ARTIFACT_ROOT` environment variable.
- **Concurrency**: Multiple machine instances can run concurrently on the server.
  The runner uses Effect's fiber model (no blocking). A single global `Semaphore` bounds
  the number of **actively executing** machines (running an action / processing a transition).
  Machines that are passively waiting for children **release their permit** first, preventing
  deadlock on recursive or deeply nested spawning. Default: 50 permits, configurable via
  `MAX_CONCURRENT_MACHINES` env var. See §3 "Global Execution Semaphore".
- **Error handling**: If an action's Effect fails, the machine transitions to an error
  terminal state. Middleware `onError` hooks fire. The error is recorded in the instance.
- **Safety limits**: The runner enforces a maximum child spawning depth (`maxDepth`,
  default: 10, configurable via `MAX_MACHINE_DEPTH` env var) to prevent runaway
  recursion from circular child references that slip past static validation (e.g.,
  a definition updated after initial validation). When the depth limit is reached,
  the runner fails with `DefinitionError`. Individual action execution can be bounded
  by an optional `timeoutMs` on `StateDefinition` (default: none — unbounded); the
  runner wraps the action in `Effect.timeout` when set. Machine-level timeout can be
  passed via `run(definition, input, { timeoutMs })`.
- **Idempotency**: Starting a machine returns an instance ID. Repeated GETs are safe.
- **Observability**: The server exports traces and metrics via **OpenTelemetry** (OTLP).
  `TelemetryMiddleware` creates a span per state transition (with `machineDefId`,
  `instanceId`, `stateName`, and `actionId` as span attributes) and records duration
  histograms. Child machine spans are nested under their parent's span, producing a
  full trace tree for composed machines. Metrics include: active instance count,
  transition throughput, action error rate, and semaphore utilisation. The OTLP endpoint
  is configured via `OTEL_EXPORTER_OTLP_ENDPOINT` env var (standard OpenTelemetry env
  convention). Add `@opentelemetry/api`, `@opentelemetry/sdk-node`,
  `@opentelemetry/exporter-trace-otlp-http`, and
  `@opentelemetry/exporter-metrics-otlp-http` as server dependencies. Effect's built-in
  OpenTelemetry integration (`@effect/opentelemetry`) bridges `Effect.logSpan` to OTel
  spans automatically.
- **Type safety**: Full TypeScript types for definitions, instances, actions, middleware.
  Two validation layers: `Schema` from `effect` (the main package — not `@effect/schema`,
  which was consolidated in Effect v3.x) validates API payloads and internal data structures
  on the **server**. `ajv` validates user-provided `inputSchema`/`outputSchema`/`dataSchema`
  JSON Schema definitions against state data at runtime. Add `ajv` as a server dependency.
  The **client** currently depends on the separate `@effect/schema` package; when adding
  machine types in Phase 4, use the same import path the client already depends on, or
  migrate to `Schema` from `effect` if the client's `effect` version supports it.

---

### 9. Artifact File System

State actions often produce **output files** — reports, CSVs, transformed data, images, etc.
Rather than forcing actions to manage file paths manually, the runner provides an implicit,
hierarchical file store scoped to each machine instance.

#### Directory Structure

Every machine instance gets an artifact directory. Child machines are nested under their parent:

```
<artifacts-root>/
  <parent-instance-id>/
    report.pdf                          # Written by parent action
    summary.json                        # Written by parent action
    children/
      <child-instance-id>/
        validation-results.csv          # Written by child action
        children/
          <grandchild-instance-id>/
            ...                         # Arbitrarily deep
```

The `<artifacts-root>` is configurable (defaults to `./data/artifacts` in dev,
configurable via environment variable `ARTIFACT_ROOT` for production).

#### ArtifactStore API

Actions receive a scoped `ArtifactStore` via `ctx.artifacts`. It can only write within
the current instance's directory — no escaping the sandbox.

```typescript
import { Effect } from 'effect';

interface ArtifactStore {
  /** Write a file into this instance's artifact directory. */
  write(
    name: string,
    content: Buffer | string,
    metadata?: ArtifactMetadata,
  ): Effect.Effect<ArtifactRecord, MachineError>;

  /** Read a file from this instance's artifact directory. */
  read(name: string): Effect.Effect<Buffer, MachineError>;

  /** List all artifacts for this instance (not including children). */
  list(): Effect.Effect<ArtifactRecord[], MachineError>;

  /**
   * Read a file from a child instance's artifact directory.
   * `childInstanceId` must be a direct or transitive child of this instance.
   * Validated by querying the MachineStore for the child instance and walking
   * `parentInstanceId` up to this instance — rejects with `NotFoundError` if
   * the child is not a descendant. This prevents path traversal via forged IDs.
   */
  readChild(childInstanceId: string, name: string): Effect.Effect<Buffer, MachineError>;

  /** List artifacts from a child instance. */
  listChild(childInstanceId: string): Effect.Effect<ArtifactRecord[], MachineError>;

  /** Resolve the absolute filesystem path for an artifact (for use by actions that
   *  need to pass a path to external tools). */
  resolvePath(name: string): string;
}
```

> **Factory pattern:** The runner constructs a new `ArtifactStore` instance per state
> execution, scoped to the current machine instance ID. This differs from the typical
> Effect singleton service pattern — the `ArtifactStoreFactory` Layer provides a
> `makeScoped(instanceId)` method, and the runner calls it before entering each state.

```typescript
interface ArtifactRecord {
  name: string; // Filename (e.g., "report.pdf")
  instanceId: string; // Which instance wrote it
  stateName: string; // Which state produced it
  size: number; // File size in bytes
  mimeType?: string; // Optional MIME type hint
  metadata?: ArtifactMetadata; // User-defined metadata
  createdAt: string; // ISO timestamp
}

interface ArtifactMetadata {
  description?: string;
  tags?: string[];
  [key: string]: unknown; // Extensible
}
```

#### Parent Access to Child Artifacts

After a child machine completes, the parent can read the child's generated files
via `ctx.artifacts.readChild(childInstanceId, name)`. This enables workflows like:

```typescript
import { Effect } from 'effect';

const afterValidation = (ctx: ActionContext): Effect.Effect<TransitionResult, ActionError> =>
  Effect.gen(function* () {
    const childResult = ctx.stateData as MachineResult;
    const childId = childResult.instanceId;

    // Read the CSV the child produced
    const csvBuffer = yield* ctx.artifacts.readChild(childId, 'validation-results.csv');

    // Write a combined report that includes child data
    yield* ctx.artifacts.write(
      'combined-report.json',
      JSON.stringify({
        parentData: ctx.machineInput,
        childValidation: csvBuffer.toString('utf-8'),
      }),
      { description: 'Combined parent + child report' },
    );

    return { nextState: 'Deliver', data: { reportReady: true } };
  });
```

#### Artifact Tree

The REST API supports a `?tree=true` query parameter on the artifacts endpoint.
This returns a recursive tree of all artifacts for the instance and its descendants:

```typescript
interface ArtifactTree {
  instanceId: string;
  definitionName: string;
  artifacts: ArtifactRecord[];
  children: ArtifactTree[]; // Recursive — one per child instance
}
```

The client UI uses this to render a file-explorer-style tree view showing which files
were produced at each level of the machine hierarchy.

#### Cleanup

Artifact directories are **not** automatically deleted when an instance completes.
This allows post-hoc inspection and download. A future garbage collection mechanism
can be added (TTL-based, or manual delete via API).

---

## Implementation Plan

### Phase 1 — Core Engine (Server)

> Goal: State machine definitions, action registry, runner, and middleware — all on the server,
> tested via REST API.

#### 1.1 Data Types & Schemas

Create the shared type definitions used by both server and client.

**Files:**

- `server/src/machines/types.ts` — All interfaces and types:
  - **Definition**: `StateMachineDefinition`, `StateDefinition`, `TransitionRule`,
    `ChildSpawnDefinition`, `JsonSchema` (type alias — `Record<string, unknown>`,
    validated at runtime via `ajv`; add `ajv` as a server dependency)
  - **Runtime**: `MachineInstance`, `TransitionRecord`, `LogEntry`, `MachineResult`,
    `ParallelChildrenResult`, `InstanceFilter`
  - **Action**: `ActionFunction`, `ActionContext`, `TransitionResult`, `StateLogger`
  - **Middleware**: `TransitionMiddleware`, `MiddlewareContext`
  - **Artifacts**: `ArtifactStore`, `ArtifactRecord`, `ArtifactMetadata`, `ArtifactTree`
  - **Events**: `MachineEvent` (tagged union of all runner-emitted events for PubSub /
    WebSocket — `state_changed`, `transition_recorded`, `log_entry`, `machine_completed`,
    `child_spawned`, `child_completed`, `children_spawned`, `children_completed`,
    `artifact_created`)
  - **Errors**: `MachineError`, `ActionError`, `ValidationError`, `StoreError`,
    `NotFoundError`, `DefinitionError` (all with `_tag` discriminant for Effect `catchTag`)
- `server/src/machines/schemas.ts` — `Schema` validators from `effect` (not `@effect/schema`,
  which was consolidated into the main `effect` package in v3.x) for all definition and
  instance types. Used to validate API request bodies, store operations, and definition
  structure.

#### 1.2 Action Registry

Register named async functions that states can reference.

**Files:**

- `server/src/machines/ActionRegistry.ts` — `ActionRegistry` Effect Service (Tag + Layer pattern)
  with `register(id, fn, metadata)`, `get(id)`, `list()` methods. Stores action functions +
  metadata (description, input/output schemas). Implemented as an Effect Layer for DI consistency
  with the rest of the server (see Architectural Decision #3).
- `server/src/machines/actions/index.ts` — Re-exports all built-in actions
- `server/src/machines/actions/http-request.ts` — Example: make an HTTP request
- `server/src/machines/actions/delay.ts` — Example: wait for N ms
- `server/src/machines/actions/transform-data.ts` — Example: apply a JSONPath transform
- `server/src/machines/actions/conditional-branch.ts` — Example: evaluate a condition, return
  different transitions
- `server/src/machines/actions/log-message.ts` — Example: log a message and pass through

#### 1.3 Machine Runner

The execution engine. **New server dependency required**: `jsonpath-plus` (for evaluating
`childInputMapping` JSONPath expressions when spawning child machines).

**Files:**

- `server/src/machines/StateMachineRunner.ts` — Core runner Effect Service
  - `run(definition, input, opts?)` → `Effect<MachineResult, MachineError>`
  - `resume(instanceId)` → `Effect<MachineResult, MachineError>` — loads a suspended
    instance from the store, recursively resumes children, re-enters `currentState`
  - `suspendAll()` → `Effect<void, MachineError>` — graceful shutdown: interrupts all
    in-flight fibers, sets status to `suspended`, persists checkpoint
  - Manages the state loop, action dispatch, child machine spawning
  - Handles `parallel_children` states: spawns N children via `Effect.all` /
    `Effect.allSettled` (based on `parallelMode`), releasing the parent's semaphore
    permit before waiting (release-before-wait pattern prevents deadlock)
  - Evaluates `childInputMapping` / `children[].inputMapping` JSONPath expressions
    via `jsonpath-plus`
  - Calls middleware hooks around each transition
  - Records transition history and logs on the instance
  - Writes persistence checkpoints to `MachineStore` at each phase of the state loop
    (see §3 "Persistence Checkpoints") to support resumability
  - Emits `MachineEvent` to Effect `PubSub` on each transition (consumed by WebSocket in Phase 3)
  - Implemented as an Effect Layer, taking `ActionRegistry`, `MachineStore`,
    `PubSub<MachineEvent>`, and `Semaphore` (global execution limiter) as dependencies
- `server/src/machines/StateLogger.ts` — Scoped logger for a state; wraps Effect's `Logger`
  with machine instance + state name annotations, and appends `LogEntry` records to the instance

#### 1.4 Middleware

**Files:**

- `server/src/machines/middleware/index.ts` — Re-exports
- `server/src/machines/middleware/TelemetryMiddleware.ts` — OpenTelemetry spans and
  metrics per transition (duration histogram, error counter, span attributes for
  `machineDefId`, `instanceId`, `stateName`, `actionId`)
- `server/src/machines/middleware/AuditMiddleware.ts` — Immutable audit trail
- `server/src/machines/middleware/LoggingMiddleware.ts` — Structured logs via Effect logger
- `server/src/machines/middleware/ValidationMiddleware.ts` — Schema validation on state data

#### 1.5 In-Memory Store

The `MachineStore` is an Effect Service (Tag + Layer) with the following contract:

```typescript
import { Effect } from 'effect';

interface MachineStore {
  // Definitions
  saveDefinition(def: StateMachineDefinition): Effect.Effect<void, StoreError>;
  getDefinition(id: string): Effect.Effect<StateMachineDefinition, NotFoundError>;
  listDefinitions(): Effect.Effect<StateMachineDefinition[], StoreError>;
  deleteDefinition(id: string): Effect.Effect<void, NotFoundError>;

  // Instances
  saveInstance(instance: MachineInstance): Effect.Effect<void, StoreError>;
  getInstance(id: string): Effect.Effect<MachineInstance, NotFoundError>;
  listInstances(filter?: InstanceFilter): Effect.Effect<MachineInstance[], StoreError>;
  updateInstance(id: string, patch: Partial<MachineInstance>): Effect.Effect<void, NotFoundError>;
}

interface InstanceFilter {
  status?: MachineInstance['status'];
  definitionId?: string;
  parentInstanceId?: string;
  limit?: number;
  offset?: number;
}
```

**Files:**

- `server/src/machines/store/MachineStore.ts` — `MachineStore` Effect Service Tag + interface
- `server/src/machines/store/InMemoryMachineStore.ts` — In-memory `Layer.succeed` implementation
  with `Map<string, StateMachineDefinition>` and `Map<string, MachineInstance>`

#### 1.6 Artifact Store

**Files:**

- `server/src/machines/artifacts/ArtifactStoreFactory.ts` — `ArtifactStoreFactory` Effect Service
  (Tag + Layer). Provides a `makeScoped(instanceId, parentInstanceId?)` method that returns
  a scoped `ArtifactStore` instance. The runner calls this before entering each state.
  This factory pattern differs from the typical Effect singleton service — each machine
  instance gets its own sandboxed store. Validates filenames (no path traversal). Records
  `ArtifactRecord` entries on the `MachineInstance`.
- `server/src/machines/artifacts/FsArtifactStore.ts` — Filesystem-backed implementation
  using `node:fs/promises`. Writes files under `<ARTIFACT_ROOT>/<instanceId>/`, nests
  children under `children/<childId>/`. Configured via `ARTIFACT_ROOT` env var
  (default `./data/artifacts`). Implemented as an Effect Layer providing `ArtifactStoreFactory`.

#### 1.7 Tests

Tests are co-located with source files, matching the established project pattern
(e.g., `hello.test.ts` beside `hello.ts`, `HomePage.test.tsx` beside `HomePage.tsx`).

**Files:**

- `server/src/machines/StateMachineRunner.test.ts` — Core runner tests
  - Simple linear machine
  - Branching machine
  - Single child machine composition
  - Parallel children: all succeed
  - Parallel children: one fails with `all_or_interrupt` (remaining interrupted)
  - Parallel children: one fails with `all_settled` (all results collected)
  - Parallel children: semaphore queuing (more children than permits)
  - Recursive single-child depth exceeding semaphore permits (no deadlock)
  - Mixed nesting: parallel children that themselves spawn children (no deadlock)
  - Error handling
  - Transition legality rejection (action returns illegal `nextState` → `DefinitionError`)
  - Max depth exceeded → `DefinitionError`
  - Action timeout via `timeoutMs`
  - Cancellation of running instance (fiber interrupted, terminal state reached)
  - Cancellation propagation to single child and parallel children
  - Middleware execution order
  - Artifact creation during actions
  - Parent reading child artifacts after child and parallel children complete
  - Suspend and resume of a simple linear machine (re-enters `currentState`)
  - Suspend and resume of a machine with a running single child (child resumed first)
  - Suspend and resume of parallel children (mix of suspended and already-completed)
  - Resume rejects non-suspended instances (409 Conflict)
  - Resume rejects when definition version has changed (`DefinitionError`)
  - Resume rejects when definition has been deleted (`NotFoundError`)
  - Graceful shutdown suspends all in-flight instances
  - Startup recovery with `AUTO_RESUME_ON_STARTUP` (top-level instances only)
  - Action idempotency: resumed action can detect prior partial work via artifacts
  - Persistence checkpoints: instance state correct after each checkpoint
- `server/src/machines/ActionRegistry.test.ts`
- `server/src/machines/middleware/middleware.test.ts`
- `server/src/machines/artifacts/ArtifactStore.test.ts` — Write, read, list,
  path traversal rejection, child artifact access, artifact tree construction

---

### Phase 2 — REST API

> Goal: Expose machine CRUD, action listing, instance management over HTTP.

#### 2.1 Routes

**Files:**

- `server/src/routes/machines/index.ts` — Combined router, merges sub-routers
- `server/src/routes/machines/definitions.ts` — CRUD for StateMachineDefinition
- `server/src/routes/machines/actions.ts` — List / get registered actions
- `server/src/routes/machines/instances.ts` — Start, list, get, cancel, resume instances;
  get history, logs, and artifacts (list, download, tree)

#### 2.2 Wire into HttpServer

**Modified files:**

- `server/src/lib/HttpServer.ts` — Add `MachineRouter` alongside `HelloRouter`

**Layer composition sketch** (the full dependency graph for the server):

```
HttpLive = (HelloRouter + MachineRouter)
  |> HttpServer.serve(HttpMiddleware.logger)
  |> HttpServer.withLogAddress
  |> Layer.provide(ActionRegistryLive)        // Built-in actions pre-registered
  |> Layer.provide(StateMachineRunnerLive)     // Depends on ActionRegistry, MachineStore, Semaphore
  |> Layer.provide(ExecutionSemaphoreLive)     // Global Semaphore(MAX_CONCURRENT_MACHINES)
  |> Layer.provide(InMemoryMachineStoreLive)   // Implements MachineStore interface
  |> Layer.provide(FsArtifactStoreLive)        // Implements ArtifactStoreFactory
  |> Layer.provide(ServerLive)                // NodeHttpServer
```

The `MachineRouter` routes access the `StateMachineRunner` and `MachineStore` services
from the Effect context (they don't import singletons — everything flows through Layers).

#### 2.3 Tests

**Files:**

- `server/src/routes/machines/definitions.test.ts`
- `server/src/routes/machines/instances.test.ts`

---

### Phase 3 — WebSocket Live Updates

> Goal: Real-time state change and log streaming to clients.
>
> **New server dependency required**: `ws` (WebSocket server library) + `@types/ws`.
> `@effect/platform-node` does not include a built-in WS server. The `ws` library
> handles the low-level transport; an Effect wrapper Layer manages connection lifecycle,
> subscriptions, and event broadcasting.

#### 3.1 WebSocket Server

**Files:**

- `server/src/machines/live/WebSocketManager.ts` — Effect Service (Tag + Layer) wrapping
  the `ws` library. Manages WS connections, subscriptions per instance ID, and broadcasts
  events. Subscribes to the runner's Effect `PubSub` and forwards matching events to
  connected clients.
- `server/src/machines/live/events.ts` — Event types: `state_changed`, `transition_recorded`,
  `log_entry`, `machine_completed`, `machine_resumed`, `child_spawned`, `child_completed`,
  `children_spawned`, `children_completed`, `artifact_created`

#### 3.2 Hook into Runner

The runner emits events through an Effect `PubSub<MachineEvent>` (not Node's
`EventEmitter` — `PubSub` is typed, integrates with Effect's fiber model, and supports
backpressure). The `WebSocketManager` subscribes to the `PubSub` and forwards events
to connected clients filtered by their subscribed instance IDs.

**Modified files:**

- `server/src/machines/StateMachineRunner.ts` — Emit events via `PubSub.publish` on each
  transition, child spawn/complete, and log entry
- `server/src/lib/HttpServer.ts` — Mount WS upgrade handler on the underlying Node
  `http.Server` (accessed via the `NodeHttpServer` Layer). The WebSocket server shares
  the same port as the HTTP server (default: 3001) — no separate port is needed.
  The `ws` library handles the HTTP → WS upgrade on the `/api/machines/live` path.

---

### Phase 4 — Client: State Machine Viewer

> Goal: View running/completed machine instances with live-updating state diagrams.
>
> **New client dependencies required**: `@xyflow/react` (React Flow v12 — node/edge graph
> rendering for state diagrams and the definition editor), `dagre` or `elkjs` (automatic
> graph layout), and their type packages. Add to `client/package.json` before starting
> this phase.

#### 4.1 API Client

Extend the existing `client/src/utils/apiClient.ts` (which already provides a `makeRequest`
helper using Effect `HttpClient` with `filterStatusOk`, logging spans, and `FetchHttpClient.layer`)
rather than creating a parallel client.

**Files:**

- `client/src/utils/apiClient.ts` — **Modified**: Add machine endpoint functions (`getDefinitions`,
  `createDefinition`, `getInstance`, `startInstance`, `cancelInstance`, `listArtifacts`,
  `downloadArtifact`, `getArtifactTree`, etc.) using the existing `makeRequest` pattern
- `client/src/utils/machineSocket.ts` — WebSocket client with reconnection
  (exponential backoff: 1s → 2s → 4s → … → 30s cap, with automatic re-subscribe
  on reconnect), subscription management, event callbacks

#### 4.2 State Management

**Files:**

- `client/src/hooks/useMachineDefinitions.ts` — Zustand store for definitions
- `client/src/hooks/useMachineInstances.ts` — Zustand store for instances,
  subscribes to WebSocket for live updates
- `client/src/hooks/useMachineLogs.ts` — Fetch and stream logs

#### 4.3 Pages & Components

**Files:**

- `client/src/pages/MachinesPage.tsx` — Dashboard: list definitions, recent instances
- `client/src/pages/MachineDefinitionPage.tsx` — View/edit a single definition
- `client/src/pages/MachineInstancePage.tsx` — View a running/completed instance
- `client/src/components/machines/StateDiagram.tsx` — SVG/Canvas state diagram with
  current-state highlighting (use dagre or elkjs for layout)
- `client/src/components/machines/TransitionHistory.tsx` — Timeline table of transitions
- `client/src/components/machines/LogViewer.tsx` — Filterable log panel
- `client/src/components/machines/ChildMachineTree.tsx` — Tree view of parent/child relationships
- `client/src/components/machines/ArtifactViewer.tsx` — File-explorer tree of artifacts
  across the instance hierarchy. Fetches `?tree=true` endpoint, renders nested folders
  per child instance with download links. Live-updates on `artifact_created` WS events.
- `client/src/components/machines/ActionInfo.tsx` — Display action metadata for a state

#### 4.4 Routing

**Modified files:**

- `client/src/app/router/routes.ts` — Add machine routes
- `client/src/app/router/AppRouter.tsx` — Add machine page routes

---

### Phase 5 — Client: Definition Editor

> Goal: Visually create and modify state machine definitions.

#### 5.1 Editor Components

**Files:**

- `client/src/components/machines/editor/DefinitionEditor.tsx` — Main editor container
- `client/src/components/machines/editor/StateNode.tsx` — Draggable state node
- `client/src/components/machines/editor/TransitionEdge.tsx` — Connectable edges
- `client/src/components/machines/editor/StateConfigPanel.tsx` — Side panel to configure
  a selected state (name, action, child machine, parallel children list, schemas, parallelMode)
- `client/src/components/machines/editor/ActionPicker.tsx` — Dropdown/search for
  registered actions
- `client/src/components/machines/editor/ChildMachinePicker.tsx` — Pick a definition to use
  as a child machine (used for both single-child and parallel-children entries)
- `client/src/components/machines/editor/DefinitionValidator.tsx` — Validate & show errors

#### 5.2 Editor State

**Files:**

- `client/src/hooks/useDefinitionEditor.ts` — Zustand store for editor state (undo/redo,
  dirty tracking, node positions)

---

### Phase 6 — Polish & Integration

> Goal: End-to-end flows, error handling, documentation.

- Wire up the client's "Launch Instance" button → POST to server → redirect to instance page
- Ensure child machine navigation works (click child in tree → opens child instance page)
- Error boundaries in the client for machine pages
- Loading skeletons while data loads
- Toast notifications for machine completion/errors
- Add machine-related routes to the nav/sidebar
- Write integration tests (Playwright) for the full create → run → view cycle

---

### Dependency Graph

```
Phase 1 (Core Engine)
   │
   ├──→ Phase 2 (REST API)
   │        │
   │        ├──→ Phase 3 (WebSocket)
   │        │        │
   │        ├──→ Phase 4 (Client Viewer) ──────────────→ Phase 6 (Polish)
   │        │    (starts with REST; adds WS when Phase 3 ready)    ▲
   │        │                                                      │
   │        └──→ Phase 5 (Client Editor) ─────────────────────────┘
   │
   └──→ Tests at every phase
```

### Key Architectural Decisions

1. **Definitions are data, not code** — Unlike the Kotlin Flow where state machines are
   classes, our definitions are JSON documents. This allows client-side editing and
   persistence without deploying code.

2. **Actions are code, registered on the server** — The "what happens" at each state is
   still a TypeScript function, but it's registered by name. Definitions reference actions
   by ID. This separates the state machine structure from the execution logic.

3. **Effect-first** — The entire server is built on Effect. All server-side interfaces
   (`ActionFunction`, `TransitionMiddleware`, `ArtifactStore`, `MachineStore`) return
   `Effect` — never raw `Promise`. This gives typed errors (`MachineError` union with
   `_tag` discriminants for `catchTag`), structured concurrency via fibers, `Semaphore`-based
   concurrency limits, `PubSub` for event broadcasting, `LogSpan` for automatic timing,
   and clean dependency injection via the Layer/Service pattern. Actions that wrap
   callback-style or Promise-based code use `Effect.tryPromise` at the boundary.

4. **WebSocket for liveness, REST for everything else** — WS is only for real-time
   streaming of state changes and logs. All CRUD goes through REST.

5. **In-memory first, persistence interface ready** — The `MachineStore` interface makes
   it trivial to swap in SQLite/Postgres later without changing the runner or API layer.

6. **No guard expressions in Phase 1** — `TransitionRule` does not include a `condition`
   field initially. Transition logic is handled entirely within action functions (which
   can inspect `stateData` and return different `nextState` values). A structured guard
   expression language (field / operator / value predicates) may be added in a future
   phase once the core engine is proven.

7. **Parallel children via global Semaphore with release-before-wait** — A
   `parallel_children` state type spawns N child machines concurrently, bounded by a
   single global `Semaphore`. The semaphore is **not** reentrant, so a parent **releases
   its permit before waiting** for children, then re-acquires when they finish. This
   prevents deadlock on deep recursion (e.g. a linked-list of 51 machines with 50
   permits — only the deepest active machine holds a permit at any time). One knob
   (`MAX_CONCURRENT_MACHINES`) controls all active concurrency. Two error modes:
   `all_or_interrupt` (fail-fast, interrupt siblings) and `all_settled` (wait for all).

8. **Resumability via checkpoint-and-replay** — The runner persists the `MachineInstance`
   to the `MachineStore` at defined checkpoint points during execution. The critical
   checkpoint is **before entering each state** (checkpoint 2): `currentState` and
   `stateData` are written before the action runs, so a crash mid-action leaves the
   instance pointing at the unfinished state. On resume, the runner re-enters
   `currentState` and re-executes its action — it never skips states or replays
   completed ones (those are in `history[]`). This is a **checkpoint-and-replay**
   strategy (not event sourcing or WAL). The tradeoff is that actions must tolerate
   at-least-once execution (idempotency). Graceful shutdown uses Effect fiber
   interruption to transition all in-flight instances to `'suspended'` status before
   the process exits. Automatic resume on startup is opt-in (`AUTO_RESUME_ON_STARTUP`)
   to avoid surprising behavior in development.
