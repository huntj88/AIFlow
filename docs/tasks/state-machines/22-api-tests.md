# Task 22 — REST API Test Suite

> **Phase**: 2 (REST API)
> **Depends on**: Tasks 18–21 (all API routes and wiring)
> **Continued by**: Task 22.1 (cancel running & artifact download)
> **Blocks**: Phase 3 (WebSocket), Phase 4 (Client)

---

## Objective

Write integration tests for all machine REST API endpoints. Tests should make real HTTP requests to the server (using the Effect test client or a test harness) with the `InMemoryMachineStore`. These tests verify the full request → route → service → response cycle.

---

## Implementation Notes from Completed Tasks

> These details emerged from Tasks 01–17 and affect test setup.

### Test harness pattern (CONFIRMED from hello.test.ts)

The existing `hello.test.ts` uses `HttpApp.toWebHandler()` — NOT `HttpClient.fetch`:

```typescript
import { HttpApp } from '@effect/platform';
import { describe, expect, it } from 'vitest';

import { HelloRouter } from './hello.js';

describe('HelloRouter', () => {
  it('GET /api/hello returns hello world', async () => {
    const handler = HttpApp.toWebHandler(HelloRouter);
    const response = await handler(new Request('http://localhost/api/hello'));
    const body = (await response.json()) as { message: string };
    expect(body).toEqual({ message: 'hello world' });
  });
});
```

This pattern does NOT start a real HTTP server — it creates an in-process handler. **However**, the `HelloRouter` has no Effect dependencies. Routes that depend on services (e.g., `MachineStore`, `ActionRegistry`) will need layers provided before conversion to a web handler.

### Providing layers for route tests

For routes that access Effect services, you must provide layers before calling `toWebHandler`. The pattern:

```typescript
import { HttpApp, HttpRouter } from '@effect/platform';
import { Layer, ManagedRuntime } from 'effect';

// Compose all layers needed by the router
const TestLayer = Layer.mergeAll(
  InMemoryMachineStoreLive,
  ActionRegistryLive,
  ExecutionSemaphoreLive,
  makeMiddlewareExecutorLayer([]),
).pipe(
  Layer.provideMerge(FsArtifactStoreLive),  // FsArtifactStoreLive depends on MachineStore
  Layer.provideMerge(StateMachineRunnerLive), // Runner depends on all 5 services
);

// Option A: Provide to router, then toWebHandler
const app = DefinitionsRouter.pipe(HttpRouter.provideServiceEffect(...));
const handler = HttpApp.toWebHandler(app);

// Option B: Use ManagedRuntime for more control
const runtime = ManagedRuntime.make(TestLayer);
```

### Layer composition (5 dependencies for StateMachineRunnerLive)

The runner requires ALL 5 services:

1. `MachineStore` — use `InMemoryMachineStoreLive`
2. `ActionRegistry` — use `ActionRegistryLive` (pre-loaded with 5 built-ins) or `InMemoryActionRegistryLive` (empty)
3. `ArtifactStoreFactory` — use `FsArtifactStoreLive` (depends on MachineStore)
4. `MiddlewareExecutor` — use `makeMiddlewareExecutorLayer([])`
5. `ExecutionSemaphore` — use `ExecutionSemaphoreLive`

This is the same 5-layer pattern used in `StateMachineRunner.test.ts`.

### Critical: `run()` blocks until completion

`StateMachineRunner.run()` internally forks a fiber but blocks via `Fiber.await()`. In API tests:

- Simple machines (1-2 states) will complete quickly — test can await the response
- For cancel/resume tests, use `delay` action to keep machine running, then cancel/resume from another fiber
- The API route itself should fork run() into a background fiber and return 201 immediately

### run() error semantics

- Action errors → `MachineResult` with `status: 'error'` (NOT an Effect failure)
- Definition not found → Effect fails with `NotFoundError`
- Invalid input (schema violation) → Effect fails with `ValidationError`
- Instance already running → Effect fails with `DefinitionError`

### Items removed from scope

- **`POST with missing input → 400`** — The route schema uses `Schema.Unknown` for `input`,
  which accepts `undefined`. A missing `input` field passes route-level decode and falls
  through to definition lookup (404 if non-existent, or 201 if valid). Not a 400.
- **`POST with input violating inputSchema → 400`** — Input schema validation happens
  **asynchronously** inside the forked runner fiber, _after_ the route returns 201. A
  violation causes the instance to enter `'error'` status, not a synchronous 400 response.
- **`POST resume on suspended instance → success`** — Suspension is triggered only by
  `StateMachineRunner.suspendAll()` (SIGTERM/SIGINT). There is no user-facing API to
  suspend a single instance, so this cannot be tested in the HTTP harness. Covered by
  `StateMachineRunner.test.ts`.

### Existing test patterns from StateMachineRunner.test.ts

The runner test file uses helper functions for definition creation and action registration — consider extracting shared test fixtures:

```typescript
// Registration helper pattern from existing tests
const registerAction = (id: string, fn: ActionFunction) =>
  Effect.gen(function* () {
    const registry = yield* ActionRegistry;
    yield* registry.register(id, fn);
  });
```

---

## Test Files

### 1. `server/src/routes/machines/definitions.test.ts`

#### CRUD Operations (§1)

- [x] POST with valid body → 201, response has `id`, `version: 1`, `createdAt`, `updatedAt`
- [x] Created definition appears in GET list
- [x] Creating with same name succeeds (names not unique)
- [x] GET by id returns full definition JSON
- [x] GET non-existent id → 404
- [x] GET list returns array of all definitions
- [x] PUT with valid body → updated definition; `version` incremented; `updatedAt` refreshed
- [x] PUT non-existent id → 404
- [x] DELETE → success (204)
- [x] Deleted definition → 404 on GET and not in list
- [x] DELETE non-existent → 404

#### Validation (§2)

- [x] POST with invalid definition (Rule 1: bad `initialState`) → 400 with `DefinitionError`
- [x] POST with missing terminal states → 400
- [x] PUT with invalid definition → 400
- [x] Validation response has `message` and `details[]`
- [x] Multiple validation violations reported together

### 2. `server/src/routes/machines/actions.test.ts`

- [x] GET list returns all 5 built-in actions with metadata
- [x] GET by id returns specific action metadata
- [x] GET non-existent action → 404

### 3. `server/src/routes/machines/instances.test.ts`

#### Start & Query (§4, §21)

- [x] POST with valid definition ID and input → 201 with instance ID
- [x] POST with missing `definitionId` → 400
- [x] POST with non-existent definition ID → 404
- [x] GET list returns instances; supports status/definitionId filters
- [x] GET by id returns full instance
- [x] GET non-existent instance → 404

#### History & Logs (§4.4, §4.5)

- [x] GET `/instances/:id/history` returns ordered transition records
- [x] GET `/instances/:id/logs` returns all log entries
- [x] GET `/instances/:id/logs?state=X` filters correctly

#### Cancel (§11)

- [x] POST cancel on running instance → 200 _(completed in Task 22.1)_
- [x] POST cancel on completed → 409
- [x] POST cancel on cancelled → 409
- [x] POST cancel on errored → 409
- [x] POST cancel on non-existent → 404

#### Resume (§12)

> **Note:** Suspension is an infrastructure-level mechanism triggered only by
> `StateMachineRunner.suspendAll()` (server shutdown / SIGTERM). There is no
> user-facing API or action to suspend a single instance, so the "resume
> suspended → success" happy path cannot be tested in the in-process HTTP
> harness. That path is covered by `StateMachineRunner.test.ts` instead.

- [x] POST resume on running → 409
- [x] POST resume on completed → 409
- [x] POST resume on non-existent → 404

#### Artifacts (§15)

- [x] GET `/instances/:id/artifacts` returns artifact list
- [x] GET `/instances/:id/artifacts?tree=true` returns recursive tree
- [x] GET `/instances/:id/artifacts/:name` downloads file content _(completed in Task 22.1)_
- [x] GET `/instances/:id/artifacts/:name` for non-existent → 404

#### Concurrent Operations (§21.2)

- [x] Starting multiple instances concurrently → no data corruption
- [x] Two concurrent GETs on same instance return consistent data

#### Definition Mutation During Execution (§21.3)

- [x] Updating a definition while instance is running → running instance unaffected
- [x] Deleting a definition while instance is running → instance still completes
- [x] Completed instance viewable after definition deleted

---

## Behavior Spec Coverage

- §1 (Definition CRUD) — full coverage
- §2 (Definition Validation via API) — validation error responses
- §3 (Action Registry) — list and get actions
- §4.1, §4.3, §4.4, §4.5 — instance start, query, history, logs
- §11 — cancel conflict responses; cancel running deferred to Task 22.1
- §12 — resume conflict responses (suspend/resume happy path covered in runner unit tests)
- §15.4 — artifact list, tree, non-existent; download deferred to Task 22.1
- §21.1 — error responses for missing fields, non-existent resources
- §21.2 — concurrent operations
- §21.3 — definition mutation during execution

---

## Validation Checklist

- [x] All test files compile and pass
- [x] Definition CRUD fully tested
- [x] Validation error responses include `message` and `details[]`
- [x] Instance lifecycle tested (start, query, cancel, resume)
- [x] History and log endpoints tested with filtering
- [x] Error responses (400, 404, 409, 500) tested for each case
- [x] Concurrent operations tested
- [x] `pnpm --filter @aiflow/server run test` passes

> **Remaining:** Cancel running instance & artifact download deferred to **Task 22.1**.
