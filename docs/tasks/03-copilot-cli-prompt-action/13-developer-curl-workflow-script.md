# Task 13 — Developer Curl Workflow Script

> **Phase**: 5 (Developer tooling)
> **Depends on**: Tasks 07–08, 11–12
> **Blocks**: none

---

## Objective

Ship a developer script (non-test) that exercises the new canonical flow end-to-end:

1. Upsert machine definition using `copilot-cli-prompt`.
2. Start an instance with a prompt requesting `helloWorld.md`.
3. Demonstrate chained execution where downstream state can reuse returned `conversationId`.
4. Poll status until terminal state.
5. Print live progress and final completion status.

---

## Scope

- Add script under repository tooling folder (recommended: `scripts/dev/`):
  - `scripts/dev/copilot-cli-workflow.sh` (or Node/TS equivalent).
- Add usage documentation in [docs/SETUP_PLAN.md](../../SETUP_PLAN.md) or a new section in [docs/PROJECT_BASE.md](../../PROJECT_BASE.md).

---

## Script Requirements

- Configurable API base URL.
- Creates or updates full machine definition JSON with:
  - `copilot-cli-prompt`
  - `handle-invalid-copilot-result`
  - `handle-copilot-exec-error`
- Sends required `runtimeOptions` on start.
- Uses prompt text requesting creation of `helloWorld.md`.
- Includes at least one follow-up state input that consumes upstream `conversationId` to resume conversation context.
- Polls `/instances/:id` and prints:
  - current state
  - machine status
  - recent transition count/log hints
- Exits non-zero on terminal `error` (or configurable behavior).

---

## Operational Notes

- This script is explicitly **developer tooling**, not an e2e test.
- It is expected to evolve with action contract changes.

---

## Behavior Spec Coverage

- [03-copilot-cli-prompt-action.md](../../feature-specs/03-copilot-cli-prompt-action.md) “Developer curl workflow script requirement”.

---

## Validation Checklist

- [ ] Script can upsert definition on a running server.
- [ ] Script can start instance with required runtime options.
- [ ] Script demonstrates `conversationId` handoff/resume in chained state flow.
- [ ] Script polls until terminal state and prints progress.
- [ ] Script outputs final status and completion summary.
