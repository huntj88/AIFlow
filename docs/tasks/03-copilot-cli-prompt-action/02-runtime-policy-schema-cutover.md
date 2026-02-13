# Task 02 — Runtime Policy Schema Cutover

> **Phase**: 1 (Platform contract cutover)
> **Depends on**: Task 01
> **Blocks**: Tasks 03, 04, 08, 09

---

## Objective

Make `runtimeOptions` required in request decoding and schema validation with no legacy fallback behavior.

---

## Scope

- Update `server/src/machines/schemas.ts`:
  - `StartInstanceRequestSchema` requires `runtimeOptions`.
  - Add nested schema for `cliDirectoryPolicy.workspaceDirs`, `cliDirectoryPolicy.artifactDirs`, and `cliOutputCapture.enabled`.
- Keep `artifactDirs` represented as base roots (lineage is appended later at runtime).
- Update schema decode tests in `server/src/machines/schemas.test.ts` for all missing-key failure branches.

---

## Acceptance Checklist

- [x] Missing `runtimeOptions` fails schema decode.
- [x] Missing nested keys (`workspaceDirs`, `artifactDirs`, `enabled`) fail schema decode.
- [x] Legacy `{ definitionId, input, workspaceRoot }` payload no longer validates.
- [x] Schema tests explicitly cover hard-cut behavior.

---

## Spec Coverage

- Feature spec: Rollout decision 1, migration item 1.
- Behavior spec: §4.5 and §22.1 request-contract failure cases.
