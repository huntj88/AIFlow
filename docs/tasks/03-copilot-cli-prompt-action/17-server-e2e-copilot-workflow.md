# Task 17 — Server E2E Copilot Workflow

> **Phase**: 4 (Verification & tooling)
> **Depends on**: Tasks 16, 09
> **Blocks**: Tasks 18, 20

---

## Objective

Add HTTP-level e2e coverage for runtime-option validation and the full copilot prompt workflow behavior contract.

---

## Scope

- Add new server e2e suite (e.g., `server/src/__e2e__/13-copilot-cli-prompt.e2e.test.ts`) using deterministic CLI stubbing.
- Update existing e2e suites:
  - `02-actions.e2e.test.ts` for action discoverability.
  - `11-edge-cases.e2e.test.ts` for required runtimeOptions API errors.
- Validate workflow branches:
  - new vs resumed conversation behavior
  - bounded JSON repair retries
  - schema-valid success handling
  - invalid final JSON failure payload
  - filePathWarnings pass-through
  - reset failure branch
  - capture-enabled `commandOutputFiles` references

---

## Acceptance Checklist

- [ ] RuntimeOptions validation e2e coverage matches behavior spec.
- [ ] Copilot workflow e2e coverage includes success and all required failure branches.
- [ ] E2E confirms `conversationId` propagation for chained states.
- [ ] E2E confirms capture metadata references for all CLI calls when enabled.

---

## Spec Coverage

- Behavior spec: §4.5, §21.9, §22.1, §22.7.
- Feature spec: transition behavior + recovery/reset requirements.
