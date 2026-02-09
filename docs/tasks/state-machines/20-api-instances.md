# Task 20 — REST API — Instance Management, History, Logs & Artifacts

> **Phase**: 2 (REST API)
> **Depends on**: Task 09 (runner), Task 14 (cancellation), Task 15 (resume)
> **Blocks**: Task 22 (API tests)

---

## Objective

Implement the REST API routes for machine instance lifecycle: starting, listing, querying, cancelling, resuming, and accessing history, logs, and artifacts. This is the largest route file, covering the instance management surface of the API.

---

## Implementation Notes from Completed Tasks

> These details emerged from Tasks 01–15 and affect this task's implementation.

### Schema decoding

`decodeStartInstance` (from `schemas.ts`) returns `Either`, not `Effect`:

```typescript
import { decodeStartInstance } from '@/machines/schemas.js';
const decoded = decodeStartInstance(requestBody);
if (Either.isLeft(decoded)) {
  /* return 400 */
}
```

Or use `Schema.decodeUnknown(StartInstanceRequestSchema)` for an effectful version.

**All decode utilities available from `schemas.ts`:**

- `decodeStartInstance` — for POST `/instances` body (`{ definitionId, input }`)
- `decodeInstanceFilter` — for GET `/instances` query params (`{ status?, definitionId?, parentInstanceId?, limit?, offset? }`)
- `decodeCreateDefinition`, `decodeUpdateDefinition` — for definition routes (Task 18)

### Store method signatures (CONFIRMED from implementation)

- **`MachineStore.listInstances(filter?)`** — filter supports `status`, `definitionId`, `parentInstanceId`, `limit`, `offset`. All optional. Returns `Effect.Effect<MachineInstance[], StoreError>`.
- **`MachineStore.getInstance(id)`** returns `Effect.Effect<MachineInstance, NotFoundError>`.
- **`MachineStore.getDefinition(id)`** returns `Effect.Effect<StateMachineDefinition, NotFoundError>`. Use to verify definition exists before starting.

### Error constructors

`mkNotFoundError({ entityType: 'instance', id })`, `mkDefinitionError({ message })` — from `'@/machines/types.js'`.

### Runner interface (CONFIRMED — all 4 methods)

The `StateMachineRunner` is an Effect Service with these methods:

```typescript
interface StateMachineRunner {
  run(definition, input, opts?): Effect.Effect<MachineResult, MachineError>;
  cancel(instanceId: string): Effect.Effect<void, NotFoundError | DefinitionError>;
  resume(instanceId: string): Effect.Effect<MachineResult, MachineError>;
  suspendAll(): Effect.Effect<void, MachineError>;
}
```

### Critical: `run()` and `resume()` BLOCK until completion — must fork

Both `runner.run()` and `runner.resume()` internally fork fibers but **call `Fiber.await(fiber)` before returning**, so they block the calling Effect until the machine reaches a terminal state. **The API route MUST fork these as background fibers** so the HTTP response returns immediately:

```typescript
// POST /api/machines/instances
Effect.gen(function* () {
  const runner = yield* StateMachineRunner;
  const store = yield* MachineStore;
  const definition = yield* store.getDefinition(body.definitionId);

  // Fork the run — returns immediately; machine executes in background
  yield* Effect.fork(runner.run(definition, body.input));

  // The instance was already created inside run() at Checkpoint 1.
  // But since run() is forked, we can't get the instanceId from its return value.
  // Instead, query the store for the most recently created instance for this definition.
  // Alternatively, create the instance BEFORE calling run() and pass it in,
  // or modify the approach to capture the instance ID.

  // Simplest approach: query the latest instance
  const instances = yield* store.listInstances({ definitionId: body.definitionId });
  const newest = instances.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return yield* HttpServerResponse.json(newest, { status: 201 });
});
```

**Alternative approach**: Since `run()` creates the instance internally (Checkpoint 1), and the fiber runs asynchronously, you could:

1. Use a `Deferred<string>` to pass the instance ID out of the forked fiber before it blocks on the state loop.
2. Or modify the runner's `run()` to accept a pre-created instance ID.
3. Or let the first few steps of `run()` be synchronous (validation + instance creation), then fork only the state loop. However, the current implementation validates and creates inside `run()` before forking internally.

**Note**: The runner already validates input, validates definition, and enforces depth limits BEFORE creating the instance. If any of these fail, the forked Effect will fail silently (no HTTP error response). Consider catching early validation errors synchronously:

```typescript
// Validate input first (before forking):
yield * validateDefinition(definition, 'runtime', syncRegistry);
// Validate inputSchema:
if (Object.keys(definition.inputSchema).length > 0) {
  /* ajv check */
}
// Then fork:
yield * Effect.fork(runner.run(definition, body.input));
```

### `cancel()` error semantics (CONFIRMED from implementation)

- **Success** → `Effect.Effect<void>` (returns nothing)
- **Not found** → fails with `NotFoundError` (from `store.getInstance`)
- **Already terminal** (`completed`, `cancelled`, `error`) → fails with `DefinitionError` with message `"Cannot cancel instance with status: ${status}"`
- **`waiting_for_child`** → recursively cancels children first, then interrupts parent fiber
- **`suspended`** → direct store transition (no fiber to interrupt), writes cancellation record to history

### `resume()` error semantics (CONFIRMED from implementation)

- **Success** → returns `MachineResult` (but blocks — must fork)
- **Not found** → fails with `NotFoundError`
- **Not suspended** → fails with `DefinitionError` with message `"Cannot resume instance with status: ${status}"` and details `['Only suspended instances can be resumed']`
- **Definition deleted** → fails with `NotFoundError` (entityType: 'definition')
- **Definition version changed** → fails with `DefinitionError` with message `"Definition version changed since suspension"` and details showing old/new versions
- **Server shutting down** → fails with `DefinitionError` with message `"Server is shutting down — not accepting resume requests"`

### Instance filter query params

For `GET /api/machines/instances`, use `decodeInstanceFilter` from `schemas.ts`. The `InstanceFilterSchema` validates `status`, `definitionId`, `parentInstanceId`, `limit`, `offset`.

### Artifact download requires `ArtifactStoreFactory` (Task 08)

`ArtifactStoreFactory` is an Effect Service. To download an artifact, the route needs to create a scoped store from the factory:

```typescript
const factory = yield * ArtifactStoreFactory;
const instance = yield * store.getInstance(id);
const artifactStore = factory.makeScoped(id, '', instance.parentInstanceId);
const content = yield * artifactStore.read(name);
```

Note: `makeScoped` takes `stateName` as the second argument, but for reading it doesn't matter — the directory is resolved by `instanceId` and `parentInstanceId` only. Pass empty string for read-only access.

### Artifact tree builder (Task 08)

For `?tree=true`, use the standalone function:

```typescript
import { buildArtifactTree } from '@/machines/artifacts/ArtifactTreeBuilder.js';
// Returns Effect.Effect<ArtifactTree, NotFoundError | StoreError>
const tree = yield * buildArtifactTree(instanceId, store);
```

This recursively walks child instances via `store.listInstances({ parentInstanceId })` and builds the tree.

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
