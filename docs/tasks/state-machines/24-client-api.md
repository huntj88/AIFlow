# Task 24 — Client API Client Extension

> **Phase**: 4 (Client Viewer)
> **Depends on**: Task 21 (API wiring — server routes available)
> **Blocks**: Task 26 (client state management), Task 27 (dashboard)

---

## Objective

Extend the existing `client/src/utils/apiClient.ts` with machine-specific API functions. The existing client uses `@effect/platform` `HttpClient` with `filterStatusOk`, logging spans, and `FetchHttpClient.layer`. Add all machine endpoint functions following the established pattern.

---

## Steps

### 1. Extend `client/src/utils/apiClient.ts`

Add machine endpoint functions using the existing `makeRequest` pattern. Create additional helpers for POST, PUT, DELETE:

```typescript
const makeGet = (path: string) => /* existing makeRequest pattern */;
const makePost = (path: string, body: unknown) => /* POST variant */;
const makePut = (path: string, body: unknown) => /* PUT variant */;
const makeDelete = (path: string) => /* DELETE variant */;
```

#### Definition endpoints

- `getDefinitions()` — `GET /api/machines/definitions`
- `getDefinition(id)` — `GET /api/machines/definitions/:id`
- `createDefinition(body)` — `POST /api/machines/definitions`
- `updateDefinition(id, body)` — `PUT /api/machines/definitions/:id`
- `deleteDefinition(id)` — `DELETE /api/machines/definitions/:id`

#### Action endpoints

- `getActions()` — `GET /api/machines/actions`
- `getAction(id)` — `GET /api/machines/actions/:id`

#### Instance endpoints

- `startInstance(definitionId, input)` — `POST /api/machines/instances`
- `getInstances(filter?)` — `GET /api/machines/instances`
- `getInstance(id)` — `GET /api/machines/instances/:id`
- `getInstanceHistory(id)` — `GET /api/machines/instances/:id/history`
- `getInstanceLogs(id, state?)` — `GET /api/machines/instances/:id/logs`
- `cancelInstance(id)` — `POST /api/machines/instances/:id/cancel`
- `resumeInstance(id)` — `POST /api/machines/instances/:id/resume`

#### Artifact endpoints

- `getInstanceArtifacts(id)` — `GET /api/machines/instances/:id/artifacts`
- `getInstanceArtifactTree(id)` — `GET /api/machines/instances/:id/artifacts?tree=true`
- `downloadArtifact(instanceId, name)` — `GET /api/machines/instances/:id/artifacts/:name`

### 2. Type the responses

Use the types from the feature spec. Since the client may not share server types directly, define client-side types or use a shared types package. For now, define response types inline or in a `client/src/types/machines.ts` file:

```typescript
// Mirror the server types needed by the client
export interface StateMachineDefinition { ... }
export interface MachineInstance { ... }
export interface TransitionRecord { ... }
export interface LogEntry { ... }
export interface ArtifactRecord { ... }
export interface ArtifactTree { ... }
export interface ActionMetadata { ... }
```

### 3. Error handling

Each API function should handle HTTP errors and map them to typed client errors:

- 400 → validation error details
- 404 → not found
- 409 → conflict (cancel/resume)
- 500 → server error

---

## Behavior Spec Coverage

This task enables all client-side behaviors by providing the API layer. No specific behaviors are directly testable from the API client alone — they are exercised through the UI components in Tasks 27–30.

---

## Validation Checklist

- [ ] `client/src/utils/apiClient.ts` extended with all machine endpoints
- [ ] Client-side machine types defined
- [ ] All endpoints use the established `makeRequest` pattern
- [ ] POST/PUT/DELETE variants added
- [ ] Response types are correct
- [ ] Error mapping for 400/404/409/500
- [ ] `pnpm --filter @aiflow/client run build` succeeds (or `tsc --noEmit`)
