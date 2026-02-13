# Task 08 — Remove Artifact API & Events

> **Phase**: 4 (Cleanup)
> **Depends on**: Task 07 (artifact infrastructure removed)
> **Blocks**: Task 12 (client API migration)

---

## Objective

Remove the artifact-related API routes, the `artifact_created` event from the
event system, and any WebSocket handling of artifact events on the server side.

---

## Current State

### Artifact API routes (in `server/src/routes/machines/instances.ts`)

| Method | Path                                          | Description              |
| ------ | --------------------------------------------- | ------------------------ |
| GET    | `/api/machines/instances/:id/artifacts`       | List artifacts or tree   |
| GET    | `/api/machines/instances/:id/artifacts/:name` | Download artifact binary |

These routes import `ArtifactStoreFactory` and `buildArtifactTree` from the
(now deleted) artifacts infrastructure.

### `artifact_created` event

- Defined in `MachineEvent` type union (removed in Task 01)
- Published by the runner's artifact store wrapper (removed in Task 05)
- Handled by the WebSocket server for live streaming to clients

---

## Steps

### 1. Remove artifact routes from `instances.ts`

Delete the two route handlers:

```typescript
// DELETE: GET /api/machines/instances/:id/artifacts
// DELETE: GET /api/machines/instances/:id/artifacts/:name
```

Remove the corresponding imports:

```typescript
// DELETE:
import { ArtifactStoreFactory } from '@/machines/artifacts/index.js';
import { buildArtifactTree } from '@/machines/artifacts/ArtifactTreeBuilder.js';
```

### 2. Remove `artifact_created` from EventPubSub

If `server/src/machines/EventPubSub.ts` has any artifact-specific logic, remove it.
The `artifact_created` event type was already removed from `MachineEvent` in Task 01,
so any remaining references will cause TypeScript errors.

### 3. Remove `artifact_created` from WebSocket handling

Check `server/src/machines/live/WebSocketManager.ts` for any artifact-specific
event filtering or handling. If the WebSocket manager simply forwards all
`MachineEvent`s, no changes are needed (the type union change in Task 01 is
sufficient). If there's explicit handling, remove it.

### 4. Remove `artifact_created` from middleware

Check if any middleware (e.g., `AuditMiddleware.ts`, `LoggingMiddleware.ts`)
references `artifact_created` events or artifact operations:

```
server/src/machines/middleware/AuditMiddleware.ts
server/src/machines/middleware/LoggingMiddleware.ts
server/src/machines/middleware/TelemetryMiddleware.ts
```

Remove any artifact-related audit records or telemetry spans.

### 5. Update API test fixtures

If there are API tests (`server/src/__e2e__/` or unit tests) that test the
artifact endpoints, remove or update them:

- Remove tests for `GET /instances/:id/artifacts`
- Remove tests for `GET /instances/:id/artifacts/:name`
- Remove tests for `?tree=true` responses
- Remove any test fixtures that create artifacts

### 6. Update E2E test file

If `docs/tasks/00-state-machine/43-server-e2e-artifacts.md` resulted in E2E
tests at `server/src/__e2e__/artifacts.e2e.test.ts` or similar, these tests
must be deleted and replaced with the new workspace/CLI tests in Task 16.

---

## Behavior Spec Coverage

- **§15.6** — `GET /instances/:id/artifacts` returns 404 (endpoint removed)
- **§15.6** — `GET /instances/:id/artifacts/:name` returns 404 (endpoint removed)
- **§15.6** — `GET /instances/:id/artifacts?tree=true` returns 404 (endpoint removed)
- **§17.2** — `artifact_created` event no longer exists (removed from event types)

---

## Validation Checklist

- [x] Artifact routes removed from `instances.ts`
- [x] No imports of `ArtifactStoreFactory` or `buildArtifactTree` in route handlers
- [x] `artifact_created` not referenced anywhere in server code
- [x] No middleware references to artifact events
- [x] Artifact-related API tests removed
- [x] `pnpm --filter @aiflow/server exec tsc --noEmit` passes
- [x] `pnpm --filter @aiflow/server run test` passes
