# State Machine — Testable Behaviors

> Comprehensive catalog of discrete, end-to-end testable behaviors derived from the
> [00-state-machine.md](00-state-machine.md) and
> [01-state-machine-working-directory.md](01-state-machine-working-directory.md) feature
> specifications. Intended as the source of truth for Playwright e2e tests and
> integration tests. Each item describes an observable behavior from the outside — what
> a client or API consumer can verify.

---

## 1. Definition CRUD

### 1.1 Create

- [ ] `POST /api/machines/definitions` with a valid body returns 201 and the created definition with a generated `id`
- [ ] Created definition has `version: 1` and populated `metadata.createdAt` / `metadata.updatedAt`
- [ ] The created definition appears in `GET /api/machines/definitions` list
- [ ] Creating a definition with the same `name` as an existing one succeeds (names are not unique keys)

### 1.2 Read

- [ ] `GET /api/machines/definitions/:id` returns the full definition JSON
- [ ] `GET /api/machines/definitions/:id` for a non-existent ID returns 404
- [ ] `GET /api/machines/definitions` returns an array of all saved definitions

### 1.3 Update

- [ ] `PUT /api/machines/definitions/:id` with a valid body returns the updated definition
- [ ] Update increments `version` monotonically
- [ ] Update refreshes `metadata.updatedAt`
- [ ] `PUT` on a non-existent ID returns 404

### 1.4 Delete

- [ ] `DELETE /api/machines/definitions/:id` returns success
- [ ] Deleted definition no longer appears in list or by direct GET (404)
- [ ] `DELETE` on a non-existent ID returns 404

---

## 2. Definition Validation

> These rules are enforced at save time (POST/PUT) and again at run time. Each rule
> maps to a specific validation from the spec (§1 "Definition Validation").

### 2.1 Structural Rules

- [ ] **Rule 1** — Reject definition where `initialState` does not reference a key in `states`
- [ ] **Rule 2** — Reject definition missing any of the three required terminal states (`completed`, `cancelled`, `error`) or where any of them has `type` other than `'terminal'`
- [ ] **Rule 3** — Reject definition with a transition originating `from` a terminal state
- [ ] **Rule 4** — Reject definition where a `transitions[]` entry references a non-existent state in `from` or `to`
- [ ] **Rule 5** — Reject definition where a non-terminal state has zero outgoing transitions
- [ ] **Rule 6** — Reject definition where a non-terminal state is unreachable from `initialState` via transitions (orphan). Terminal states are exempt.
- [ ] **Rule 7** — Reject definition where `StateDefinition.name` does not match its key in the `states` record

### 2.2 State Type Rules

- [ ] **Rule 8** — At run time, reject definition where an `action` state's `actionId` does not reference a registered action. At save time, this is advisory (warning, not rejection).
- [ ] **Rule 9** — Reject `child_machine` state missing any of: `actionId`, `childMachineDefId`, `childInputMapping`
- [ ] **Rule 10** — Reject `parallel_children` state missing `actionId` or with an empty `children[]`
- [ ] **Rule 11** — Reject `terminal` state that has `actionId`, `childMachineDefId`, or `children` set

### 2.3 Referential Integrity

- [ ] **Rule 12** — Reject definition where `childMachineDefId` references (or `children[].machineDefId` references) form a cycle (e.g., machine A → child B → child A)
- [ ] **Rule 13** — Reject definition where `inputSchema`, `outputSchema`, or any `dataSchema` is not a valid JSON Schema document (checked via `ajv.validateSchema()`)
- [ ] **Rule 14** — Reject `parallel_children` state where `children[]` entries have duplicate `key` values

### 2.4 Validation Error Response

- [ ] Validation failures return a `DefinitionError` with a descriptive `message` and `details[]` listing each violated rule
- [ ] Multiple validation violations are reported together (not just the first one)

---

## 3. Action Registry

- [ ] `GET /api/machines/actions` returns a list of all registered action functions with metadata (id, description)
- [ ] `GET /api/machines/actions/:id` returns metadata for a specific registered action
- [ ] `GET /api/machines/actions/:id` for a non-existent action ID returns 404
- [ ] Built-in actions are present on server startup: `http-request`, `delay`, `transform-data`, `log-message`, `conditional-branch`

---

## 4. Machine Execution — Linear Flow

### 4.1 Start & Complete

- [ ] `POST /api/machines/instances` with a valid definition ID, input, and `workspaceRoot` returns 201 with an instance ID
- [ ] The returned instance has `status: 'running'` (or `'completed'` if fast enough) and `currentState` set
- [ ] The returned instance includes `workspaceRoot`, `familyRootInstanceId`, and `artifactsPath`
- [ ] For a root instance, `familyRootInstanceId` equals the instance's own `id`
- [ ] `artifactsPath` points to `<ARTIFACT_ROOT>/<familyRootInstanceId>/`
- [ ] A simple linear machine (A → B → C → completed) runs to the `completed` terminal state
- [ ] On completion, `GET /instances/:id` shows `status: 'completed'` and populated `output`
- [ ] The `output` matches what the final action returned as transition `data` to the `completed` state

### 4.2 State Data Flow

- [ ] The initial state's action receives `ctx.machineInput` matching the input provided at start
- [ ] `ctx.stateData` in the initial state equals the machine's `input` (same as `machineInput`)
- [ ] When an action returns `{ nextState, data }`, the next state's action receives that `data` as `ctx.stateData`
- [ ] When an action returns `{ nextState }` without `data` (or `data: undefined`), the previous `stateData` carries forward unchanged
- [ ] `ctx.machineInput` remains the same immutable original input in every state throughout the machine's lifetime
- [ ] Each action receives the correct `ctx.stateName`, `ctx.machineInstanceId`, and `ctx.machineDefId`

### 4.3 Input Validation

- [ ] Starting an instance with input that violates the definition's `inputSchema` returns a validation error (machine never created)
- [ ] Starting an instance with input that satisfies `inputSchema` proceeds normally
- [ ] Starting an instance for a non-existent definition ID returns 404

### 4.4 Workspace Root Validation

- [ ] Starting an instance without `workspaceRoot` returns 400 Bad Request
- [ ] Starting an instance with a relative `workspaceRoot` returns a validation error
- [ ] Starting an instance with a `workspaceRoot` that does not exist on disk returns a validation error
- [ ] Starting an instance with a valid absolute `workspaceRoot` that exists succeeds

### 4.5 Transition History

- [ ] `GET /instances/:id/history` returns an ordered array of `TransitionRecord`s
- [ ] Each record has `fromState`, `toState`, `timestamp`, `durationMs`, and `actionId`
- [ ] History length equals the number of transitions the machine took
- [ ] History records are in chronological order

### 4.6 Logs

- [ ] `GET /instances/:id/logs` returns all `LogEntry` records emitted during execution
- [ ] Each log entry has `stateName`, `level`, `message`, `timestamp`
- [ ] `GET /instances/:id/logs?state=X` returns only logs from state X
- [ ] Actions that call `ctx.logger.info(...)` produce entries with `level: 'info'`
- [ ] Actions that call `ctx.logger.error(...)` produce entries with `level: 'error'`

---

## 5. Machine Execution — Branching

- [ ] An action that inspects `ctx.stateData` and returns different `nextState` values causes the machine to follow different paths depending on the data
- [ ] The `conditional-branch` built-in action routes to different states based on a condition in stateData
- [ ] A machine can reach the `completed` terminal via multiple valid paths through the graph
- [ ] A machine can reach the `error` terminal from any non-terminal state (if the action decides so)

---

## 6. Machine Execution — Error Handling

### 6.1 Action Failure

- [ ] If an action's Effect fails (throws or returns a failed Effect), the machine transitions to the `error` terminal state
- [ ] The instance's `error` field contains a descriptive error message
- [ ] The instance's `status` is `'error'`
- [ ] A `machine_completed` event with `status: 'error'` is emitted

### 6.2 Illegal Transition

- [ ] If an action returns a `nextState` that is not an allowed transition from the current state per `transitions[]`, the machine fails with `DefinitionError`
- [ ] The error message identifies the illegal transition (from → to)

### 6.3 Data Validation

- [ ] If stateData fails the target state's `dataSchema` validation (via ValidationMiddleware), the machine transitions to error
- [ ] The error includes the schema validation details

### 6.4 Middleware Error Propagation

- [ ] If `beforeTransition` middleware fails with `MachineError`, the machine transitions to error
- [ ] The middleware's `onError` hooks fire when an action or middleware fails

---

## 7. Machine Execution — Timeouts & Safety Limits

### 7.1 Action Timeout

- [ ] A state with `timeoutMs: 500` that runs an action exceeding 500ms causes the machine to error with a timeout-related message
- [ ] A state without `timeoutMs` allows unbounded action execution (no artificial timeout)

### 7.2 Machine-Level Timeout

- [ ] `run(definition, input, { timeoutMs: 2000 })` causes the entire machine to error if it hasn't completed within 2 seconds

### 7.3 Max Depth

- [ ] A chain of child machines exceeding `MAX_MACHINE_DEPTH` (default: 10) fails with `DefinitionError`
- [ ] Depth 10 is allowed; depth 11 is rejected
- [ ] The error message identifies the depth limit as the cause

---

## 8. Child Machine — Single

### 8.1 Spawning & Completion

- [ ] A `child_machine` state spawns a child instance that appears in `GET /instances` with a `parentInstanceId` pointing to the parent
- [ ] The parent instance's `status` becomes `'waiting_for_child'` while the child runs
- [ ] The parent instance's `childInstanceId` is set to the child's ID while waiting
- [ ] When the child completes, the parent's `stateData` is set to the child's `MachineResult`
- [ ] The parent's `actionId` runs after the child completes, receiving the child result
- [ ] The parent continues its state loop based on the action's `TransitionResult`
- [ ] On final completion, both parent and child instances have `status: 'completed'`

### 8.2 Input Mapping

- [ ] `childInputMapping` JSONPath expression correctly extracts child input from `{ stateData, machineInput, stateName }`
- [ ] The child receives the extracted value as its `machineInput`
- [ ] An invalid JSONPath expression causes the parent to error (not silently produce null)

### 8.3 Child Failure

- [ ] If the child machine errors, the parent's action receives a `MachineResult` with `status: 'error'`
- [ ] The parent action can inspect the child error and decide the transition (e.g., route to error or retry)

### 8.4 Context

- [ ] The child action's `ctx.parentContext` is populated with `parentInstanceId` and `parentStateName`
- [ ] The child's `TransitionRecord` entries include `childInstanceId` and `childDefinitionId`
- [ ] The parent's `TransitionRecord` for the child_machine state includes `childInstanceId`

### 8.5 Workspace & Family Inheritance

- [ ] The child instance inherits the parent's `workspaceRoot` (same user workspace)
- [ ] The child instance inherits the parent's `familyRootInstanceId` (always the top-level root's ID)
- [ ] The child's `artifactsPath` equals the parent's `artifactsPath` (shared family root)
- [ ] The child's `ctx.workspace.root` is the same as the parent's `ctx.workspace.root`
- [ ] The child's `ctx.artifactsWorkspace.root` is the same as the parent's `ctx.artifactsWorkspace.root`

---

## 9. Parallel Children

### 9.1 All Succeed

- [ ] A `parallel_children` state with 3 children spawns 3 child instances, all visible in `GET /instances`
- [ ] The parent's `childInstanceIds` (keyed by `ChildSpawnDefinition.key`) is set while waiting
- [ ] All 3 children run (potentially concurrently) and complete
- [ ] The parent's `stateData` is a `ParallelChildrenResult` with `results` keyed by child `key` and `childInstanceIds` mapping
- [ ] The parent's `actionId` runs after all children complete, receiving the collected results
- [ ] Each child result has `status: 'completed'`

### 9.2 `all_or_interrupt` Mode (Default)

- [ ] If one child errors, the remaining children are interrupted (their fibers cancelled)
- [ ] Interrupted children end with `status: 'cancelled'`
- [ ] The parent's action receives partial results (one error, others cancelled)
- [ ] The parent action can route to an error-handling state based on which child failed

### 9.3 `all_settled` Mode

- [ ] If one child errors, the remaining children are allowed to finish
- [ ] The parent's action receives all results: some completed, some errored
- [ ] No child is interrupted due to another child's failure

### 9.4 Input Mapping

- [ ] Each child's `inputMapping` JSONPath expression extracts the correct input from the parent's context
- [ ] Different children receive different inputs (e.g., regional data slices)

### 9.5 Key Uniqueness

- [ ] Results are correctly keyed by `ChildSpawnDefinition.key` — no key collisions
- [ ] The action can identify which child produced which result by key

### 9.6 Workspace & Family Inheritance

- [ ] All parallel children inherit the parent's `workspaceRoot`
- [ ] All parallel children inherit the parent's `familyRootInstanceId`
- [ ] All parallel children share the same `artifactsWorkspace.root` (the family root)

---

## 10. Concurrency & Semaphore

### 10.1 Bounded Active Concurrency

- [ ] Starting more instances than `MAX_CONCURRENT_MACHINES` causes excess machines to queue (not reject)
- [ ] Queued machines start as permits become available
- [ ] Active instance count never exceeds the semaphore permit count

### 10.2 Release-Before-Wait (No Deadlock)

- [ ] A parent with a `child_machine` state releases its semaphore permit before the child runs — child can acquire a permit even if the pool is near capacity
- [ ] A linked-list chain of 51+ single-child machines (deeper than semaphore permits) completes without deadlock — only the deepest active machine holds a permit at any time
- [ ] Fan-out: a parent with 10 parallel children releases its permit, and all 10 children compete for permits — the parent does not hold one while waiting
- [ ] Mixed nesting (parallel children that spawn their own children) completes without deadlock

---

## 11. Cancellation

### 11.1 Cancel Running Instance

- [ ] `POST /instances/:id/cancel` on a running instance returns success
- [ ] The instance transitions to `status: 'cancelled'`
- [ ] The instance's `currentState` is `'cancelled'` (the terminal state)
- [ ] A `machine_completed` event with `status: 'cancelled'` is published

### 11.2 Cancel While Waiting for Child

- [ ] Cancelling a parent that is `waiting_for_child` (single) also cancels the child
- [ ] Both parent and child reach `status: 'cancelled'`
- [ ] The child fires its own `machine_completed` event with `status: 'cancelled'`

### 11.3 Cancel While Waiting for Parallel Children

- [ ] Cancelling a parent waiting on parallel children interrupts all running children
- [ ] All children reach `status: 'cancelled'`
- [ ] Each child fires its own `machine_completed` event

### 11.4 Cancel Suspended Instance

- [ ] Cancelling a `suspended` instance directly transitions it to `cancelled` (no fiber to interrupt)
- [ ] The instance's status becomes `'cancelled'`

### 11.5 Cancel Idempotency / Conflict

- [ ] Cancelling an already-completed instance returns 409 Conflict
- [ ] Cancelling an already-cancelled instance returns 409 Conflict
- [ ] Cancelling an already-errored instance returns 409 Conflict

### 11.6 Transition History

- [ ] The cancellation is recorded in the instance's `history[]` as a transition to the `cancelled` state

---

## 12. Resumability & Graceful Shutdown

### 12.1 Graceful Shutdown — Suspension

- [ ] On `SIGTERM` / `SIGINT`, all `running` instances are interrupted and persisted with `status: 'suspended'`
- [ ] Instances that were `waiting_for_child` are also suspended
- [ ] Children of suspended parents are themselves suspended recursively
- [ ] Suspended instances are **not** marked `cancelled` — they are distinct statuses
- [ ] The server waits for all finalizers to complete (up to `SHUTDOWN_TIMEOUT_MS`)
- [ ] After shutdown, `GET /instances` shows suspended instances (in-memory store within single process lifetime)

### 12.2 Resume — Happy Path

- [ ] `POST /instances/:id/resume` on a suspended simple-linear machine returns success
- [ ] The instance's status changes to `'running'` and then reaches a terminal state
- [ ] The runner re-enters `currentState` (the state whose action was interrupted) and re-executes the action
- [ ] Already-completed transitions (in `history[]`) are not re-executed
- [ ] A `machine_resumed` event is published with `previousState` and `resumedState`
- [ ] The machine runs to completion from the resumed state

### 12.3 Resume — With Single Child

- [ ] Resuming a parent whose `childInstanceId` points to a suspended child resumes the child first
- [ ] The child completes, then the parent continues (its action receives the child result)
- [ ] If the child already completed before shutdown, its stored `MachineResult` is used directly (child not re-run)

### 12.4 Resume — With Parallel Children

- [ ] Resuming a parent with mixed-status parallel children: suspended children are resumed, already-completed children are not re-run
- [ ] The parent waits for all children to reach a terminal state before continuing
- [ ] The collected `ParallelChildrenResult` is correct, mixing pre-completed and just-resumed results

### 12.5 Resume — Rejection

- [ ] Resuming a non-suspended instance (running, completed, cancelled, error) returns 409 Conflict
- [ ] Resuming an instance whose definition version has changed since execution started fails with `DefinitionError`
- [ ] Resuming an instance whose definition has been deleted fails with `NotFoundError`

### 12.6 Startup Recovery

- [ ] With `AUTO_RESUME_ON_STARTUP=true`, the server automatically resumes all suspended top-level instances on startup
- [ ] Child instances are resumed by their parent's resume protocol (not independently at startup)
- [ ] Instances are resumed in `updatedAt` order (oldest first)
- [ ] Instances that fail to resume (deleted definition, version mismatch) are moved to `'error'` status
- [ ] With `AUTO_RESUME_ON_STARTUP=false` (default), suspended instances remain suspended until manually resumed

---

## 13. Persistence Checkpoints

> These behaviors verify that the `MachineInstance` is in the correct state at each
> checkpoint, which is essential for correct resume behavior.

- [ ] **Checkpoint 1 — Instance creation**: immediately after start, a `GET /instances/:id` returns `status: 'running'`, `currentState` = `initialState`, `stateData` matching input, and `workspaceRoot` / `familyRootInstanceId` / `artifactsPath` populated
- [ ] **Checkpoint 2 — Before state entry**: `currentState` and `stateData` are persisted before the action runs (if the action were to "crash", the store reflects the unfinished state)
- [ ] **Checkpoint 3 — After transition**: `history[]` is appended, `currentState` is advanced to `nextState`, `stateData` is the transition result's `data`
- [ ] **Checkpoint 4 — Terminal state**: `status` is one of `'completed'` / `'cancelled'` / `'error'`; `output` or `error` field is populated
- [ ] **Checkpoint 5 — Suspension**: `status` is `'suspended'`, `currentState` reflects the interrupted state

---

## 14. Middleware

### 14.1 Execution Order

- [ ] `beforeTransition` middleware fires before each action execution
- [ ] `afterTransition` middleware fires after each action completes, receiving the `TransitionResult`
- [ ] Multiple middlewares execute in registration order for `beforeTransition` (first registered = first to run)
- [ ] Multiple middlewares execute in reverse registration order for `afterTransition` (onion model)

### 14.2 Cross-Cutting Concerns

- [ ] **ValidationMiddleware**: if a state has `dataSchema` and incoming `stateData` violates it, the machine errors before the action runs
- [ ] **LoggingMiddleware**: structured log output is produced for each transition (observable via server logs or log entries)
- [ ] **AuditMiddleware**: an immutable audit record is created for each transition with actor, timestamp, and transition data
- [ ] **TelemetryMiddleware**: an OpenTelemetry span is created per transition with `machineDefId`, `instanceId`, `stateName`, `actionId` attributes

### 14.3 Child Machine Middleware

- [ ] Middleware fires on child machine transitions independently of the parent
- [ ] A child that performs 5 transitions causes each middleware to fire 5 times for that child
- [ ] The `MiddlewareContext.instance.parentInstanceId` allows middleware to distinguish child from parent transitions

---

## 15. Working Directories & Artifacts Workspace

> After the working-directory migration, the term "artifact" refers to any file written
> to the artifacts workspace. There are no system-managed artifact records, metadata, or
> artifact API endpoints. Artifacts are plain files accessed via
> `ctx.artifactsWorkspace.resolve(...)`.

### 15.1 User Workspace

- [ ] `ctx.workspace.root` returns the absolute `workspaceRoot` path provided at instance start
- [ ] `ctx.workspace.resolve('path/to/file')` returns an absolute path within the workspace root
- [ ] The workspace root is inherited by child instances (same value as parent)
- [ ] Actions can read and write files within the workspace root via standard filesystem operations

### 15.2 Artifacts Workspace — Family Root

- [ ] `ctx.artifactsWorkspace.root` returns `<ARTIFACT_ROOT>/<familyRootInstanceId>/`
- [ ] `ctx.artifactsWorkspace.resolve('report.json')` returns an absolute path within the family root
- [ ] The artifacts workspace root is the same for all instances in the same family (parent, children, grandchildren)
- [ ] The artifacts workspace directory is created on disk when the root instance starts

### 15.3 Artifacts Workspace — File Operations

- [ ] An action can write a file to the artifacts workspace using `ctx.artifactsWorkspace.resolve('report.json')` and standard filesystem APIs
- [ ] An action can read a file from the artifacts workspace using the resolved path
- [ ] No path traversal restrictions are enforced — the artifacts root is advisory only
- [ ] Actions may write to any path (including absolute paths outside the artifacts workspace) — no enforcement

### 15.4 Family Artifact Sharing

- [ ] A child action can access parent artifacts via `ctx.artifactsWorkspace.resolve('parent-report.json')` (shared family root)
- [ ] A parent action can access child artifacts via `ctx.artifactsWorkspace.resolve('children/<childInstanceId>/file.json')` after the child completes
- [ ] Siblings within the same family share the same `artifactsWorkspace.root` and can access each other's files
- [ ] The `children/<childInstanceId>/` subdirectory structure is a naming convention, not enforced by the system

### 15.5 Instance Payload

- [ ] `GET /instances/:id` includes `workspaceRoot` (the user-specified workspace path)
- [ ] `GET /instances/:id` includes `familyRootInstanceId` (the top-level root instance ID)
- [ ] `GET /instances/:id` includes `artifactsPath` (the resolved family artifacts root directory path)
- [ ] The instance payload does **not** include `artifacts: ArtifactRecord[]` (removed)

### 15.6 Removed Artifact API Surface

- [ ] `GET /instances/:id/artifacts` returns 404 (endpoint removed)
- [ ] `GET /instances/:id/artifacts/:name` returns 404 (endpoint removed)
- [ ] `GET /instances/:id/artifacts?tree=true` returns 404 (endpoint removed)
- [ ] No `ArtifactRecord`, `ArtifactStore`, or `ArtifactTree` types exist in the codebase

---

## 16. CLI Helper

> The CLI helper (`ctx.cli`) provides standardized command execution and result capture.
> It is a plain property on `ActionContext`, constructed by the runner.

### 16.1 Basic Execution

- [ ] `ctx.cli.exec({ command: 'echo', args: ['hello'] })` returns a `CliExecResult` with `exitCode: 0` and `stdout: 'hello\n'`
- [ ] `CliExecResult` contains `exitCode`, `stdout`, `stderr`, and `durationMs`
- [ ] `exec` never fails in the Effect error channel — all outcomes are surfaced in `CliExecResult`
- [ ] Spawn failures (e.g., command not found) set `exitCode: -1` with the error message in `stderr`

### 16.2 Working Directory

- [ ] By default, CLI commands run in `ctx.workspace.root` (the user workspace)
- [ ] `cli.exec({ command, cwd: '/some/path' })` runs the command in the specified directory
- [ ] Actions may issue multiple `cli.exec(...)` calls with different `cwd` values within a single action
- [ ] `cwd` may be set to any path — no enforcement or restriction

### 16.3 Environment Variables

- [ ] Every `cli.exec(...)` call provides `WORKSPACE_ROOT` in the process environment (set to `ctx.workspace.root`)
- [ ] Every `cli.exec(...)` call provides `ARTIFACTS_ROOT` in the process environment (set to `ctx.artifactsWorkspace.root`)
- [ ] Actions may pass additional env vars via `cli.exec({ command, env: { MY_VAR: 'value' } })`
- [ ] Action-provided env vars are merged with (and override) the default environment

### 16.4 Output Capture

- [ ] `stdout` is captured up to 1 MiB; larger output is truncated with a `\n...<truncated>` suffix
- [ ] `stderr` is captured up to 1 MiB; larger output is truncated with a `\n...<truncated>` suffix
- [ ] The action still receives `exitCode` and `durationMs` even when output is truncated

### 16.5 Timeout Integration

- [ ] The CLI helper does **not** enforce its own timeout — it runs the child process indefinitely
- [ ] If the state's `timeoutMs` fires, the runner interrupts the action's Effect fiber and kills the in-flight child process
- [ ] There is no `timedOut` field or timeout sentinel exit code in `CliExecResult`

### 16.6 Exit Code Branching

- [ ] An action can inspect `result.exitCode` and return different `nextState` values based on success (`0`) vs failure (non-zero)
- [ ] Non-zero exit codes do **not** automatically fail the machine — the action decides the transition
- [ ] An action can parse `result.stdout` (e.g., JSON) to determine the next state dynamically

---

## 17. WebSocket — Live Updates

### 17.1 Connection & Subscription

- [ ] Client connects to `ws://host/api/machines/live` successfully
- [ ] Sending `{ type: 'subscribe', instanceId }` begins receiving events for that instance
- [ ] Sending `{ type: 'unsubscribe', instanceId }` stops events for that instance
- [ ] Subscribing to multiple instances concurrently delivers events for all of them
- [ ] Events for instances the client is **not** subscribed to are **not** delivered

### 17.2 Event Types

- [ ] `state_changed` event fires on each state transition with `previousState`, `currentState`, `stateData`, `timestamp`
- [ ] `transition_recorded` event fires with the full `TransitionRecord` after each transition
- [ ] `log_entry` event fires when an action writes a log via `ctx.logger`
- [ ] `machine_completed` event fires when the machine reaches any terminal state (completed, cancelled, error)
- [ ] `child_spawned` event fires when a `child_machine` state spawns a child, with `childInstanceId` and `childDefinitionId`
- [ ] `child_completed` event fires when the single child finishes, with the child's `MachineResult`
- [ ] `children_spawned` event fires when a `parallel_children` state spawns all children, with `childInstanceIds` (keyed)
- [ ] `children_completed` event fires when all parallel children finish, with `results` (keyed)
- [ ] `machine_resumed` event fires when a suspended instance is resumed, with `previousState` and `resumedState`

> **Removed:** The `artifact_created` event has been removed. Artifacts are plain files
> in the artifacts workspace — there is no system-level artifact tracking or event emission.

### 17.3 Event Ordering

- [ ] Events for a single instance arrive in causal order (state_changed before transition_recorded for the same transition)
- [ ] Log entries from an action arrive before the transition_recorded event for that action's state

### 17.4 Reconnection

- [ ] After a WebSocket disconnect, the client reconnects with exponential backoff (1s → 2s → 4s → … → 30s cap)
- [ ] On reconnect, the client re-subscribes to previously subscribed instances
- [ ] Events that occurred during the disconnect are not replayed (client should re-fetch state via REST)

---

## 18. Client UI — Dashboard

- [ ] The machines dashboard page lists all saved definitions
- [ ] Each definition shows its name, version, description, and tags
- [ ] A "Create New" button navigates to the definition editor with a blank definition
- [ ] An "Edit" action on a definition navigates to the definition editor pre-populated
- [ ] A "Delete" action on a definition removes it (with confirmation) and refreshes the list
- [ ] The dashboard lists recent / running / suspended instances
- [ ] Each instance row shows: definition name, status, current state, created timestamp
- [ ] Suspended instances display a "Resume" button that calls `POST /instances/:id/resume` and refreshes
- [ ] A "Quick Start" control allows: selecting a definition, entering JSON input, specifying a workspace root, and clicking "Launch"
- [ ] Launching redirects to the new instance's viewer page

---

## 19. Client UI — Instance Viewer

### 19.1 State Diagram

- [ ] The instance page renders a state diagram (node-and-edge graph) from the definition
- [ ] The current state node is visually highlighted (distinct color/border)
- [ ] Terminal states are visually distinct from action states
- [ ] Transitions (edges) are labeled when the definition provides labels
- [ ] As the machine progresses (via WebSocket), the highlighted node updates in real time

### 19.2 Transition History

- [ ] A history panel/table shows all completed transitions in chronological order
- [ ] Each row shows: from → to, action ID, duration, timestamp
- [ ] Transition data (stateData carried) is expandable / viewable per row
- [ ] New transitions appear in real time as the machine runs

### 19.3 Logs Panel

- [ ] A logs panel displays all log entries for the instance
- [ ] Logs can be filtered by state name (dropdown of all states)
- [ ] Logs can be filtered by level (debug, info, warn, error)
- [ ] New log entries appear in real time via WebSocket
- [ ] Log entries show timestamp, state, level, message, and optional data

### 19.4 Child Machine Tree

- [ ] If the instance spawned children, a tree view shows the parent → child hierarchy
- [ ] Clicking a child in the tree navigates to that child's instance viewer page
- [ ] Parallel children are grouped under their parent state
- [ ] The tree updates live when children are spawned or complete

### 19.5 Artifacts Path Display

> The artifacts panel displays the `artifactsPath` from the instance payload as a
> read-only filesystem path. There is no artifacts API or file browser — the user
> accesses the artifacts workspace directory on their own filesystem.

- [ ] The instance viewer displays the `artifactsPath` as a read-only text string
- [ ] The path is selectable / copyable by the user
- [ ] The `workspaceRoot` is also displayed alongside the artifacts path

---

## 20. Client UI — Definition Editor

### 20.1 Visual Graph Editing

- [ ] The editor displays states as draggable nodes on a canvas
- [ ] Transitions are displayed as connectable edges between nodes
- [ ] Adding a new state creates a node that can be positioned on the canvas
- [ ] Connecting two nodes creates a transition rule in the definition
- [ ] Removing a node removes the state and all its transitions
- [ ] Removing an edge removes the corresponding transition rule
- [ ] The three required terminal states (`completed`, `cancelled`, `error`) are always present and cannot be deleted

### 20.2 State Configuration

- [ ] Selecting a state node opens a side panel for configuration
- [ ] The panel allows setting: name, type, description
- [ ] For `action` type: an action picker dropdown lists all registered actions from the server
- [ ] For `child_machine` type: a picker lists all saved definitions to choose as the child, plus fields for `childInputMapping`
- [ ] For `parallel_children` type: a list editor allows adding/removing `ChildSpawnDefinition` entries (key, machineDefId, inputMapping)
- [ ] For `parallel_children`: a `parallelMode` selector (all_or_interrupt / all_settled)
- [ ] Schema editors allow defining `dataSchema` per state and `inputSchema` / `outputSchema` for the machine

### 20.3 Validation

- [ ] A "Validate" button checks all 14 definition validation rules and displays errors inline
- [ ] Errors highlight the offending states/transitions on the canvas
- [ ] The "Save" button is disabled (or warns) when validation errors exist
- [ ] Validation errors include human-readable descriptions of each violation

### 20.4 Import / Export

- [ ] An "Export JSON" button downloads the current definition as a JSON file
- [ ] An "Import JSON" button loads a definition from a JSON file into the editor
- [ ] Importing an invalid JSON file shows a parse error

### 20.5 Editor State

- [ ] Undo / Redo support for all editing operations (add state, remove state, add transition, change config)
- [ ] Dirty tracking: the editor warns before navigating away with unsaved changes
- [ ] Node positions are persisted (in the editor state) so reopening the editor preserves the layout

---

## 21. End-to-End Workflows

> Full user journeys that exercise multiple subsystems together. These are the most
> valuable e2e tests — they prove the system works as a whole.

### 21.1 Create → Run → View → Complete

- [ ] User creates a 3-state linear definition via the editor → saves
- [ ] User launches an instance from the dashboard with JSON input and a workspace root
- [ ] User is redirected to the instance viewer
- [ ] The state diagram highlights each state as the machine progresses
- [ ] Transition history and logs update in real time
- [ ] The machine reaches `completed` and the diagram shows the terminal state highlighted
- [ ] The instance status in the dashboard changes to `completed`

### 21.2 Create → Run → Cancel

- [ ] User creates a definition with a `delay` action (slow enough to cancel)
- [ ] User launches an instance and sees it running
- [ ] User clicks "Cancel" on the instance viewer
- [ ] The machine transitions to `cancelled` terminal state
- [ ] The state diagram updates to show `cancelled` highlighted
- [ ] The dashboard shows the instance as `cancelled`

### 21.3 Parent–Child Composition

- [ ] User creates a child definition (validation pipeline) and a parent definition referencing it
- [ ] User launches the parent with a workspace root
- [ ] The instance viewer shows the child being spawned (child_spawned event)
- [ ] The child machine tree appears with the child instance
- [ ] Clicking the child in the tree opens the child's instance viewer
- [ ] The child completes and the parent continues
- [ ] Both instances end as `completed`
- [ ] Both instances share the same `workspaceRoot` and `familyRootInstanceId`

### 21.4 Parallel Children

- [ ] User creates a parent definition with a `parallel_children` state referencing 3 child definitions
- [ ] User launches the parent
- [ ] 3 child instances are spawned (visible in the tree and in instance list)
- [ ] Children run concurrently and complete
- [ ] The parent's action aggregates results and the machine completes

### 21.5 Suspend → Resume

- [ ] User launches a multi-step machine with a `delay` action
- [ ] Server is shut down gracefully while the machine is running
- [ ] Server restarts; suspended instance is visible in the dashboard
- [ ] User clicks "Resume" on the suspended instance
- [ ] The machine continues from where it left off and completes
- [ ] Already-completed states are not re-executed (verified via transition count)

### 21.6 CLI → Artifacts Workspace Workflow

- [ ] User launches a machine whose action runs a CLI command via `ctx.cli.exec()`
- [ ] The action writes output to the artifacts workspace via `ctx.artifactsWorkspace.resolve('output.json')`
- [ ] The instance viewer displays the `artifactsPath` where the file was written
- [ ] For a parent–child machine, the child can read files written by the parent via the shared artifacts workspace
- [ ] The parent can read files written by the child after the child completes

### 21.7 CLI Branching by Exit Code

- [ ] User launches a machine with a `run-cli` action state
- [ ] The CLI command succeeds (`exitCode === 0`) and the machine transitions to the success state
- [ ] (Alternate run) The CLI command fails (`exitCode !== 0`) and the machine transitions to the error-handling state
- [ ] The error-handling state receives `stderr` and `exitCode` in `ctx.stateData`

### 21.8 Definition Editing Round-Trip

- [ ] User creates a definition in the visual editor
- [ ] User exports it as JSON, modifies the JSON externally, and re-imports
- [ ] The editor reflects the imported changes
- [ ] User saves and launches an instance — it runs correctly with the modified definition

---

## 22. Negative / Edge-Case Behaviors

### 22.1 API Error Responses

- [ ] `POST /instances` with a missing `definitionId` returns 400 Bad Request
- [ ] `POST /instances` with a missing `input` field returns 400 Bad Request
- [ ] `POST /instances` with a missing `workspaceRoot` field returns 400 Bad Request
- [ ] `POST /instances` with a non-absolute `workspaceRoot` returns 400 Bad Request
- [ ] `GET /instances/:id` with a non-existent ID returns 404
- [ ] `POST /instances/:id/cancel` on a non-existent instance returns 404
- [ ] `POST /instances/:id/resume` on a non-existent instance returns 404

### 22.2 Concurrent Operations

- [ ] Starting multiple instances of the same definition concurrently does not cause data corruption
- [ ] Cancelling an instance while it is transitioning between states completes without error (cancel takes effect at next yield point)
- [ ] Two clients subscribing to the same instance via WebSocket both receive the same events

### 22.3 Definition Mutation During Execution

- [ ] Updating a definition while an instance of it is running does not affect the running instance (it uses the version at start time)
- [ ] Deleting a definition while an instance is running does not crash the instance (it already loaded the definition)
- [ ] After the definition is deleted, the completed instance is still viewable via `GET /instances/:id`

### 22.4 Large-Scale Behaviors

- [ ] A machine with 50+ states and transitions runs correctly
- [ ] A parallel_children state with 20+ children completes (queued by semaphore as needed)
- [ ] An instance with 1000+ log entries can be retrieved and filtered

### 22.5 WebSocket Edge Cases

- [ ] Subscribing to an instance that has already completed delivers no events (the machine is done)
- [ ] Subscribing to a non-existent instance ID does not crash the connection
- [ ] Sending malformed JSON over the WebSocket does not crash the server
- [ ] Multiple rapid subscribe/unsubscribe cycles do not leak subscriptions

### 22.6 CLI Edge Cases

- [ ] `cli.exec` with a non-existent command returns `exitCode: -1` and the error in `stderr`
- [ ] `cli.exec` with a command that produces >1 MiB stdout returns truncated output with `\n...<truncated>` suffix
- [ ] `cli.exec` with a long-running command that exceeds the state's `timeoutMs` is interrupted (child process killed)
- [ ] Multiple concurrent `cli.exec` calls within a single action all complete and return their results
