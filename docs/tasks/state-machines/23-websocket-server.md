# Task 23 — WebSocket Server & Event Broadcasting

> **Phase**: 3 (WebSocket)
> **Depends on**: Task 16 (runner PubSub events), Task 21 (API wiring)
> **Blocks**: Task 25 (client WebSocket client)

---

## Objective

Implement the WebSocket server for real-time event streaming to clients. Clients connect to `ws://host/api/machines/live`, subscribe to specific instance IDs, and receive `MachineEvent`s filtered by their subscriptions. The WS server wraps the `ws` library in an Effect Layer and subscribes to the runner's `PubSub<MachineEvent>`.

**New server dependency**: `ws` + `@types/ws`.

---

## Implementation Notes from Completed Tasks

> These details emerged from Tasks 01–17 and affect this task's implementation.

### ✅ Task 16 (EventPubSub) is COMPLETE — no longer a blocker

Task 16 has been implemented. The following are now in place:

- **`server/src/machines/EventPubSub.ts`** exists and exports:
  ```typescript
  export const MachineEventPubSub =
    Context.GenericTag<PubSub.PubSub<MachineEvent>>('MachineEventPubSub');
  export const MachineEventPubSubLive: Layer.Layer<PubSub.PubSub<MachineEvent>> = Layer.effect(
    MachineEventPubSub,
    PubSub.unbounded<MachineEvent>(),
  );
  ```
- The runner now has **6 service dependencies** (PubSub is the 6th).
- **`MachineLive` in `HttpServer.ts` already includes `PubSubLive`** — no layer composition changes needed for this task. The WS manager just needs to access `MachineEventPubSub` from the same context.
- The runner publishes **all 10 event types** at the correct insertion points.
- Import path: `import { MachineEventPubSub } from '@/machines/EventPubSub.js';`

### Current `HttpServer.ts` layer composition (CONFIRMED — post Task 16)

```typescript
const PubSubLive = MachineEventPubSubLive;

const RunnerLive = StateMachineRunnerLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      StoreLive,
      RegistryLive,
      ArtifactLive,
      MiddlewareLive,
      SemaphoreLive,
      PubSubLive,
    ),
  ),
);

export const MachineLive = Layer.mergeAll(
  StoreLive,
  RegistryLive,
  ArtifactLive,
  RunnerLive,
  SemaphoreLive,
  PubSubLive,
);
```

`PubSubLive` is already in `MachineLive`, so the WS manager Layer can depend on `MachineEventPubSub` directly — it will be provided by the existing layer stack.

### Runner's `publishEvent` is fire-and-forget — subscriber must be ready

The runner wraps every publish call as:

```typescript
const publishEvent = (event: MachineEvent) =>
  PubSub.publish(pubsub, event).pipe(Effect.catchAll(() => Effect.void));
```

**Impact on WebSocketManager**: The PubSub is unbounded, so events are buffered until a subscriber takes them. However, the WS manager's subscription fiber must be started **before** any machines run, or early events will have no subscriber and be dropped. Since both are Effect Layers launched at startup, this should be fine — but ensure the subscription fiber starts in the Layer's `Effect.gen` body (not lazily).

### `child_spawned` event has placeholder `childInstanceId: 'pending'`

In the runner, the `child_spawned` event is published **before** `runner.run()` is called for the child, so the child's instance ID is not yet known:

```typescript
yield *
  publishEvent({
    type: 'child_spawned',
    instanceId: ls.instanceId,
    data: {
      childInstanceId: 'pending', // instanceId assigned inside run()
      childDefinitionId: childSpawnInfo.childDefId,
    },
  });
```

The WS manager should forward this as-is. Clients subscribing to the **parent** instance will receive this event. If the client also wants child events, it must separately subscribe to the child's instance ID (obtainable from the subsequent `child_completed` event or by querying the instance API).

### Accessing the underlying Node HTTP server (CONFIRMED approach)

`@effect/platform-node`'s `NodeHttpServer.layer()` does **NOT** expose the underlying `http.Server` in the Effect context. The `HttpServer` interface only provides `serve` and `address`.

**Use Option A**: Extract `createServer()` result to a module-level variable in `HttpServer.ts`:

```typescript
// In server/src/lib/HttpServer.ts — change:
const ServerLive = NodeHttpServer.layer(() => createServer(), { port: PORT });

// To:
import type Http from 'node:http';
export const nodeHttpServer: Http.Server = createServer();
const ServerLive = NodeHttpServer.layer(() => nodeHttpServer, { port: PORT });
```

Then in `WebSocketManager.ts`:

```typescript
import { nodeHttpServer } from '@/lib/HttpServer.js';
// Use nodeHttpServer.on('upgrade', ...) to attach WS
```

This is the simplest approach — no new Effect service needed for the server reference.

### Current server entry point (`index.ts`) — unchanged

```typescript
const main = Effect.gen(function* () {
  const runner = yield* StateMachineRunner;
  yield* Effect.sync(() => {
    const shutdown = (signal: string) => {
      Effect.log(`Received ${signal} — suspending all running machines…`).pipe(
        Effect.andThen(() => runner.suspendAll()),
        Effect.andThen(() => Effect.log('All machines suspended, shutting down.')),
        Effect.catchAll((err: unknown) =>
          Effect.log(`Shutdown error: ${err instanceof Error ? err.message : JSON.stringify(err)}`),
        ),
        Effect.provide(ServerLoggerLive),
        Effect.runFork,
      );
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  });
});

startServer.pipe(
  Effect.provide(ServerLoggerLive),
  Effect.tap(() => main.pipe(Effect.provide(MachineLive))),
  NodeRuntime.runMain,
);
```

Shutdown handlers already call `runner.suspendAll()`. The WebSocket manager should also cleanly close connections on shutdown — either add `wsManager.close()` to the shutdown handler, or register an `Effect.addFinalizer` in the WS manager Layer.

### MachineEvent structure (CONFIRMED from types.ts — all 10 types)

`MachineEvent` uses **`type`** as the discriminant (NOT `_tag`):

```typescript
{ type: 'state_changed', instanceId: '...', data: { previousState, currentState, stateData, timestamp } }
{ type: 'machine_completed', instanceId: '...', data: MachineResult }
// etc.
```

All 10 event types have `{ type, instanceId, data }` at the top level. The `type` field values are:
`state_changed`, `transition_recorded`, `log_entry`, `machine_completed`, `machine_resumed`, `child_spawned`, `child_completed`, `children_spawned`, `children_completed`, `artifact_created`

### PubSub subscription (CONFIRMED — Task 16 complete)

`MachineEventPubSub` is implemented in `server/src/machines/EventPubSub.ts`:

```typescript
import { Context, Layer, PubSub } from 'effect';
import type { MachineEvent } from './types.js';

export const MachineEventPubSub =
  Context.GenericTag<PubSub.PubSub<MachineEvent>>('MachineEventPubSub');
export const MachineEventPubSubLive: Layer.Layer<PubSub.PubSub<MachineEvent>> = Layer.effect(
  MachineEventPubSub,
  PubSub.unbounded<MachineEvent>(),
);
```

Subscribe in the WS manager via `PubSub.subscribe(pubsub)` which returns a `Queue.Dequeue<MachineEvent>`.

### Layer composition — NO changes needed (already done in Task 16)

`MachineLive` in `HttpServer.ts` already includes `PubSubLive`. The WebSocketManager Layer just needs `MachineEventPubSub` in its requirements — it will be satisfied by the existing `MachineLive` stack.

### WebSocket service should NOT be a runner dependency

The WS manager subscribes to PubSub events — it does NOT need to be a dependency of `StateMachineRunnerLive`. The data flow is: Runner → PubSub → WebSocketManager → Clients. This keeps the runner independent of the transport layer.

---

## Steps

### 1. Install dependencies

```bash
cd server && pnpm add ws && pnpm add -D @types/ws
```

### 2. Create `server/src/machines/live/WebSocketManager.ts`

Effect Service (Tag + Layer) wrapping the `ws` library:

```typescript
interface WebSocketManager {
  // Lifecycle managed by the Layer — start/stop automatic
}
```

Internal implementation:

- Creates a `WebSocketServer` from `ws`
- Attaches to the existing Node HTTP server (same port 3001)
- Handles the HTTP → WS upgrade on `/api/machines/live` path
- Manages connections and per-connection subscriptions

### 3. Connection & subscription handling

#### Client → Server messages

```typescript
{ type: 'subscribe', instanceId: string }
{ type: 'unsubscribe', instanceId: string }
```

Implementation:

- Maintain a `Map<WebSocket, Set<string>>` tracking subscriptions per connection
- On `subscribe`: add instanceId to the connection's subscription set
- On `unsubscribe`: remove instanceId from the set
- Support subscribing to multiple instances per connection

#### Server → Client messages

Forward `MachineEvent`s from the PubSub to connected clients, filtered by subscriptions:

- For each event, check which connections have the `event.instanceId` in their subscription set
- Send only to those connections
- Events for unsubscribed instances are NOT delivered

### 4. PubSub subscription

The `WebSocketManager` subscribes to `MachineEventPubSub` (confirmed available from `@/machines/EventPubSub.js`):

```typescript
import { MachineEventPubSub } from '@/machines/EventPubSub.js';

const pubsub = yield * MachineEventPubSub;
const subscription = yield * PubSub.subscribe(pubsub);

// In a background fiber — must start eagerly in the Layer body
yield *
  Effect.fork(
    Effect.forever(
      Effect.gen(function* () {
        const event = yield* Queue.take(subscription);
        broadcastToSubscribers(event);
      }),
    ),
  );
```

**Important**: The runner's `publishEvent` is fire-and-forget (`Effect.catchAll(() => Effect.void)`). The PubSub is unbounded so events buffer until taken, but the subscription fiber must be running before machines start to avoid missing events. Starting the fiber in the Layer's `Effect.gen` body ensures this.

### 5. Event types forwarded

All 10 `MachineEvent` types are forwarded:

- `state_changed` — on each state transition
- `transition_recorded` — with full `TransitionRecord`
- `log_entry` — when action writes a log
- `machine_completed` — when machine reaches terminal state
- `child_spawned` — when child_machine state spawns child (**note**: `childInstanceId` is `'pending'` — the child's ID is not yet known at this point; see `child_completed` for the actual ID)
- `child_completed` — when single child finishes
- `children_spawned` — when parallel_children state spawns all children
- `children_completed` — when all parallel children finish
- `artifact_created` — when action writes an artifact
- `machine_resumed` — when suspended instance is resumed

### 6. Edge case handling

- **Malformed JSON**: If client sends non-JSON or malformed message → log warning, do not crash server/connection
- **Non-existent instance ID**: Subscribing to a non-existent ID → silently accepted (no events will come)
- **Completed instance**: Subscribing to a completed instance → silently accepted (no events will come)
- **Rapid subscribe/unsubscribe**: Must not leak subscriptions — use proper Set operations
- **Connection close**: Clean up all subscriptions for the closed connection

### 7. Mount on HTTP server

`@effect/platform-node`'s `NodeHttpServer.layer()` does NOT expose the underlying `http.Server` in the Effect context. The recommended approach is to extract the `createServer()` result to a module-level export in `HttpServer.ts`:

```typescript
// In server/src/lib/HttpServer.ts — change:
import type Http from 'node:http';
export const nodeHttpServer: Http.Server = createServer();
const ServerLive = NodeHttpServer.layer(() => nodeHttpServer, { port: PORT });
```

Then in `WebSocketManager.ts`, attach the WS upgrade handler:

```typescript
import { nodeHttpServer } from '@/lib/HttpServer.js';

const wss = new WebSocketServer({ noServer: true });

nodeHttpServer.on('upgrade', (request, socket, head) => {
  if (request.url === '/api/machines/live') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});
```

**Note**: The `live/` directory under `server/src/machines/` does not exist yet — it must be created for `WebSocketManager.ts` and `events.ts`.

### 8. Create `server/src/machines/live/events.ts`

Define the event serialization format (JSON). This file can re-export event types and provide serialization helpers.

### 9. Unit tests — `server/src/machines/live/WebSocketManager.test.ts`

- Client connects successfully
- Subscribe → events for that instance are delivered
- Unsubscribe → events stop
- Multiple subscriptions → events for all subscribed instances delivered
- Unsubscribed instance events not delivered
- Malformed JSON does not crash connection/server
- Non-existent instance subscription accepted silently
- Connection close cleans up subscriptions
- Rapid subscribe/unsubscribe cycles → no leaked subscriptions

---

## Behavior Spec Coverage

- §16.1 — Client connects to `ws://host/api/machines/live` successfully
- §16.1 — Subscribe begins receiving events; unsubscribe stops
- §16.1 — Multiple instance subscriptions; unsubscribed events not delivered
- §16.2 — All 10 event types forwarded to subscribers
- §16.3 — Event ordering preserved (events arrive in causal order from PubSub)
- §21.5 — Subscribing to completed instance delivers no events
- §21.5 — Non-existent instance ID does not crash
- §21.5 — Malformed JSON does not crash server
- §21.5 — Rapid subscribe/unsubscribe does not leak

---

## Validation Checklist

- [ ] `ws` and `@types/ws` added to server dependencies
- [ ] `server/src/machines/live/WebSocketManager.ts` implemented as Effect Layer
- [ ] WS server mounted on same HTTP server at `/api/machines/live`
- [ ] Subscribe/unsubscribe messages handled correctly
- [ ] Events filtered by subscription before sending
- [ ] All 10 event types forwarded
- [ ] Malformed messages handled gracefully
- [ ] Connection cleanup on close
- [ ] Unit tests pass
- [ ] `pnpm --filter @aiflow/server run build` succeeds
