# Copilot CLI Prompt Action (Draft)

## Overview

This draft adds a reusable AI action that runs a prompt through GitHub `copilot` CLI, captures structured JSON output, validates required fields, and routes to success/error states in a state machine.

The action is designed to chain into later AI actions by returning validated file path references in a stable format.

## Goals

- Accept a `prompt` string as action input.
- Run `copilot` CLI in YOLO mode.
- Use system/runtime-provided allowed workspace and artifacts directory policy for CLI execution.
- Prepend a system directory-guidance prompt only when starting a new Copilot conversation.
- Reuse an existing conversation when `conversationId` is provided.
- Return/pass the active `conversationId` so downstream states can resume the same conversation.
- Support optional file-path context forwarded to `copilot` CLI input arguments.
- Ask a result-reporting system prompt that returns JSON (`data`, `filePaths`, diagnostics).
- If the model returns invalid JSON, retry in-action with a system prompt to wrap/reformat as strict JSON.
- Stream CLI transcript outputs for all `ctx.cli.exec(...)` calls while each command is running (not end-of-command or end-of-action flush).
- Use `gpt-5.1-codex-mini` for result-formatting prompt turns and `gpt-5.3-codex` for all other prompt turns.
- Validate JSON shape and required fields before returning state data.
- Route invalid JSON/shape failures (after retries) through the action error transition with structured diagnostics.
- Depend on a system-wide, toggleable CLI transcript capture feature for all `ctx.cli.exec` usage.

## Non-goals

- Defining the final production CLI wrapper implementation details.
- Defining UI behavior beyond state-machine data contracts.

## Proposed Action ID

- `copilot-cli-prompt`

## Rollout decisions (current)

This spec adopts the following implementation decisions for this rollout:

1. **Start-instance contract: hard cutover**

- `runtimeOptions` is required immediately.
- No legacy request fallback, compatibility shim, or versioned parallel endpoint in this rollout.

2. **Runner runtime policy model: pass-through**

- Runtime CLI policy/capture settings are passed through the run execution path and into action context construction.
- Runtime policy is **not** persisted on `MachineInstance` as part of this rollout.

3. **CLI capture metadata: rich metadata**

- `ctx.cli.exec(...)` returns structured transcript metadata when capture is enabled (workspace, relative path, resolved path, label, exit code, duration).

4. **Client/API cutover: immediate update**

- Client start-instance requests must send the new required `runtimeOptions` contract.
- No client compatibility mode in this rollout.

5. **Artifact allow-dir source: `artifactsWorkspaceRoot`**

- `runtimeOptions.cliDirectoryPolicy` only provides `workspaceDirs`.
- The artifacts `--add-dir` value is always `ctx.artifactsWorkspace.root` (family-root scoped).

6. **JSON recovery retries: bounded**

- Use in-action retries for invalid JSON with `maxFormatRetries = 2` (3 total attempts including initial result prompt).

7. **Schema-valid status routing**

- Any schema-valid result (including `status = "error"`) transitions to `successState`.

8. **CLI transcript labels: helper-derived**

- Transcript labels are derived by the CLI helper from command name (actions do not provide per-call labels).

9. **Conversation reset behavior: removed**

- Do not execute a conversation reset command after result capture.
- Result-formatting prompt turns may remain in conversation history for resumed sessions.

10. **`filePaths` handling policy: warn + pass-through**

- Do not fail the action on malformed/unsafe `filePaths` entries.
- Preserve raw entries and emit warnings in action output.

11. **Rollout sequencing**

- Land platform refactors first (schema/API + runner/context + `CliHelper` capture), then register/use `copilot-cli-prompt`.

12. **Developer workflow script location**

- Required dev curl workflow script lives under `scripts/dev/`.

13. **CLI transcript write mode: streamed append**

- All `ctx.cli.exec(...)` calls stream stdout/stderr chunks into transcript files while commands execute.
- Do not defer transcript writes to end-of-command or end-of-action flushes.

14. **Copilot model routing policy**

- Use `gpt-5.3-codex` for main task turns (new and resumed conversations).
- Use `gpt-5.1-codex-mini` for strict-JSON result prompt turns (initial + repair retries).

15. **State-scoped transcript file policy**

- Within one state visit, all `ctx.cli.exec(...)` calls append to a single shared transcript log file.
- Use clear delimiter blocks between CLI invocations in that shared file.
- Transcript filenames use a `-log` suffix.

## Implementation simplifications (draft, no behavior/contract changes)

The following simplifications are recommended before implementation. They reduce moving parts while preserving all rollout decisions and behavior-spec obligations.

1. **Single platform cutover slice (`01–04`)**

- Implement runtime policy types, schema, API validation, and runner pass-through in one change train.
- Avoid intermediate states where one layer expects `runtimeOptions` while another still treats it as optional.

2. **Single CLI capture module boundary (`05–06`)**

- Keep lineage path resolution, transcript writing, and returned capture metadata behind `ctx.cli.exec(...)` in `CliHelper`.
- Avoid additional action-layer wrappers for capture behavior.

3. **Inline prelude formatter for first rollout (`10`)**

- Implement directory-guidance prelude formatting as a private function in the `copilot-cli-prompt` action module first.
- Extract to a shared utility only after a second caller exists.

4. **One result pipeline helper (`11–14`)**

- Use one internal helper for: prompt-for-result JSON → retry-on-invalid (`maxFormatRetries = 2`) → schema validation → file-path normalization/warnings.
- Return a discriminated outcome consumed directly by transition shaping (`successState` vs `execErrorState`).

5. **Stable output shape defaults**

- Always include `commandOutputFiles`, `commandOutputWarnings`, and `filePathWarnings` as arrays (empty when none) across both success and exec-error branches.
- This removes optional-field branching in downstream states and tests.

6. **Thin developer script (`19`)**

- Keep the `scripts/dev/` curl workflow script declarative: static definition payload + start + poll loop.
- Reuse a single polling/status-printer path for both success and failure terminal outcomes.

7. **Single streamed transcript boundary (`23`)**

- Keep streamed transcript writing centralized in `CliHelper` for all CLI commands.
- Do not create action-specific stream-log implementations.

## Action Input Contract (`ctx.stateData`)

```json
{
  "prompt": "Implement a parser for config files",
  "conversationId": "copilot-conv-123",
  "contextFilePaths": [
    { "workspace": "workspace", "path": "server/src/config/types.ts" },
    { "workspace": "artifacts", "path": "plans/parser-notes.md" }
  ],
  "successState": "runFollowupPrompt",
  "execErrorState": "handleCopilotExecError"
}
```

### Input notes

- `prompt` is required and non-empty.
- `conversationId` is optional:
  - Omitted: start a new conversation and include the directory-guidance prelude.
  - Provided: resume that conversation and do **not** prepend the directory-guidance prelude again.
- `contextFilePaths` is optional and may include workspace/artifacts-relative paths.
- `successState` and `execErrorState` are required transition targets.
- Allowed workspace/artifacts directory policy comes from machine/runtime configuration (not action `stateData`).

## CLI Execution Contract

The action executes `copilot` CLI with:

1. A system directory-guidance prompt prepended before the user prompt **only when starting a new conversation**.
2. User prompt as the main task prompt.
3. YOLO mode enabled.
4. Allowed directories passed as CLI arguments from runtime `workspaceDirs` plus `ctx.artifactsWorkspace.root`.
5. Optional context file arguments derived from `contextFilePaths`.
6. Optional conversation resume using `conversationId` when provided.

Model policy for this action:

- Main prompt execution uses `gpt-5.3-codex`.
- Result-formatting and JSON-repair prompt executions use `gpt-5.1-codex-mini`.

Runtime resolves `workspaceDirs` entries to absolute paths before passing them as `--add-dir` values, and always appends `ctx.artifactsWorkspace.root` as the artifacts allow-dir.
These flags configure Copilot CLI with the expected state-machine workspaces; the state machine itself does not enforce filesystem access control.

> CLI compatibility note: current Copilot CLI builds expose `--add-dir` (not `--allow-dir`) and session resume via `--resume` (not `--conversation-id`).
> In this spec, `conversationId` refers to that resumable session identifier.

Example command shape (illustrative):

```bash
copilot \
  --prompt "<system-directory-guidance>\n\nUser task:\n<prompt>" \
  --model "gpt-5.3-codex" \
  --yolo \
  --add-dir "<resolved-workspace-dir>" \
  --add-dir "<resolved-artifacts-dir>" \
  --context "<resolved-context-file-1>" \
  --context "<resolved-context-file-2>"
```

Resume command shape (illustrative):

```bash
copilot \
  --resume "<conversationId>" \
  --prompt "<prompt>" \
  --model "gpt-5.3-codex" \
  --yolo \
  --add-dir "<resolved-workspace-dir>" \
  --add-dir "<resolved-artifacts-dir>" \
  --context "<resolved-context-file-1>" \
  --context "<resolved-context-file-2>"
```

## System directory-guidance prompt (prepended on first conversation turn only)

The action prepends a system prompt to guide file placement across the two working directories:

- **Workspace** (`ctx.workspace.root`) for project/source files.
- **Artifacts workspace** (`ctx.artifactsWorkspace.root`) for generated non-project files.

Recommended prompt content:

```text
You have access to two working directories:
1) Workspace: project/source files.
2) Artifacts workspace: generated non-project files and artifacts.

Default file placement guidance (recommendation, not restriction):
- Put non-project generated files in artifacts workspace.
- Artifact files include plans, reports, checklists, and metadata.
- Put plans and high-level documents at the root of the artifacts family tree folder.
- Put reports, logs, and other non-structural files in the folder associated with the current state machine instance.
- For child state machines, use nested family-tree folders under children/<childInstanceId>/...

You may read/write files anywhere within either workspace root when needed.
```

When `conversationId` is provided, this prelude is not sent again; the action resumes the existing conversation with the new user prompt.

### Default artifacts placement recommendation

This recommendation is intentionally loose (not enforced by state-machine access controls), and actions may read/write anywhere within the workspace or artifacts workspace roots.
`ctx.artifactsWorkspace.root` is already family-root scoped (`<ARTIFACT_ROOT>/<rootInstanceId>/`).

- Family root (plans/high-level docs):
  - `ctx.artifactsWorkspace.root/<filename>`
- State-machine-associated folder (reports/logs/non-structural):
  - Root instance: `ctx.artifactsWorkspace.resolve("<stateName>/<filename>")`
  - Child instance: `ctx.artifactsWorkspace.resolve("children/<childInstanceId>/<stateName>/<filename>")`
  - Nested children: continue nesting with `/children/<instanceId>/...`.

## Required system refactors before implementing this action

The following refactors are prerequisites and apply platform-wide (not just `copilot-cli-prompt`):

1. **Global CLI transcript capture in `CliHelper`**
   - Every `ctx.cli.exec(...)` call across all actions can be captured when enabled.
   - Transcript `.txt` content includes command/args, cwd, exitCode, stdout, stderr, and duration.

2. **Toggleable capture policy at machine runtime**
   - Add machine-level runtime option (for example in start-instance input) to enable/disable capture.
   - Custom actions should not re-implement capture logic; they rely on `ctx.cli.exec` behavior.

3. **Instance-lineage artifact path helper**
   - Standardize transcript output paths so files are associated with the spawning instance and nested for children.
   - Use one shared resolver that works for root, child, and deeply nested descendants.

4. **Capture metadata returned from CLI helper**
   - `ctx.cli.exec(...)` should return transcript path metadata when capture is enabled so actions can forward references.

5. **Test coverage before action rollout**
   - Add tests that prove capture works for any action using `ctx.cli.exec`, including parent and child machine executions.

6. **System prompt prelude utility**
   - Add a shared helper that prepends the directory-guidance system prompt before user prompts for `copilot-cli-prompt`.
   - Inject runtime values (workspace root, artifacts root, lineage path hints) into the prompt template.

7. **Developer curl workflow script (non-test)**
   - Add a developer script that uses `curl` to create/update a full machine definition using `copilot-cli-prompt`.
   - The script must start an instance whose prompt requests creating `helloWorld.md`.
   - The script must poll run status until terminal completion and print progress plus current completion status throughout.
   - This script is a developer environment/tooling utility (not an e2e test) and is expected to evolve.

## Migration details (breaking migration; no legacy compatibility)

This migration intentionally makes breaking changes to move directly to the target model in this spec.

1. **Replace start-instance contract**
   - Replace the request contract with required `runtimeOptions` (not optional):
   - `cliDirectoryPolicy: { workspaceDirs: string[] }`
   - `cliOutputCapture: { enabled: boolean }`

- Remove legacy start behavior that runs without runtime CLI policy input.
- Do not provide compatibility shims or fallback request shapes.

2. **Update runner/action context to require runtime policy**

- Require resolved directory-policy and capture-policy values in runner context for every action execution.
- Use a **pass-through model**: pass runtime policy through run/context wiring and action execution.
- Do not persist runtime policy on `MachineInstance` in this rollout.
- Remove fallback/default branches that assume missing runtime policy.

3. **Centralize capture in `CliHelper` and remove per-action alternatives**

- `ctx.cli.exec(...)` becomes the single path for CLI transcript capture and capture metadata return.
- Return rich capture metadata including workspace, relative path, resolved path, label, exitCode, and durationMs.
- Derive label from command name within `CliHelper` (no action-level label parameter in this rollout).
- Remove/forbid any action-level capture implementations.

4. **Adopt one lineage path resolver**
   - Use a single instance-lineage resolver for transcript paths across root/child/nested-child execution.
   - Remove duplicate or ad-hoc path construction logic.

5. **Register and use `copilot-cli-prompt` as the new AI action path**

- Implement and register `copilot-cli-prompt` with strict JSON flow, in-action retry-on-invalid, normalization, and explicit transitions.
  - Treat this action contract as the canonical prompt-action interface for machine workflows in this rollout.

6. **Ship developer curl script as required operational tooling**
   - Provide a developer script that upserts the machine definition, starts a run with a `helloWorld.md` prompt, polls to terminal state, and prints progress/completion status throughout.
   - This script is not an e2e test; it is required developer tooling and is expected to evolve.

7. **Cutover sequence**
   - Land schema/API breaking changes first.
   - Land runner + `CliHelper` refactor second.
   - Land `copilot-cli-prompt` action and registry wiring third.
   - Land developer curl tooling last, targeting only the new contract.

8. **Post-rollout follow-up**

- Land system-wide streamed CLI transcript writes + model-routing hardening as a follow-up task.

## System-wide toggleable CLI output capture

When runtime capture is enabled, every CLI command in any action writes a `.txt` transcript artifact that includes:

- command and args
- cwd
- exit code
- stdout
- stderr

Capture includes all CLI calls in this action flow (initial prompt execution, JSON-result prompt, optional JSON-repair reprompt) and in every other action flow, because it applies to all `ctx.cli.exec` usage platform-wide.

When capture is enabled, `ctx.cli.exec(...)` also returns rich transcript metadata for each command:

```json
{
  "workspace": "artifacts",
  "path": "runCopilotPrompt/001-copilot.txt",
  "resolvedPath": "/abs/path/to/artifacts/.../runCopilotPrompt/001-copilot.txt",
  "label": "copilot",
  "exitCode": 0,
  "durationMs": 1432
}
```

### Artifact path convention

Each transcript is written under an artifacts folder scoped to the machine instance that executed the command:

- Root instance:
  - `ctx.artifactsWorkspace.resolve("<stateName>/<visitIndex>-<label>.txt")`
- Child instance:
  - `ctx.artifactsWorkspace.resolve("children/<childInstanceId>/<stateName>/<visitIndex>-<label>.txt")`
- Nested children:
  - Continue nesting with `/children/<instanceId>/...` for each level.
- `<visitIndex>` is the 1-based count of how many times that state has been visited for the executing instance (for example: `001`, then `002`).
- The transcript filename for a state visit uses a `-log` suffix (for example `001-log.txt`).
- Multiple CLI invocations in one state visit append to that same state-visit log file.
- Delimiter blocks are written between invocations to preserve command boundaries.

This keeps command outputs associated with the spawning machine instance while preserving parent/child hierarchy.

## Response capture with JSON recovery

After the main prompt execution:

1. Send a **system result prompt** in the same conversation asking for strict JSON only.
2. Parse and validate the JSON.
3. If JSON is invalid, send a **system reprompt** asking the model to wrap/reformat its previous response as strict JSON only.
4. Repeat parse/validate for each retry until success or `maxFormatRetries` is reached.

Recommended default: `maxFormatRetries = 2` (up to 3 total format attempts including the first result prompt).

### System-wide streamed CLI transcript behavior

Every `ctx.cli.exec(...)` call writes to its transcript artifact as CLI output arrives.

This includes Copilot prompt flow commands (initial prompt execution, result prompt, JSON-repair retries) and all non-Copilot action commands that use `ctx.cli.exec(...)`.

- Streamed transcript content should retain command context and include stream source markers (`stdout`/`stderr`) in arrival order.
- In state-shared transcript files, each CLI invocation must begin with a clear delimiter section containing invocation metadata (index/command/args/cwd/timestamp).
- If a transcript stream write fails, action execution continues and returns a warning diagnostic in `commandOutputWarnings`.

### Required system result prompt behavior

- Must request machine-readable JSON only (no markdown).
- Must request fields needed for chaining (data + file paths + status + diagnostics).
- On invalid JSON, must issue system reprompts from within the same action until success or `maxFormatRetries` is exhausted.
- Must run in the active conversation (newly created or resumed via `conversationId`).
- Must use `gpt-5.1-codex-mini` for result prompt and repair turns.

## Required JSON result schema

The post-processed JSON must validate against this shape before transition:

```json
{
  "type": "object",
  "required": ["schemaVersion", "status", "summary", "data", "filePaths", "diagnostics"],
  "properties": {
    "schemaVersion": { "type": "string", "const": "copilot-action-result.v1" },
    "status": { "type": "string", "enum": ["ok", "error"] },
    "summary": { "type": "string", "minLength": 1 },
    "data": { "type": "object" },
    "filePaths": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["workspace", "path"],
        "properties": {
          "workspace": { "type": "string", "enum": ["workspace", "artifacts"] },
          "path": { "type": "string", "minLength": 1 },
          "description": { "type": "string" }
        },
        "additionalProperties": false
      }
    },
    "diagnostics": {
      "type": "object",
      "required": ["exitCode"],
      "properties": {
        "exitCode": { "type": "number" },
        "durationMs": { "type": "number" }
      },
      "additionalProperties": true
    }
  },
  "additionalProperties": false
}
```

## File path normalization and warnings

Before returning `data`, the action should attempt to normalize each `filePaths[]` item into:

```json
{
  "workspace": "workspace",
  "path": "server/src/config/parser.ts",
  "resolvedPath": "/abs/path/from/workspace/root/server/src/config/parser.ts"
}
```

Rules:

- `workspace` selects resolver:
  - `workspace` -> `ctx.workspace.resolve(path)`
  - `artifacts` -> `ctx.artifactsWorkspace.resolve(path)`
- `path` should be relative and ideally resolve inside the selected workspace root.
- Malformed/unsafe entries do **not** fail the action in this rollout; they are preserved and surfaced as warnings.
- `normalizedFilePaths` may contain only successfully normalized entries.
- Add `filePathWarnings` with per-item diagnostics for malformed/unsafe entries.

This preserves model output while still providing best-effort normalized references for downstream chaining.

## Transition behavior

### Success

Any schema-valid result (including `status = "error"`) transitions to `successState`; downstream states can branch on `copilotResult.status`.

Return:

```json
{
  "nextState": "<successState>",
  "data": {
    "conversationId": "<activeConversationId>",
    "copilotResult": { "...validated-json..." },
    "normalizedFilePaths": [{ "...normalized-path-record..." }],
    "commandOutputFiles": [
      {
        "workspace": "artifacts",
        "path": "runCopilotPrompt/001-copilot.txt",
        "resolvedPath": "/abs/path/to/artifacts/.../001-copilot.txt",
        "label": "copilot",
        "exitCode": 0,
        "durationMs": 1432
      }
    ],
    "filePathWarnings": [
      {
        "index": 1,
        "workspace": "workspace",
        "path": "../outside-root.txt",
        "message": "path resolves outside workspace root"
      }
    ]
  }
}
```

### Invalid JSON or schema mismatch

If a JSON response is invalid, retry in-action with the JSON-wrapping system prompt.
If the final retry result is still invalid, return `nextState = execErrorState` with error details in `data`:

```json
{
  "conversationId": "<activeConversationId>",
  "reason": "invalid_result_json",
  "attemptCount": 3,
  "validationErrors": [
    { "path": "/filePaths/0/path", "message": "must NOT be shorter than 1 characters" }
  ],
  "rawResult": "<raw-output>"
}
```

### Copilot CLI execution failure

Return `nextState = execErrorState` with `stderr`/`exitCode` data.
If runtime CLI capture is enabled, return any collected `commandOutputFiles` references in this branch as well.
Include `conversationId` in returned data when available so downstream states can decide whether to resume or restart.

## Full setup example

### 1) Machine definition snippet

Use the right shape for the right API surface:

- **Stored/returned definition shape** (what `GET /api/machines/definitions/:id` returns): includes server-managed fields.
- **Create/update request payload shape** (what `POST/PUT /api/machines/definitions` accepts): excludes server-managed fields.

#### Stored/returned definition shape (server response)

```json
{
  "id": "<definitionId>",
  "name": "Copilot file workflow",
  "version": 1,
  "inputSchema": { "type": "object" },
  "outputSchema": { "type": "object" },
  "initialState": "runCopilotPrompt",
  "states": {
    "runCopilotPrompt": {
      "name": "runCopilotPrompt",
      "type": "action",
      "actionId": "copilot-cli-prompt",
      "dataSchema": { "type": "object" },
      "timeoutMs": 120000
    },
    "runFollowupPrompt": {
      "name": "runFollowupPrompt",
      "type": "action",
      "actionId": "copilot-cli-prompt"
    },
    "handleCopilotExecError": {
      "name": "handleCopilotExecError",
      "type": "action",
      "actionId": "handle-copilot-exec-error"
    },
    "completed": { "name": "completed", "type": "terminal" },
    "cancelled": { "name": "cancelled", "type": "terminal" },
    "error": { "name": "error", "type": "terminal" }
  },
  "transitions": [
    { "from": "runCopilotPrompt", "to": "runFollowupPrompt" },
    { "from": "runCopilotPrompt", "to": "handleCopilotExecError" },
    { "from": "runFollowupPrompt", "to": "completed" },
    { "from": "runFollowupPrompt", "to": "handleCopilotExecError" },
    { "from": "handleCopilotExecError", "to": "completed" }
  ],
  "metadata": {
    "createdAt": "<server-generated-iso>",
    "updatedAt": "<server-generated-iso>",
    "description": "Copilot CLI workflow",
    "tags": ["copilot", "workflow"]
  }
}
```

Use this returned `id` value as `definitionId` when starting instances.

#### Create/update request payload shape (request body)

No `id`, no `version`, and no `metadata.createdAt/updatedAt`.

```json
{
  "name": "Copilot file workflow",
  "inputSchema": { "type": "object" },
  "outputSchema": { "type": "object" },
  "initialState": "runCopilotPrompt",
  "states": {
    "runCopilotPrompt": {
      "name": "runCopilotPrompt",
      "type": "action",
      "actionId": "copilot-cli-prompt",
      "dataSchema": { "type": "object" },
      "timeoutMs": 120000
    },
    "runFollowupPrompt": {
      "name": "runFollowupPrompt",
      "type": "action",
      "actionId": "copilot-cli-prompt"
    },
    "handleCopilotExecError": {
      "name": "handleCopilotExecError",
      "type": "action",
      "actionId": "handle-copilot-exec-error"
    },
    "completed": { "name": "completed", "type": "terminal" },
    "cancelled": { "name": "cancelled", "type": "terminal" },
    "error": { "name": "error", "type": "terminal" }
  },
  "transitions": [
    { "from": "runCopilotPrompt", "to": "runFollowupPrompt" },
    { "from": "runCopilotPrompt", "to": "handleCopilotExecError" },
    { "from": "runFollowupPrompt", "to": "completed" },
    { "from": "runFollowupPrompt", "to": "handleCopilotExecError" },
    { "from": "handleCopilotExecError", "to": "completed" }
  ],
  "metadata": {
    "description": "Copilot CLI workflow",
    "tags": ["copilot", "workflow"]
  }
}
```

### 2) Example state input for first AI action

```json
{
  "prompt": "Create a typed parser and update tests.",
  "contextFilePaths": [
    { "workspace": "workspace", "path": "server/src/config/parser.ts" },
    { "workspace": "workspace", "path": "server/src/config/parser.test.ts" }
  ],
  "successState": "runFollowupPrompt",
  "execErrorState": "handleCopilotExecError"
}
```

Note: omit `conversationId` on the first turn so the directory-guidance prelude is prepended.

### 3) Example state input for second AI action (chained paths)

Build `contextFilePaths` and `conversationId` from the previous action output:

```typescript
const contextFilePaths = normalizedFilePaths.map(({ workspace, path }) => ({ workspace, path }));
const conversationId = previousStateData.conversationId;
```

Example resulting state input:

```json
{
  "prompt": "Review generated files and produce a concise summary.",
  "conversationId": "copilot-conv-123",
  "contextFilePaths": [
    { "workspace": "workspace", "path": "server/src/config/parser.ts" },
    { "workspace": "workspace", "path": "server/src/config/parser.test.ts" }
  ],
  "successState": "completed",
  "execErrorState": "handleCopilotExecError"
}
```

### 4) Action registry setup (illustrative)

```typescript
yield * registry.register('copilot-cli-prompt', copilotCliPromptAction);
yield * registry.register('handle-copilot-exec-error', handleCopilotExecErrorAction);
```

### 5) Start-instance request (system data included)

`runtimeOptions` is required in this rollout (no legacy request shape supported).

```json
{
  "definitionId": "<definitionId>",
  "workspaceRoot": "/home/user/my-repo",
  "runtimeOptions": {
    "cliDirectoryPolicy": {
      "workspaceDirs": ["/home/user/my-repo"]
    },
    "cliOutputCapture": {
      "enabled": true
    }
  },
  "input": {
    "prompt": "Create a typed parser and update tests.",
    "contextFilePaths": [{ "workspace": "workspace", "path": "server/src/config/parser.ts" }],
    "successState": "runFollowupPrompt",
    "execErrorState": "handleCopilotExecError"
  }
}
```

### 6) Example transcript artifact paths

- Root machine command:
  - `runCopilotPrompt/001-copilot.txt`
- Child machine command:
  - `children/<childInstanceId>/runCopilotPrompt/001-copilot.txt`

### 7) Developer curl workflow script requirement

- Provide a script (for developers) that uses `curl` to:
  1. Register/update a full state machine definition that uses `copilot-cli-prompt`.
  2. Start a machine instance with prompt text requesting creation of `helloWorld.md`.
  3. Poll instance status until terminal state.
  4. Print live progress details and final completion status as it runs.
- Place this script under `scripts/dev/`.
- This is explicitly not an e2e test; it is a developer setup/runtime tool intended to evolve.

## Implementation notes (for follow-up)

- Use `ctx.cli.exec(...)` so transition logic remains in-machine.
- Keep capture behavior centralized in `ctx.cli.exec` (system refactor), not reimplemented inside each action.
- Keep JSON validation strict (`additionalProperties: false` where practical).
- Emit raw outputs only in error branches to simplify debugging.
- Preserve source-of-truth semantics for `stateData`, `machineInput`, `workspace`, and `artifactsWorkspace`.
- Propagate active `conversationId` in action outputs so follow-up states can resume conversation context when desired.
