# Task 37 — Server E2E: Linear Execution & Branching

> **Phase**: 7 (Server E2E Validation)
> **Depends on**: Task 34 (infrastructure)
> **Blocks**: None
> **Validates**: §4 Machine Execution — Linear Flow, §5 Machine Execution — Branching

---

## Objective

Validate all 22 behaviors from §4 (Linear Flow) and §5 (Branching) via HTTP
requests. These tests confirm that the state machine runner correctly executes
linear and branching workflows, propagates data through the state chain, validates
input, and records transition history and logs.

---

## Behavior Checklist → Test Mapping

### §4.1 Start & Complete (5 behaviors)

| #   | Behavior                                                         | Test                               |
| --- | ---------------------------------------------------------------- | ---------------------------------- |
| 1   | `POST /instances` with valid def + input → 201 with instance ID  | `start → 201 with id`              |
| 2   | Returned instance has `status: 'running'` and `currentState` set | `start → running status`           |
| 3   | Simple linear machine runs to `completed`                        | `linear 3-state → completed`       |
| 4   | `GET /instances/:id` shows `completed` with populated `output`   | `completed → output populated`     |
| 5   | `output` matches final action's transition data                  | `output matches final action data` |

### §4.2 State Data Flow (4 behaviors)

| #   | Behavior                                                                          | Test                                  |
| --- | --------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | Initial state receives `ctx.machineInput` matching start input                    | `data flow: machineInput passed`      |
| 2   | First state has `undefined`/empty `stateData`                                     | `data flow: first state no stateData` |
| 3   | Action's `{ nextState, data }` → next state's `stateData`                         | `data flow: data propagated`          |
| 4   | Each action receives correct `ctx.stateName`, `machineInstanceId`, `machineDefId` | `data flow: ctx fields correct`       |

### §4.3 Input Validation (3 behaviors)

| #   | Behavior                                                              | Test                                  |
| --- | --------------------------------------------------------------------- | ------------------------------------- |
| 1   | Input violating `inputSchema` → validation error, no instance created | `input validation: bad input → error` |
| 2   | Input satisfying `inputSchema` → proceeds normally                    | `input validation: good input → ok`   |
| 3   | Non-existent definition ID → 404                                      | `start with bad defId → 404`          |

### §4.4 Transition History (4 behaviors)

| #   | Behavior                                                                      | Test                      |
| --- | ----------------------------------------------------------------------------- | ------------------------- |
| 1   | `GET /instances/:id/history` → ordered `TransitionRecord[]`                   | `history: ordered array`  |
| 2   | Each record has `fromState`, `toState`, `timestamp`, `durationMs`, `actionId` | `history: record shape`   |
| 3   | History length = number of transitions                                        | `history: correct length` |
| 4   | Chronological order                                                           | `history: chronological`  |

### §4.5 Logs (5 behaviors)

| #   | Behavior                                                    | Test                    |
| --- | ----------------------------------------------------------- | ----------------------- |
| 1   | `GET /instances/:id/logs` returns all `LogEntry` records    | `logs: returns entries` |
| 2   | Each entry has `stateName`, `level`, `message`, `timestamp` | `logs: entry shape`     |
| 3   | `?state=X` filters by state                                 | `logs: state filter`    |
| 4   | `ctx.logger.info(...)` → `level: 'info'`                    | `logs: info level`      |
| 5   | `ctx.logger.error(...)` → `level: 'error'`                  | `logs: error level`     |

### §5 Branching (4 behaviors)

| #   | Behavior                                                 | Test                                     |
| --- | -------------------------------------------------------- | ---------------------------------------- |
| 1   | Action inspects `stateData` and routes differently       | `branching: data-dependent routing`      |
| 2   | `conditional-branch` routes based on condition           | `branching: conditional-branch action`   |
| 3   | Machine reaches `completed` via multiple valid paths     | `branching: multiple paths to completed` |
| 4   | Machine can reach `error` terminal from any non-terminal | `branching: route to error terminal`     |

---

## Test Structure

```typescript
// server/src/__e2e__/03-linear-execution.e2e.test.ts

describe('§4 — Machine Execution: Linear Flow', () => {
  describe('§4.1 Start & Complete', () => {
    it('POST /instances with valid definition + input → 201 with instance ID');
    it('returned instance has status "running" and currentState set');
    it('3-state linear machine (init → process → completed) runs to completed');
    it('GET /instances/:id shows completed with populated output');
    it('output matches what the final action returned');
  });

  describe('§4.2 State Data Flow', () => {
    it('initial state receives machineInput matching start input (verified via logs)');
    it('first state stateData is undefined (no prior transition)');
    it('action data propagates as next state stateData (verified via history)');
    it('actions receive correct stateName, machineInstanceId, machineDefId');
  });

  describe('§4.3 Input Validation', () => {
    it('input violating inputSchema → validation error, machine never created');
    it('input satisfying inputSchema → proceeds normally');
    it('non-existent definition ID → 404');
  });

  describe('§4.4 Transition History', () => {
    it('GET /instances/:id/history returns ordered TransitionRecord array');
    it('each record has fromState, toState, timestamp, durationMs, actionId');
    it('history length equals number of transitions taken');
    it('history records are in chronological order');
  });

  describe('§4.5 Logs', () => {
    it('GET /instances/:id/logs returns all LogEntry records');
    it('each log entry has stateName, level, message, timestamp');
    it('?state=X filters to only logs from state X');
    it('ctx.logger.info(...) produces level: info entries');
    it('ctx.logger.error(...) produces level: error entries');
  });
});

describe('§5 — Machine Execution: Branching', () => {
  it('conditional-branch routes to trueState when condition met');
  it('conditional-branch routes to falseState when condition not met');
  it('machine reaches completed via path A and via path B');
  it('machine can reach error terminal from any non-terminal state');
});
```

---

## Fixtures Needed

```typescript
// Linear 3-state: init(log-message) → process(conditional-branch) → completed
const LINEAR_3STATE = {
  name: 'e2e-linear-3',
  inputSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] },
  outputSchema: { type: 'object' },
  initialState: 'init',
  states: {
    init: { name: 'init', type: 'action', actionId: 'log-message' },
    process: { name: 'process', type: 'action', actionId: 'conditional-branch' },
    completed: { name: 'completed', type: 'terminal' },
    cancelled: { name: 'cancelled', type: 'terminal' },
    error: { name: 'error', type: 'terminal' },
  },
  transitions: [
    { from: 'init', to: 'process' },
    { from: 'process', to: 'completed' },
    { from: 'process', to: 'error' },
  ],
};

// Branching: check → success | failure
const BRANCHING_DEF = {
  name: 'e2e-branching',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'check',
  states: {
    check: { name: 'check', type: 'action', actionId: 'conditional-branch' },
    success: { name: 'success', type: 'action', actionId: 'log-message' },
    completed: { name: 'completed', type: 'terminal' },
    cancelled: { name: 'cancelled', type: 'terminal' },
    error: { name: 'error', type: 'terminal' },
  },
  transitions: [
    { from: 'check', to: 'success' },
    { from: 'check', to: 'error' },
    { from: 'success', to: 'completed' },
  ],
};

// Strict input schema for validation testing
const STRICT_SCHEMA_DEF = {
  ...LINEAR_3STATE,
  name: 'e2e-strict-schema',
  inputSchema: {
    type: 'object',
    properties: { value: { type: 'number', minimum: 0 } },
    required: ['value'],
    additionalProperties: false,
  },
};
```

---

## Key Assertions

- **Data flow**: Verify via logs/history that `machineInput` was received, `stateData` was propagated
- **History shape**: Each record has all required fields; `durationMs` ≥ 0; `timestamp` is ISO string
- **Log filtering**: `?state=X` returns only entries where `stateName === X`
- **Branching**: Same definition, different inputs → different terminal states
- **Input validation**: POST returns 400 (not 201) when input violates schema; instance is never created

---

## Behavior Spec Coverage

- §4 Machine Execution — Linear Flow (§4.1–§4.5) — 21 behaviors
- §5 Machine Execution — Branching — 4 behaviors

---

## Validation Checklist

- [ ] All 5 §4.1 behaviors verified
- [ ] All 4 §4.2 data flow behaviors verified
- [ ] All 3 §4.3 input validation behaviors verified
- [ ] All 4 §4.4 transition history behaviors verified
- [ ] All 5 §4.5 log behaviors verified
- [ ] All 4 §5 branching behaviors verified
- [ ] Test file: `server/src/__e2e__/03-linear-execution.e2e.test.ts`
