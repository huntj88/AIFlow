# Task 13 — JSON Recovery & Conversation Reset

> **Status note**: Conversation-reset requirements in this task are superseded by Task 21 (`21-remove-conversation-reset-step.md`).

> **Phase**: 3 (Copilot action implementation)
> **Depends on**: Task 12
> **Blocks**: Task 14

---

## Objective

Implement in-action strict JSON capture retries and mandatory conversation reset semantics.

---

## Scope

- After main prompt, issue system result prompt in active conversation.
- Parse + validate result; on invalid output send repair prompt in same conversation.
- Enforce `maxFormatRetries = 2` (3 total attempts).
- Snapshot/reset conversation around result-prompt sequence.
- On reset failure, transition to `execErrorState` with reset diagnostics.

---

## Acceptance Checklist

- [x] Retry loop is bounded exactly per spec.
- [x] Invalid JSON/schema after final retry routes to `execErrorState`.
- [x] Reset executes on success and invalid-json branches.
- [x] Reset failure is treated as execution failure.

---

## Spec Coverage

- Feature spec: response capture with JSON recovery, required system result prompt behavior, rollout decisions 6 and 9.
- Behavior spec: §21.9 retry/reset requirements and §22.7 reset edge behavior.
