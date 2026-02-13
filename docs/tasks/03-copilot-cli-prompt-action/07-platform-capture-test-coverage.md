# Task 07 — Platform Capture Test Coverage

> **Phase**: 2 (Capture infrastructure)
> **Depends on**: Task 06
> **Blocks**: Tasks 10, 16, 17

---

## Objective

Add blocker-level tests proving runtime-toggle capture and lineage behavior works for all actions, including parent-child execution paths.

---

## Scope

- Extend `server/src/machines/cli/CliHelper.test.ts` for capture enabled/disabled behavior and transcript file content.
- Extend `server/src/machines/StateMachineRunner.test.ts` for:
  - parent + child + nested child transcript path associations
  - per-state visit index increments
- Add/adjust e2e scaffolding tests under `server/src/__e2e__/12-workspace.e2e.test.ts` for lineage-path assertions.

---

## Acceptance Checklist

- [x] Capture toggle behavior is tested at unit and integration levels.
- [x] Parent-child lineage path correctness is validated.
- [x] Transcript metadata assertions match new `CliExecResult` contract.
- [x] Tests fail if capture is implemented outside `CliHelper`.

---

## Spec Coverage

- Feature spec: required refactor #5 and capture-path convention.
- Behavior spec: §16.7 and §16.8.
