# Task 16 — Server Unit/Integration Copilot Tests

> **Status note**: Reset-failure branch coverage in this task is superseded by Task 21 (`21-remove-conversation-reset-step.md`).

> **Phase**: 4 (Verification & tooling)
> **Depends on**: Task 15
> **Blocks**: Tasks 17, 20

---

## Objective

Add deterministic unit/integration tests for copilot action internals and runtime-policy pass-through behavior.

---

## Scope

- Add action-focused tests under `server/src/machines/actions/`:
  - input validation
  - CLI arg construction
  - schema-valid `status:error` success routing
  - invalid JSON final failure shaping
  - reset failure routing
- Add runner integration tests proving runtime policy is required/pass-through and not persisted.
- Update existing test scaffolding/mocks for new `CliExecResult` metadata shape.

---

## Acceptance Checklist

- [x] Unit tests cover happy path + bounded retry + reset-failure branches.
- [x] Integration tests cover runtime policy inheritance into child executions.
- [x] Tests verify no runtime policy persistence on `MachineInstance`.
- [x] Server unit/integration suite passes with new contract.

---

## Spec Coverage

- Feature spec: rollout decisions 2, 6, 7, 9, 10.
- Behavior spec: §21.9 and §22.7 internal behavior coverage.
