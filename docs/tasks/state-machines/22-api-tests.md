# Task 22 — REST API Test Suite

> **Phase**: 2 (REST API)
> **Depends on**: Tasks 18–21 (all API routes and wiring)
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

- [ ] POST with valid body → 201, response has `id`, `version: 1`, `createdAt`, `updatedAt`
- [ ] Created definition appears in GET list
- [ ] Creating with same name succeeds (names not unique)
- [ ] GET by id returns full definition JSON
- [ ] GET non-existent id → 404
- [ ] GET list returns array of all definitions
- [ ] PUT with valid body → updated definition; `version` incremented; `updatedAt` refreshed
- [ ] PUT non-existent id → 404
- [ ] DELETE → success (204)
- [ ] Deleted definition → 404 on GET and not in list
- [ ] DELETE non-existent → 404

#### Validation (§2)

- [ ] POST with invalid definition (Rule 1: bad `initialState`) → 400 with `DefinitionError`
- [ ] POST with missing terminal states → 400
- [ ] PUT with invalid definition → 400
- [ ] Validation response has `message` and `details[]`
- [ ] Multiple validation violations reported together

### 2. `server/src/routes/machines/actions.test.ts`

- [ ] GET list returns all 5 built-in actions with metadata
- [ ] GET by id returns specific action metadata
- [ ] GET non-existent action → 404

### 3. `server/src/routes/machines/instances.test.ts`

#### Start & Query (§4, §21)

- [ ] POST with valid definition ID and input → 201 with instance ID
- [ ] POST with missing `definitionId` → 400
- [ ] POST with missing `input` → 400
- [ ] POST with non-existent definition ID → 404
- [ ] POST with input violating `inputSchema` → 400
- [ ] GET list returns instances; supports status/definitionId filters
- [ ] GET by id returns full instance
- [ ] GET non-existent instance → 404

#### History & Logs (§4.4, §4.5)

- [ ] GET `/instances/:id/history` returns ordered transition records
- [ ] GET `/instances/:id/logs` returns all log entries
- [ ] GET `/instances/:id/logs?state=X` filters correctly

#### Cancel (§11)

- [ ] POST cancel on running instance → success
- [ ] POST cancel on completed → 409
- [ ] POST cancel on cancelled → 409
- [ ] POST cancel on errored → 409
- [ ] POST cancel on non-existent → 404

#### Resume (§12)

- [ ] POST resume on suspended instance → success
- [ ] POST resume on running → 409
- [ ] POST resume on completed → 409
- [ ] POST resume on non-existent → 404

#### Artifacts (§15)

- [ ] GET `/instances/:id/artifacts` returns artifact list
- [ ] GET `/instances/:id/artifacts?tree=true` returns recursive tree
- [ ] GET `/instances/:id/artifacts/:name` downloads file content
- [ ] GET `/instances/:id/artifacts/:name` for non-existent → 404

#### Concurrent Operations (§21.2)

- [ ] Starting multiple instances concurrently → no data corruption
- [ ] Two concurrent GETs on same instance return consistent data

#### Definition Mutation During Execution (§21.3)

- [ ] Updating a definition while instance is running → running instance unaffected
- [ ] Deleting a definition while instance is running → instance still completes
- [ ] Completed instance viewable after definition deleted

---

## Behavior Spec Coverage

- §1 (Definition CRUD) — full coverage
- §2 (Definition Validation via API) — validation error responses
- §3 (Action Registry) — list and get actions
- §4.1, §4.3, §4.4, §4.5 — instance start, query, history, logs
- §11.5 — cancel conflict responses
- §12.5 — resume conflict responses
- §15.4 — artifact API endpoints
- §21.1 — error responses for missing fields, non-existent resources
- §21.2 — concurrent operations
- §21.3 — definition mutation during execution

---

## Validation Checklist

- [ ] All test files compile and pass
- [ ] Definition CRUD fully tested
- [ ] Validation error responses include `message` and `details[]`
- [ ] Instance lifecycle tested (start, query, cancel, resume)
- [ ] History and log endpoints tested with filtering
- [ ] Artifact endpoints tested (list, tree, download)
- [ ] Error responses (400, 404, 409, 500) tested for each case
- [ ] Concurrent operations tested
- [ ] `pnpm --filter @aiflow/server run test` passes
