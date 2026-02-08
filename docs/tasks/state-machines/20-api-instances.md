# Task 20 — REST API — Instance Management, History, Logs & Artifacts

> **Phase**: 2 (REST API)
> **Depends on**: Task 09 (runner), Task 14 (cancellation), Task 15 (resume)
> **Blocks**: Task 22 (API tests)

---

## Objective

Implement the REST API routes for machine instance lifecycle: starting, listing, querying, cancelling, resuming, and accessing history, logs, and artifacts. This is the largest route file, covering the instance management surface of the API.

---

## Steps

### 1. Create `server/src/routes/machines/instances.ts`

#### `POST /api/machines/instances`

- Decode request body via `StartInstanceRequestSchema` (`definitionId`, `input`)
- Missing `definitionId` → **400 Bad Request**
- Missing `input` → **400 Bad Request**
- Load definition from store; not found → **404**
- Call `StateMachineRunner.run(definition, input)` (forked as a fiber — returns immediately)
- Return **201** with the instance ID and initial status

#### `GET /api/machines/instances`

- Accept query params: `status`, `definitionId`, `parentInstanceId`, `limit`, `offset`
- Call `MachineStore.listInstances(filter)`
- Return JSON array of `MachineInstance`

#### `GET /api/machines/instances/:id`

- Call `MachineStore.getInstance(id)`
- Return full instance JSON
- Not found → **404**

#### `GET /api/machines/instances/:id/history`

- Load instance; return `instance.history` array
- Not found → **404**

#### `GET /api/machines/instances/:id/logs`

- Load instance; return `instance.logs` array
- Accept query param `?state=X` to filter by state name
- Not found → **404**

#### `POST /api/machines/instances/:id/cancel`

- Call `StateMachineRunner.cancel(id)`
- On success → **200** with `{ message: "Instance cancelled" }`
- Not found → **404**
- Already terminal → **409 Conflict**

#### `POST /api/machines/instances/:id/resume`

- Call `StateMachineRunner.resume(id)` (forked — returns immediately)
- On success → **200** with `{ message: "Instance resuming" }`
- Not found → **404**
- Not suspended → **409 Conflict**
- Definition version mismatch → **409** with `DefinitionError`
- Definition deleted → **404**

#### `GET /api/machines/instances/:id/artifacts`

- Load instance
- If query param `?tree=true` → build and return `ArtifactTree` via `ArtifactTreeBuilder`
- Otherwise → return flat `instance.artifacts` array
- Not found → **404**

#### `GET /api/machines/instances/:id/artifacts/:name`

- Load instance; find artifact by `name` in `instance.artifacts`
- Use `ArtifactStore.read(name)` to get file content
- Return file content with appropriate `Content-Type` header
- Not found (instance or artifact) → **404**

### 2. Error mapping

| Error Type        | HTTP Status | Response               |
| ----------------- | ----------- | ---------------------- |
| `NotFoundError`   | 404         | `{ message, id }`      |
| `DefinitionError` | 400 or 409  | `{ message, details }` |
| `ValidationError` | 400         | `{ message, path }`    |
| `StoreError`      | 500         | `{ message }`          |

Special cases:

- Cancel/resume of terminal instance → 409 Conflict
- Missing required fields → 400 Bad Request

### 3. Async execution note

`POST /instances` and `POST /instances/:id/resume` should fork the execution as a background fiber and return immediately with the instance ID. The client uses WebSocket (Task 23) or polling to track progress. The initial response includes the instance status at the time of response (likely `'running'`).

---

## Behavior Spec Coverage

- §4.1 — POST `/instances` with valid definition and input → 201 with instance ID
- §4.1 — Returned instance has `status: 'running'` and `currentState` set
- §4.3 — Input violating `inputSchema` → validation error (machine never created)
- §4.3 — Non-existent definition ID → 404
- §4.4 — GET `/instances/:id/history` returns ordered `TransitionRecord` array
- §4.5 — GET `/instances/:id/logs` returns `LogEntry` records
- §4.5 — GET `/instances/:id/logs?state=X` filters by state
- §11.1 — POST `/instances/:id/cancel` on running → success
- §11.5 — Cancel completed/cancelled/errored → 409 Conflict
- §12.2 — POST `/instances/:id/resume` on suspended → success
- §12.5 — Resume non-suspended → 409 Conflict
- §15.4 — GET `/instances/:id/artifacts` returns artifacts; `?tree=true` returns recursive tree
- §15.4 — GET `/instances/:id/artifacts/:name` downloads artifact; non-existent → 404
- §21.1 — Missing `definitionId` → 400; missing `input` → 400; non-existent instance → 404

---

## Validation Checklist

- [ ] `server/src/routes/machines/instances.ts` exists with all routes
- [ ] POST `/instances` validates request, forks execution, returns 201
- [ ] GET `/instances` supports all filter query params
- [ ] GET `/instances/:id` returns full instance or 404
- [ ] GET history and logs work with correct filtering
- [ ] POST cancel: success for running; 409 for terminal
- [ ] POST resume: success for suspended; 409 for others; 404 for deleted def
- [ ] GET artifacts: flat list and `?tree=true` recursive tree
- [ ] GET artifacts/:name: downloads file content or 404
- [ ] All error mappings correct
- [ ] `pnpm --filter @aiflow/server run build` succeeds
