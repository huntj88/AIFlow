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
  actionId?: string; // Reference to a registered ActionFunction
  childMachineDefId?: string; // For 'child_machine': reference to another StateMachineDefinition
  childInputMapping?: string; // JSONPath expression (via `jsonpath-plus`) to extract from parent context
  children?: ChildSpawnDefinition[]; // For 'parallel_children': list of children to spawn concurrently
  description?: string;
  dataSchema?: JsonSchema; // Schema for data this state carries
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
  description?: string;
}
```

**Terminal states**: Every definition **must** include exactly three terminal states keyed
as `"completed"`, `"cancelled"`, and `"error"`. These are auto-validated by the runner on
startup — definitions missing any of the three are rejected. Terminal states have
`type: 'terminal'` and no `actionId`. The runner's main loop exits when it transitions
into any terminal state. (Analogous to `FlowResult.Completed` and `FlowResult.Back` in
Kotlin Flow, with `error` for unrecoverable failures.)

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

/** The definition itself is invalid (orphan states, missing terminals, etc.). */
interface DefinitionError {
  readonly _tag: 'DefinitionError';
  readonly message: string;
  readonly details?: string[];
}
```

All error types use the `_tag` discriminant pattern for idiomatic Effect
`Effect.catchTag` / `Match.tag` usage throughout the codebase.

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
```

> **Note on services:** There is no `ServiceContainer` bag object. Actions that need
> shared services (HTTP clients, database connections, etc.) access them through the
> Effect context — the runner provides all required services via its Layer graph.
> Actions declare additional service requirements by widening their `R` type parameter
> as needed; the runner's Layer composition ensures they are satisfied at startup.

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
│     b. Execute the state's action / spawn child machine      │
│     c. Run middleware chain (afterTransition)                 │
│     d. Record transition in history                          │
│     e. Publish event to Effect PubSub                        │
│     f. If result is terminal → resolve machine result        │
│     g. Else → transition to next state, continue loop        │
│  5. Return MachineResult                                     │
└──────────────────────────────────────────────────────────────┘
```

#### Child Machine Spawning (Single)

When a state has `type: 'child_machine'`, the runner:

1. Maps the parent's current context to the child's input (via `childInputMapping`)
2. Instantiates and runs the child machine (recursive call to the runner)
3. The child's `MachineResult` is returned as the state's data
4. The parent uses the child's result in its transition logic (the action function
   on the parent state after child completes decides which transition to take)

This mirrors Kotlin Flow's `this.flow(ChildController::class.java, input)` pattern
where the parent suspends until the child completes.

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
and `childInstanceIds` on the `MachineInstance` tracks all running children.

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

All machine execution — top-level instances, single children, and parallel children —
acquires a permit from a **single global `Semaphore`** before entering the state loop.
This bounds total server-wide concurrency regardless of nesting depth.

```typescript
import { Effect, Semaphore } from 'effect';

// Created once at Layer construction, shared across all runners
const executionSemaphore = Semaphore.make(maxConcurrentMachines); // default: 50

// Every machine run (top-level or child) wraps its execution:
Semaphore.withPermits(executionSemaphore, 1)(runMachineLoop(definition, input));
```

When a parallel state spawns 10 children but only 3 semaphore permits are available,
3 children start immediately and the remaining 7 queue. As each child completes and
releases its permit, the next queued child starts. The parent fiber is suspended
(via `Effect.all` / `Effect.allSettled`) until every child has resolved.

The semaphore permit count is configurable via the `MAX_CONCURRENT_MACHINES` environment
variable (default: 50).

#### Machine Instance (Runtime State)

```typescript
interface MachineInstance {
  id: string; // UUID
  definitionId: string;
  definitionVersion: number;
  status: 'running' | 'completed' | 'cancelled' | 'error' | 'waiting_for_child';
  currentState: string;
  stateData: unknown; // Data in the current state
  input: unknown; // Original input
  output?: unknown; // Final output (when completed)
  error?: string; // Error message (when errored)
  parentInstanceId?: string; // If this is a child machine
  childInstanceId?: string; // If currently waiting on a single child
  childInstanceIds?: string[]; // If currently waiting on parallel children
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
  childInstanceIds?: string[]; // If parallel children were spawned
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

```typescript
// At Layer construction
const RunnerLive = StateMachineRunner.layer({
  middleware: [ValidationMiddleware, LoggingMiddleware, TelemetryMiddleware, AuditMiddleware],
});
```

**Built-in middleware:**

- **ValidationMiddleware** — Validates stateData against the state's `dataSchema` before
  entering (fails with `ValidationError` if invalid)
- **LoggingMiddleware** — Structured logs for each state via `Effect.log` with annotations
- **TelemetryMiddleware** — Records timing per transition using `Effect.logSpan`
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
{ type: 'child_spawned', instanceId: string, data: { childInstanceId: string } }
{ type: 'child_completed', instanceId: string, data: { childInstanceId: string, result: MachineResult } }
{ type: 'children_spawned', instanceId: string, data: {
    childInstanceIds: Record<string, string>; // key → instanceId
}}
{ type: 'children_completed', instanceId: string, data: {
    results: Record<string, MachineResult>;   // key → result
}}
{ type: 'artifact_created', instanceId: string, data: ArtifactRecord }
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
- List of running / recent instances
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
  "childMachineDefId": "validation-pipeline-v2",
  "childInputMapping": "$.stateData.rawRecords"
}
```

After the child completes, an **action function** on the parent state handles the
child's result and decides the transition:

```typescript
import { Effect } from 'effect';

// The "after child" action for ProcessData state
const processDataAfterChild = (ctx: ActionContext): Effect.Effect<TransitionResult, ActionError> =>
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

  Children are submitted to the global Semaphore.
  Only N run at a time; the rest queue until a slot opens.
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
  SQLite/Postgres later. Definitions and instances are stored server-side.
- **Artifact storage**: Generated files are written to the local filesystem in a
  hierarchy that mirrors instance parent/child relationships. Artifact metadata
  (name, size, state, timestamp) is tracked on the `MachineInstance`. The filesystem
  path is configurable via `ARTIFACT_ROOT` environment variable.
- **Concurrency**: Multiple machine instances can run concurrently on the server.
  The runner uses Effect's fiber model (no blocking). A single global `Semaphore` bounds
  the total number of concurrently executing machines (top-level, single children, and
  parallel children alike). Default: 50 permits, configurable via `MAX_CONCURRENT_MACHINES`
  env var. When parallel children are spawned, each child acquires its own permit — children
  that can't acquire one queue until a slot frees up. See §3 "Global Execution Semaphore".
- **Error handling**: If an action's Effect fails, the machine transitions to an error
  terminal state. Middleware `onError` hooks fire. The error is recorded in the instance.
- **Idempotency**: Starting a machine returns an instance ID. Repeated GETs are safe.
- **Type safety**: Full TypeScript types for definitions, instances, actions, middleware.
  Two validation layers: `Schema` from `effect` validates API payloads and internal
  data structures (definition shape, instance shape). `ajv` validates user-provided
  `inputSchema`/`outputSchema`/`dataSchema` JSON Schema definitions against state data
  at runtime. Add `ajv` as a server dependency.

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

- `server/src/machines/types.ts` — All interfaces: `StateMachineDefinition`, `StateDefinition`,
  `TransitionRule`, `MachineInstance`, `TransitionRecord`, `LogEntry`, `MachineResult`,
  `ActionContext`, `TransitionResult`, `TransitionMiddleware`, `StateLogger`,
  `ArtifactStore`, `ArtifactRecord`, `ArtifactMetadata`, `ArtifactTree`.
  Error types: `MachineError`, `ActionError`, `ValidationError`, `StoreError`,
  `NotFoundError`, `DefinitionError` (all with `_tag` discriminant for Effect `catchTag`).
  `JsonSchema` (type alias for JSON Schema objects used in `inputSchema`/`outputSchema`/`dataSchema`
  — validated at runtime via `ajv`; add `ajv` as a server dependency).
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
  - Manages the state loop, action dispatch, child machine spawning
  - Handles `parallel_children` states: spawns N children via `Effect.all` /
    `Effect.allSettled` (based on `parallelMode`), gated by the global `Semaphore`
  - Evaluates `childInputMapping` / `children[].inputMapping` JSONPath expressions
    via `jsonpath-plus`
  - Calls middleware hooks around each transition
  - Records transition history and logs on the instance
  - Emits `MachineEvent` to Effect `PubSub` on each transition (consumed by WebSocket in Phase 3)
  - Implemented as an Effect Layer, taking `ActionRegistry`, `MachineStore`,
    `PubSub<MachineEvent>`, and `Semaphore` (global execution limiter) as dependencies
- `server/src/machines/StateLogger.ts` — Scoped logger for a state; wraps Effect's `Logger`
  with machine instance + state name annotations, and appends `LogEntry` records to the instance

#### 1.4 Middleware

**Files:**

- `server/src/machines/middleware/index.ts` — Re-exports
- `server/src/machines/middleware/TelemetryMiddleware.ts` — Timing per transition
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
  - Error handling
  - Middleware execution order
  - Artifact creation during actions
  - Parent reading child artifacts after child and parallel children complete
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
- `server/src/routes/machines/instances.ts` — Start, list, get, cancel instances;
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
  `log_entry`, `machine_completed`, `child_spawned`, `child_completed`, `children_spawned`,
  `children_completed`, `artifact_created`

#### 3.2 Hook into Runner

The runner emits events through an Effect `PubSub<MachineEvent>` (not Node's
`EventEmitter` — `PubSub` is typed, integrates with Effect's fiber model, and supports
backpressure). The `WebSocketManager` subscribes to the `PubSub` and forwards events
to connected clients filtered by their subscribed instance IDs.

**Modified files:**

- `server/src/machines/StateMachineRunner.ts` — Emit events via `PubSub.publish` on each
  transition, child spawn/complete, and log entry
- `server/src/lib/HttpServer.ts` — Mount WS upgrade handler on the underlying Node
  `http.Server` (accessed via the `NodeHttpServer` Layer)

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
- `client/src/utils/machineSocket.ts` — WebSocket client with reconnection,
  subscription management, event callbacks

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

7. **Parallel children via global Semaphore** — A `parallel_children` state type spawns
   N child machines concurrently, but total server-wide concurrency is bounded by a single
   `Semaphore` shared across all execution (top-level, single children, parallel children).
   Children that exceed the permit limit queue and start as slots free up. This avoids
   resource exhaustion from deeply nested fan-outs while keeping the mental model simple:
   one knob (`MAX_CONCURRENT_MACHINES`) controls all concurrency. Two error modes are
   supported: `all_or_interrupt` (fail-fast, interrupt siblings) and `all_settled` (wait
   for all regardless).
