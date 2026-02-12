# Task 10 — Instance Payload Updates

> **Phase**: 5 (API)
> **Depends on**: Task 09 (start-instance API), Task 08 (artifact API removed)
> **Blocks**: Task 12 (client API migration), Task 16 (server E2E tests)

---

## Objective

Ensure all API endpoints that return `MachineInstance` payloads reflect the new
data model: include `workspaceRoot`, `familyRootInstanceId`, `artifactsPath`,
and exclude `artifacts: ArtifactRecord[]`.

---

## Endpoints Affected

| Method | Path                          | Returns             |
| ------ | ----------------------------- | ------------------- |
| POST   | `/api/machines/instances`     | `MachineInstance`   |
| GET    | `/api/machines/instances`     | `MachineInstance[]` |
| GET    | `/api/machines/instances/:id` | `MachineInstance`   |

All three return `MachineInstance` objects (directly or in an array). The
schema and type changes from Tasks 01–02 should make these endpoints
automatically include the new fields, as long as the `MachineStore`
persists them correctly.

---

## Steps

### 1. Verify `MachineStore.saveInstance()` persists new fields

The `InMemoryMachineStore` should store `workspaceRoot`, `familyRootInstanceId`,
and `artifactsPath` when an instance is created. Since these fields are now part
of `MachineInstance`, the store should handle them without changes — but verify:

```typescript
// In InMemoryMachineStore.saveInstance():
const instance: MachineInstance = {
  id: generateId(),
  ...data,
  // Ensure workspaceRoot, familyRootInstanceId, artifactsPath are included in ...data
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
```

### 2. Verify `MachineStore.getInstance()` returns new fields

The `getInstance()` method returns the full stored object. Since the fields are
now part of the type, they should be present if `saveInstance()` stored them.

### 3. Verify `MachineStore.listInstances()` returns new fields

Same as above — list returns stored instances.

### 4. Update `InMemoryMachineStore` type checks

If the `InMemoryMachineStore` has explicit type checking or schema validation
on save/update, ensure it accepts the new fields and does NOT expect `artifacts`.

### 5. Remove `artifacts` from instance serialization

If there is any explicit serialization logic (beyond just returning the stored
object), ensure `artifacts: ArtifactRecord[]` is not included:

- No `artifacts` array in the response
- No artifact count, metadata, or references

### 6. Update instance response type documentation

If there are OpenAPI docs, README docs, or inline comments describing the
instance response shape, update them to reflect:

```json
{
  "id": "...",
  "definitionId": "...",
  "workspaceRoot": "/path/to/workspace",
  "familyRootInstanceId": "...",
  "artifactsPath": "/path/to/data/artifacts/<familyRootInstanceId>",
  "status": "running",
  "currentState": "...",
  ...
}
```

### 7. Verify child instance payloads

When fetching a child instance via `GET /instances/:childId`, verify:

- `workspaceRoot` equals the parent's `workspaceRoot`
- `familyRootInstanceId` equals the root ancestor's ID (not the child's own ID)
- `artifactsPath` equals the family root artifacts path

### 8. Update `GET /instances` filter behavior

Verify that filtering by `parentInstanceId` returns child instances with the
correct inherited workspace fields.

---

## Behavior Spec Coverage

- **§15.5** — `GET /instances/:id` includes `workspaceRoot`, `familyRootInstanceId`, `artifactsPath`
- **§15.5** — Instance payload does NOT include `artifacts: ArtifactRecord[]`
- **§8.5** — Child instance payloads reflect inherited workspace and family root
- **§9.6** — Parallel child instance payloads reflect inherited values

---

## Validation Checklist

- [x] `POST /instances` response includes `workspaceRoot`, `familyRootInstanceId`, `artifactsPath`
- [x] `GET /instances/:id` response includes the three new fields
- [x] `GET /instances` response includes the three new fields for each instance
- [x] No `artifacts` array in any instance response
- [x] Child instances have correct `familyRootInstanceId` (parent's root, not own ID)
- [x] Child instances have correct `artifactsPath` (shared family root)
- [x] `InMemoryMachineStore` correctly persists and returns new fields
- [ ] `pnpm --filter @aiflow/server run test` passes
      <!-- Blocked: StateMachineRunner.test.ts, suspend-resume.test.ts still have pre-existing artifact/opts errors — fixed in Tasks 15-16 -->
