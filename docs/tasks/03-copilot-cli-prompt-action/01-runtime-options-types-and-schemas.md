# Task 01 — Runtime Options Types and Schemas

> **Phase**: 1 (Contracts)
> **Depends on**: existing state-machine working-directory baseline
> **Blocks**: Tasks 02–03, 09–13

---

## Objective

Introduce the new **required** start-instance runtime options contract:

- `runtimeOptions.cliDirectoryPolicy.workspaceDirs: string[]`
- `runtimeOptions.cliDirectoryPolicy.artifactDirs: string[]`
- `runtimeOptions.cliOutputCapture.enabled: boolean`

Remove fallback behavior for missing runtime policy.

---

## Scope

### Server types

- Update [server/src/machines/types.ts](../../../server/src/machines/types.ts):
  - Add `CliDirectoryPolicy`, `CliOutputCapturePolicy`, `MachineRuntimeOptions` types.
  - Add runtime policy fields to runner context/action context types used by `ctx.cli`.

### Server schemas

- Update [server/src/machines/schemas.ts](../../../server/src/machines/schemas.ts):
  - Extend `StartInstanceRequestSchema` with required `runtimeOptions`.
  - Add schema constraints for array/non-empty and boolean toggles.

### Client types

- Update [client/src/types/machines.ts](../../../client/src/types/machines.ts) to match server request contract.

---

## Steps

1. Define canonical runtime-option interfaces in server types.
2. Update schema definitions so `runtimeOptions` is required (no optional branch).
3. Ensure absolute-path validation remains a route/runtime concern (schema validates shape, not disk existence).
4. Mirror request type changes on client types.
5. Remove old/legacy request helpers that assumed missing runtime policy.

---

## Behavior Spec Coverage

- Runtime option requirements in [behaviors.md](../../feature-specs/behaviors.md) section 4.5.
- Migration rules in [03-copilot-cli-prompt-action.md](../../feature-specs/03-copilot-cli-prompt-action.md) (“Replace start-instance contract”).

---

## Validation Checklist

- [ ] `StartInstanceRequestSchema` requires `runtimeOptions`.
- [ ] `runtimeOptions.cliDirectoryPolicy.workspaceDirs` required.
- [ ] `runtimeOptions.cliDirectoryPolicy.artifactDirs` required.
- [ ] `runtimeOptions.cliOutputCapture.enabled` required.
- [ ] Server and client request types compile with same contract.
- [ ] No legacy fallback type path remains.
