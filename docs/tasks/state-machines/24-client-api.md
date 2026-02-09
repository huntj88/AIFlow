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

### Vite dev proxy is configured

`client/vite.config.ts` proxies `/api` to `http://localhost:3001`:

```typescript
server: {
  proxy: {
    '/api': { target: 'http://localhost:3001', changeOrigin: true },
  },
},
```

This means the client can use **relative paths** like `/api/machines/definitions` — Vite forwards them to port 3001 in dev. **No `ws://` proxy is configured** — Task 25 (WebSocket) may need to add a `ws` entry or connect to the server port directly.

### Running Effects in client code

The client uses `runWithLogging` from `client/src/utils/logger.ts`:

```typescript
export const runWithLogging = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(Effect.provide(ClientLoggerLive), Effect.runPromise);
```

Zustand store actions will call `runWithLogging(apiClient.getDefinitions())` to execute API calls.

### Important: Instance start is asynchronous

The server's `StateMachineRunner.run()` BLOCKS until the machine completes (it forks a fiber internally but awaits it). The API route (Task 20) must fork `run()` into a background fiber and return `201 Created` with the `instanceId` immediately. This means:

- `startInstance()` returns the response BEFORE the machine finishes — it only contains the `instanceId`
- To get the final result, poll `getInstance(id)` or subscribe via WebSocket
- The `status` field on the instance object tracks progress: `running` → `completed` / `error` / `cancelled` / `suspended`

### Server API response shapes (CONFIRMED from implementation)

These are the **exact** response shapes returned by the server routes:

| Endpoint                             | Success                                                                                 | Error shapes                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `POST /definitions`                  | 201: Full `StateMachineDefinition` (with auto-generated `id`, `version: 1`, timestamps) | 400: `{ message, details[] }` (validation), 500: `{ message }` |
| `GET /definitions`                   | 200: `StateMachineDefinition[]`                                                         | 500                                                            |
| `GET /definitions/:id`               | 200: `StateMachineDefinition`                                                           | 404: `{ message, id }`                                         |
| `PUT /definitions/:id`               | 200: Updated `StateMachineDefinition` (version incremented)                             | 400, 404                                                       |
| `DELETE /definitions/:id`            | 204: empty body                                                                         | 404                                                            |
| `GET /actions`                       | 200: `ActionMetadata[]` (each: `{ id, description, inputSchema?, outputSchema? }`)      | 500                                                            |
| `GET /actions/:id`                   | 200: `ActionMetadata`                                                                   | 404                                                            |
| `POST /instances`                    | 201: Full `MachineInstance` (the newest for that def)                                   | 400, 404, 500                                                  |
| `GET /instances`                     | 200: `MachineInstance[]`                                                                | 500                                                            |
| `GET /instances/:id`                 | 200: `MachineInstance`                                                                  | 404                                                            |
| `GET /instances/:id/history`         | 200: `TransitionRecord[]`                                                               | 404                                                            |
| `GET /instances/:id/logs`            | 200: `LogEntry[]` (supports `?state=X` filter)                                          | 404                                                            |
| `POST /instances/:id/cancel`         | 200: `{ message: 'Instance cancelled' }`                                                | 404, 409: `{ message, details[] }`                             |
| `POST /instances/:id/resume`         | 200: `{ message: 'Instance resuming' }`                                                 | 404, 409: `{ message, details[] }`                             |
| `GET /instances/:id/artifacts`       | 200: `ArtifactRecord[]` or `ArtifactTree` (if `?tree=true`)                             | 404                                                            |
| `GET /instances/:id/artifacts/:name` | 200: binary content with content-type                                                   | 404                                                            |

**Error response format**: 404 uses `{ message: "<Entity> not found", id: "..." }` where the entity is capitalized (e.g., "Definition not found", "Instance not found"). 409 uses `{ message, details[] }`. 400 validation uses `{ message, details[] }` or `{ message, path? }`.

**Note on error `_tag`**: The server's error types use `_tag` internally for Effect error handling, but the HTTP responses do **not** include `_tag` in the JSON body — they use `message`/`details`/`id` fields. The `_tag` is only used server-side with `Effect.catchTag`.

### Instance query filter params (CONFIRMED)

The `GET /instances` endpoint supports these query parameters:

- `status` — filter by status string
- `definitionId` — filter by definition ID
- `parentInstanceId` — filter by parent instance
- `limit` — max results (number)
- `offset` — pagination offset (number)

### Extending for POST/PUT/DELETE

The existing pattern only has `client.get(path)`. For other methods:

```typescript
import { HttpBody } from '@effect/platform';
// POST:
const response = yield * client.post(path, { body: HttpBody.json(body) });
// PUT:
const response = yield * client.put(path, { body: HttpBody.json(body) });
// DELETE:
const response = yield * client.del(path);
```

Import `HttpBody` from `@effect/platform` for request bodies.

**Important for DELETE**: The server returns 204 (no content) for successful deletes, so `response.json` will fail. Use `response.text` or just check the status code.

**Important for artifact download**: `GET /instances/:id/artifacts/:name` returns raw binary content (not JSON). Use `response.arrayBuffer` or `response.blob` instead of `response.json`.

### Client-side machine types

Define mirrored types in `client/src/types/machines.ts` since the client doesn’t share server code directly. The types should match the server interfaces from `server/src/machines/types.ts` (Task 01).
**Key types to mirror** (with confirmed field names from the server):

```typescript
// StateMachineDefinition fields: id, name, version, inputSchema, outputSchema,
//   states (Record<string, StateDefinition>), initialState, transitions (TransitionRule[]),
//   metadata ({ createdAt, updatedAt, description?, tags? })

// StateDefinition fields: name, type ('action'|'child_machine'|'parallel_children'|'terminal'),
//   actionId?, childMachineDefId?, childInputMapping?, children? (ChildSpawnDefinition[]),
//   description?, dataSchema?, timeoutMs?, parallelMode? ('all_or_interrupt'|'all_settled')

// MachineInstance fields: id, definitionId, definitionVersion, status
//   ('running'|'completed'|'cancelled'|'error'|'waiting_for_child'|'suspended'),
//   currentState, stateData, input, output?, error?, parentInstanceId?,
//   childInstanceId?, childInstanceIds? (Record<string, string>),
//   history (TransitionRecord[]), logs (LogEntry[]), artifacts (ArtifactRecord[]),
//   createdAt, updatedAt

// TransitionRecord fields: id, fromState, toState, data?, timestamp, durationMs,
//   actionId?, childInstanceId?, childDefinitionId?, childInstanceIds?,
//   middlewareResults?

// LogEntry fields: id, instanceId, stateName, level, message, data?, timestamp

// ArtifactRecord fields: name, size, contentType, stateName, metadata?, createdAt

// ArtifactTree fields: instanceId, definitionId?, artifacts (ArtifactRecord[]),
//   children (ArtifactTree[]) (recursive)

// ActionMetadata fields: id, description?, inputSchema?, outputSchema?

// MachineEvent: uses 'type' discriminant (NOT '_tag'), shape: { type, instanceId, data }
```

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

- [x] `client/src/utils/apiClient.ts` extended with all machine endpoints
- [x] Client-side machine types defined
- [x] All endpoints use the established `makeRequest` pattern
- [x] POST/PUT/DELETE variants added
- [x] Response types are correct
- [x] Error mapping for 400/404/409/500
- [x] `pnpm --filter @aiflow/client run build` succeeds (or `tsc --noEmit`)
