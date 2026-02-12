# Task 39 — Server E2E: Child Machines & Parallel Children

> **Phase**: 7 (Server E2E Validation)
> **Depends on**: Task 34 (infrastructure), Task 37 (linear execution)
> **Blocks**: None
> **Validates**: §8 Child Machine — Single, §9 Parallel Children

---

## Objective

Validate all 30 behaviors from §8 (Child Machine) and §9 (Parallel Children) via
HTTP requests. These tests confirm parent/child spawning, input mapping, child
failure handling, context propagation, parallel execution modes, and result
aggregation.

---

## Behavior Checklist → Test Mapping

### §8.1 Spawning & Completion (7 behaviors)

| #   | Behavior                                                           | Test                              |
| --- | ------------------------------------------------------------------ | --------------------------------- |
| 1   | Child instance appears in `GET /instances` with `parentInstanceId` | `child has parentInstanceId`      |
| 2   | Parent `status` becomes `'waiting_for_child'` while child runs     | `parent waiting_for_child`        |
| 3   | Parent `childInstanceId` set to child's ID while waiting           | `parent childInstanceId set`      |
| 4   | Child completes → parent `stateData` = child's `MachineResult`     | `child result → parent stateData` |
| 5   | Parent `actionId` runs after child completes                       | `parent action runs post-child`   |
| 6   | Parent continues based on action's `TransitionResult`              | `parent continues after child`    |
| 7   | Both parent and child end as `completed`                           | `both completed`                  |

### §8.2 Input Mapping (3 behaviors)

| #   | Behavior                                          | Test                          |
| --- | ------------------------------------------------- | ----------------------------- |
| 1   | `childInputMapping` JSONPath extracts child input | `child input mapping works`   |
| 2   | Child receives extracted value as `machineInput`  | `child receives mapped input` |
| 3   | Invalid JSONPath → parent errors                  | `bad JSONPath → error`        |

### §8.3 Child Failure (2 behaviors)

| #   | Behavior                                                           | Test                                   |
| --- | ------------------------------------------------------------------ | -------------------------------------- |
| 1   | Child errors → parent action receives `MachineResult` with `error` | `child error → parent receives result` |
| 2   | Parent can inspect child error and decide transition               | `parent routes based on child error`   |

### §8.4 Context (3 behaviors)

| #   | Behavior                                                                   | Test                                    |
| --- | -------------------------------------------------------------------------- | --------------------------------------- |
| 1   | Child `ctx.parentContext` has `parentInstanceId` and `parentStateName`     | `child parentContext populated`         |
| 2   | Child's `TransitionRecord` includes `childInstanceId`, `childDefinitionId` | `child transition records have ids`     |
| 3   | Parent's `TransitionRecord` includes `childInstanceId`                     | `parent transition has childInstanceId` |

### §9.1 All Succeed (6 behaviors)

| #   | Behavior                                                          | Test                                 |
| --- | ----------------------------------------------------------------- | ------------------------------------ |
| 1   | 3 children spawned, all visible in `GET /instances`               | `3 children spawned`                 |
| 2   | Parent `childInstanceIds` keyed by child `key`                    | `parent childInstanceIds keyed`      |
| 3   | All 3 children run and complete                                   | `all children complete`              |
| 4   | Parent `stateData` is `ParallelChildrenResult` with keyed results | `parent gets ParallelChildrenResult` |
| 5   | Parent `actionId` runs after all children complete                | `parent action runs post-parallel`   |
| 6   | Each child result has `status: 'completed'`                       | `each child completed`               |

### §9.2 `all_or_interrupt` Mode (4 behaviors)

| #   | Behavior                                            | Test                                      |
| --- | --------------------------------------------------- | ----------------------------------------- |
| 1   | One child errors → remaining interrupted            | `interrupt: one error → others cancelled` |
| 2   | Interrupted children → `status: 'cancelled'`        | `interrupt: cancelled status`             |
| 3   | Parent receives partial results (error + cancelled) | `interrupt: partial results`              |
| 4   | Parent can route to error handling state            | `interrupt: parent routes to error`       |

### §9.3 `all_settled` Mode (3 behaviors)

| #   | Behavior                                          | Test                       |
| --- | ------------------------------------------------- | -------------------------- |
| 1   | One child errors → others continue                | `settled: others finish`   |
| 2   | Parent receives all results (completed + errored) | `settled: mixed results`   |
| 3   | No child interrupted                              | `settled: no interruption` |

### §9.4 Input Mapping (2 behaviors)

| #   | Behavior                                           | Test                        |
| --- | -------------------------------------------------- | --------------------------- |
| 1   | Each child's `inputMapping` extracts correct input | `parallel input mapping`    |
| 2   | Different children receive different inputs        | `parallel different inputs` |

### §9.5 Key Uniqueness (2 behaviors)

| #   | Behavior                                       | Test                      |
| --- | ---------------------------------------------- | ------------------------- |
| 1   | Results keyed by `ChildSpawnDefinition.key`    | `results keyed correctly` |
| 2   | Action can identify which child → which result | `key → result mapping`    |

---

## Test Structure

```typescript
// server/src/__e2e__/05-child-machines.e2e.test.ts

describe('§8 — Child Machine (Single)', () => {
  describe('§8.1 Spawning & Completion', () => {
    it('child instance created with parentInstanceId pointing to parent');
    it('parent enters waiting_for_child while child runs');
    it('parent childInstanceId set during wait');
    it('child completes → parent stateData receives MachineResult');
    it('parent actionId runs after child completion');
    it('parent continues to next state based on action result');
    it('both parent and child end as completed');
  });

  describe('§8.2 Input Mapping', () => {
    it('childInputMapping JSONPath extracts child input correctly');
    it('child receives extracted value as machineInput');
    it('invalid JSONPath expression → parent errors');
  });

  describe('§8.3 Child Failure', () => {
    it('child error → parent receives MachineResult with status error');
    it('parent action routes based on child error');
  });

  describe('§8.4 Context', () => {
    it('child parentContext has parentInstanceId and parentStateName');
    it('child TransitionRecord includes childInstanceId and childDefinitionId');
    it('parent TransitionRecord for child_machine state has childInstanceId');
  });
});

describe('§9 — Parallel Children', () => {
  describe('§9.1 All Succeed', () => {
    it('3 children spawned and visible in GET /instances');
    it('parent childInstanceIds keyed by child key');
    it('all 3 children complete');
    it('parent stateData is ParallelChildrenResult with keyed results');
    it('parent actionId runs after all children complete');
    it('each child result has status completed');
  });

  describe('§9.2 all_or_interrupt Mode', () => {
    it('one child errors → remaining children cancelled');
    it('interrupted children have status cancelled');
    it('parent receives partial results (error + cancelled)');
    it('parent can route to error-handling state');
  });

  describe('§9.3 all_settled Mode', () => {
    it('one child errors → other children still finish');
    it('parent receives all results: completed + errored');
    it('no child is interrupted');
  });

  describe('§9.4 Input Mapping', () => {
    it('each child inputMapping extracts correct input from parent context');
    it('different children receive different inputs');
  });

  describe('§9.5 Key Uniqueness', () => {
    it('results correctly keyed by ChildSpawnDefinition.key');
    it('action can identify which child produced which result by key');
  });
});
```

---

## Fixtures Needed

```typescript
// Simple child that completes
const CHILD_DEF = {
  name: 'e2e-child',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'child_work',
  states: {
    child_work: { name: 'child_work', type: 'action', actionId: 'log-message' },
    completed: { name: 'completed', type: 'terminal' },
    cancelled: { name: 'cancelled', type: 'terminal' },
    error: { name: 'error', type: 'terminal' },
  },
  transitions: [{ from: 'child_work', to: 'completed' }],
};

// Child that always errors (for failure tests)
const ERROR_CHILD_DEF = {
  ...CHILD_DEF,
  name: 'e2e-error-child',
  states: {
    ...CHILD_DEF.states,
    child_work: { name: 'child_work', type: 'action', actionId: 'test-always-fail' },
  },
};

// Parent with single child_machine state
const makeParentDef = (childDefId: string) => ({
  name: 'e2e-parent',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'spawn_child',
  states: {
    spawn_child: {
      name: 'spawn_child',
      type: 'child_machine',
      actionId: 'test-forward-result',
      childMachineDefId: childDefId,
      childInputMapping: '$.machineInput',
    },
    completed: { name: 'completed', type: 'terminal' },
    cancelled: { name: 'cancelled', type: 'terminal' },
    error: { name: 'error', type: 'terminal' },
  },
  transitions: [
    { from: 'spawn_child', to: 'completed' },
    { from: 'spawn_child', to: 'error' },
  ],
});

// Parent with parallel_children
const makeParallelDef = (childIds: string[], mode = 'all_settled') => ({
  name: 'e2e-parallel-parent',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'spawn_parallel',
  states: {
    spawn_parallel: {
      name: 'spawn_parallel',
      type: 'parallel_children',
      actionId: 'test-forward-result',
      children: childIds.map((id, i) => ({
        key: `child_${i}`,
        machineDefId: id,
        inputMapping: '$.machineInput',
      })),
      parallelMode: mode,
    },
    completed: { name: 'completed', type: 'terminal' },
    cancelled: { name: 'cancelled', type: 'terminal' },
    error: { name: 'error', type: 'terminal' },
  },
  transitions: [
    { from: 'spawn_parallel', to: 'completed' },
    { from: 'spawn_parallel', to: 'error' },
  ],
});
```

---

## Custom Test Actions

```typescript
// Forward result action: routes to 'completed' if child succeeded, 'error' if not
registry.register(
  'test-forward-result',
  (ctx) =>
    Effect.succeed({
      nextState:
        ctx.stateData?.status === 'completed' || ctx.stateData?.results ? 'completed' : 'error',
      data: ctx.stateData,
    }),
  { description: 'Forwards child/parallel result to next state' },
);
```

---

## Key Assertions

- **Parent waiting**: Poll parent until `status === 'waiting_for_child'`; check `childInstanceId` is set
- **Child list**: `GET /instances?parentInstanceId=<parentId>` returns child instances
- **Both completed**: After poll, both parent and child `status === 'completed'`
- **Parallel results**: Parent's final `stateData` contains `results` keyed by child key
- **Interrupt mode**: One errored child → others have `status: 'cancelled'`
- **Settled mode**: One errored child → others still `status: 'completed'`
- **Input mapping**: Verify child's `machineInput` matches JSONPath extraction

---

## Behavior Spec Coverage

- §8 Child Machine — Single (§8.1–§8.4) — 15 behaviors
- §9 Parallel Children (§9.1–§9.5) — 17 behaviors

---

## Validation Checklist

- [x] All 7 §8.1 spawning behaviors verified
- [x] All 3 §8.2 input mapping behaviors verified
- [x] Both §8.3 child failure behaviors verified
- [x] All 3 §8.4 context behaviors verified
- [x] All 6 §9.1 all-succeed behaviors verified
- [x] All 4 §9.2 all_or_interrupt behaviors verified
- [x] All 3 §9.3 all_settled behaviors verified
- [x] Both §9.4 input mapping behaviors verified
- [x] Both §9.5 key uniqueness behaviors verified
- [x] Test file: `server/src/__e2e__/05-child-machines.e2e.test.ts`
