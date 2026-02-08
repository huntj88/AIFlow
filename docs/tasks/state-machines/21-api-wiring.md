# Task 21 — REST API — Server Wiring & Layer Composition

> **Phase**: 2 (REST API)
> **Depends on**: All Phase 1 tasks, Tasks 18–20 (route definitions)
> **Blocks**: Task 22 (API tests), Task 23 (WebSocket)

---

## Objective

Wire all machine routes into the existing `HttpServer`, compose the full Effect Layer dependency graph, and ensure the server starts with all machine services available. This task modifies existing files (`HttpServer.ts`, `index.ts`) and creates the combined machine router.

---

## Steps

### 1. Create `server/src/routes/machines/index.ts`

Combine all machine sub-routers into a single `MachineRouter`:

```typescript
import { HttpRouter } from '@effect/platform';
import { DefinitionRoutes } from './definitions.js';
import { ActionRoutes } from './actions.js';
import { InstanceRoutes } from './instances.js';

export const MachineRouter = HttpRouter.empty.pipe(
  HttpRouter.mount(
    '/api/machines',
    HttpRouter.empty
      .pipe
      // definitions routes
      // actions routes
      // instances routes
      (),
  ),
);
```

Or merge all routes at the `/api/machines` prefix using the @effect/platform routing.

### 2. Modify `server/src/lib/HttpServer.ts`

Add `MachineRouter` alongside the existing `HelloRouter`:

```typescript
export const HttpLive = HttpRouter.empty.pipe(
  HttpRouter.mount('/', HelloRouter),
  HttpRouter.mount('/', MachineRouter),
  HttpServer.serve(HttpMiddleware.logger),
  HttpServer.withLogAddress,
  Layer.provide(ServerLive),
  // New: provide all machine service layers
  Layer.provide(ActionRegistryLive),
  Layer.provide(StateMachineRunnerLive),
  Layer.provide(ExecutionSemaphoreLive),
  Layer.provide(InMemoryMachineStoreLive),
  Layer.provide(FsArtifactStoreLive),
  Layer.provide(MachineEventPubSubLive),
  Layer.provide(MiddlewareExecutorLive),
);
```

### 3. Full Layer composition

The complete dependency graph:

```
HttpLive
  = (HelloRouter + MachineRouter)
  |> HttpServer.serve(HttpMiddleware.logger)
  |> HttpServer.withLogAddress
  |> Layer.provide(ServerLive)                 // NodeHttpServer
  |> Layer.provide(ActionRegistryLive)         // Built-in actions pre-registered
  |> Layer.provide(StateMachineRunnerLive)     // Depends on: ActionRegistry, MachineStore,
  |                                            //   Semaphore, PubSub, Middleware, ArtifactStoreFactory
  |> Layer.provide(ExecutionSemaphoreLive)     // Global Semaphore(MAX_CONCURRENT_MACHINES)
  |> Layer.provide(InMemoryMachineStoreLive)   // Implements MachineStore
  |> Layer.provide(FsArtifactStoreLive)        // Implements ArtifactStoreFactory
  |> Layer.provide(MachineEventPubSubLive)     // PubSub<MachineEvent>
  |> Layer.provide(MiddlewareExecutorLive)     // Default middleware stack
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

In `server/src/index.ts`, register `SIGTERM`/`SIGINT` handlers that call `runner.suspendAll()`:

```typescript
process.on('SIGTERM', () => {
  // Call runner.suspendAll() via the runtime
  // Then exit
});
```

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

- [ ] `server/src/routes/machines/index.ts` combines all machine sub-routers
- [ ] `server/src/lib/HttpServer.ts` provides all machine service layers
- [ ] Full Layer dependency graph compiles without missing services
- [ ] `pnpm --filter @aiflow/server run dev` starts without errors
- [ ] `GET /api/hello` still works
- [ ] `GET /api/machines/definitions` returns empty array
- [ ] `GET /api/machines/actions` returns 5 built-in actions
- [ ] Shutdown handlers registered for `SIGTERM`/`SIGINT`
- [ ] `pnpm --filter @aiflow/server run build` succeeds
