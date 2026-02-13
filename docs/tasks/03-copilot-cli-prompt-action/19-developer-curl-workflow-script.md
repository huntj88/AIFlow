# Task 19 — Developer Curl Workflow Script

> **Phase**: 4 (Verification & tooling)
> **Depends on**: Tasks 15, 09
> **Blocks**: Task 20

---

## Objective

Provide required developer tooling script under `scripts/dev/` that exercises the copilot workflow using the new runtime contract.

---

## Scope

- Create script at `scripts/dev/curl-copilot-workflow.sh` (or equivalent executable) that:
  1. Upserts a machine definition with `copilot-cli-prompt` and `handle-copilot-exec-error`.
  2. Starts instance with prompt requesting `helloWorld.md`.
  3. Polls status until terminal and prints progress + completion state continuously.
  4. Demonstrates conversation chaining by forwarding returned `conversationId` into follow-up state input.
- Keep script as dev tooling (not test suite).

---

## Acceptance Checklist

- [ ] Script is under `scripts/dev/` and executable.
- [ ] Script sends required `runtimeOptions` payload.
- [ ] Script logs incremental progress and final terminal status.
- [ ] Script includes conversation chaining flow.

---

## Spec Coverage

- Feature spec: required refactor #7, rollout decision 12, full setup script requirement.
- Behavior spec: §21.10.
