# Task 38 — Server E2E: Error Handling & Timeouts

> **Phase**: 7 (Server E2E Validation)
> **Depends on**: Task 34 (infrastructure)
> **Blocks**: None
> **Validates**: §6 Machine Execution — Error Handling, §7 Timeouts & Safety Limits

---

## Objective

Validate all 13 behaviors from §6 (Error Handling) and §7 (Timeouts & Safety
Limits) via HTTP requests. These tests confirm that action failures, illegal
transitions, data validation errors, middleware errors, state timeouts, machine
timeouts, and depth limits are handled correctly.

---

## Behavior Checklist → Test Mapping

### §6.1 Action Failure (4 behaviors)

| #   | Behavior                                                 | Test                                                        |
| --- | -------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | Action fails → machine transitions to `error` terminal   | `action failure → error state`                              |
| 2   | Instance `error` field has descriptive message           | `action failure → error field populated`                    |
| 3   | Instance `status` is `'error'`                           | `action failure → status is error`                          |
| 4   | `machine_completed` event with `status: 'error'` emitted | `action failure → event emitted` (§16, deferred to Task 44) |

### §6.2 Illegal Transition (2 behaviors)

| #   | Behavior                                                              | Test                                     |
| --- | --------------------------------------------------------------------- | ---------------------------------------- |
| 1   | Action returns `nextState` not in `transitions[]` → `DefinitionError` | `illegal transition → error`             |
| 2   | Error identifies the illegal transition (from → to)                   | `illegal transition → descriptive error` |

### §6.3 Data Validation (2 behaviors)

| #   | Behavior                                      | Test                        |
| --- | --------------------------------------------- | --------------------------- |
| 1   | stateData fails `dataSchema` → machine errors | `data validation → error`   |
| 2   | Error includes schema validation details      | `data validation → details` |

### §6.4 Middleware Error Propagation (2 behaviors)

| #   | Behavior                                             | Test                                             |
| --- | ---------------------------------------------------- | ------------------------------------------------ |
| 1   | `beforeTransition` middleware fails → machine errors | `middleware failure → error`                     |
| 2   | `onError` hooks fire on failure                      | `middleware onError fires` (observable via logs) |

### §7.1 Action Timeout (2 behaviors)

| #   | Behavior                                                  | Test                     |
| --- | --------------------------------------------------------- | ------------------------ |
| 1   | State with `timeoutMs: 500` + slow action → timeout error | `state timeout → error`  |
| 2   | State without `timeoutMs` → no artificial timeout         | `no timeout → unbounded` |

### §7.2 Machine-Level Timeout (1 behavior)

| #   | Behavior                                                                | Test                      |
| --- | ----------------------------------------------------------------------- | ------------------------- |
| 1   | `run(def, input, { timeoutMs: 2000 })` → entire machine errors after 2s | `machine timeout → error` |

> Note: Machine-level timeout is a runner option, not an API parameter. This test
> requires registering a custom action that uses the runner directly, or verifying
> via the existing infrastructure. If the API doesn't expose `timeoutMs`, this test
> may need to be an in-process unit test only.

### §7.3 Max Depth (3 behaviors)

| #   | Behavior                                         | Test                                |
| --- | ------------------------------------------------ | ----------------------------------- |
| 1   | Chain exceeding `MAX_MACHINE_DEPTH` (10) → error | `depth 11 → error`                  |
| 2   | Depth 10 is allowed                              | `depth 10 → allowed`                |
| 3   | Error identifies depth limit                     | `depth error → descriptive message` |

---

## Test Structure

```typescript
// server/src/__e2e__/04-errors-timeouts.e2e.test.ts

describe('§6 — Error Handling', () => {
  describe('§6.1 Action Failure', () => {
    it('action that throws → machine reaches error terminal state');
    it('error instance has descriptive error field');
    it('error instance has status "error"');
  });

  describe('§6.2 Illegal Transition', () => {
    it('action returns nextState not in transitions → machine errors');
    it('error message identifies the illegal from→to transition');
  });

  describe('§6.3 Data Validation', () => {
    it('stateData failing target state dataSchema → machine errors');
    it('error includes schema validation details');
  });

  describe('§6.4 Middleware Error Propagation', () => {
    it('beforeTransition middleware failure → machine errors');
    it('middleware onError hooks fire (observable via logs)');
  });
});

describe('§7 — Timeouts & Safety Limits', () => {
  describe('§7.1 Action Timeout', () => {
    it('state with timeoutMs: 500 and slow delay → timeout error');
    it('state without timeoutMs allows long-running action');
  });

  describe('§7.2 Machine-Level Timeout', () => {
    it('machine-level timeoutMs causes error if exceeded');
  });

  describe('§7.3 Max Depth', () => {
    it('child chain at depth 10 → allowed');
    it('child chain at depth 11 → DefinitionError');
    it('error message identifies depth limit');
  });
});
```

---

## Fixtures Needed

```typescript
// Action failure: use a definition where the action produces an error
// Approach: Use `http-request` with an unreachable URL, or register a
// custom test action that always fails.
const ERROR_ACTION_DEF = {
  name: 'e2e-action-failure',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'will_fail',
  states: {
    will_fail: { name: 'will_fail', type: 'action', actionId: 'test-always-fail' },
    completed: { name: 'completed', type: 'terminal' },
    cancelled: { name: 'cancelled', type: 'terminal' },
    error: { name: 'error', type: 'terminal' },
  },
  transitions: [{ from: 'will_fail', to: 'completed' }],
};

// State timeout: delay >> timeoutMs
const TIMEOUT_DEF = {
  name: 'e2e-timeout',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'slow_state',
  states: {
    slow_state: {
      name: 'slow_state',
      type: 'action',
      actionId: 'delay',
      timeoutMs: 200,
    },
    completed: { name: 'completed', type: 'terminal' },
    cancelled: { name: 'cancelled', type: 'terminal' },
    error: { name: 'error', type: 'terminal' },
  },
  transitions: [{ from: 'slow_state', to: 'completed' }],
};

// Data validation: state with dataSchema
const DATA_SCHEMA_DEF = {
  name: 'e2e-data-validation',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'produce_bad_data',
  states: {
    produce_bad_data: { name: 'produce_bad_data', type: 'action', actionId: 'log-message' },
    validate_data: {
      name: 'validate_data',
      type: 'action',
      actionId: 'log-message',
      dataSchema: {
        type: 'object',
        properties: { score: { type: 'number' } },
        required: ['score'],
      },
    },
    completed: { name: 'completed', type: 'terminal' },
    cancelled: { name: 'cancelled', type: 'terminal' },
    error: { name: 'error', type: 'terminal' },
  },
  transitions: [
    { from: 'produce_bad_data', to: 'validate_data' },
    { from: 'validate_data', to: 'completed' },
  ],
};
```

---

## Custom Test Actions

Register these in the test handler setup:

```typescript
// Always-fail action
registry.register(
  'test-always-fail',
  (ctx) =>
    Effect.fail(
      mkActionError({
        actionId: 'test-always-fail',
        stateName: ctx.stateName,
        cause: 'Intentional test failure',
      }),
    ),
  { description: 'Test action that always fails' },
);

// Illegal-transition action (returns nextState not in transitions)
registry.register(
  'test-illegal-transition',
  (ctx) => Effect.succeed({ nextState: 'nonexistent-state', data: {} }),
  { description: 'Test action returning illegal nextState' },
);
```

---

## Key Assertions

- **Action failure**: `status === 'error'`, `error` field contains message, `currentState === 'error'`
- **Illegal transition**: `status === 'error'`, `error` contains "from" and "to" state names
- **Data validation**: `status === 'error'`, error mentions schema validation
- **State timeout**: `delayMs: 60000` + `timeoutMs: 200` → error within ~1s
- **No timeout**: `delayMs: 2000` without `timeoutMs` → completes normally (poll with 5s timeout)
- **Max depth**: Create a chain of definitions A → B → ... → K (11 deep); starting A → error

---

## Notes

- The `machine_completed` event assertion (§6.1 behavior 4) is deferred to Task 44
  (WebSocket tests) since observing events requires a WS client.
- Machine-level `timeoutMs` may only be testable at the runner level (not exposed
  as an API parameter). Verify in existing unit tests or add a runner-level test.
- §6.4 middleware error propagation requires the full middleware stack (not empty).
  Use the `makeE2ETestLayer()` from Task 34 which includes all default middleware.

---

## Behavior Spec Coverage

- §6 Machine Execution — Error Handling (§6.1–§6.4) — 10 behaviors
- §7 Timeouts & Safety Limits (§7.1–§7.3) — 6 behaviors

---

## Validation Checklist

- [x] All 4 §6.1 action failure behaviors verified (event deferred)
- [x] Both §6.2 illegal transition behaviors verified
- [x] Both §6.3 data validation behaviors verified
- [x] Both §6.4 middleware error behaviors verified
- [x] Both §7.1 action timeout behaviors verified
- [x] §7.2 machine-level timeout verified (or documented as unit-only)
- [x] All 3 §7.3 max depth behaviors verified
- [x] Test file: `server/src/__e2e__/04-errors-timeouts.e2e.test.ts`
