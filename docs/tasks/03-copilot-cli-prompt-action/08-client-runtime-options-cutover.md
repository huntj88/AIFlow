# Task 08 — Client RuntimeOptions Contract Cutover

> **Phase**: 2 (Capture infrastructure)
> **Depends on**: Task 03
> **Blocks**: Tasks 09, 18

---

## Objective

Update client-side instance start flows to send required `runtimeOptions` with no compatibility mode.

---

## Scope

- Update `client/src/types/machines.ts` and `client/src/utils/apiClient.ts` start-instance signatures.
- Update `client/src/hooks/useMachineInstances.ts` and `client/src/pages/MachinesPage.tsx` launch flow contracts.
- Extend `QuickStartPanel` inputs/state to collect or derive runtime options (workspace dirs, artifact dirs, capture toggle).
- Update relevant UI/unit tests (`MachinesPage.test.tsx` and component tests).

---

## Acceptance Checklist

- [ ] Client start requests always include `runtimeOptions`.
- [ ] No client code path emits legacy payload shape.
- [ ] Runtime option input/derivation behavior is validated by tests.
- [ ] Errors from runtime option validation surface in UI consistently.

---

## Spec Coverage

- Feature spec: rollout decision 4; migration item 1.
- Behavior spec: contributes to §4.1 and §4.5 via client contract compliance.
