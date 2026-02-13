# Task 01 — Runtime Policy Types & Shared Contracts

> **Phase**: 1 (Platform contract cutover)
> **Depends on**: none
> **Blocks**: Tasks 02, 04, 06, 08

---

## Objective

Define shared server/client types for required runtime CLI policy and capture settings so the hard-cut contract is explicit at compile time.

---

## Scope

- Add runtime policy interfaces to `server/src/machines/types.ts`:
  - `CliDirectoryPolicy` (`workspaceDirs`, `artifactDirs`)
  - `CliOutputCapturePolicy` (`enabled`)
  - `MachineRuntimeOptions`
- Extend CLI result typing for capture metadata references returned by `ctx.cli.exec(...)` when enabled.
- Add mirrored client request types in `client/src/types/machines.ts`.
- Keep `MachineInstance` unchanged regarding runtime policy persistence (explicitly no new persisted runtime fields).

---

## Acceptance Checklist

- [ ] Runtime policy types exist on both server and client.
- [ ] `StartInstanceInput` (client + server usage sites) can represent required `runtimeOptions`.
- [ ] `CliExecResult` type supports optional transcript metadata for capture-enabled executions.
- [ ] No runtime policy fields are added to persisted `MachineInstance`.

---

## Spec Coverage

- Feature spec: Rollout decisions 1, 2, 3, 4.
- Feature spec: Migration details (replace start contract, pass-through model, rich capture metadata).
