# Task 40 — Server E2E: Concurrency, Cancellation & Lifecycle

> **Phase**: 7 (Server E2E Validation)
> **Depends on**: Task 34 (infrastructure), Task 37 (linear execution)
> **Blocks**: None
> **Validates**: §10 Concurrency & Semaphore, §11 Cancellation

---

## Objective

Validate all 18 behaviors from §10 (Concurrency & Semaphore) and §11
(Cancellation) via HTTP requests. These tests confirm semaphore-based
concurrency control, deadlock-free parent/child execution, and the full
cancellation protocol for running, waiting, suspended, and terminal instances.

---

## Behavior Checklist → Test Mapping

### §10.1 Bounded Active Concurrency (3 behaviors)

| #   | Behavior                                                                  | Test                               |
| --- | ------------------------------------------------------------------------- | ---------------------------------- |
| 1   | More instances than `MAX_CONCURRENT_MACHINES` → excess queue (not reject) | `overflow → queued`                |
| 2   | Queued machines start as permits free                                     | `queued → start when permit freed` |
| 3   | Active count never exceeds semaphore permits                              | `active count ≤ permits`           |

### §10.2 Release-Before-Wait (No Deadlock) (4 behaviors)

| #   | Behavior                                                    | Test                               |
| --- | ----------------------------------------------------------- | ---------------------------------- |
| 1   | Parent with child_machine releases permit before child runs | `parent releases permit for child` |
| 2   | 51+ single-child chain completes without deadlock           | `deep chain → no deadlock`         |
| 3   | Fan-out: parent with 10 parallel children releases permit   | `fan-out → no deadlock`            |
| 4   | Mixed nesting completes without deadlock                    | `mixed nesting → no deadlock`      |

### §11.1 Cancel Running Instance (4 behaviors)

| #   | Behavior                                                       | Test                        |
| --- | -------------------------------------------------------------- | --------------------------- |
| 1   | `POST /instances/:id/cancel` on running → success              | `cancel running → 200`      |
| 2   | Instance `status: 'cancelled'`                                 | `cancel → cancelled status` |
| 3   | `currentState` is `'cancelled'` terminal                       | `cancel → cancelled state`  |
| 4   | `machine_completed` event with cancelled (deferred to Task 44) | —                           |

### §11.2 Cancel While Waiting for Child (3 behaviors)

| #   | Behavior                                                        | Test                              |
| --- | --------------------------------------------------------------- | --------------------------------- |
| 1   | Cancel parent waiting_for_child → also cancels child            | `cancel parent → child cancelled` |
| 2   | Both reach `status: 'cancelled'`                                | `both cancelled`                  |
| 3   | Child fires own `machine_completed` event (deferred to Task 44) | —                                 |

### §11.3 Cancel While Waiting for Parallel Children (3 behaviors)

| #   | Behavior                                         | Test                                          |
| --- | ------------------------------------------------ | --------------------------------------------- |
| 1   | Cancel parent → all running children interrupted | `cancel parallel parent → children cancelled` |
| 2   | All children `status: 'cancelled'`               | `all children cancelled`                      |
| 3   | Each child fires event (deferred to Task 44)     | —                                             |

### §11.4 Cancel Suspended Instance (2 behaviors)

| #   | Behavior                                 | Test                           |
| --- | ---------------------------------------- | ------------------------------ |
| 1   | Cancel suspended → directly to cancelled | `cancel suspended → cancelled` |
| 2   | Status becomes `'cancelled'`             | `suspended → cancelled status` |

### §11.5 Cancel Idempotency / Conflict (3 behaviors)

| #   | Behavior               | Test                     |
| --- | ---------------------- | ------------------------ |
| 1   | Cancel completed → 409 | `cancel completed → 409` |
| 2   | Cancel cancelled → 409 | `cancel cancelled → 409` |
| 3   | Cancel errored → 409   | `cancel errored → 409`   |

### §11.6 Transition History (1 behavior)

| #   | Behavior                                                      | Test                                 |
| --- | ------------------------------------------------------------- | ------------------------------------ |
| 1   | Cancellation recorded in history as transition to `cancelled` | `history includes cancel transition` |

---

## Test Structure

```typescript
// server/src/__e2e__/06-concurrency-cancel.e2e.test.ts

describe('§10 — Concurrency & Semaphore', () => {
  describe('§10.1 Bounded Active Concurrency', () => {
    it('starting more instances than MAX_CONCURRENT → excess queued, not rejected');
    it('queued machines start as permits become available');
    it('active instance count never exceeds semaphore permits');
  });

  describe('§10.2 Release-Before-Wait (No Deadlock)', () => {
    it('parent with child_machine releases permit for child');
    it('chain of 51+ single-child machines completes without deadlock');
    it('fan-out: parent with 10 parallel children releases permit');
    it('mixed nesting (parallel children spawning their own children) completes');
  });
});

describe('§11 — Cancellation', () => {
  describe('§11.1 Cancel Running Instance', () => {
    it('POST /instances/:id/cancel on running → 200');
    it('cancelled instance has status "cancelled"');
    it('cancelled instance currentState is "cancelled" terminal');
  });

  describe('§11.2 Cancel While Waiting for Child', () => {
    it('cancel parent waiting_for_child → child also cancelled');
    it('both parent and child have status cancelled');
  });

  describe('§11.3 Cancel While Waiting for Parallel Children', () => {
    it('cancel parent with parallel children → all children cancelled');
    it('all children reach status cancelled');
  });

  describe('§11.4 Cancel Suspended Instance', () => {
    it('cancel suspended instance → transitions directly to cancelled');
    it('status becomes cancelled');
  });

  describe('§11.5 Cancel Idempotency / Conflict', () => {
    it('cancel already-completed → 409');
    it('cancel already-cancelled → 409');
    it('cancel already-errored → 409');
  });

  describe('§11.6 Transition History', () => {
    it('cancellation recorded in history as transition to cancelled state');
  });
});
```

---

## Fixtures Needed

```typescript
// Slow machine (long delay for cancellation)
const SLOW_DEF = {
  name: 'e2e-slow',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'waiting',
  states: {
    waiting: { name: 'waiting', type: 'action', actionId: 'delay' },
    completed: { name: 'completed', type: 'terminal' },
    cancelled: { name: 'cancelled', type: 'terminal' },
    error: { name: 'error', type: 'terminal' },
  },
  transitions: [{ from: 'waiting', to: 'completed' }],
};

// For concurrency tests: create many instances with moderate delay
const MODERATE_DELAY_INPUT = { delayMs: 1000, nextState: 'completed' };
const LONG_DELAY_INPUT = { delayMs: 30_000, nextState: 'completed' };
```

---

## Testing Strategy

### Concurrency Testing

1. **Overflow test**: Start `MAX_CONCURRENT_MACHINES + 5` instances simultaneously.
   Verify all return 201 (none rejected). Some will be `running`, some may queue.
   Eventually all complete.

2. **Active count**: Use the delay action (1s delay) and start more instances than
   the semaphore allows. At any point, poll all instances — count those with
   `status: 'running'` — should never exceed `MAX_CONCURRENT_MACHINES`.

3. **Deep chain**: Create definitions A→B→C→...→Z (>50 levels of child_machine).
   Start A. If it completes without timeout/deadlock, the release-before-wait
   pattern works.

### Cancellation Testing

1. **Cancel running**: Start slow machine (30s delay), poll until `running`,
   POST cancel, verify 200, poll until `cancelled`.

2. **Cancel parent+child**: Start parent with slow child, poll parent until
   `waiting_for_child`, cancel parent, verify both parent and child `cancelled`.

3. **409 conflict**: Start fast machine, wait for completion, try cancel → 409.
   Start slow machine, cancel once → 200, cancel again → 409.

---

## Key Assertions

- **Concurrency**: All POST /instances return 201 regardless of load; count of
  `running` instances at any poll ≤ `MAX_CONCURRENT_MACHINES`
- **Deadlock freedom**: Deep chain and fan-out complete within reasonable timeout
- **Cancel response**: 200 for valid cancel, 409 for terminal-state cancel
- **Cancel state**: `status === 'cancelled'`, `currentState === 'cancelled'`
- **History**: Last entry in `GET /history` has `toState: 'cancelled'`
- **Cascade**: Parent cancel propagates to children (single and parallel)

---

## Behavior Spec Coverage

- §10 Concurrency & Semaphore (§10.1–§10.2) — 7 behaviors
- §11 Cancellation (§11.1–§11.6) — 16 behaviors

---

## Validation Checklist

- [ ] All 3 §10.1 bounded concurrency behaviors verified
- [ ] All 4 §10.2 no-deadlock behaviors verified
- [ ] All 4 §11.1 cancel-running behaviors verified (event deferred)
- [ ] All 3 §11.2 cancel-with-child behaviors verified (event deferred)
- [ ] All 3 §11.3 cancel-parallel behaviors verified (event deferred)
- [ ] Both §11.4 cancel-suspended behaviors verified
- [ ] All 3 §11.5 conflict behaviors verified
- [ ] §11.6 history behavior verified
- [ ] Test file: `server/src/__e2e__/06-concurrency-cancel.e2e.test.ts`
