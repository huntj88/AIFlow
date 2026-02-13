# Copilot CLI Prompt Action (Draft)

## Overview

This draft adds a reusable AI action that runs a prompt through GitHub `copilot` CLI, captures structured JSON output, validates required fields, and routes to success/error states in a state machine.

The action is designed to chain into later AI actions by returning validated file path references in a stable format.

## Goals

- Accept a `prompt` string as action input.
- Run `copilot` CLI in YOLO mode.
- Use system/runtime-provided allowed workspace and artifacts directory policy for CLI execution.
- Prepend a system directory-guidance prompt before the user prompt.
- Support optional file-path context forwarded to `copilot` CLI input arguments.
- Ask a result-reporting system prompt that returns JSON (`data`, `filePaths`, diagnostics).
- Reset conversation state to before the system result prompt.
- Validate JSON shape and required fields before returning state data.
- Route invalid JSON/shape failures to a dedicated machine error-handling action.
- Depend on a system-wide, toggleable CLI transcript capture feature for all `ctx.cli.exec` usage.

## Non-goals

- Defining the final production CLI wrapper implementation details.
- Defining UI behavior beyond state-machine data contracts.

## Proposed Action ID

- `copilot-cli-prompt`

## Action Input Contract (`ctx.stateData`)

```json
{
  "prompt": "Implement a parser for config files",
  "contextFilePaths": [
    { "workspace": "workspace", "path": "server/src/config/types.ts" },
    { "workspace": "artifacts", "path": "plans/parser-notes.md" }
  ],
  "successState": "runFollowupPrompt",
  "invalidResultState": "handleInvalidCopilotResult",
  "execErrorState": "handleCopilotExecError"
}
```

### Input notes

- `prompt` is required and non-empty.
- `contextFilePaths` is optional and may include workspace/artifacts-relative paths.
- `successState`, `invalidResultState`, and `execErrorState` are required transition targets.
- Allowed workspace/artifacts directory policy comes from machine/runtime configuration (not action `stateData`).

## CLI Execution Contract

The action executes `copilot` CLI with:

1. A system directory-guidance prompt prepended before the user prompt.
2. User prompt as the main task prompt.
3. YOLO mode enabled.
4. Allowed directories passed as CLI arguments from machine/runtime directory policy.
5. Optional context file arguments derived from `contextFilePaths`.

Runtime resolves directory-policy entries to absolute paths before passing them as `--allow-dir` values.

Example command shape (illustrative):

```bash
copilot chat \
  --prompt "<system-directory-guidance>\n\nUser task:\n<prompt>" \
  --yolo \
  --allow-dir "<resolved-workspace-dir>" \
  --allow-dir "<resolved-artifacts-dir>" \
  --context "<resolved-context-file-1>" \
  --context "<resolved-context-file-2>"
```

## System directory-guidance prompt (prepended)

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

You may still read/write files in other locations when needed.
```

### Default artifacts placement recommendation

This recommendation is intentionally loose (not enforced), and actions may read/write other locations.
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
   - Add optional `artifactDir` override (default `cli-command-output`).
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

## System-wide toggleable CLI output capture

When runtime capture is enabled, every CLI command in any action writes a `.txt` transcript artifact that includes:

- command and args
- cwd
- exit code
- stdout
- stderr

Capture includes all CLI calls in this action flow (initial prompt execution, JSON-result prompt, and reset command) because it applies to all `ctx.cli.exec` usage.

### Artifact path convention

Each transcript is written under an artifacts folder scoped to the machine instance that executed the command:

- Root instance:
  - `ctx.artifactsWorkspace.resolve("<captureArtifactDir>/<stateName>/<sequence>.txt")`
- Child instance:
  - `ctx.artifactsWorkspace.resolve("<captureArtifactDir>/children/<childInstanceId>/<stateName>/<sequence>.txt")`
- Nested children:
  - Continue nesting with `/children/<instanceId>/...` for each level.

This keeps command outputs associated with the spawning machine instance while preserving parent/child hierarchy.

## Two-step response capture

After the main prompt execution:

1. Send a **system result prompt** in the same conversation asking for strict JSON only.
2. Parse and validate the JSON.
3. Reset/restore conversation state to the snapshot from immediately before the system result prompt.

### Required system result prompt behavior

- Must request machine-readable JSON only (no markdown).
- Must request fields needed for chaining (data + file paths + status + diagnostics).
- Must be ephemeral from conversation-history perspective (state reset after capture).

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

## File path normalization for chaining

Before returning `data`, the action should normalize every `filePaths[]` item into a chaining-safe record:

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
- `path` must be relative (no empty strings).
- Reject malformed entries and route to `invalidResultState`.

This ensures downstream AI actions can consume a consistent format without guessing path roots.

## Transition behavior

### Success

Return:

```json
{
  "nextState": "<successState>",
  "data": {
    "copilotResult": { "...validated-json..." },
    "normalizedFilePaths": [{ "...normalized-path-record..." }],
    "commandOutputFiles": [
      {
        "workspace": "artifacts",
        "path": "cli-command-output/<rootId>/runCopilotPrompt/001-main-prompt.txt",
        "resolvedPath": "/abs/path/to/artifacts/.../001-main-prompt.txt"
      }
    ]
  }
}
```

### Invalid JSON or schema mismatch

Return `nextState = invalidResultState` with error details in `data`:

```json
{
  "reason": "invalid_result_json",
  "validationErrors": [
    { "path": "/filePaths/0/path", "message": "must NOT be shorter than 1 characters" }
  ],
  "rawResult": "<raw-output>"
}
```

### Copilot CLI execution failure

Return `nextState = execErrorState` with `stderr`/`exitCode` data.
If runtime CLI capture is enabled, return any collected `commandOutputFiles` references in this branch as well.

## Full setup example

### 1) Machine definition snippet

```json
{
  "id": "copilot-file-workflow",
  "name": "Copilot file workflow",
  "version": 1,
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
    "handleInvalidCopilotResult": {
      "name": "handleInvalidCopilotResult",
      "type": "action",
      "actionId": "handle-invalid-copilot-result"
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
    { "from": "runCopilotPrompt", "to": "handleInvalidCopilotResult" },
    { "from": "runCopilotPrompt", "to": "handleCopilotExecError" },
    { "from": "runFollowupPrompt", "to": "completed" },
    { "from": "runFollowupPrompt", "to": "handleInvalidCopilotResult" },
    { "from": "runFollowupPrompt", "to": "handleCopilotExecError" },
    { "from": "handleInvalidCopilotResult", "to": "completed" },
    { "from": "handleCopilotExecError", "to": "completed" }
  ]
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
  "invalidResultState": "handleInvalidCopilotResult",
  "execErrorState": "handleCopilotExecError"
}
```

### 3) Example state input for second AI action (chained paths)

Build `contextFilePaths` from the previous action's `normalizedFilePaths`:

```typescript
const contextFilePaths = normalizedFilePaths.map(({ workspace, path }) => ({ workspace, path }));
```

Example resulting state input:

```json
{
  "prompt": "Review generated files and produce a concise summary.",
  "contextFilePaths": [
    { "workspace": "workspace", "path": "server/src/config/parser.ts" },
    { "workspace": "workspace", "path": "server/src/config/parser.test.ts" }
  ],
  "successState": "completed",
  "invalidResultState": "handleInvalidCopilotResult",
  "execErrorState": "handleCopilotExecError"
}
```

### 4) Action registry setup (illustrative)

```typescript
actionRegistry.register('copilot-cli-prompt', copilotCliPromptAction);
actionRegistry.register('handle-invalid-copilot-result', handleInvalidCopilotResultAction);
actionRegistry.register('handle-copilot-exec-error', handleCopilotExecErrorAction);
```

### 5) Start-instance request (system data included)

```json
{
  "definitionId": "copilot-file-workflow",
  "workspaceRoot": "/home/user/my-repo",
  "runtimeOptions": {
    "cliDirectoryPolicy": {
      "workspaceDirs": ["/home/user/my-repo"],
      "artifactDirs": ["/home/user/.aiflow/artifacts/<rootInstanceId>"]
    },
    "cliOutputCapture": {
      "enabled": true,
      "artifactDir": "cli-command-output"
    }
  },
  "input": {
    "prompt": "Create a typed parser and update tests.",
    "contextFilePaths": [{ "workspace": "workspace", "path": "server/src/config/parser.ts" }],
    "successState": "runFollowupPrompt",
    "invalidResultState": "handleInvalidCopilotResult",
    "execErrorState": "handleCopilotExecError"
  }
}
```

### 6) Example transcript artifact paths

- Root machine command:
  - `cli-command-output/runCopilotPrompt/001-main-prompt.txt`
- Child machine command:
  - `cli-command-output/children/<childInstanceId>/runCopilotPrompt/001-main-prompt.txt`

## Implementation notes (for follow-up)

- Use `ctx.cli.exec(...)` so transition logic remains in-machine.
- Keep capture behavior centralized in `ctx.cli.exec` (system refactor), not reimplemented inside each action.
- Keep JSON validation strict (`additionalProperties: false` where practical).
- Emit raw outputs only in error branches to simplify debugging.
- Preserve source-of-truth semantics for `stateData`, `machineInput`, `workspace`, and `artifactsWorkspace`.
