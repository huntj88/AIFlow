# Task 04 — Runner Runtime Policy Pass-Through

> **Phase**: 1 (Platform contract cutover)
> **Depends on**: Task 03
> **Blocks**: Tasks 05, 06, 10, 12

---

## Objective

Refactor runner execution wiring so runtime CLI policy and capture settings are required for action context construction while remaining non-persistent on `MachineInstance`.

---

## Scope

- Update `RunOptions` and runner call paths in `server/src/machines/StateMachineRunner.ts` to require runtime policy.
- Thread runtime policy through:
  - root `run(...)`
  - child machine spawning
  - parallel child spawning
- Include runtime policy data in action-context construction inputs required by `CliHelper`.
- Ensure `MachineInstance` persistence payload does not store runtime policy.

---

## Acceptance Checklist

- [ ] Runner rejects missing runtime policy internally (no silent defaults).
- [ ] Child/parallel runs inherit runtime policy from parent run context.
- [ ] Action context receives runtime policy-derived execution settings.
- [ ] Runtime policy is not persisted to instance records.

---

## Spec Coverage

- Feature spec: Rollout decision 2; migration item 2.
- Behavior spec: supports §16.7 global capture semantics and §21.9 flow preconditions.
