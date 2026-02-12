# State Machine Working Directory & Artifacts (Draft)

## Overview

State machine actions need two kinds of filesystem access (two working directories):

1. **User workspace** — user-specified working directory for reading and editing files.
2. **Artifacts workspace** — managed, persisted outputs stored by the system.

Tools typically accept file paths rather than artifact records, so the system must provide
path resolution for both working directories without enforcing access restrictions.

> **Terminology note:** After this migration, the term "artifact" refers to any file
> written to the artifacts workspace. It is a conceptual label — there is no
> system-managed artifact record, metadata, or API. Artifacts are plain files accessed
> via `ctx.artifactsWorkspace.resolve(...)`.

## Goals

- Provide a stable workspace root for file operations.
- Provide path resolution for both working directories.
- Allow actions to operate on files in either working directory.
- Allow **family** artifact access for the same instance family.
- Remove protections for artifacts and CLI execution to allow
  arbitrary commands and filesystem access.

## Directory Model

Each machine instance has **two workspaces**:

1. **User Workspace Root** (user-specified):
   - Absolute path provided when the instance starts.
   - Used for file operations and tool execution.
   - Inherited by child instances (same workspace).
   - Not automatically treated as artifacts.

2. **Artifacts Workspace Root** (system-managed):

- `<ARTIFACT_ROOT>/<familyRootInstanceId>/` (family root). Any `children/` subpaths are just
  conventional subdirectories inside the shared family root, not separate workspaces.
- Single shared workspace for the entire family (ancestors + descendants).
- No path traversal enforcement; this root is advisory only.

The term **working directory** refers to either root above. Artifacts live in a separate
managed directory tree; actions access them via file paths.

**Example layout (family root):**

```
<ARTIFACT_ROOT>/
  <familyRootInstanceId>/
    report.json
    plans/
      shared-data.json
    logs.txt
    children/
      <childInstanceId>/
        child-report.json
```

> **Namespacing convention:** All instances share the same `artifactsWorkspace.root`
> (the family root). The `children/<childInstanceId>/` subdirectory structure shown
> above is a convention, not enforced. Child actions are responsible for namespacing
> their files (e.g., `ctx.artifactsWorkspace.resolve(\`children/${ctx.machineInstanceId}/file.json\`)`).

## Action Context Additions

Actions receive the following context. All existing fields are retained except
`artifacts: ArtifactStore` (removed). New fields: `cli`, `workspace`,
`artifactsWorkspace`.

```typescript
interface ActionContext {
  // Retained from current ActionContext:
  readonly machineInstanceId: string;
  readonly machineDefId: string;
  readonly stateName: string;
  readonly stateData: unknown;
  readonly machineInput: unknown;
  readonly parentContext?: {
    readonly parentInstanceId: string;
    readonly parentStateName: string;
  };
  readonly logger: StateLogger;

  // REMOVED: artifacts: ArtifactStore

  // New: CLI helper (plain property, constructed by the runner)
  readonly cli: CliHelper;

  // New: workspace context
  readonly workspace: {
    readonly root: string;
    /** Resolve a path within the workspace. */
    resolve(relativePath: string): string;
  };

  // New: artifacts workspace context (family-scoped)
  readonly artifactsWorkspace: {
    readonly root: string;
    /** Resolve a path within the artifacts workspace. */
    resolve(relativePath: string): string;
  };
}
```

> **`stateData` vs `machineInput`:** Both fields are retained.
> `machineInput` is the immutable original input provided when the instance
> started. `stateData` evolves per state — the runner replaces it with each
> action's returned `data`. An action in a later state can refer back to
> `machineInput` without requiring intermediate actions to thread it forward.

**Workspace helpers:**

- `resolve()` is a convenience helper for building file paths.
- Actions may pass `workspace.resolve('path/to/file')` directly to tools.

**Artifacts workspace helpers:**

- `resolve()` is a convenience helper for building file paths.
- Actions may pass `artifactsWorkspace.resolve('path/to/file')` directly to tools.
- `artifactsWorkspace.root` is the family root for all instances (parent and
  children alike). Children namespace by convention (e.g.,
  `resolve(\`children/${instanceId}/file.json\`)`).

### `stateData` flow between states

The runner sets `ctx.stateData` for each state as follows:

- **Initial state**: `stateData` is the machine's `input`.
- **Subsequent states**: when an action returns `{ nextState, data }`, the runner
  **replaces** `stateData` with `data`. If `data` is `undefined`, the previous
  `stateData` carries forward unchanged.
- The definition's `dataSchema` (if present) validates the incoming `stateData`
  but does not provide a default value.

This means the next action receives the previous action's returned `data` as
`ctx.stateData` (e.g., `ctx.stateData.stdout` after a CLI action that returned
`{ data: { stdout, exitCode } }`).

## Artifact Access Rules (Family)

Artifacts live in the shared **artifacts workspace** for the family. Actions may read and
write files within that workspace.

No access restrictions are enforced for artifacts or file paths.

**Family access scope:**

- The artifacts workspace is shared by the entire instance family (ancestors, descendants, and siblings).
- Artifacts are not rigidly structured; state machines generally read/write anywhere under
  `<familyRootInstanceId>/`.

## Mapping Working Directories to File Paths

Tools that require file paths should use:

- **Workspace file path**: `ctx.workspace.resolve('path')`
- **Artifacts workspace path**: `ctx.artifactsWorkspace.resolve('path')`
- **Family root (optional)**: `ctx.artifactsWorkspace.root`

Artifacts are accessed via file paths; there is no artifacts API in this model.

## API and WS Contract Changes

- Remove artifact API endpoints under `/api/machines/instances/:id/artifacts*`.
- Remove `artifact_created` event from machine events and WebSocket payloads.
- Update instance payloads to include `workspaceRoot`, `familyRootInstanceId`,
  and `artifactsPath`.
- **Breaking change:** Remove `artifacts: ArtifactRecord[]` from the instance
  payload. Replace with `artifactsPath: string` pointing to the family artifacts
  root directory on disk. Clients that previously consumed `artifacts` metadata
  must use `artifactsPath` for filesystem-based access instead.

## CLI Action Execution Requirements

Actions that invoke CLI tools must be able to branch on exit codes or returned data.
This requires standardized command execution and result capture:

- Commands run in `workspace.root` by default, with optional `cwd` set to any path.
- The action receives `exitCode`, `stdout`, `stderr`, and `durationMs`.
- Non-zero exit code does **not** automatically fail the machine; the action decides
  the transition based on exit code or parsed output.
- Spawn failures and invalid paths are surfaced in `CliExecResult`
  (not as Effect errors), so the action can inspect and route accordingly.
- Timeouts are handled by the runner's state-level `timeoutMs`, not by the CLI
  helper. If a state times out, the runner interrupts the action's Effect fiber
  (killing any in-flight child process).
- CLI helpers do **not** restrict `cwd` or command targets; actions may
  invoke arbitrary commands and access any filesystem paths.

Proposed helper shape (plain property on `ActionContext`, constructed by the runner):

```typescript
interface CliExecResult {
  readonly exitCode: number; // -1 = spawn failure
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

interface CliHelper {
  exec(input: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  }): Effect.Effect<CliExecResult>;
}
```

> **Note:** `exec` never fails in the Effect error channel. All outcomes —
> including spawn failures — are surfaced in `CliExecResult`.
> This keeps the action in control: it can inspect `exitCode`
> and `stderr` to decide whether to route to an error state or handle the
> failure as part of normal flow.
>
> **Timeouts:** The CLI helper does not enforce its own timeout. The runner's
> state-level `timeoutMs` governs the deadline for the entire action; if it
> fires, the Effect fiber (and any in-flight child process) is interrupted.
> There is no `timedOut` field or timeout sentinel exit code in `CliExecResult`.

**CLI rules:**

- CLI runs in the **user workspace root** by default.
- If `cwd` is provided, it may be any path (no enforcement).
- Actions may set `cwd` to a child directory within either working directory, and later
  execute again with `cwd` omitted or set to `workspace.root` / `artifactsWorkspace.root`.
- Actions may change the CLI working directory during a single action by issuing
  multiple `cli.exec(...)` calls with different `cwd` values.
- Actions may also switch between the two working directories **within a single shell
  command** (e.g., `bash -lc "cd $WORKSPACE_ROOT; ...; cd $ARTIFACTS_ROOT; ..."`).
  Implementations should provide both roots via environment variables.
- No artifact or CLI protections are enforced.

**CLI defaults (proposed):**

- **Timeout**: none. The CLI helper runs the child process indefinitely. The
  runner's state-level `timeoutMs` is the only deadline; when it fires, the
  action's Effect fiber is interrupted and the child process is killed.
- `stdout`/`stderr` capture: default max 1 MiB each; truncate with a clear suffix
  (e.g., `\n...<truncated>`). The action still receives `exitCode` and truncated output.
- Spawn failures set `exitCode: -1` with the error message in `stderr`.

**CLI environment (proposed):**

- Provide `WORKSPACE_ROOT` and `ARTIFACTS_ROOT` in the process environment for every
  `cli.exec(...)` call.
- `cwd` default is `WORKSPACE_ROOT` unless explicitly set by the action.

## Example: CLI Tool Branching (string input → success/error actions)

This example adds a **run-script** action state that:

1. Reads the CLI command/args from the action’s `stateData` (state/action input).
2. Invokes the CLI tool.
3. If `exitCode === 0`, transitions to **interpretScriptOutput** and passes stdout.
4. If `exitCode !== 0`, transitions to **handleScriptError** and passes stderr/exitCode.

### Action state data (state/action input)

The **runScript** state uses `stateData` (state/action input) to configure _how_ to run the CLI tool:

```json
{
  "command": "bash",
  "args": ["scripts/compute.sh"],
  "successState": "interpretScriptOutput",
  "errorState": "handleScriptError"
}
```

Recommended `dataSchema` for the `runScript` state:

```json
{
  "type": "object",
  "required": ["command", "args", "successState", "errorState"],
  "properties": {
    "command": { "type": "string", "minLength": 1 },
    "args": { "type": "array", "items": { "type": "string" } },
    "successState": { "type": "string" },
    "errorState": { "type": "string" }
  }
}
```

### Definition snippet (valid per current runner rules)

```json
{
  "initialState": "runScript",
  "states": {
    "runScript": {
      "name": "runScript",
      "type": "action",
      "actionId": "run-cli",
      "dataSchema": { "type": "object" },
      "timeoutMs": 15000
    },
    "interpretScriptOutput": {
      "name": "interpretScriptOutput",
      "type": "action",
      "actionId": "interpret-script-output"
    },
    "handleScriptError": {
      "name": "handleScriptError",
      "type": "action",
      "actionId": "handle-script-error"
    },
    "completed": { "name": "completed", "type": "terminal" },
    "cancelled": { "name": "cancelled", "type": "terminal" },
    "error": { "name": "error", "type": "terminal" }
  },
  "transitions": [
    { "from": "runScript", "to": "interpretScriptOutput" },
    { "from": "runScript", "to": "handleScriptError" },
    { "from": "interpretScriptOutput", "to": "completed" },
    { "from": "handleScriptError", "to": "completed" }
  ]
}
```

> **Note:** `cancelled` and `error` have no user-defined transitions targeting them.
> They are system-reachable terminal states — the runner may transition to them
> directly (e.g., on external cancellation or unrecoverable runtime error).

### Action behavior (using the proposed CLI helper)

The **run-cli** action reads `command`, `args`, `successState`, and `errorState` from
`ctx.stateData` (state/action input), then:

- Calls `ctx.cli.exec({ command, args })`.
- On success (`exitCode === 0`): returns `{ nextState: successState, data: { stdout, exitCode } }`.
- On failure (`exitCode !== 0`): returns `{ nextState: errorState, data: { stderr, exitCode } }`.

This keeps error handling **inside the machine flow** instead of failing the action.
The **interpret-script-output** action can parse `ctx.stateData.stdout` (data passed from the
previous state’s result) to build a structured result or write artifacts. The
**handle-script-error** action can log or emit a diagnostic artifact using `stderr` and
`exitCode` from `ctx.stateData`.

### Required inputs summary

- **runScript state data (state/action input)**: `command`, `args`, `successState`, `errorState`
- **Transitions**: from `runScript` to both success and error states
- **Action registry**: register `run-cli`, `interpret-script-output`, `handle-script-error`

## Example: Node script → JSON → dynamic next state

This example shows a state that runs a Node script, parses JSON, and chooses the
next state based on the JSON payload. The successful transition returns data
that becomes the machine output.

### State data (input to the action)

```json
{
  "command": "node",
  "args": ["scripts/evaluate.js", "--input", "./data/payload.json"],
  "successState": "completed",
  "errorState": "handleScriptError"
}
```

### Script contract (stdout)

The script writes JSON to stdout in the shape:

```json
{
  "status": "ok",
  "nextState": "completed",
  "output": { "score": 92, "grade": "A" }
}
```

If the script fails, it writes JSON like:

```json
{
  "status": "error",
  "message": "validation failed"
}
```

### Definition snippet

```json
{
  "initialState": "runNodeScript",
  "states": {
    "runNodeScript": {
      "name": "runNodeScript",
      "type": "action",
      "actionId": "run-node-script",
      "dataSchema": { "type": "object" },
      "timeoutMs": 15000
    },
    "handleScriptError": {
      "name": "handleScriptError",
      "type": "action",
      "actionId": "handle-script-error"
    },
    "completed": { "name": "completed", "type": "terminal" },
    "cancelled": { "name": "cancelled", "type": "terminal" },
    "error": { "name": "error", "type": "terminal" }
  },
  "transitions": [
    { "from": "runNodeScript", "to": "completed" },
    { "from": "runNodeScript", "to": "handleScriptError" },
    { "from": "handleScriptError", "to": "completed" }
  ]
}
```

> **Note:** `cancelled` and `error` have no user-defined transitions targeting them.
> They are system-reachable terminal states — the runner may transition to them
> directly (e.g., on external cancellation or unrecoverable runtime error).

### Action behavior (pseudocode — post-refactor `ctx.cli`)

```typescript
const runNodeScript: ActionFunction = (ctx) =>
  Effect.gen(function* () {
    const { command, args, successState, errorState } = ctx.stateData as {
      command: string;
      args: string[];
      successState: string;
      errorState: string;
    };

    const result = yield* ctx.cli.exec({ command, args });

    // Expect JSON on stdout from the script
    const payload = JSON.parse(result.stdout) as {
      status: 'ok' | 'error';
      nextState?: string;
      output?: unknown;
      message?: string;
    };

    if (result.exitCode !== 0 || payload.status !== 'ok') {
      return {
        nextState: errorState,
        data: { stderr: result.stderr, message: payload.message },
      };
    }

    // Use the configured success state directly.
    // NOTE: Actions that need dynamic routing (e.g., script chooses among
    // multiple success states) can validate payload.nextState against the
    // definition's transitions. That pattern is out of scope for this example.
    return {
      nextState: successState,
      data: payload.output,
    };
  });
```

In this example, the machine reaches the `completed` terminal state with
`payload.output` as the final output. The action IDs `run-node-script` and
`handle-script-error` must be registered in the ActionRegistry.

## Example Flow: CLI → Artifact → Child → Aggregation

1. **State A (action)** runs a CLI command and transitions based on `exitCode` or
   parsed `stdout` (e.g., equality checks).
2. **State B (action)** writes an artifact `parent-report.json`.
3. **State C (child_machine)** spawns a child.
4. **Child action** resolves the family root or parent artifact directory and runs `ls`
   (or reads the artifact), confirming visibility.
5. **Child action** writes `child-report.json` and completes.
6. **Parent** reads child artifacts via file paths in the shared family root and may write a combined
   artifact.

## Required Refactors

- **Machine instance model**: persist `workspaceRoot`, `familyRootInstanceId`,
  and `artifactsPath` on `MachineInstance`, store them on creation, and include
  them in API responses. Root instance sets `familyRootInstanceId = id`;
  descendants copy from their spawning parent.
- **Artifacts API**: remove the existing artifacts API surface and any artifact records/metadata endpoints.
- **API inputs**: require a `workspaceRoot` (absolute) on instance start; validate
  existence/permissions at start time; compute the family root on first run.
- **ActionContext**: add `workspace` helper and required `cli` helper to
  standardize command execution and output capture.
- **Runner**: ensure children copy `workspaceRoot` and `familyRootInstanceId`
  from their spawning parent, and receive `ActionContext` workspace + CLI helpers.
- **Tests**: add coverage for CLI branching by exit code/output and child visibility
  of parent artifacts via CLI path resolution.

## Migration Plan (from current implementation)

This section maps the **current codebase** to the new model in this draft and
lays out a step-by-step migration path.

### 0) Current implementation touchpoints (for orientation)

- **Types**: `server/src/machines/types.ts` and `client/src/types/machines.ts`
  (ActionContext, MachineInstance, Artifact types).
- **Schemas**: `server/src/machines/schemas.ts` (`StartInstanceRequestSchema`,
  `MachineInstanceSchema`, `ArtifactRecordSchema`).
- **Runner**: `server/src/machines/StateMachineRunner.ts` builds `ActionContext`
  and injects `ArtifactStore`, publishes `artifact_created`.
- **Artifacts infra**: `server/src/machines/artifacts/*`
  (`ArtifactStoreFactory`, `FsArtifactStore`, `ArtifactTreeBuilder`, tests).
- **Artifacts API**: `server/src/routes/machines/instances.ts` routes under
  `/api/machines/instances/:id/artifacts*`.
- **Client usage**: `client/src/utils/apiClient.ts`,
  `client/src/hooks/useMachineArtifacts.ts`,
  `client/src/components/machines/ArtifactViewer.tsx`,
  `client/src/pages/MachineInstancePage.tsx`, and the `artifact_created`
  event handling.

### 1) Data model changes (types + schemas)

1. **MachineInstance**

- Add `workspaceRoot: string`, `familyRootInstanceId: string`, and
  `artifactsPath: string` (resolved path to the family artifacts root).
- Remove `artifacts: ArtifactRecord[]` — replaced by `artifactsPath`.
- Keep `parentInstanceId`, `childInstanceId`, and `childInstanceIds` unchanged
  (runner orchestration — orthogonal to the family/workspace model).

2. **ActionContext**

- Remove `artifacts: ArtifactStore`.
- Add `cli`, `workspace`, and `artifactsWorkspace` helpers.

3. **Artifact types**

- Remove `ArtifactStore`, `ArtifactRecord`, `ArtifactTree` from shared types
  if the artifacts API and metadata are fully removed.

4. **Schemas** (`server/src/machines/schemas.ts`)

- Update `StartInstanceRequestSchema` to include `workspaceRoot`.
- Update `MachineInstanceSchema` to include `workspaceRoot`,
  `familyRootInstanceId`, and `artifactsPath` (and drop `artifacts`).
- Remove `ArtifactRecordSchema` / `ArtifactTree` schemas if unused.

5. **Client types** mirror the server changes in
   `client/src/types/machines.ts`.

### 2) Start-instance API changes (workspaceRoot required)

1. **Request body**

- Add `workspaceRoot` to the POST `/api/machines/instances` body.

2. **Validation**

- Validate `workspaceRoot` is an absolute path and exists at start time.
- Persist `workspaceRoot` and set `familyRootInstanceId = id` for the root
  instance (the root's own ID — this is a definitive rule, not advisory).

3. **Propagation to children**

- Child runs copy `workspaceRoot` and `familyRootInstanceId` from their
  spawning parent. Since the parent's `familyRootInstanceId` is always the
  top-level root's ID (passed down the chain), no parent-chain walk is needed.

### 3) Runner & ActionContext wiring

1. **Remove ArtifactStore plumbing**

- Delete `ArtifactStoreFactory` injection and the `artifact_created` event.
- Remove the `artifacts` wrapper in `StateMachineRunner`.

2. **Add CLI helper**

- Introduce a `CliHelper` implementation (e.g., `server/src/machines/cli/*`).
- The runner constructs it and places it on `ActionContext` as `ctx.cli`
  (a plain property, not an Effect service), consistent with the existing
  `ctx.logger` pattern.

3. **Add workspace helpers**

- Build `ctx.workspace` and `ctx.artifactsWorkspace` from the instance’s
  `workspaceRoot` and `familyRootInstanceId`.
- Include helpers in `ActionContext` for resolving paths.

### 4) Remove artifacts infrastructure & API surface

1. **Delete artifacts services**

- Remove `server/src/machines/artifacts/ArtifactStoreFactory.ts`,
  `FsArtifactStore.ts`, `ArtifactTreeBuilder.ts`, and related tests.

2. **Remove API routes**

- Delete `/api/machines/instances/:id/artifacts*` routes from
  `server/src/routes/machines/instances.ts`.

3. **Remove artifact events**

- Drop `artifact_created` from `MachineEvent` and WebSocket event handling.

### 5) Client migration

1. **Remove artifacts UI**

- Remove `useMachineArtifacts`, `ArtifactViewer`, and the artifacts UI on
  `MachineInstancePage` if the API is removed.

2. **Update API client**

- Remove `getInstanceArtifacts`, `getInstanceArtifactTree`,
  `downloadArtifact` from `client/src/utils/apiClient.ts`.

3. **Update WS events**

- Remove `artifact_created` handling in the machine socket and stores.

### 6) Tests and cleanup

- Remove artifact-related unit/integration tests and fixtures.
- Add new tests for `workspaceRoot` validation, CLI execution, and child
  inheritance of workspace/family roots.
- Update any test fixtures that create instances to include `workspaceRoot`.

### 7) Incremental rollout suggestion

1. **Phase A**: Update types + schemas + API request validation.
2. **Phase B**: Introduce `CliHelper` and workspace helpers in the runner.
3. **Phase C**: Remove artifacts API + server/client artifacts UI.
4. **Phase D**: Clean up tests and docs.
