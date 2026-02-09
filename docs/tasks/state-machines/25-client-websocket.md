# Task 25 — Client WebSocket Client

> **Phase**: 4 (Client Viewer)
> **Depends on**: Task 23 (WebSocket server)
> **Blocks**: Task 26 (client state management)

---

## Objective

Create a WebSocket client for the browser that connects to `ws://host/api/machines/live`, manages subscriptions to instance IDs, handles reconnection with exponential backoff, and dispatches received events to subscribers (Zustand stores, components).

---

## Implementation Notes from Completed Tasks

> These details emerged from the existing client codebase and server types.

- **`MachineEvent` structure**: Uses `type` as the discriminant (not `_tag`). Top-level fields: `type`, `instanceId`, `data`. Example: `{ type: 'state_changed', instanceId: '...', data: { previousState, currentState, stateData, timestamp } }`.
- **Client Effect pattern**: The existing client uses `runWithLogging` from `client/src/utils/logger.ts` to execute Effects with `ClientLoggerLive`. The WebSocket client doesn't need Effect — it's a plain TypeScript singleton managing native `WebSocket`.
- **Zustand pattern**: Existing stores use `create<T>()(...)` from `zustand` with `persist` middleware. See `useThemeStore.ts`. The WebSocket client should be a plain module, not a Zustand store, with a React hook wrapper.
- **Router**: Uses `HashRouter` from `react-router` (hash-based URLs like `#/machines/instances/123`).

---

## Steps

### 1. Create `client/src/utils/machineSocket.ts`

Implement a singleton WebSocket client manager:

```typescript
interface MachineSocketClient {
  connect(): void;
  disconnect(): void;
  subscribe(instanceId: string, callback: (event: MachineEvent) => void): () => void;
  unsubscribe(instanceId: string): void;
}
```

### 2. Connection management

- Connect to `ws://${window.location.host}/api/machines/live`
- Handle `onopen`, `onclose`, `onerror`, `onmessage` events
- Parse incoming JSON messages as `MachineEvent`

### 3. Subscription management

- Maintain a `Map<string, Set<(event: MachineEvent) => void>>` of instanceId → callback sets
- On subscribe:
  - Add callback to the set for the instanceId
  - Send `{ type: 'subscribe', instanceId }` to the server
  - Return an unsubscribe function
- On unsubscribe:
  - Remove callback from the set
  - If no more callbacks for the instanceId, send `{ type: 'unsubscribe', instanceId }` to server
- On message:
  - Parse JSON, look up `event.instanceId` in subscriptions
  - Call all registered callbacks for that instanceId

### 4. Reconnection with exponential backoff

On connection close or error:

- Attempt reconnect starting at 1 second delay
- Double delay on each attempt: 1s → 2s → 4s → 8s → 16s → 30s (cap)
- On successful reconnect:
  - Reset backoff timer
  - **Re-subscribe** to all previously subscribed instance IDs
- Events that occurred during disconnect are NOT replayed (client should re-fetch state via REST)

### 5. Event types

Handle all 10 `MachineEvent` types:

- `state_changed`
- `transition_recorded`
- `log_entry`
- `machine_completed`
- `child_spawned`
- `child_completed`
- `children_spawned`
- `children_completed`
- `artifact_created`
- `machine_resumed`

### 6. React hook wrapper

Create `client/src/hooks/useMachineSocket.ts`:

```typescript
// Subscribe to events for a specific instance
const useMachineSocket = (instanceId: string, onEvent: (event: MachineEvent) => void) => {
  useEffect(() => {
    const unsub = machineSocket.subscribe(instanceId, onEvent);
    return unsub;
  }, [instanceId, onEvent]);
};
```

---

## Behavior Spec Coverage

- §16.1 — Client connects to `ws://host/api/machines/live`
- §16.1 — Subscribe/unsubscribe messages sent
- §16.1 — Multiple instance subscriptions supported
- §16.4 — Reconnection with exponential backoff (1s → 2s → 4s → … → 30s cap)
- §16.4 — On reconnect, re-subscribes to previously subscribed instances
- §16.4 — Events during disconnect not replayed (client re-fetches via REST)

---

## Validation Checklist

- [ ] `client/src/utils/machineSocket.ts` implements WebSocket client
- [ ] Connection to `ws://host/api/machines/live` works
- [ ] Subscribe/unsubscribe sends correct messages to server
- [ ] Callbacks dispatched for matching instanceId events
- [ ] Exponential backoff reconnection: 1s → 2s → 4s → … → 30s cap
- [ ] Re-subscribe on reconnect
- [ ] React hook `useMachineSocket` properly subscribes/cleans up
- [ ] `pnpm --filter @aiflow/client run build` succeeds
