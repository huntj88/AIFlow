# Task 45 — Server E2E: Negative & Edge Cases

> **Phase**: 7 (Server E2E Validation)
> **Depends on**: Task 34 (infrastructure), Tasks 35–44 (all prior e2e tasks)
> **Blocks**: None
> **Validates**: §21 Negative / Edge-Case Behaviors

---

## Objective

Validate all 16 behaviors from §21 (Negative / Edge-Case Behaviors) via HTTP
requests and WebSocket connections. These are the "break it" tests that ensure
the server handles malformed inputs, concurrent operations, definition mutation
during execution, large-scale payloads, and WebSocket edge cases gracefully.

---

## Behavior Checklist → Test Mapping

### §21.1 API Error Responses (5 behaviors)

| #   | Behavior                                        | Test                         |
| --- | ----------------------------------------------- | ---------------------------- |
| 1   | `POST /instances` missing `definitionId` → 400  | `missing definitionId → 400` |
| 2   | `POST /instances` missing `input` → 400         | `missing input → 400`        |
| 3   | `GET /instances/:id` non-existent → 404         | `get non-existent → 404`     |
| 4   | `POST /instances/:id/cancel` non-existent → 404 | `cancel non-existent → 404`  |
| 5   | `POST /instances/:id/resume` non-existent → 404 | `resume non-existent → 404`  |

### §21.2 Concurrent Operations (3 behaviors)

| #   | Behavior                                                    | Test                               |
| --- | ----------------------------------------------------------- | ---------------------------------- |
| 1   | Multiple instances of same def concurrently → no corruption | `concurrent start → no corruption` |
| 2   | Cancel during transition → completes without error          | `cancel during transition → clean` |
| 3   | Two WS clients same instance → both receive events          | `two clients → same events`        |

### §21.3 Definition Mutation During Execution (3 behaviors)

| #   | Behavior                                                        | Test                                     |
| --- | --------------------------------------------------------------- | ---------------------------------------- |
| 1   | Update def while instance running → running instance unaffected | `update def → running ok`                |
| 2   | Delete def while instance running → instance completes          | `delete def → running ok`                |
| 3   | Completed instance viewable after def deleted                   | `completed → viewable after def deleted` |

### §21.4 Large-Scale Behaviors (3 behaviors)

| #   | Behavior                                                 | Test                    |
| --- | -------------------------------------------------------- | ----------------------- |
| 1   | Machine with 50+ states runs correctly                   | `50+ state machine`     |
| 2   | Parallel children with 20+ children completes            | `20+ parallel children` |
| 3   | Instance with 1000+ log entries retrievable + filterable | `1000+ log entries`     |

### §21.5 WebSocket Edge Cases (4 behaviors)

| #   | Behavior                                              | Test                                |
| --- | ----------------------------------------------------- | ----------------------------------- |
| 1   | Subscribe to completed instance → no events (done)    | `subscribe completed → no events`   |
| 2   | Subscribe to non-existent instance → no crash         | `subscribe non-existent → no crash` |
| 3   | Malformed JSON over WS → server doesn't crash         | `malformed JSON → no crash`         |
| 4   | Rapid subscribe/unsubscribe → no leaked subscriptions | `rapid sub/unsub → no leak`         |

---

## Test Structure

```typescript
// server/src/__e2e__/11-edge-cases.e2e.test.ts

describe('§21 — Negative & Edge Cases', () => {
  describe('§21.1 API Error Responses', () => {
    it('POST /instances with missing definitionId → 400');
    it('POST /instances with missing input → 400 or 404');
    it('GET /instances/:id with non-existent ID → 404');
    it('POST /instances/:id/cancel on non-existent → 404');
    it('POST /instances/:id/resume on non-existent → 404');
  });

  describe('§21.2 Concurrent Operations', () => {
    it('starting 10 instances of same definition concurrently → no data corruption');
    it('cancel instance while transitioning → cancel takes effect at next yield');
    it('two WS clients subscribe to same instance → both receive same events');
  });

  describe('§21.3 Definition Mutation During Execution', () => {
    it('updating definition while instance running → running unaffected');
    it('deleting definition while instance running → instance still completes');
    it('completed instance viewable after definition deleted');
  });

  describe('§21.4 Large-Scale Behaviors', () => {
    it('machine with 50+ states and transitions runs correctly');
    it('parallel_children with 20+ children completes');
    it('instance with 1000+ log entries retrievable and filterable');
  });

  describe('§21.5 WebSocket Edge Cases', () => {
    it('subscribing to completed instance delivers no events');
    it('subscribing to non-existent instance ID does not crash connection');
    it('sending malformed JSON does not crash server');
    it('rapid subscribe/unsubscribe cycles do not leak subscriptions');
  });
});
```

---

## Fixtures Needed

```typescript
// 50+ state machine (generated)
function make50StateDef() {
  const states: Record<string, any> = {};
  const transitions: { from: string; to: string }[] = [];

  for (let i = 0; i < 50; i++) {
    const name = `state_${i}`;
    states[name] = { name, type: 'action', actionId: 'log-message' };
    if (i > 0) transitions.push({ from: `state_${i - 1}`, to: name });
  }
  transitions.push({ from: 'state_49', to: 'completed' });

  states.completed = { name: 'completed', type: 'terminal' };
  states.cancelled = { name: 'cancelled', type: 'terminal' };
  states.error = { name: 'error', type: 'terminal' };

  return {
    name: 'e2e-50-states',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    initialState: 'state_0',
    states,
    transitions,
  };
}

// Machine that produces 1000+ log entries
// Use a loop state that logs on each iteration. Or use a single state
// with a custom action that writes 1000+ log entries.
```

---

## Custom Test Actions

```typescript
// Action that writes N log entries (for large-scale log test)
registry.register(
  'test-many-logs',
  (ctx) =>
    Effect.gen(function* () {
      const input = ctx.stateData as { logCount?: number; nextState?: string };
      const count = input.logCount ?? 100;
      for (let i = 0; i < count; i++) {
        yield* ctx.logger.info(`Log entry ${i}`);
      }
      return { nextState: input.nextState ?? 'completed', data: { logged: count } };
    }),
  { description: 'Writes N log entries for testing' },
);
```

---

## Testing Strategy

### Concurrent Start (§21.2.1)

```typescript
const defId = await api.createDef(SIMPLE_DEF).then((d) => d.id);
const promises = Array.from({ length: 10 }, () =>
  api.postInstance({ definitionId: defId, input: { message: 'test', nextState: 'completed' } }),
);
const results = await Promise.all(promises);

// All should return 201
for (const res of results) expect(res.status).toBe(201);

// Wait for all to complete
await Promise.all(
  results.map(async (r) => {
    const body = await r.json();
    await api.pollStatus(body.id, ['completed'], 10_000);
  }),
);

// Verify unique IDs, no data corruption
const listRes = await api.getInstances(`?definitionId=${defId}`);
const instances = await listRes.json();
const ids = new Set(instances.map((i: any) => i.id));
expect(ids.size).toBe(10);
```

### 50+ State Machine (§21.4.1)

```typescript
const bigDef = make50StateDef();
const def = await api.createDef(bigDef);
const inst = await api.startInst(def.id, { message: 'start', nextState: 'state_1' });
const final = await api.pollStatus(inst.id, ['completed'], 30_000);
expect(final.status).toBe('completed');

const history = await api.getHistory(inst.id).then((r) => r.json());
expect(history.length).toBe(50); // 50 transitions
```

### 1000+ Log Entries (§21.4.3)

```typescript
// Create def with test-many-logs action
const def = await api.createDef(MANY_LOGS_DEF);
const inst = await api.startInst(def.id, { logCount: 1500, nextState: 'completed' });
await api.pollStatus(inst.id, ['completed'], 30_000);

const logsRes = await api.getLogs(inst.id);
const logs = await logsRes.json();
expect(logs.length).toBeGreaterThanOrEqual(1000);
```

### WS Edge Cases (§21.5)

```typescript
// Malformed JSON
ws.send('this is not json {{{{');
// Wait 1s — connection should still be open
expect(ws.readyState).toBe(WebSocket.OPEN);

// Rapid subscribe/unsubscribe
for (let i = 0; i < 100; i++) {
  subscribe(ws, instanceId);
  unsubscribe(ws, instanceId);
}
// Connection should still be healthy
ws.send(JSON.stringify({ type: 'subscribe', instanceId: 'test' }));
```

---

## Key Assertions

- **400**: Missing required fields in POST body
- **404**: Non-existent resource IDs
- **No corruption**: Concurrent operations produce unique, valid instances
- **Large-scale**: 50+ state machines complete; 1000+ logs retrievable
- **WS resilience**: Malformed messages don't crash; rapid sub/unsub doesn't leak
- **Definition mutation**: Running instances are unaffected by definition changes

---

## Behavior Spec Coverage

- §21 Negative / Edge-Case Behaviors (§21.1–§21.5) — 18 behaviors

---

## Validation Checklist

- [x] All 5 §21.1 API error response behaviors verified
- [x] All 3 §21.2 concurrent operation behaviors verified
- [x] All 3 §21.3 definition mutation behaviors verified
- [x] All 3 §21.4 large-scale behaviors verified
- [x] All 4 §21.5 WebSocket edge case behaviors verified (requires real server)
- [x] Test file: `server/src/__e2e__/11-edge-cases.e2e.test.ts`
