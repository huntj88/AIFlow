# Task 23 — Streamed Result Log & Model Routing

> **Phase**: 6 (Post-rollout follow-up)
> **Depends on**: Task 22
> **Blocks**: nothing (follow-up task)

---

## Objective

Harden `copilot-cli-prompt` result-capture behavior by streaming result-attempt output to an artifacts log file while each attempt runs, and enforce prompt-model routing (`gpt-5.1-codex-mini` for result formatting; `gpt-5.3-codex` otherwise).

---

## Scope

- Add/confirm one append-only result log file per state visit for `copilot-cli-prompt`.
- Stream stdout/stderr chunks for each result-format attempt (initial result prompt + repair retries) to that log while CLI is running.
- Include attempt metadata in each streamed entry (`attempt`, `promptType`, `model`, timestamp, stream source).
- Do not defer result-log writes to end-of-attempt or action completion.
- Route models by prompt type:
  - Main task prompt turns (new + resumed conversations) use `gpt-5.3-codex`.
  - Result-formatting + JSON-repair turns use `gpt-5.1-codex-mini`.
- If result-log stream-write fails, continue action flow and surface warning diagnostics.
- Update unit/integration/e2e coverage and docs to lock behavior.

---

## Acceptance Checklist

- [ ] Result attempts stream in arrival order to a single state-visit log file.
- [ ] Log file grows while CLI attempts are still running (not only after each attempt or at action end).
- [ ] Main prompt turns use `gpt-5.3-codex`.
- [ ] Result/repair prompt turns use `gpt-5.1-codex-mini`.
- [ ] Result-log stream-write failures surface warnings and do not independently force `execErrorState`.
- [ ] Spec + behavior docs reflect this policy and tests cover regressions.

---

## Spec Coverage

- Feature spec: rollout decisions 13 and 14; response-capture streamed-write behavior.
- Behavior spec: §21.9 Copilot workflow and §22.7 edge-case warning behavior.
