# State Machine Specification — Source of Truth

> This document supersedes:
>
> - `docs/feature-specs/00-state-machine.md`
> - `docs/feature-specs/01-state-machine-working-directory.md`
>
> It defines the current canonical behavior implemented in `server/src/machines`, `server/src/routes/machines`, and corresponding client types/UI.

---

## 0) Purpose and what you can do with this

### 0.1 Purpose

This specification is the contract for how state machines behave in AIFlow.
Use it as the single reference for:

- **Design** (how to model workflows and composition)
- **Implementation** (server/client/runtime expectations)
- **Validation** (what is allowed vs rejected)
- **Testing** (what behavior should be observable through APIs and WS events)

### 0.2 What you can do with the state machine system

With this model, you can:

- Model linear, branching, and terminal workflows as declarative JSON definitions
- Compose reusable workflows by spawning child machines (`child_machine`)
- Fan out and aggregate work with concurrent children (`parallel_children`)
- Run CLI commands inside a user workspace and branch on exit code/output
- Read/write shared family artifacts in `artifactsWorkspace`
- Apply schema validation at machine input and per-state data boundaries
- Observe live execution via transition history, logs, and WebSocket events
- Operate running flows using cancel/suspend/resume semantics

### 0.3 How to use this spec in practice

Recommended authoring loop:

1. Define states, transitions, and required terminal states
2. Assign action IDs and register matching server actions
3. Add schemas (`inputSchema`, optional `dataSchema`) for safety
4. Choose composition strategy (`action`, `child_machine`, `parallel_children`)
5. Start instances with a valid `workspaceRoot`
6. Verify behavior through REST (`instances`, `history`, `logs`) and WS events

---

## 1) Core definition model

### 1.1 Definition shape

A machine definition includes:

- `id`, `name`, `version`
- `inputSchema`, `outputSchema` (JSON Schema validated with Ajv)
- `states` and `initialState`
- `transitions`
- `metadata` (`createdAt`, `updatedAt`, optional `description`, `tags`)

State types:

- `action`
- `child_machine`
- `parallel_children`
- `terminal`

State-level options:

- `actionId?`
- `childMachineDefId?`
- `childInputMapping?` (JSONPath over `{ stateData, machineInput, stateName }`)
- `children?` (for `parallel_children`)
- `dataSchema?`
- `timeoutMs?`
- `parallelMode?` (`all_or_interrupt` default, or `all_settled`)

### 1.2 Required terminal states

Definitions must include these terminal states with `type: "terminal"`:

- `completed`
- `cancelled`
- `error`

System-level cancellation and failures can reach terminal states even if user transitions do not explicitly target them.

---

## 2) Definition validation rules

Validation runs at save-time and run-time (Rule 8 is advisory on save, mandatory at run):

1. `initialState` must exist in `states`
2. `completed` / `cancelled` / `error` terminal states must exist and be terminal
3. No transition may originate from a terminal state
4. Every `from`/`to` transition state must exist
5. Every non-terminal state must have at least one outgoing transition
6. Every non-terminal must be reachable from `initialState`
7. `StateDefinition.name` must match its key in `states`
8. `action` states must reference registered `actionId` (runtime hard requirement)
9. `child_machine` requires `actionId`, `childMachineDefId`, `childInputMapping`
10. `parallel_children` requires `actionId` and non-empty `children`
11. `terminal` states must not have `actionId`, `childMachineDefId`, or `children`
12. Child-definition references cannot form cycles
13. `inputSchema`, `outputSchema`, `dataSchema` must be valid JSON Schema documents
14. `parallel_children.children[].key` must be unique per state

Validation errors are returned as `DefinitionError` with aggregated `details[]`.

---

## 3) Runtime instance model

`MachineInstance` includes:

- Identity: `id`, `definitionId`, `definitionVersion`
- Execution status: `running | completed | cancelled | error | waiting_for_child | suspended`
- Execution state: `currentState`, `stateData`, `input`, optional `output`, optional `error`
- Composition links: `parentInstanceId?`, `childInstanceId?`, `childInstanceIds?`
- Observability: `history[]`, `logs[]`
- Workspace/artifact roots: `workspaceRoot`, `familyRootInstanceId`, `artifactsPath`
- Timestamps: `createdAt`, `updatedAt`

`artifacts` metadata arrays are not part of the runtime model anymore.

---

## 4) Action runtime contract

Actions are `ActionFunction = (ctx) => Effect<TransitionResult, ActionError>`.

`ActionContext` includes:

- Core fields: `machineInstanceId`, `machineDefId`, `stateName`, `stateData`, `machineInput`
- Optional `parentContext`
- `logger`
- `cli`
- `workspace` (`root`, `resolve(relativePath)`)
- `artifactsWorkspace` (`root`, `resolve(relativePath)`)

### State data flow

- Initial state: `stateData = input`
- After each transition: `nextStateData = transitionResult.data ?? previousStateData`
- `machineInput` remains immutable original input for all states

---

## 5) Runner behavior

### 5.1 Run lifecycle

`run(definition, input, opts)`:

1. Rejects new runs if shutdown is in progress
2. Validates definition at runtime
3. Enforces `MAX_MACHINE_DEPTH` (default `10`)
4. Validates input against `definition.inputSchema` (if schema non-empty)
5. Creates instance with `status: running`, `currentState: initialState`
6. Runs state loop until terminal state
7. Resolves terminal result and emits `machine_completed`

### 5.2 Checkpoints and transition safety

- Persist before executing each state action
- Validate `nextState` against legal transitions
- Persist history/logs/current state after each transition
- Persist terminal result at completion/error/cancelled

For `completed`, output is resolved as:

- last transition `data` when history exists
- otherwise current `stateData`

### 5.3 `child_machine`

- Evaluates `childInputMapping` via JSONPath over `{ stateData, machineInput, stateName }`
- Sets parent `status = waiting_for_child`
- Spawns child with inherited `workspaceRoot` and `familyRootInstanceId`
- On child completion, parent action runs with child `MachineResult` in `stateData`

### 5.4 `parallel_children`

- Evaluates each child `inputMapping` and loads each child definition
- Sets parent `status = waiting_for_child`
- Spawns children with inherited `workspaceRoot` and `familyRootInstanceId`
- `parallelMode`:
  - `all_or_interrupt` (default): first child failure interrupts remaining children
  - `all_settled`: waits for all child outcomes
- Parent action receives:
  - `results: Record<string, MachineResult>`
  - `childInstanceIds: Record<string, string>`

---

## 6) Concurrency, cancellation, suspend, resume

### 6.1 Concurrency control

- A global semaphore bounds active machine computation (`MAX_CONCURRENT_MACHINES`, default `50`)
- Parent machines release permits before waiting for children (release-before-wait)

### 6.2 Cancellation

`cancel(instanceId)`:

- Allowed for `running`, `waiting_for_child`, `suspended`
- Terminal states (`completed`, `cancelled`, `error`) reject with conflict
- Recursively cancels child/parallel child instances when waiting on children

### 6.3 Graceful suspension

`suspendAll()`:

- Stops accepting new runs/resumes
- Interrupts in-flight fibers
- Persists interrupted instances as `suspended`
- Waits for completion up to `SHUTDOWN_TIMEOUT_MS` (default `10000`)

### 6.4 Resume

`resume(instanceId)`:

- Requires `status === suspended`
- Requires definition still exists and version matches persisted `definitionVersion`
- Revalidates definition
- Recursively resumes suspended children first
- Re-enters persisted `currentState` and continues loop
- Emits `machine_resumed`

`AUTO_RESUME_ON_STARTUP=true` enables startup recovery for top-level suspended instances.

---

## 7) Working directories and artifacts workspace

Each instance family has two directory concepts:

1. **User workspace root** (`workspaceRoot`)
   - Required when starting via API
   - Must be absolute and point to an existing directory
   - Inherited by child instances

2. **Artifacts workspace root** (`artifactsPath` / `artifactsWorkspace.root`)
   - `<ARTIFACT_ROOT>/<familyRootInstanceId>/`
   - Shared by the full family (root + descendants)
   - Root instance sets `familyRootInstanceId = own instance id`
   - Root instance ensures artifacts directory exists on disk

Path helpers use `path.resolve(...)`; no sandbox/path-traversal enforcement is applied by these helpers.

There is no server-side artifact metadata store or artifact REST API surface in this model.

---

## 8) CLI helper contract

`ctx.cli.exec({ command, args?, cwd?, env? })` returns:

- `exitCode` (`-1` for spawn failure)
- `stdout`
- `stderr`
- `durationMs`

Behavior:

- Default `cwd` is `workspaceRoot`
- Injected env vars: `WORKSPACE_ROOT`, `ARTIFACTS_ROOT`
- Merges user-provided `env` over defaults
- Stdout/stderr capture capped at 1 MiB each with `\n...<truncated>` suffix
- Non-zero exit codes are returned normally (not Effect-channel failures)
- Fiber interruption terminates the spawned process

---

## 9) API contract

### 9.1 REST endpoints

- `GET/POST/PUT/DELETE /api/machines/definitions...`
- `GET /api/machines/actions`
- `GET /api/machines/actions/:id`
- `POST /api/machines/instances`
- `GET /api/machines/instances`
- `GET /api/machines/instances/:id`
- `GET /api/machines/instances/:id/history`
- `GET /api/machines/instances/:id/logs` (optional `?state=...`)
- `POST /api/machines/instances/:id/cancel`
- `POST /api/machines/instances/:id/resume`

No `/artifacts` REST endpoints are part of the current API.

### 9.2 Start-instance request

`POST /api/machines/instances` body:

- `definitionId: string`
- `input: unknown`
- `workspaceRoot: string` (required absolute existing directory)

### 9.3 Instance payload expectations

Instance responses include:

- `workspaceRoot`
- `familyRootInstanceId`
- `artifactsPath`

and do not include an `artifacts` array.

---

## 10) WebSocket contract

Path: `/api/machines/live`

Client messages:

- `{ type: "subscribe", instanceId }`
- `{ type: "unsubscribe", instanceId }`

Server messages:

- `{ type: "event", payload: MachineEvent }`
- `{ type: "error", message }`

`MachineEvent.type` values:

- `state_changed`
- `transition_recorded`
- `log_entry`
- `machine_completed`
- `machine_resumed`
- `child_spawned`
- `child_completed`
- `children_spawned`
- `children_completed`

`artifact_created` is not part of the current event model.

---

## 11) Middleware behavior

Default middleware stack (registration order):

1. `ValidationMiddleware`
2. `LoggingMiddleware`
3. `TelemetryMiddleware`
4. `AuditMiddleware`

Execution semantics:

- `beforeTransition` hooks run in registration order
- `afterTransition` hooks run in reverse order
- `onError` hooks run for all middleware; middleware hook errors are swallowed/logged

Behavior highlights:

- `ValidationMiddleware` validates `stateData` against the current state's `dataSchema` (when present)
- `LoggingMiddleware` emits structured before/after/error logs
- `TelemetryMiddleware` records transition spans/metrics (OpenTelemetry-aware)
- `AuditMiddleware` records immutable transition audit entries (in-memory)

---

## 12) Built-in action IDs

Registered by default:

- `http-request`
- `delay`
- `transform-data`
- `log-message`
- `conditional-branch`

---

## 13) Client-facing behavior

- Machine launch UI requires user-supplied `workspaceRoot`
- Client `startInstance` call sends `definitionId`, `input`, `workspaceRoot`
- Instance view displays `workspaceRoot`, `artifactsPath`, `familyRootInstanceId`
- Artifacts panel displays the artifacts directory path (not artifact metadata records)
- WebSocket client auto-reconnects with exponential backoff and re-subscribes active instance subscriptions

---

## 14) Configuration

Environment variables used by the implementation:

- `ARTIFACT_ROOT` (default `./data/artifacts`)
- `MAX_CONCURRENT_MACHINES` (default `50`)
- `MAX_MACHINE_DEPTH` (default `10`)
- `SHUTDOWN_TIMEOUT_MS` (default `10000`)
- `AUTO_RESUME_ON_STARTUP` (default `false`)

---

## 15) Persistence note

`MachineStore` is currently provided by an in-memory implementation. The interface is intentionally storage-agnostic for future durable backends; resumability across process restarts requires a durable store implementation.

---

## 16) Practical examples

### 16.1 Quality-gate pipeline (parallel checks + aggregation)

Use `parallel_children` for independent checks (lint/test/typecheck) and a parent aggregator action:

- Parent state spawns one child per check target
- `parallelMode: "all_settled"` keeps full visibility even when one check fails
- Parent post-parallel action reads `results` and routes to `completed` or `error`

Good fit when you need one consolidated decision from many independent tasks.

### 16.2 CLI-driven branching (tool success/error paths)

Use an `action` state that runs `ctx.cli.exec(...)` and transitions by `exitCode`:

- `exitCode === 0` -> success state
- `exitCode !== 0` -> recovery/error-handling state

This keeps command failure handling inside machine logic rather than treating non-zero as an immediate system failure.

### 16.3 Parent-child artifact handoff

Use `child_machine` when a subflow should produce files consumed by a parent:

- Parent prepares context and spawns child
- Child writes outputs into `artifactsWorkspace` (family-shared root)
- Parent receives child `MachineResult` and can read/aggregate generated files

This pattern is useful for staged workflows like plan -> execute -> summarize.

### 16.4 Long-running operational workflows

For workflows that may outlive a single process window:

- Start via API with `workspaceRoot`
- Subscribe to `/api/machines/live` for progress updates
- Use cancel/resume endpoints as needed
- Use `suspendAll()` semantics and optional `AUTO_RESUME_ON_STARTUP` for shutdown/startup operations

This gives explicit operational control without losing machine state semantics.
