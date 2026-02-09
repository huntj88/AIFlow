# Task 19 — REST API — Action Routes

> **Phase**: 2 (REST API)
> **Depends on**: Task 05 (action registry)
> **Blocks**: Task 22 (API tests)

---

## Objective

Implement REST API routes for browsing the action registry. These routes allow the client to discover registered action functions and their metadata when configuring state machine definitions.

---

## Implementation Notes from Completed Tasks

> These details emerged from Tasks 01–05 and affect this task’s implementation.

### ActionRegistry access in route handlers

The `ActionRegistry` is an Effect Service — access it from the Effect context:

```typescript
import { ActionRegistry } from '@/machines/ActionRegistry.js';

Effect.gen(function* () {
  const registry = yield* ActionRegistry;
  const actions = yield* registry.list(); // returns ActionMetadata[]
});
```

- `registry.list()` returns `Effect.Effect<ActionMetadata[]>` — metadata only (no function references). Each item has `{ id, description?, inputSchema?, outputSchema? }`.
- `registry.get(id)` returns `Effect.Effect<{ fn: ActionFunction; metadata: ActionMetadata }, NotFoundError>`. For the API response, return only `metadata` (not `fn`).

### Route composition pattern

Follow the `HelloRouter` pattern from `server/src/routes/hello.ts` using `@effect/platform` `HttpRouter`.

### Error constructors

`mkNotFoundError({ entityType: 'action', id })` — imported from `'@/machines/types.js'`.

---

## Steps

### 1. Create `server/src/routes/machines/actions.ts`

#### `GET /api/machines/actions`

- Call `ActionRegistry.list()` to get all registered action metadata
- Return JSON array of `ActionMetadata` objects:
  ```json
  [
    { "id": "http-request", "description": "Make an HTTP request" },
    { "id": "delay", "description": "Wait for a specified duration" },
    { "id": "transform-data", "description": "Apply JSONPath transform" },
    { "id": "log-message", "description": "Log a message and pass through" },
    { "id": "conditional-branch", "description": "Branch based on condition" }
  ]
  ```

#### `GET /api/machines/actions/:id`

- Call `ActionRegistry.get(id)` for the specific action
- Return the `ActionMetadata` object
- If not found → **404** with `{ message: "Action not found", id }`

### 2. Error mapping

| Error Type      | HTTP Status | Response Body     |
| --------------- | ----------- | ----------------- |
| `NotFoundError` | 404         | `{ message, id }` |

---

## Behavior Spec Coverage

- §3 — `GET /api/machines/actions` returns list of all registered actions with metadata (id, description)
- §3 — `GET /api/machines/actions/:id` returns metadata for specific action
- §3 — Non-existent action ID → 404
- §3 — Built-in actions present on startup: `http-request`, `delay`, `transform-data`, `log-message`, `conditional-branch`

---

## Validation Checklist

- [ ] `server/src/routes/machines/actions.ts` exists with both routes
- [ ] GET list returns all 5 built-in actions
- [ ] GET by ID returns correct metadata
- [ ] Non-existent action → 404
- [ ] `pnpm --filter @aiflow/server run build` succeeds
