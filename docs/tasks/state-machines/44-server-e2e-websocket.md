# Task 44 — Server E2E: WebSocket Live Updates

> **Phase**: 7 (Server E2E Validation)
> **Depends on**: Task 34 (infrastructure), Task 37 (linear execution)
> **Blocks**: None
> **Validates**: §16 WebSocket — Live Updates

---

## Objective

Validate all 17 behaviors from §16 (WebSocket Live Updates) by connecting a
WebSocket client to the server and verifying event delivery, ordering, and
subscription management.

---

## Testability Analysis

WebSocket tests require a **real server** (not just `HttpApp.toWebHandler()`)
because the WS upgrade requires a real HTTP server. Two approaches:

1. **In-process server**: Start the Effect HTTP server on a random port in
   `beforeAll`, connect `ws` client to it, shut down in `afterAll`.
2. **Use `WebSocketManager` directly**: If the manager exposes a testable API,
   mock the WS connection.

**Recommended**: Approach 1 — spin up a real server on a random port for the
WebSocket test suite. This validates the full stack including upgrade handling.

---

## Behavior Checklist → Test Mapping

### §16.1 Connection & Subscription (5 behaviors)

| #   | Behavior                                         | Test                           |
| --- | ------------------------------------------------ | ------------------------------ |
| 1   | Client connects to `ws://host/api/machines/live` | `connect → open`               |
| 2   | `subscribe` → receives events for that instance  | `subscribe → events received`  |
| 3   | `unsubscribe` → stops events                     | `unsubscribe → no more events` |
| 4   | Subscribe to multiple instances → events for all | `multi-subscribe → all events` |
| 5   | Events not delivered for unsubscribed instances  | `unsubscribed → no events`     |

### §16.2 Event Types (10 behaviors)

| #   | Behavior                                                | Test                         |
| --- | ------------------------------------------------------- | ---------------------------- |
| 1   | `state_changed` fires on transition                     | `event: state_changed`       |
| 2   | `transition_recorded` fires with TransitionRecord       | `event: transition_recorded` |
| 3   | `log_entry` fires when action logs                      | `event: log_entry`           |
| 4   | `machine_completed` fires at terminal state             | `event: machine_completed`   |
| 5   | `child_spawned` fires when child_machine spawns         | `event: child_spawned`       |
| 6   | `child_completed` fires when child finishes             | `event: child_completed`     |
| 7   | `children_spawned` fires for parallel children          | `event: children_spawned`    |
| 8   | `children_completed` fires when all parallel done       | `event: children_completed`  |
| 9   | `artifact_created` fires when artifact written          | `event: artifact_created`    |
| 10  | `machine_resumed` fires when suspended instance resumed | `event: machine_resumed`     |

### §16.3 Event Ordering (2 behaviors)

| #   | Behavior                                                         | Test                             |
| --- | ---------------------------------------------------------------- | -------------------------------- |
| 1   | `state_changed` before `transition_recorded` for same transition | `order: state before transition` |
| 2   | `log_entry` before `transition_recorded` for that action's state | `order: log before transition`   |

---

## Test Structure

```typescript
// server/src/__e2e__/10-websocket.e2e.test.ts

import WebSocket from 'ws';

describe('§16 — WebSocket Live Updates', () => {
  let serverUrl: string;
  let wsUrl: string;

  beforeAll(async () => {
    // Start real server on random port
    // serverUrl = `http://localhost:${port}`;
    // wsUrl = `ws://localhost:${port}/api/machines/live`;
  });

  afterAll(async () => {
    // Shut down server
  });

  function connectWs(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  function subscribe(ws: WebSocket, instanceId: string) {
    ws.send(JSON.stringify({ type: 'subscribe', instanceId }));
  }

  function unsubscribe(ws: WebSocket, instanceId: string) {
    ws.send(JSON.stringify({ type: 'unsubscribe', instanceId }));
  }

  function collectEvents(ws: WebSocket, count: number, timeoutMs = 10_000): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const events: any[] = [];
      const timer = setTimeout(() => resolve(events), timeoutMs);
      ws.on('message', (data) => {
        events.push(JSON.parse(data.toString()));
        if (events.length >= count) {
          clearTimeout(timer);
          resolve(events);
        }
      });
    });
  }

  describe('§16.1 Connection & Subscription', () => {
    it('client connects to ws://host/api/machines/live successfully');
    it('subscribe to instance → receives events during execution');
    it('unsubscribe → stops receiving events');
    it('subscribe to multiple instances → events for all');
    it('events not delivered for unsubscribed instances');
  });

  describe('§16.2 Event Types', () => {
    it('state_changed event with previousState, currentState, stateData, timestamp');
    it('transition_recorded event with full TransitionRecord');
    it('log_entry event when action writes log');
    it('machine_completed event at terminal state');
    it('child_spawned event with childInstanceId and childDefinitionId');
    it('child_completed event with MachineResult');
    it('children_spawned event with keyed childInstanceIds');
    it('children_completed event with keyed results');
    it('artifact_created event with ArtifactRecord');
    it('machine_resumed event with previousState and resumedState');
  });

  describe('§16.3 Event Ordering', () => {
    it('state_changed arrives before transition_recorded for same transition');
    it('log_entry arrives before transition_recorded for that state');
  });
});
```

---

## Testing Strategy

### Server Setup

Start the real Effect HTTP server on a random port:

```typescript
import { createServer } from 'http';

async function startTestServer(): Promise<{ port: number; close: () => Promise<void> }> {
  // Use the same server bootstrap as src/index.ts but with a random port
  // and the test layer instead of production layer
}
```

### Event Collection Pattern

For each test:

1. Connect WS client
2. Subscribe to the target instance
3. Start the machine (via HTTP API)
4. Collect N events (with timeout)
5. Assert on event types, shapes, and order
6. Close WS

### Verifying Event Absence

For unsubscribe tests:

1. Connect WS, subscribe to instance A
2. Start instance A and collect 1 event (proves subscription works)
3. Unsubscribe from A
4. Start instance B (same definition)
5. Wait 2s — should receive 0 events for A or B
6. Subscribe to B, start another machine on B — should receive events

---

## Key Assertions

- **Connection**: WS `open` event fires, no errors
- **Event shape**: Each event has `type`, `instanceId`, `payload`, `timestamp`
- **state_changed**: `payload` has `previousState`, `currentState`, `stateData`
- **transition_recorded**: `payload` has full `TransitionRecord` fields
- **machine_completed**: `payload` has `status` (completed/cancelled/error)
- **child_spawned**: `payload` has `childInstanceId`, `childDefinitionId`
- **Ordering**: `state_changed` timestamp ≤ `transition_recorded` timestamp for same transition
- **No events**: After unsubscribe, collect returns empty within timeout

---

## Notes

- The `ws` package is already a dependency (`@types/ws` too) — used by
  `WebSocketManager`.
- For `machine_resumed` event, need a suspended instance (coordinate with Task 41).
- For `artifact_created` event, need an artifact-producing action (coordinate
  with Task 43).
- `children_spawned` and `children_completed` require parallel children
  (coordinate with Task 39).

---

## Behavior Spec Coverage

- §16 WebSocket — Live Updates (§16.1–§16.3) — 17 behaviors

---

## Validation Checklist

- [x] All 5 §16.1 connection/subscription behaviors verified
- [x] All 10 §16.2 event types verified
- [x] Both §16.3 event ordering behaviors verified
- [x] WS test server starts/stops cleanly in beforeAll/afterAll
- [x] No event leaks (unsubscribe prevents delivery)
- [x] Test file: `server/src/__e2e__/10-websocket.e2e.test.ts`
