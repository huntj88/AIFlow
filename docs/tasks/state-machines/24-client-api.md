# Task 24 — Client API Client Extension

> **Phase**: 4 (Client Viewer)
> **Depends on**: Task 21 (API wiring — server routes available)
> **Blocks**: Task 26 (client state management), Task 27 (dashboard)

---

## Objective

Extend the existing `client/src/utils/apiClient.ts` with machine-specific API functions. The existing client uses `@effect/platform` `HttpClient` with `filterStatusOk`, logging spans, and `FetchHttpClient.layer`. Add all machine endpoint functions following the established pattern.

---

## Implementation Notes from Completed Tasks

> These details emerged from the existing client codebase and Tasks 01–21.

### Current `apiClient.ts` pattern

The existing client (`client/src/utils/apiClient.ts`) uses:

```typescript
import { FetchHttpClient, HttpClient } from '@effect/platform';
import { Effect } from 'effect';

const makeRequest = (path: string) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const response = yield* client.get(path);
    return yield* response.json;
  }).pipe(
    Effect.scoped,
    Effect.provide(FetchHttpClient.layer),
    Effect.tap((res) => Effect.log('API response received', { path, response: res })),
    Effect.withLogSpan(`api.GET ${path}`),
  );

export const apiClient = {
  hello: () => makeRequest('/api/hello') as Effect.Effect<{ message: string }, Error>,
};
```

Key patterns to follow:

- Uses `Effect.gen` with `HttpClient.HttpClient` from context
- `HttpClient.filterStatusOk` for automatic error on non-2xx status
- `Effect.scoped` + `FetchHttpClient.layer` provided inline
- `Effect.tap` for logging, `Effect.withLogSpan` for tracing
- Each method returns a typed `Effect.Effect<ResponseType, Error>`

### Important: Instance start is asynchronous

The server's `StateMachineRunner.run()` BLOCKS until the machine completes (it forks a fiber internally but awaits it). The API route (Task 20) must fork `run()` into a background fiber and return `201 Created` with the `instanceId` immediately. This means:

- `startInstance()` returns the response BEFORE the machine finishes — it only contains the `instanceId`
- To get the final result, poll `getInstance(id)` or subscribe via WebSocket
- The `status` field on the instance object tracks progress: `running` → `completed` / `error` / `cancelled` / `suspended`

### Extending for POST/PUT/DELETE

The existing pattern only has `client.get(path)`. For other methods:

```typescript
// POST:
const response = yield * client.post(path, { body: HttpBody.json(body) });
// PUT:
const response = yield * client.put(path, { body: HttpBody.json(body) });
// DELETE:
const response = yield * client.del(path);
```

Import `HttpBody` from `@effect/platform` for request bodies.

### Client-side machine types

Define mirrored types in `client/src/types/machines.ts` since the client doesn’t share server code directly. The types should match the server interfaces from `server/src/machines/types.ts` (Task 01).

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
