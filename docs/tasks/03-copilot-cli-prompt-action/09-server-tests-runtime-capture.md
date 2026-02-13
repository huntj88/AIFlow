# Task 09 — Server Tests: Runtime Policy and Global Capture

> **Phase**: 4 (Tests)
> **Depends on**: Tasks 02–05
> **Blocks**: Tasks 10–11

---

## Objective

Add focused tests proving runtime policy enforcement and global CLI transcript capture across actions and machine lineage.

---

## Scope

- Extend tests in:
  - [server/src/machines/cli/CliHelper.test.ts](../../../server/src/machines/cli/CliHelper.test.ts)
  - [server/src/machines/StateMachineRunner.test.ts](../../../server/src/machines/StateMachineRunner.test.ts)
  - [server/src/routes/machines/instances.test.ts](../../../server/src/routes/machines/instances.test.ts)

---

## Test Matrix

1. Start-instance rejects missing `runtimeOptions` and malformed policy fields.
2. Capture enabled writes transcripts for existing non-copilot actions using `ctx.cli.exec`.
3. Capture disabled writes no transcripts.
4. Root and child instances write transcripts under correct lineage folders.
5. Revisited states increment visit index.
6. `ctx.cli.exec` returns transcript metadata references when enabled.

---

## Behavior Spec Coverage

- [behaviors.md](../../feature-specs/behaviors.md):
  - 4.5 Runtime CLI options validation
  - 16.7 Global transcript capture toggle
  - 16.8 Transcript lineage paths

---

## Validation Checklist

- [ ] Runtime option validation tests pass.
- [ ] Capture toggle tests pass.
- [ ] Parent/child lineage capture tests pass.
- [ ] Capture metadata is asserted in exec results.
