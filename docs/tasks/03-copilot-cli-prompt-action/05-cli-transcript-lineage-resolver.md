# Task 05 — CLI Transcript Lineage Resolver

> **Phase**: 2 (Capture infrastructure)
> **Depends on**: Task 04
> **Blocks**: Tasks 06, 14, 17

---

## Objective

Implement one shared resolver that produces transcript artifact paths for root, child, and nested child executions with deterministic visit indexing.

---

## Scope

- Add a lineage/path helper module under `server/src/machines/workspace/` (or `cli/`) that returns:
  - workspace (`artifacts`)
  - relative path
  - resolved absolute path
- Encode path format:
  - root: `<stateName>/<visitIndex>-<label>.txt`
  - child: `children/<childInstanceId>/<stateName>/<visitIndex>-<label>.txt`
  - nested children: recursive `children/<instanceId>/...`
- Support collision-safe suffixing when multiple commands in one visit share label.

---

## Acceptance Checklist

- [ ] Path resolver supports root, child, and nested-child lineage.
- [ ] Visit index increments per state visit (`001`, `002`, ...).
- [ ] Label collision handling is deterministic.
- [ ] Ad-hoc path construction in CLI capture call sites is removed.

---

## Spec Coverage

- Feature spec: required refactor #3, migration item 4, artifact path convention.
- Behavior spec: §16.8 transcript lineage paths.
