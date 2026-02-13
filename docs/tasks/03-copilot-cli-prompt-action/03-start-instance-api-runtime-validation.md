# Task 03 — Start-Instance API Runtime Validation

> **Phase**: 1 (Platform contract cutover)
> **Depends on**: Task 02
> **Blocks**: Tasks 04, 08, 09, 17

---

## Objective

Enforce runtime policy validation in `POST /api/machines/instances` and pass the validated policy to runner execution without compatibility paths.

---

## Scope

- Update `server/src/routes/machines/instances.ts`:
  - Validate absolute-path semantics for runtime directory policy entries.
  - Keep `workspaceRoot` disk existence checks.
  - Reject missing/invalid runtime policy branches with 400 responses.
  - Pass validated `runtimeOptions` to `runner.run(...)`.
- Update route tests in `server/src/routes/machines/instances.test.ts` for all new required branches.

---

## Acceptance Checklist

- [x] Missing `runtimeOptions` returns 400.
- [x] Missing nested runtime fields returns 400.
- [x] Relative directory policy paths return validation errors.
- [x] Valid runtime policy reaches runner call path.
- [x] No fallback path exists for legacy start payloads.

---

## Spec Coverage

- Feature spec: Rollout decisions 1, 4, 5; migration items 1 and 7.
- Behavior spec: §4.1, §4.5, §22.1.
