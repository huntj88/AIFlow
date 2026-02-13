# Task 06 — CLI Helper Global Capture Refactor

> **Phase**: 2 (Capture infrastructure)
> **Depends on**: Task 05
> **Blocks**: Tasks 07, 10, 12, 17

---

## Objective

Centralize transcript capture in `CliHelper` for every `ctx.cli.exec(...)` call with runtime toggle support and rich metadata return.

---

## Scope

- Refactor `server/src/machines/cli/CliHelper.ts`:
  - Use runtime capture toggle (`enabled`) from runner-provided options.
  - Write transcript `.txt` files containing command/args/cwd/exit/stdout/stderr/duration.
  - Derive transcript labels from command name (no action-specified labels).
  - Return capture metadata references when enabled.
- Ensure no action-level capture logic remains or is introduced.

---

## Acceptance Checklist

- [ ] Capture enabled => every CLI execution writes transcript file and returns metadata. _(Full workflow-wide validation is deferred until Task 17 e2e covers copilot action call paths.)_
- [ ] Capture disabled => no transcript file writes. _(Full workflow-wide validation is deferred until Task 17 e2e covers copilot action call paths.)_
- [ ] Metadata includes workspace, path, resolvedPath, label, exitCode, durationMs.
- [ ] Label is helper-derived from command name.

---

## Spec Coverage

- Feature spec: required refactors #1, #2, #4; rollout decisions 3 and 8.
- Behavior spec: §16.7 global transcript capture.
