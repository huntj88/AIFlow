# Task 09 — Test Harness RuntimeOptions Cutover

> **Phase**: 2 (Capture infrastructure)
> **Depends on**: Tasks 07, 08
> **Blocks**: Tasks 17, 19

---

## Objective

Update shared server and client test helpers so every instance-start call uses the new required runtime contract.

---

## Scope

- Update server e2e helper defaults in `server/src/__e2e__/helpers/api-helpers.ts`.
- Update client e2e helper defaults in `client/e2e/helpers/machine-helpers.ts`.
- Update route/integration test helpers using legacy payload shapes.
- Ensure test fixtures model `artifactDirs` as base roots (lineage added by runtime).

---

## Acceptance Checklist

- [x] Shared helpers create start payloads with required runtime options.
- [x] No e2e suite depends on legacy start payload behavior. _(Final validation is deferred until Tasks 17 and 18 add remaining e2e suites.)_
- [x] Runtime-option validation tests remain explicit (not hidden by helper defaults).

---

## Spec Coverage

- Feature spec: hard-cut migration support for all test surfaces.
- Behavior spec: §4.5 and §22.1 validation coverage scaffolding.
