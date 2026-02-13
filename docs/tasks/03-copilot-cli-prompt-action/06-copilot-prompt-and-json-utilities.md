# Task 06 — Copilot Prompt Prelude and JSON Utilities

> **Phase**: 3 (Copilot action stack)
> **Depends on**: Tasks 03–05
> **Blocks**: Task 07, Task 10

---

## Objective

Build reusable utilities required by `copilot-cli-prompt`:

1. System directory-guidance prelude template injection (first-turn only).
2. Strict result JSON schema + validation helper.
3. JSON parse/repair helper flow primitives.
4. Context file-path resolution/validation helpers.
5. Conversation-id extraction/propagation helpers.

---

## Scope

- Add utility modules under [server/src/machines/actions](../../../server/src/machines/actions) (or a subfolder like `copilot/`).
- Add JSON schema constants and validation utilities (Ajv-backed).

---

## Steps

1. Implement `buildDirectoryGuidancePrelude(...)` helper that injects runtime roots and lineage hints.
2. Implement prompt composition helpers that support:

- new conversation: prepend prelude + user prompt
- resumed conversation: user prompt only (no repeated prelude)

3. Add canonical result schema constant (`copilot-action-result.v1`).
4. Add `parseAndValidateCopilotResult(raw)` helper returning:
   - valid result object, or
   - structured validation errors.
5. Add `normalizeContextFilePaths(...)` helper for input context file references.
6. Add `normalizeOutputFilePaths(...)` helper to enforce workspace-relative and in-root resolution.
7. Add `resolveConversationId(...)` helper that safely pulls active conversation id from CLI response metadata.
8. Add tests for each utility including invalid/malformed cases.

---

## Behavior Spec Coverage

- [03-copilot-cli-prompt-action.md](../../feature-specs/03-copilot-cli-prompt-action.md):
  - first-turn-only directory-guidance prompt
  - conversation resume via `conversationId`
  - required result schema
  - file path normalization for chaining

---

## Validation Checklist

- [ ] Prelude helper outputs deterministic template text.
- [ ] Prompt composition supports first-turn vs resume behavior.
- [ ] Strict result schema validator implemented and tested.
- [ ] Invalid JSON and schema mismatch return structured errors.
- [ ] Input and output file-path normalization enforce workspace root boundaries.
- [ ] Conversation-id extraction helper is implemented and tested.
