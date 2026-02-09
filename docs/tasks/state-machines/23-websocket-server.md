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

> These details emerged from Tasks 01–05 and affect this task's implementation.

### Accessing the underlying Node HTTP server

The current `HttpLive` in `server/src/lib/HttpServer.ts` creates the Node server via:

```typescript
const ServerLive = NodeHttpServer.layer(() => createServer(), { port: PORT });
```

The `createServer()` return value is the raw `http.Server` needed for the WebSocket upgrade handler. To share it:

- Extract `createServer()` to a module-level variable, OR
- Use `NodeHttpServer` platform APIs to access the underlying server from the Effect context
- The `ws` library's `noServer: true` + manual `handleUpgrade` is the recommended approach

### MachineEvent structure

`MachineEvent` (from `types.ts`) uses **`type`** as the discriminant (NOT `_tag`):

```typescript
{ type: 'state_changed', instanceId: '...', data: { previousState, currentState, stateData, timestamp } }
{ type: 'machine_completed', instanceId: '...', data: MachineResult }
// etc.
```

All 10 event types have `type` + `instanceId` + `data` at the top level.

### PubSub access

The `MachineEventPubSub` (from Task 16) is a `Context.GenericTag<PubSub.PubSub<MachineEvent>>('MachineEventPubSub')`. Subscribe via `PubSub.subscribe(pubsub)` which returns a `Queue.Dequeue<MachineEvent>`.

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

The `WebSocketManager` subscribes to `MachineEventPubSub`:

```typescript
const subscription = yield * PubSub.subscribe(machineEventPubSub);

// In a background fiber:
yield *
  Effect.forever(
    Effect.gen(function* () {
      const event = yield* Queue.take(subscription);
      broadcastToSubscribers(event);
    }),
  );
```

### 5. Event types forwarded

All 10 `MachineEvent` types are forwarded:

- `state_changed` — on each state transition
- `transition_recorded` — with full `TransitionRecord`
- `log_entry` — when action writes a log
- `machine_completed` — when machine reaches terminal state
- `child_spawned` — when child_machine state spawns child
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

Access the underlying Node `http.Server` from the `NodeHttpServer` Layer to attach the WS upgrade handler:

```typescript
// The ws library handles HTTP → WS upgrade
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (request, socket, head) => {
  if (request.url === '/api/machines/live') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});
```

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
