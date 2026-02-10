# Task 35 — Server E2E: Definition CRUD & Validation

> **Phase**: 7 (Server E2E Validation)
> **Depends on**: Task 34 (infrastructure)
> **Blocks**: None
> **Validates**: §1 Definition CRUD, §2 Definition Validation

---

## Objective

Validate all 28 behaviors from §1 (Definition CRUD) and §2 (Definition Validation)
via HTTP requests. These tests confirm that the server correctly creates, reads,
updates, deletes, and validates machine definitions.

---

## Behavior Checklist → Test Mapping

### §1.1 Create (4 behaviors)

| #   | Behavior                                              | Test                                |
| --- | ----------------------------------------------------- | ----------------------------------- |
| 1   | `POST /definitions` returns 201 with generated `id`   | `create → 201 with id`              |
| 2   | `version: 1`, populated `createdAt` / `updatedAt`     | `create → version 1 and timestamps` |
| 3   | Created definition appears in `GET /definitions` list | `create → appears in list`          |
| 4   | Same name succeeds (names not unique)                 | `create → duplicate name allowed`   |

### §1.2 Read (3 behaviors)

| #   | Behavior                                 | Test                     |
| --- | ---------------------------------------- | ------------------------ |
| 5   | `GET /definitions/:id` returns full JSON | `get by id → full JSON`  |
| 6   | Non-existent ID → 404                    | `get non-existent → 404` |
| 7   | `GET /definitions` returns array         | `list → array`           |

### §1.3 Update (4 behaviors)

| #   | Behavior                                   | Test                           |
| --- | ------------------------------------------ | ------------------------------ |
| 8   | `PUT /definitions/:id` returns updated def | `update → returns updated`     |
| 9   | Version increments monotonically           | `update → version incremented` |
| 10  | `updatedAt` refreshed                      | `update → updatedAt refreshed` |
| 11  | Non-existent ID → 404                      | `update non-existent → 404`    |

### §1.4 Delete (3 behaviors)

| #   | Behavior                                   | Test                              |
| --- | ------------------------------------------ | --------------------------------- |
| 12  | `DELETE` returns success                   | `delete → 204`                    |
| 13  | Deleted def → 404 on GET, absent from list | `delete → gone from GET and list` |
| 14  | Non-existent ID → 404                      | `delete non-existent → 404`       |

### §2.1 Structural Rules (7 behaviors)

| #   | Behavior                                    | Test                                   |
| --- | ------------------------------------------- | -------------------------------------- |
| R1  | `initialState` not in `states` → reject     | `validation: bad initialState`         |
| R2  | Missing terminal states → reject            | `validation: missing terminals`        |
| R3  | Transition from terminal → reject           | `validation: transition from terminal` |
| R4  | Transition refs non-existent state → reject | `validation: dangling transition ref`  |
| R5  | Non-terminal with zero outgoing → reject    | `validation: dead-end state`           |
| R6  | Unreachable non-terminal state → reject     | `validation: orphan state`             |
| R7  | State name ≠ key → reject                   | `validation: name mismatch`            |

### §2.2 State Type Rules (4 behaviors)

| #   | Behavior                                                | Test                                   |
| --- | ------------------------------------------------------- | -------------------------------------- |
| R8  | Unknown `actionId` on `action` state → advisory at save | `validation: unknown action (warning)` |
| R9  | `child_machine` missing required fields → reject        | `validation: incomplete child_machine` |
| R10 | `parallel_children` missing/empty → reject              | `validation: bad parallel_children`    |
| R11 | Terminal with `actionId`/`children` → reject            | `validation: terminal has action`      |

### §2.3 Referential Integrity (3 behaviors)

| #   | Behavior                               | Test                               |
| --- | -------------------------------------- | ---------------------------------- |
| R12 | Cyclic child references → reject       | `validation: cyclic child refs`    |
| R13 | Invalid JSON Schema → reject           | `validation: invalid schema doc`   |
| R14 | Duplicate parallel child keys → reject | `validation: duplicate child keys` |

### §2.4 Validation Error Response (2 behaviors)

| #   | Behavior                                                 | Test                                |
| --- | -------------------------------------------------------- | ----------------------------------- |
| 1   | Returns `DefinitionError` with `message` and `details[]` | `error format: message + details`   |
| 2   | Multiple violations reported together                    | `error format: multiple violations` |

---

## Test Structure

```typescript
// server/src/__e2e__/01-definitions.e2e.test.ts

describe('§1 — Definition CRUD', () => {
  describe('§1.1 Create', () => {
    it('POST /definitions with valid body → 201 with generated id');
    it('created definition has version: 1 and populated timestamps');
    it('created definition appears in GET list');
    it('creating with duplicate name succeeds');
  });

  describe('§1.2 Read', () => {
    it('GET /definitions/:id returns full definition JSON');
    it('GET /definitions/:id for non-existent ID → 404');
    it('GET /definitions returns array of all definitions');
  });

  describe('§1.3 Update', () => {
    it('PUT /definitions/:id returns updated definition');
    it('update increments version monotonically');
    it('update refreshes updatedAt');
    it('PUT on non-existent ID → 404');
  });

  describe('§1.4 Delete', () => {
    it('DELETE /definitions/:id returns 204');
    it('deleted definition → 404 on GET and absent from list');
    it('DELETE on non-existent ID → 404');
  });
});

describe('§2 — Definition Validation', () => {
  describe('§2.1 Structural Rules', () => {
    it('Rule 1: initialState not in states → 400');
    it('Rule 2: missing required terminal states → 400');
    it('Rule 3: transition from terminal state → 400');
    it('Rule 4: transition references non-existent state → 400');
    it('Rule 5: non-terminal with zero outgoing transitions → 400');
    it('Rule 6: unreachable non-terminal state → 400');
    it('Rule 7: state name does not match key → 400');
  });

  describe('§2.2 State Type Rules', () => {
    it('Rule 8: action state with unknown actionId → save succeeds (advisory)');
    it('Rule 9: child_machine missing actionId/childMachineDefId/childInputMapping → 400');
    it('Rule 10: parallel_children missing actionId or empty children → 400');
    it('Rule 11: terminal state with actionId → 400');
  });

  describe('§2.3 Referential Integrity', () => {
    it('Rule 12: cyclic childMachineDefId references → 400');
    it('Rule 13: invalid JSON Schema in inputSchema → 400');
    it('Rule 14: parallel_children with duplicate child keys → 400');
  });

  describe('§2.4 Validation Error Response', () => {
    it('returns DefinitionError with message and details[]');
    it('reports multiple violations together');
  });
});
```

---

## Fixtures Needed

```typescript
// Valid base definition (reusable)
const VALID_DEF = {
  name: 'test-def',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'start',
  states: {
    start: { name: 'start', type: 'action', actionId: 'log-message' },
    completed: { name: 'completed', type: 'terminal' },
    cancelled: { name: 'cancelled', type: 'terminal' },
    error: { name: 'error', type: 'terminal' },
  },
  transitions: [
    { from: 'start', to: 'completed' },
    { from: 'start', to: 'cancelled' },
    { from: 'start', to: 'error' },
  ],
};

// Rule 1: bad initialState
const BAD_INITIAL = { ...VALID_DEF, initialState: 'nonexistent' };

// Rule 2: missing terminals
const NO_TERMINALS = {
  ...VALID_DEF,
  states: { start: { name: 'start', type: 'action', actionId: 'log-message' } },
  transitions: [],
};

// Rule 3: transition from terminal
const TRANSITION_FROM_TERMINAL = {
  ...VALID_DEF,
  transitions: [...VALID_DEF.transitions, { from: 'completed', to: 'start' }],
};

// Rule 7: name mismatch
const NAME_MISMATCH = {
  ...VALID_DEF,
  states: {
    ...VALID_DEF.states,
    start: { name: 'wrong-name', type: 'action', actionId: 'log-message' },
  },
};

// Rule 11: terminal with action
const TERMINAL_WITH_ACTION = {
  ...VALID_DEF,
  states: {
    ...VALID_DEF.states,
    completed: { name: 'completed', type: 'terminal', actionId: 'log-message' },
  },
};

// Rule 13: invalid JSON Schema
const BAD_SCHEMA = { ...VALID_DEF, inputSchema: { type: 'invalid-type' } };

// Multiple violations
const MULTI_INVALID = {
  ...VALID_DEF,
  initialState: 'nonexistent',
  states: { start: { name: 'wrong', type: 'action', actionId: 'log-message' } },
  transitions: [],
};
```

---

## Key Assertions

- **201** for valid creates; **200** for valid updates; **204** for deletes
- **400** for all validation failures
- **404** for non-existent IDs
- Error response body has `{ message: string, details: string[] }`
- `details[]` length ≥ 1; for multi-violation tests, length ≥ 2
- `version` starts at 1 and increments by 1 on each PUT
- `metadata.updatedAt` is strictly greater after update

---

## Behavior Spec Coverage

- §1 Definition CRUD (§1.1 Create, §1.2 Read, §1.3 Update, §1.4 Delete) — 14 behaviors
- §2 Definition Validation (§2.1 Structural, §2.2 State Type, §2.3 Referential, §2.4 Error Response) — 16 behaviors

---

## Validation Checklist

- [ ] All 14 §1 CRUD behaviors have passing tests
- [ ] All 14 §2 validation rules have dedicated tests
- [ ] §2.4 error response format is verified
- [ ] Each test is independent (fresh handler per suite)
- [ ] Test file: `server/src/__e2e__/01-definitions.e2e.test.ts`
