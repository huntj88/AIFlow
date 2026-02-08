# Task 18 — REST API — Definition CRUD Routes

> **Phase**: 2 (REST API)
> **Depends on**: Task 03 (definition validator), Task 04 (machine store), Task 21 (API wiring)
> **Blocks**: Task 22 (API tests)

---

## Objective

Implement the REST API routes for state machine definition CRUD operations. These routes use the `MachineStore` and `DefinitionValidator` from the Effect context. Request bodies are validated using the Effect Schema validators from Task 02.

---

## Steps

### 1. Create `server/src/routes/machines/definitions.ts`

Implement routes using `@effect/platform` `HttpRouter`:

#### `GET /api/machines/definitions`

- List all definitions via `MachineStore.listDefinitions()`
- Return JSON array of `StateMachineDefinition`

#### `POST /api/machines/definitions`

- Decode request body via `CreateDefinitionRequestSchema`
- Run `DefinitionValidator` in `'save'` mode
- Call `MachineStore.saveDefinition()` (auto-generates `id`, `version: 1`, timestamps)
- Return **201** with the created definition including generated `id`

#### `GET /api/machines/definitions/:id`

- Call `MachineStore.getDefinition(id)`
- Return the full definition JSON
- If not found → **404** with error body

#### `PUT /api/machines/definitions/:id`

- Decode request body via `UpdateDefinitionRequestSchema`
- Run `DefinitionValidator` in `'save'` mode
- Call `MachineStore.updateDefinition(id, body)` (auto-increments `version`, refreshes `updatedAt`)
- Return the updated definition
- If not found → **404**

#### `DELETE /api/machines/definitions/:id`

- Call `MachineStore.deleteDefinition(id)`
- Return **204** (no content) on success
- If not found → **404**

### 2. Error mapping

Map Effect errors to HTTP responses:

| Error Type        | HTTP Status | Response Body            |
| ----------------- | ----------- | ------------------------ |
| `NotFoundError`   | 404         | `{ message, id }`        |
| `DefinitionError` | 400         | `{ message, details[] }` |
| `ValidationError` | 400         | `{ message, path }`      |
| `StoreError`      | 500         | `{ message }`            |

Use `Effect.catchTag` to handle each error type and return appropriate `HttpServerResponse`.

### 3. Validation error response format

When validation fails (Rule violations), return:

```json
{
  "message": "Definition validation failed",
  "details": [
    "Rule 1: initialState 'foo' does not reference an existing state",
    "Rule 5: Non-terminal state 'bar' has no outgoing transitions"
  ]
}
```

---

## Behavior Spec Coverage

- §1.1 — POST returns 201 with generated `id`; `version: 1`, timestamps populated
- §1.1 — Created definition appears in GET list
- §1.1 — Creating with same `name` succeeds (names not unique)
- §1.2 — GET `:id` returns full definition; non-existent → 404; list returns all
- §1.3 — PUT returns updated definition; increments `version`; refreshes `updatedAt`; non-existent → 404
- §1.4 — DELETE returns success; deleted not in list or GET (404); non-existent → 404
- §2.4 — Validation failures return `DefinitionError` with `message` and `details[]`
- §2.4 — Multiple violations reported together

---

## Validation Checklist

- [ ] `server/src/routes/machines/definitions.ts` exists with all 5 routes
- [ ] POST returns 201 with auto-generated `id`
- [ ] POST/PUT run definition validation in `'save'` mode
- [ ] GET returns 404 for non-existent IDs
- [ ] PUT increments `version` and refreshes `updatedAt`
- [ ] DELETE returns 204 on success, 404 for non-existent
- [ ] Validation errors return 400 with `message` and `details[]`
- [ ] Error mapping uses `Effect.catchTag` for each error type
- [ ] `pnpm --filter @aiflow/server run build` succeeds
