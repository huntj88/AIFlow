# Task 10 — Server Tests: `copilot-cli-prompt` Action Flow

> **Phase**: 4 (Tests)
> **Depends on**: Tasks 06–08
> **Blocks**: Tasks 11, 13

---

## Objective

Add unit/integration tests for the full `copilot-cli-prompt` behavior: success path, invalid JSON repair, schema mismatch routing, CLI execution failure, and output normalization.

---

## Scope

- Add dedicated action tests in [server/src/machines/actions](../../../server/src/machines/actions).
- Extend runner integration tests where state transitions are asserted.

---

## Test Matrix

1. **Success path**: valid strict JSON transitions to `successState` with normalized file paths.
2. **First-turn prelude**: prelude is included only when `conversationId` is absent.
3. **Resume flow**: with `conversationId`, action resumes conversation and does not send prelude again.
4. **Invalid JSON then repaired**: reprompt once, succeeds.
5. **Invalid after repair**: routes to `invalidResultState` with validation details.
6. **CLI exec error**: routes to `execErrorState` with stderr/exitCode.
7. **`status: error` but schema-valid**: still routes to `successState`.
8. **Malformed `filePaths` output**: invalid-result branch.
9. **Command output files included when capture enabled**.
10. **Conversation reset command is issued after result capture flow**.
11. **Active `conversationId` is returned on success and failure branches when available**.

---

## Behavior Spec Coverage

- [03-copilot-cli-prompt-action.md](../../feature-specs/03-copilot-cli-prompt-action.md) response capture, JSON recovery, transition behavior.

---

## Validation Checklist

- [ ] All success and error branches are covered.
- [ ] Single-reprompt policy is enforced.
- [ ] Result schema and path normalization assertions pass.
- [ ] Capture metadata propagation assertions pass.
- [ ] First-turn vs resume prompt behavior assertions pass.
- [ ] `conversationId` propagation assertions pass.
