# Task 23 — Streamed CLI Transcript Writes & Model Routing

> **Phase**: 6 (Post-rollout follow-up)
> **Depends on**: Task 22
> **Blocks**: nothing (follow-up task)

---

## Objective

Harden runtime CLI capture by streaming transcript writes for all `ctx.cli.exec(...)` usage while commands run, and enforce `copilot-cli-prompt` model routing (`gpt-5.1-codex-mini` for result formatting; `gpt-5.3-codex` otherwise).

---

## Scope

- Stream stdout/stderr chunks for every `ctx.cli.exec(...)` call to transcript artifacts while CLI is running.
- Keep streamed transcript writing centralized in `CliHelper` (no action-level stream implementations).
- Preserve transcript lineage path conventions (root/child/nested children) under artifacts workspace.
- Do not defer transcript writes to end-of-command or action completion.
- Route models by prompt type:
  - Main task prompt turns (new + resumed conversations) use `gpt-5.3-codex`.
  - Result-formatting + JSON-repair turns use `gpt-5.1-codex-mini`.
- If transcript stream-write fails, continue action flow and surface warning diagnostics.
- Update unit/integration/e2e coverage and docs to lock behavior.

---

## Acceptance Checklist

- [ ] All CLI transcript files grow while commands are still running (not only after command completion or at action end).
- [ ] Copilot result/repair turns participate in the same streamed transcript behavior as other CLI calls.
- [ ] Main prompt turns use `gpt-5.3-codex`.
- [ ] Result/repair prompt turns use `gpt-5.1-codex-mini`.
- [ ] Transcript stream-write failures surface warnings and do not independently force `execErrorState`.
- [ ] Spec + behavior docs reflect this policy and tests cover regressions.

---

## Spec Coverage

- Feature spec: rollout decisions 13 and 14; system-wide streamed transcript behavior.
- Behavior spec: §16.7/§16.8 CLI helper capture and §21.9/§22.7 Copilot-specific routing + warning behavior.
