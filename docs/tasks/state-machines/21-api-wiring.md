# Task 21 — REST API — Server Wiring & Layer Composition

> **Phase**: 2 (REST API)
> **Depends on**: All Phase 1 tasks, Tasks 18–20 (route definitions)
> **Blocks**: Task 22 (API tests), Task 23 (WebSocket)

---

## Objective

Wire all machine routes into the existing `HttpServer`, compose the full Effect Layer dependency graph, and ensure the server starts with all machine services available. This task modifies existing files (`HttpServer.ts`, `index.ts`) and creates the combined machine router.

---

## Implementation Notes from Completed Tasks

> These details emerged from Tasks 01–15 and affect this task's implementation **significantly**.

### Current server architecture (as built)

**`server/src/routes/hello.ts`** — Route pattern:

```typescript
import { HttpRouter, HttpServerResponse } from '@effect/platform';

export const HelloRouter = HttpRouter.empty.pipe(
  HttpRouter.get('/api/hello', HttpServerResponse.json({ message: 'hello world' })),
);
```

**`server/src/lib/HttpServer.ts`** — Server composition:

```typescript
import { HelloRouter } from '@/routes/hello.js';

const PORT = Number(process.env.PORT ?? 3001);
const ServerLive = NodeHttpServer.layer(() => createServer(), { port: PORT });

export const HttpLive = HelloRouter.pipe(
  HttpServer.serve(HttpMiddleware.logger),
  HttpServer.withLogAddress,
  Layer.provide(ServerLive),
);

export const startServer = Layer.launch(HttpLive).pipe(
  Effect.tap(() => Effect.log(`Server starting on port ${String(PORT)}`)),
);
```

**`server/src/index.ts`** — Entry point:

```typescript
import { startServer } from '@/lib/HttpServer.js';
import { ServerLoggerLive } from '@/lib/Logger.js';

startServer.pipe(Effect.provide(ServerLoggerLive), NodeRuntime.runMain);
```

### Key takeaways for wiring

1. Routes are `HttpRouter` instances composed via `.pipe()`.
2. The `HelloRouter` is piped directly into `HttpServer.serve()` — to add machine routes, merge routers first or mount the machine router alongside.
3. `ServerLive` wraps Node’s `createServer()` — this `http.Server` instance is needed by the WebSocket server (Task 23) for upgrade handling.
4. `ServerLoggerLive` provides structured logging — all new layers should be compatible.
5. Service layers must be provided BEFORE `Layer.launch(HttpLive)` in the composition chain.

### Actual layer names from completed tasks (ALL confirmed)

| Layer                               | Import Path                                                                   | Description                        |
| ----------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------- |
| `InMemoryMachineStoreLive`          | `'@/machines/store/index.js'` or `'@/machines/store/InMemoryMachineStore.js'` | Implements MachineStore            |
| `ActionRegistryLive`                | `'@/machines/ActionRegistry.js'`                                              | Pre-loaded with 5 built-in actions |
| `InMemoryActionRegistryLive`        | `'@/machines/ActionRegistry.js'`                                              | Bare empty registry (for tests)    |
| `StateMachineRunnerLive`            | `'@/machines/StateMachineRunner.js'`                                          | Core runner service                |
| `FsArtifactStoreLive`               | `'@/machines/artifacts/FsArtifactStore.js'`                                   | Filesystem `ArtifactStoreFactory`  |
| `makeMiddlewareExecutorLayer(mw[])` | `'@/machines/middleware/MiddlewareExecutor.js'`                               | Middleware executor from array     |
| `ExecutionSemaphoreLive`            | `'@/machines/ExecutionSemaphore.js'`                                          | Global concurrency semaphore       |

### Layer dependencies (CONFIRMED from implementation)

| Layer                              | Dependencies                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `StateMachineRunnerLive`           | `MachineStore`, `ActionRegistry`, `ArtifactStoreFactory`, `MiddlewareExecutor`, `ExecutionSemaphore` |
| `FsArtifactStoreLive`              | `MachineStore`                                                                                       |
| `ExecutionSemaphoreLive`           | None                                                                                                 |
| `InMemoryMachineStoreLive`         | None                                                                                                 |
| `ActionRegistryLive`               | None                                                                                                 |
| `makeMiddlewareExecutorLayer(...)` | None                                                                                                 |

### Layers from Tasks 13, 16 (built / to be built)

| Layer                    | Import Path                          | Description                  | Status             |
| ------------------------ | ------------------------------------ | ---------------------------- | ------------------ |
| `ExecutionSemaphoreLive` | `'@/machines/ExecutionSemaphore.js'` | Global concurrency semaphore | ✅ Built (Task 13) |
| `MachineEventPubSubLive` | `'@/machines/EventPubSub.js'`        | PubSub for machine events    | ❌ Task 16         |

### Critical: No `MiddlewareExecutorLive` export — use factory (Task 07)

**There is no pre-built `MiddlewareExecutorLive` Layer.** The export is a factory function:

```typescript
import { makeMiddlewareExecutorLayer } from '@/machines/middleware/MiddlewareExecutor.js';
// For production with no middleware:
const MiddlewareLayer = makeMiddlewareExecutorLayer([]);
// For production with custom middleware:
const MiddlewareLayer = makeMiddlewareExecutorLayer([loggingMiddleware, metricsMiddleware]);
```

### Critical: `FsArtifactStoreLive` requires `MachineStore` (Task 08)

`FsArtifactStoreLive` has type `Layer.Layer<ArtifactStoreFactory, never, MachineStore>` — it requires `MachineStore` in its environment. This affects composition order. `InMemoryMachineStoreLive` must be provided to both the runner and the artifact store.

### `StateLoggerFactory` is NOT a Layer (Task 06)

`createStateLoggerFactory()` is a plain function, not an Effect Service. The runner creates it per-state inside the loop. It does NOT need to be in the Layer composition graph.

### Import style in machines/ vs routes/

All files in `server/src/machines/` use **relative imports** (e.g., `'./types.js'`). Files in `server/src/routes/` may use `@/` aliases. Be consistent within each directory.

### Service access in routes

Routes access services from the Effect context via `yield*`:

```typescript
Effect.gen(function* () {
  const store = yield* MachineStore; // from '@/machines/store/index.js'
  const runner = yield* StateMachineRunner;
  // handle request...
});
```

---

## Steps

### 1. Create `server/src/routes/machines/index.ts`

Combine all machine sub-routers into a single `MachineRouter`:

```typescript
import { HttpRouter } from '@effect/platform';
import { DefinitionRoutes } from './definitions.js';
import { ActionRoutes } from './actions.js';
import { InstanceRoutes } from './instances.js';

// Merge all machine route groups into one router
export const MachineRouter = HttpRouter.empty
  .pipe
  // ... mount definition routes
  // ... mount action routes
  // ... mount instance routes
  ();
```

### 2. Modify `server/src/lib/HttpServer.ts`

Merge `HelloRouter` and `MachineRouter` before serving. The current pattern pipes a single router into `HttpServer.serve()`. To add the machine router:

```typescript
import { HelloRouter } from '@/routes/hello.js';
import { MachineRouter } from '@/routes/machines/index.js';

// Option A: Merge routers
const AppRouter = HttpRouter.empty.pipe(
  HttpRouter.mount('/', HelloRouter),
  HttpRouter.mount('/', MachineRouter),
);

export const HttpLive = AppRouter.pipe(
  HttpServer.serve(HttpMiddleware.logger),
  HttpServer.withLogAddress,
  Layer.provide(ServerLive),
  // Provide all machine service layers:
  Layer.provide(ActionRegistryLive),
  Layer.provide(InMemoryMachineStoreLive),
  // ... other layers from Tasks 06–16 once built
);
```

**Note**: The existing `HelloRouter.pipe(HttpServer.serve(...))` pattern must change to accommodate multiple routers.

### 3. Full Layer composition

The complete dependency graph (building on the actual `HttpLive` + `startServer` + `ServerLoggerLive` pattern):

```
HttpLive
  = AppRouter (HelloRouter + MachineRouter)
  |> HttpServer.serve(HttpMiddleware.logger)
  |> HttpServer.withLogAddress
  |> Layer.provide(ServerLive)                       // NodeHttpServer.layer(() => createServer(), { port: 3001 })
  |> Layer.provide(ActionRegistryLive)               // Built-in actions pre-registered
  |> Layer.provide(StateMachineRunnerLive)           // Depends on: ActionRegistry, MachineStore,
  |                                                  //   ArtifactStoreFactory, MiddlewareExecutor
  |                                                  //   (+ Semaphore from Task 13, PubSub from Task 16)
  |> Layer.provide(InMemoryMachineStoreLive)         // Implements MachineStore
  |> Layer.provide(FsArtifactStoreLive)              // Implements ArtifactStoreFactory; DEPENDS on MachineStore
  |> Layer.provide(makeMiddlewareExecutorLayer([]))  // Default empty middleware stack
  |> Layer.provide(ExecutionSemaphoreLive)           // Global Semaphore (added in Task 13)
  |> Layer.provide(MachineEventPubSubLive)           // PubSub<MachineEvent> (added in Task 16)

startServer = Layer.launch(HttpLive).pipe(
  Effect.tap(() => Effect.log('Server starting on port ...')),
);

// In index.ts:
startServer.pipe(Effect.provide(ServerLoggerLive), NodeRuntime.runMain);
```

**Important**: Layer ordering matters — dependent layers must be provided after their dependents. Use `Layer.merge` or `Layer.provideMerge` for complex graphs.

**Critical composition note for `FsArtifactStoreLive`**: Since it requires `MachineStore`, and the runner also requires `MachineStore`, you may need to build a merged base layer:

```typescript
const BaseLayers = Layer.merge(InMemoryMachineStoreLive, ActionRegistryLive);
const ArtifactLayer = FsArtifactStoreLive.pipe(Layer.provide(InMemoryMachineStoreLive));
const RunnerDeps = Layer.mergeAll(BaseLayers, ArtifactLayer, makeMiddlewareExecutorLayer([]));
const RunnerLayer = StateMachineRunnerLive.pipe(Layer.provide(RunnerDeps));
```

### 4. Service access in routes

Routes access services from the Effect context — not via imports of singletons:

```typescript
// In a route handler:
Effect.gen(function* () {
  const store = yield* MachineStore;
  const runner = yield* StateMachineRunner;
  // ... handle request
});
```

### 5. Wire shutdown handler

In `server/src/index.ts`, the current entry point is:

```typescript
startServer.pipe(Effect.provide(ServerLoggerLive), NodeRuntime.runMain);
```

`NodeRuntime.runMain` already handles SIGTERM/SIGINT by interrupting the running Effect. To integrate suspension:

- Register the runner's `suspendAll()` as an `Effect.addFinalizer` in the server's scope, OR
- Use `Effect.onInterrupt` in `startServer` to call `suspendAll()` before exit
- The interruption from `NodeRuntime.runMain` will trigger the finalizer chain

### 6. Verify server starts

The server should start on port 3001 (default) with:

- Existing `/api/hello` route working
- New `/api/machines/*` routes available
- All machine services initialized (action registry with built-ins, empty store, PubSub)

---

## Behavior Spec Coverage

This task doesn't cover specific behaviors directly — it's infrastructure wiring. But it enables all API behaviors from §1, §3, §4, §11, §12, §15 to be accessible over HTTP.

---

## Validation Checklist

- [x] `server/src/routes/machines/index.ts` combines all machine sub-routers
- [x] `server/src/lib/HttpServer.ts` provides all machine service layers
- [x] Full Layer dependency graph compiles without missing services
- [x] `pnpm --filter @aiflow/server run dev` starts without errors
- [x] `GET /api/hello` still works
- [x] `GET /api/machines/definitions` returns empty array
- [x] `GET /api/machines/actions` returns 5 built-in actions
- [x] Shutdown handlers registered for `SIGTERM`/`SIGINT`
- [x] `pnpm --filter @aiflow/server run build` succeeds
