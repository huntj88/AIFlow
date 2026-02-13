# Task 02 — Start-Instance API Runtime Options Validation

> **Phase**: 1 (Contracts)
> **Depends on**: Task 01
> **Blocks**: Tasks 03, 09, 12, 13

---

## Objective

Enforce the new required runtime options at the API boundary for `POST /api/machines/instances`, including shape and path validity checks, and pass validated values into runner start options.

---

## Scope

- Update [server/src/routes/machines/instances.ts](../../../server/src/routes/machines/instances.ts).
- Add/adjust route tests in [server/src/routes/machines/instances.test.ts](../../../server/src/routes/machines/instances.test.ts).

---

## Steps

1. Decode request body with updated schema from Task 01.
2. Validate `workspaceDirs` and `artifactDirs` entries are absolute paths.
3. Validate `workspaceRoot` still exists and is a directory.
4. Pass `runtimeOptions` into `runner.run(...)` options.
5. Return 400 with actionable validation messages for malformed runtime options.
6. Remove compatibility branches that auto-populated default CLI policy.

---

## Behavior Spec Coverage

- [behaviors.md](../../feature-specs/behaviors.md) section 4.5 (runtime CLI options validation).
- [03-copilot-cli-prompt-action.md](../../feature-specs/03-copilot-cli-prompt-action.md) migration steps 1–2.

---

## Validation Checklist

- [ ] Missing `runtimeOptions` returns 400.
- [ ] Missing `workspaceDirs` returns 400.
- [ ] Missing `artifactDirs` returns 400.
- [ ] Missing capture toggle returns 400.
- [ ] Relative policy directory paths are rejected.
- [ ] `runner.run(...)` receives validated runtime policy.
