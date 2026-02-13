# Task 12 — Client Runtime Options and Launch Flow Updates

> **Phase**: 5 (Client)
> **Depends on**: Tasks 01–03
> **Blocks**: Task 13

---

## Objective

Update client launch workflows to send required `runtimeOptions` and expose practical controls/defaults for developers.

---

## Scope

- Update client request types and API helpers:
  - [client/src/types/machines.ts](../../../client/src/types/machines.ts)
  - [client/src/utils/apiClient.ts](../../../client/src/utils/apiClient.ts)
- Update dashboard/launch UI:
  - [client/src/pages/MachinesPage.tsx](../../../client/src/pages/MachinesPage.tsx)
  - related form hooks/components in [client/src/components/machines](../../../client/src/components/machines)

---

## Steps

1. Require `runtimeOptions` in `startInstance` client API call.
2. Add launch form fields or sensible defaults for:
   - workspace allow-dirs
   - artifact allow-dirs
   - capture enabled toggle
3. Validate user inputs before submit (absolute paths where applicable).
4. Keep UX consistent with existing workspaceRoot launch behavior.
5. Update client tests for quick-start launch payload shape.

---

## Behavior Spec Coverage

- [behaviors.md](../../feature-specs/behaviors.md) section 18 (dashboard quick start includes runtime CLI options).

---

## Validation Checklist

- [ ] Client cannot submit launch without runtime options.
- [ ] Request payload matches server schema.
- [ ] UI includes capture toggle and policy path inputs/defaults.
- [ ] Client unit/integration tests updated.
