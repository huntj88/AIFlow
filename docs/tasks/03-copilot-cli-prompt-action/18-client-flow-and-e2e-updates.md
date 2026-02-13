# Task 18 — Client Flow & E2E Updates

> **Phase**: 4 (Verification & tooling)
> **Depends on**: Tasks 17, 08
> **Blocks**: Task 20

---

## Objective

Align client UX and automated coverage with the new runtime-options contract and copilot action workflow outputs.

---

## Scope

- Update client dashboard/instance flow tests to reflect required runtime options.
- Update Playwright helpers/specs to include runtimeOptions in all API starts.
- Add/adjust workflow assertions for surfaced copilot outputs (`conversationId`, normalized paths, warnings).
- Ensure quick-start path does not rely on legacy payload shape.

---

## Acceptance Checklist

- [ ] Client unit tests pass with runtimeOptions-first contract.
- [ ] Playwright workflows run with required runtime options.
- [ ] UI surfaces key copilot output data needed for chaining/debugging.
- [ ] No client e2e helper sends legacy start payload.

---

## Spec Coverage

- Feature spec: rollout decision 4.
- Behavior spec: contributes to §21.9 end-to-end workflow validation.
