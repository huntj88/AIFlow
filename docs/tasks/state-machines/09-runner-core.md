# Task 09 — Machine Runner — Core Linear Execution Loop

> **Phase**: 1 (Core Engine)
> **Depends on**: Tasks 01–08 (all foundation tasks)
> **Blocks**: Tasks 10–16 (runner extensions), Task 17 (tests)

---

## Objective

Implement the core `StateMachineRunner` Effect Service — the main execution engine for state machines. This task covers the **linear execution path** only: `action` type states running in sequence. Child machine spawning, cancellation, suspension/resume, and PubSub are added in subsequent tasks. The runner implements the state loop, middleware integration, transition validation, persistence checkpoints, and `MachineResult` resolution.

---

## Steps

### 1. Create `server/src/machines/StateMachineRunner.ts`

Define as an Effect Service (Tag + Layer):

```typescript
interface StateMachineRunner {
  run(
    definition: StateMachineDefinition,
    input: unknown,
    opts?: RunOptions,
  ): Effect.Effect<MachineResult, MachineError>;
  // resume(), suspendAll(), cancel() added in later tasks
}

interface RunOptions {
  timeoutMs?: number; // Machine-level timeout
  parentInstanceId?: string; // If this is a child machine
  parentStateName?: string; // Parent state that spawned this child
  depth?: number; // Current nesting depth (for MAX_MACHINE_DEPTH check)
}
```

#### Dependencies (injected via Layer)

- `MachineStore` — persist instance state
- `ActionRegistry` — look up action functions
- `ArtifactStoreFactory` — create scoped artifact stores
- `MiddlewareExecutor` — run before/after hooks
- Middleware array — `TransitionMiddleware[]`

### 2. Implement `run()` — the state loop

Follow the spec §3 runner diagram:

1. **Validate definition** at runtime via `DefinitionValidator` (mode: `'runtime'`)
2. **Validate input** against `definition.inputSchema` using `ajv`
3. **Create `MachineInstance`** record via `MachineStore.saveInstance`:
   - `id`: UUID, `definitionId`, `definitionVersion`, `status: 'running'`
   - `currentState: definition.initialState`, `stateData: input`
   - `input`, `history: []`, `logs: []`, `artifacts: []`
   - **Checkpoint 1**: Instance persisted immediately after creation
4. **Enter the state loop**:

```
while currentState is NOT terminal:
  a. Checkpoint 2: Persist currentState + stateData BEFORE action runs
  b. Create scoped StateLogger and ArtifactStore for this state
  c. Build ActionContext with all ctx fields
  d. Run middleware beforeTransition
  e. Look up actionId in ActionRegistry
  f. Execute the action → get TransitionResult
     - If action fails → transition to 'error' terminal
  g. Validate nextState is a legal transition per transitions[]
     - If illegal → fail with DefinitionError
  h. Run middleware afterTransition
  i. Record TransitionRecord in history[]
  j. Collect log entries from StateLogger
  k. Checkpoint 3: Persist history + logs + advance currentState to nextState + stateData
  l. If nextState is terminal → resolve MachineResult
     - Checkpoint 4: Persist final status + output/error
  m. Else → continue loop with nextState
```

### 3. Implement transition validation

After an action returns `TransitionResult`, verify that `nextState` is a valid transition from `currentState` per the definition's `transitions[]`:

```typescript
const isLegalTransition = (from: string, to: string, transitions: TransitionRule[]): boolean =>
  transitions.some((t) => t.from === from && t.to === to);
```

If illegal, fail with `DefinitionError` identifying the illegal transition.

### 4. Implement terminal state resolution

When the loop reaches a terminal state:

- `completed` → `MachineResult` with `status: 'completed'`, `output` = last transition's `data`
- `error` → `MachineResult` with `status: 'error'`, `error` = error message
- `cancelled` → `MachineResult` with `status: 'cancelled'`

Update instance: `status`, `currentState` = terminal state name, `output`/`error`, `updatedAt`.

### 5. Handle action failures

If an action's Effect fails:

- Catch the `ActionError`
- Run middleware `onError` hooks
- Transition the machine to the `error` terminal state
- Record the error in the instance

### 6. Build the Layer

```typescript
export const StateMachineRunnerLive = Layer.effect(
  StateMachineRunner,
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const registry = yield* ActionRegistry;
    const artifactFactory = yield* ArtifactStoreFactory;
    // ... construct runner
  }),
);
```

### 7. Wire `ActionContext` correctly

Each action receives:

- `machineInstanceId` — the running instance ID
- `machineDefId` — the definition ID
- `stateName` — current state name
- `stateData` — data carried into this state
- `machineInput` — original input to the machine
- `parentContext` — populated if this is a child machine (Task 11)
- `logger` — scoped `StateLogger` for this state
- `artifacts` — scoped `ArtifactStore` for this instance

---

## Behavior Spec Coverage

- §4.1 — Start and complete: instance created with `running` status; linear machine runs to `completed`
- §4.1 — On completion: `status: 'completed'`, `output` populated
- §4.2 — Initial state action receives `machineInput`; `stateData` in first state is empty/undefined
- §4.2 — Action returns `{ nextState, data }` → next state receives `data` as `stateData`
- §4.2 — Each action receives correct `ctx.stateName`, `ctx.machineInstanceId`, `ctx.machineDefId`
- §4.4 — Transition history: ordered `TransitionRecord` array; each has `fromState`, `toState`, `timestamp`, `durationMs`, `actionId`
- §4.5 — Log entries collected during execution
- §5 — Branching: action returns different `nextState` based on `stateData` → machine follows different paths
- §6.2 — Illegal transition: action returns invalid `nextState` → `DefinitionError`
- §13 — Checkpoints 1–4 implemented

---

## Validation Checklist

- [ ] `server/src/machines/StateMachineRunner.ts` exists and compiles
- [ ] `run()` method creates instance, validates definition and input, executes state loop
- [ ] State loop follows the spec: middleware → action → validate transition → record → checkpoint
- [ ] Terminal state resolution produces correct `MachineResult`
- [ ] Transition validation rejects illegal `nextState` values
- [ ] Action failures transition to error terminal state
- [ ] All 4 persistence checkpoints are implemented
- [ ] `ActionContext` is wired with all required fields
- [ ] Runner is an Effect Service with Layer dependencies
- [ ] `pnpm --filter @aiflow/server run build` succeeds
