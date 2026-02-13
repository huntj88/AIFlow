# Task 11 — Copilot Action Contract Schemas

> **Phase**: 3 (Copilot action implementation)
> **Depends on**: Task 10
> **Blocks**: Tasks 12, 13

---

## Objective

Implement strict validation contracts for `copilot-cli-prompt` input and required JSON result schema.

---

## Scope

- Add input parser/validator for action `stateData`:
  - required: `prompt`, `successState`, `execErrorState`
  - optional: `conversationId`, `contextFilePaths`
- Add and compile JSON schema validator for `copilot-action-result.v1`.
- Add helper error-shaping utilities for schema/parse diagnostics.
- Add unit tests for missing keys, additionalProperties, and invalid field types.

---

## Acceptance Checklist

- [x] Empty/missing prompt fails with structured diagnostics.
- [x] Required result keys and enums are strictly enforced.
- [x] Top-level `additionalProperties` rejection is covered.
- [x] Validation errors include machine-usable path/message entries.

---

## Spec Coverage

- Feature spec: action input contract and required JSON result schema.
- Behavior spec: §22.7 key-missing/additionalProperties edge cases.
