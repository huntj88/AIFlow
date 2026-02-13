# Task 14 — Result Normalization & Transition Shaping

> **Phase**: 3 (Copilot action implementation)
> **Depends on**: Task 13
> **Blocks**: Task 15

---

## Objective

Finalize action return payload semantics: normalized file paths, warnings, command output references, and success/error transition shaping.

---

## Scope

- Normalize model-returned `filePaths` using workspace-specific resolvers.
- Preserve malformed/unsafe entries and emit `filePathWarnings` instead of failing action.
- Return `normalizedFilePaths` for valid entries only.
- Build success payload with `conversationId`, validated `copilotResult`, and `commandOutputFiles`.
- Ensure any schema-valid result (including `status: "error"`) transitions to `successState`.
- Ensure execution failure and invalid-result branches include `conversationId` (when known) and capture refs when available.

---

## Acceptance Checklist

- [ ] Unsafe path entries do not fail action by themselves.
- [ ] `filePathWarnings` include index/workspace/path/message diagnostics.
- [ ] Success branch always uses `successState` for schema-valid results.
- [ ] Error branches include structured diagnostics and raw output when required.

---

## Spec Coverage

- Feature spec: file path normalization and warnings; transition behavior.
- Behavior spec: §21.9 and §22.7 pass-through warning behavior.
