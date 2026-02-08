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
| `onStateName(state): Promise<FromState>` | `ActionFunction`                                   | Named async function that runs when a state is entered          |
| `state.toNextState(data)`                | `TransitionResult`                                 | Return value from an action that declares the next state + data |
| `FlowResult<T>` (Completed / Back)       | `MachineResult<T>` (Completed / Cancelled / Error) | Terminal result of a machine                                    |
| Child `flow(controller, input)`          | `spawnChild(machineDefId, input)`                  | Launch a child machine, suspend parent until child completes    |
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
  type: 'action' | 'child_machine' | 'terminal';
  actionId?: string; // Reference to a registered ActionFunction
  childMachineDefId?: string; // Reference to another StateMachineDefinition
  childInputMapping?: string; // JSONPath or expression to map parent context → child input
  description?: string;
  dataSchema?: JsonSchema; // Schema for data this state carries
}

interface TransitionRule {
  from: string; // State name
  to: string; // State name
  condition?: string; // Optional guard expression
  description?: string;
}
```

**Terminal states** are `"completed"`, `"cancelled"`, and `"error"` (analogous to
`FlowResult.Completed` and `FlowResult.Back`, with `error` for unrecoverable failures).
A machine always ends in one of these.

---

### 2. Action Functions (Server-Side)

Each state of type `'action'` references a named **ActionFunction** registered on the server.
Actions are the "what happens at this state" — they are pure async operations that receive
context and return a transition decision.

```typescript
// Signature of every action function
type ActionFunction = (ctx: ActionContext) => Promise<TransitionResult>;

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
  artifacts: ArtifactStore; // Scoped file store for this instance (see §9)
  services: ServiceContainer; // Access to shared services (DB, HTTP, etc.)
}

// What an action returns to declare the next state
interface TransitionResult {
  nextState: string; // Must be an allowed transition from current state
  data?: unknown; // Data to carry into the next state
}
```

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
┌─────────────────────────────────────────────────────────────┐
│  StateMachineRunner                                         │
│                                                             │
│  run(definition, input) → Promise<MachineResult<Output>>    │
│                                                             │
│  1. Validate input against inputSchema                      │
│  2. Create MachineInstance record                           │
│  3. Enter initialState                                      │
│  4. Loop:                                                   │
│     a. Run middleware chain (beforeTransition)               │
│     b. Execute the state's action / spawn child machine     │
│     c. Run middleware chain (afterTransition)                │
│     d. Record transition in history                         │
│     e. If result is terminal → resolve machine result       │
│     f. Else → transition to next state, continue loop       │
│  5. Return MachineResult                                    │
└─────────────────────────────────────────────────────────────┘
```

#### Child Machine Spawning

When a state has `type: 'child_machine'`, the runner:

1. Maps the parent's current context to the child's input (via `childInputMapping`)
2. Instantiates and runs the child machine (recursive call to the runner)
3. The child's `MachineResult` is returned as the state's data
4. The parent uses the child's result in its transition logic (the action function
   on the parent state after child completes decides which transition to take)

This mirrors Kotlin Flow's `this.flow(ChildController::class.java, input)` pattern
where the parent suspends until the child completes.

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
  childInstanceId?: string; // If currently waiting on a child
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
  childInstanceId?: string; // If a child machine was spawned
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
Inspired by the Effect middleware pattern already in the server.

```typescript
interface TransitionMiddleware {
  name: string;
  beforeTransition?: (ctx: MiddlewareContext) => Promise<void>;
  afterTransition?: (ctx: MiddlewareContext & { result: TransitionResult }) => Promise<void>;
  onError?: (ctx: MiddlewareContext & { error: Error }) => Promise<void>;
}

interface MiddlewareContext {
  instance: MachineInstance;
  stateName: string;
  stateData: unknown;
  definition: StateMachineDefinition;
}
```

**Built-in middleware:**

- **TelemetryMiddleware** — Records timing, transition counts, error rates
- **AuditMiddleware** — Immutable audit log of every transition with actor, timestamp, data
- **LoggingMiddleware** — Structured logs for each state (integrates with Effect logger)
- **ValidationMiddleware** — Validates stateData against the state's `dataSchema` before entering

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
// The "after child" action for ProcessData state
async function processDataAfterChild(ctx: ActionContext): Promise<TransitionResult> {
  const childResult = ctx.stateData; // contains the child's MachineResult (including instanceId)
  if (childResult.validCount > 0) {
    // Parent can also access files the child generated:
    // await ctx.artifacts.readChild(childResult.instanceId, 'output.csv')
    return { nextState: 'SaveResults', data: childResult };
  }
  return { nextState: 'HandleError', data: { reason: 'No valid records' } };
}
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
  The runner uses async/await (no blocking).
- **Error handling**: If an action throws, the machine transitions to an error terminal
  state. Middleware `onError` hooks fire. The error is recorded in the instance.
- **Idempotency**: Starting a machine returns an instance ID. Repeated GETs are safe.
- **Type safety**: Full TypeScript types for definitions, instances, actions, middleware.
  JSON Schemas for runtime validation of state data.

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
interface ArtifactStore {
  /** Write a file into this instance's artifact directory. */
  write(
    name: string,
    content: Buffer | string,
    metadata?: ArtifactMetadata,
  ): Promise<ArtifactRecord>;

  /** Read a file from this instance's artifact directory. */
  read(name: string): Promise<Buffer>;

  /** List all artifacts for this instance (not including children). */
  list(): Promise<ArtifactRecord[]>;

  /**
   * Read a file from a child instance's artifact directory.
   * `childInstanceId` must be a direct or transitive child of this instance.
   */
  readChild(childInstanceId: string, name: string): Promise<Buffer>;

  /** List artifacts from a child instance. */
  listChild(childInstanceId: string): Promise<ArtifactRecord[]>;

  /** Resolve the absolute filesystem path for an artifact (for use by actions that
   *  need to pass a path to external tools). */
  resolvePath(name: string): string;
}

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
async function afterValidation(ctx: ActionContext): Promise<TransitionResult> {
  const childResult = ctx.stateData; // child's MachineResult
  const childId = childResult.instanceId;

  // Read the CSV the child produced
  const csvBuffer = await ctx.artifacts.readChild(childId, 'validation-results.csv');

  // Write a combined report that includes child data
  await ctx.artifacts.write(
    'combined-report.json',
    JSON.stringify({
      parentData: ctx.machineInput,
      childValidation: csvBuffer.toString('utf-8'),
    }),
    { description: 'Combined parent + child report' },
  );

  return { nextState: 'Deliver', data: { reportReady: true } };
}
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
  `ActionContext`, `TransitionResult`, `TransitionMiddleware`, `StateLogger`, `ServiceContainer`,
  `JsonSchema` (type alias for JSON Schema objects used in `inputSchema`/`outputSchema`/`dataSchema`),
  `ArtifactStore`, `ArtifactRecord`, `ArtifactMetadata`, `ArtifactTree`
- `server/src/machines/schemas.ts` — `@effect/schema` validators for all types
  (consistent with the project-wide decision to use Effect Schema — see SETUP_PLAN Decision #1)

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

The execution engine.

**Files:**

- `server/src/machines/StateMachineRunner.ts` — Core runner Effect Service
  - `run(definition, input, opts?)` → `Effect<MachineResult, MachineError>`
  - Manages the state loop, action dispatch, child machine spawning
  - Calls middleware hooks around each transition
  - Records transition history and logs on the instance
  - Implemented as an Effect Layer, taking `ActionRegistry` and `MachineStore` as dependencies
- `server/src/machines/StateLogger.ts` — Scoped logger for a state (writes to instance's log entries)

#### 1.4 Middleware

**Files:**

- `server/src/machines/middleware/index.ts` — Re-exports
- `server/src/machines/middleware/TelemetryMiddleware.ts` — Timing per transition
- `server/src/machines/middleware/AuditMiddleware.ts` — Immutable audit trail
- `server/src/machines/middleware/LoggingMiddleware.ts` — Structured logs via Effect logger
- `server/src/machines/middleware/ValidationMiddleware.ts` — Schema validation on state data

#### 1.5 In-Memory Store

**Files:**

- `server/src/machines/store/MachineStore.ts` — Interface for persistence
- `server/src/machines/store/InMemoryMachineStore.ts` — In-memory implementation with
  `Map<string, StateMachineDefinition>` and `Map<string, MachineInstance>`

#### 1.6 Artifact Store

**Files:**

- `server/src/machines/artifacts/ArtifactStore.ts` — `ArtifactStore` interface + factory.
  Creates scoped instances bound to a machine instance ID. Writes files under
  `<ARTIFACT_ROOT>/<instanceId>/`, nests children under `children/<childId>/`.
  Validates filenames (no path traversal). Records `ArtifactRecord` entries on the
  `MachineInstance`.
- `server/src/machines/artifacts/FsArtifactStore.ts` — Filesystem-backed implementation
  using `node:fs/promises`. Configured via `ARTIFACT_ROOT` env var (default `./data/artifacts`).
  Implemented as an Effect Layer.

#### 1.7 Tests

Tests are co-located with source files, matching the established project pattern
(e.g., `hello.test.ts` beside `hello.ts`, `HomePage.test.tsx` beside `HomePage.tsx`).

**Files:**

- `server/src/machines/StateMachineRunner.test.ts` — Core runner tests
  - Simple linear machine
  - Branching machine
  - Child machine composition
  - Error handling
  - Middleware execution order
  - Artifact creation during actions
  - Parent reading child artifacts after child completes
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

#### 2.3 Tests

**Files:**

- `server/src/routes/machines/definitions.test.ts`
- `server/src/routes/machines/instances.test.ts`

---

### Phase 3 — WebSocket Live Updates

> Goal: Real-time state change and log streaming to clients.

#### 3.1 WebSocket Server

**Files:**

- `server/src/machines/live/WebSocketManager.ts` — Manages WS connections, subscriptions,
  broadcasts events per instance
- `server/src/machines/live/events.ts` — Event types: `state_changed`, `transition_recorded`,
  `log_entry`, `machine_completed`, `child_spawned`, `child_completed`

#### 3.2 Hook into Runner

The runner emits events through an `EventEmitter` / Effect `PubSub`. The
`WebSocketManager` subscribes and forwards to connected clients.

**Modified files:**

- `server/src/machines/StateMachineRunner.ts` — Emit events on each transition
- `server/src/lib/HttpServer.ts` — Mount WS upgrade handler

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
  a selected state (name, action, child machine, schemas)
- `client/src/components/machines/editor/ActionPicker.tsx` — Dropdown/search for
  registered actions
- `client/src/components/machines/editor/ChildMachinePicker.tsx` — Pick a definition to use
  as a child machine
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
   │        │        └──→ Phase 4 (Client Viewer) ──→ Phase 6 (Polish)
   │        │                                              ▲
   │        └──→ Phase 5 (Client Editor) ─────────────────┘
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

3. **Effect integration** — The server already uses Effect. The runner and stores will be
   implemented as Effect services/layers for clean dependency injection and error handling.

4. **WebSocket for liveness, REST for everything else** — WS is only for real-time
   streaming of state changes and logs. All CRUD goes through REST.

5. **In-memory first, persistence interface ready** — The `MachineStore` interface makes
   it trivial to swap in SQLite/Postgres later without changing the runner or API layer.
