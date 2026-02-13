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

### Required upsert decision flow

- The script must implement explicit create/update branching with deterministic behavior:
  1. Try `GET /api/machines/definitions` and find an existing definition by exact `name` match (and/or a stable metadata tag used only for this workflow script).
  2. If found, send `PUT /api/machines/definitions/:id` using request payload shape (no server-managed fields).
  3. If not found, send `POST /api/machines/definitions` using request payload shape.
  4. Extract resulting `definitionId` from the response body and use it for start-instance.
- If `GET` succeeds but payload is malformed/unparseable, fail fast with clear diagnostics and non-zero exit.
- If `PUT` returns not-found/conflict, retry exactly once by switching to `POST`; otherwise fail fast.
- If create/update response omits definition identifier, fail fast and do not attempt start-instance.
- Always print which branch was taken (`update` vs `create`) and the selected `definitionId`.

---

## Acceptance Checklist

- [ ] Script is under `scripts/dev/` and executable.
- [ ] Script sends required `runtimeOptions` payload.
- [ ] Script logs incremental progress and final terminal status.
- [ ] Script includes conversation chaining flow.
- [ ] Script implements explicit `GET` -> (`PUT` or `POST`) upsert branching and logs chosen branch.
- [ ] Script fails with non-zero exit and clear diagnostics on malformed API responses or missing `definitionId`.

---

## Spec Coverage

- Feature spec: required refactor #7, rollout decision 12, full setup script requirement.
- Behavior spec: §21.10.
