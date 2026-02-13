# Task 07 — Implement `copilot-cli-prompt` Action

> **Phase**: 3 (Copilot action stack)
> **Depends on**: Task 05, Task 06
> **Blocks**: Tasks 08, 10, 11, 13

---

## Objective

Implement the new reusable action `copilot-cli-prompt` with strict JSON capture/recovery, validation, normalization, and explicit transitions.

---

## Action Contract

### Required input (`ctx.stateData`)

- `prompt: string`
- Optional `conversationId: string`
- `successState: string`
- `invalidResultState: string`
- `execErrorState: string`
- Optional `contextFilePaths: Array<{ workspace: 'workspace' | 'artifacts'; path: string }>`

### Required behavior

1. If `conversationId` is absent, build prelude + user prompt (new conversation).
2. If `conversationId` is present, resume conversation and send user prompt only (no prelude replay).
3. Run `copilot` CLI in YOLO mode with runtime `--allow-dir` values.
4. Optionally pass `--context` arguments for resolved context files.
5. Ask strict JSON system result prompt in same active conversation.
6. Parse + validate JSON.
7. On invalid JSON, reprompt once for strict JSON reformat.
8. Reset conversation to snapshot from before result prompt.
9. Route:
   - success: `successState`
   - invalid JSON/shape after reprompt: `invalidResultState`
   - command failure: `execErrorState`
10. Return `conversationId` and `commandOutputFiles` when available.

---

## Scope

- Add action implementation file under [server/src/machines/actions](../../../server/src/machines/actions).
- Use utility helpers from Task 06.
- Use `ctx.cli.exec(...)` only (no ad hoc command execution).

---

## Steps

1. Validate and decode action input from `ctx.stateData`.
2. Resolve context file paths to absolute paths with workspace selector.
3. Execute main prompt command with capture label `main-prompt` using:
   - no `conversationId`: first-turn prelude + prompt
   - with `conversationId`: resume conversation + prompt only
4. If main command execution fails (`exitCode !== 0`), transition to `execErrorState` with error payload + captured outputs.
5. Execute strict-result prompt capture (`result-json` label).
6. Attempt JSON parse+schema validation.
7. If invalid, execute one repair reprompt (`repair-json` label) and revalidate.
8. Execute conversation reset command (`reset-conversation` label) after capture flow.
9. On valid result:
   - normalize result `filePaths`
   - return `nextState: successState`
   - return `conversationId`, `copilotResult`, `normalizedFilePaths`, `commandOutputFiles`
10. On invalid-after-repair:

- return `nextState: invalidResultState`
- include `conversationId`, `reason`, `validationErrors`, `rawResult`, `commandOutputFiles`

---

## Behavior Spec Coverage

- [03-copilot-cli-prompt-action.md](../../feature-specs/03-copilot-cli-prompt-action.md) full action flow and transition behavior.
- [behaviors.md](../../feature-specs/behaviors.md) sections for action registry and CLI capture.

---

## Validation Checklist

- [ ] Action supports required input contract.
- [ ] Uses runtime allow-dir policy from start-instance options.
- [ ] Handles optional context files.
- [ ] Uses prelude only when starting new conversation.
- [ ] Resumes existing conversation when `conversationId` is provided.
- [ ] Performs one repair reprompt on invalid JSON.
- [ ] Restores conversation snapshot after result capture.
- [ ] Returns schema-valid payload with normalized file references and active `conversationId`.
- [ ] Error branches include diagnostics + transcript references.
