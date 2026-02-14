# Task 21 — Remove Conversation Reset Step

> **Phase**: 5 (Post-rollout follow-up)
> **Depends on**: Task 20
> **Blocks**: nothing (follow-up task)

---

## Objective

Remove the post-result conversation reset step from `copilot-cli-prompt` while preserving bounded JSON recovery and existing success/error transition contracts.

---

## Scope

- Remove/reset-disable any action behavior that issues a conversation reset prompt/command after strict JSON capture.
- Keep strict JSON result prompt + bounded repair retries (`maxFormatRetries = 2`) unchanged.
- Remove reset-failure-specific error routing requirements from action behavior and tests.
- Update prompt helpers to remove unused reset prompt builder when no callers remain.
- Update feature spec + behavior spec expectations to reflect non-ephemeral result-format prompts.

---

## Acceptance Checklist

- [x] `copilot-cli-prompt` no longer executes a reset step after result capture.
- [x] No reset-failure branch is required for transition routing.
- [x] Unit/integration/e2e tests no longer require reset behavior and still pass for retry/error branches.
- [x] Prompt helper surface no longer includes reset-specific template(s) unless still used elsewhere.
- [x] Spec/behavior/task overview docs are internally consistent on reset removal.

---

## Spec Coverage

- Feature spec: rollout decision 9 and response-capture behavior.
- Behavior spec: §21.9 and §22.7 reset-related expectations.
