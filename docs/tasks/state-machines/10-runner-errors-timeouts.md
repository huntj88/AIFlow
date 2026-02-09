# Task 10 — Machine Runner — Error Handling, Timeouts & Depth Limits

> **Phase**: 1 (Core Engine)
> **Depends on**: Task 09 (runner core)
> **Blocks**: Task 17 (tests)

---

## Objective

Extend the `StateMachineRunner` with robust error handling, per-state action timeouts (`timeoutMs`), machine-level timeouts, and maximum child machine depth enforcement (`MAX_MACHINE_DEPTH`). These are safety mechanisms that prevent runaway machines and provide clear error messages.

---

## Implementation Notes from Completed Tasks

> These details emerged from Tasks 01–05 and affect this task's implementation.

- **Error constructors** use the `mk` prefix: `mkActionError({ actionId, stateName, cause })`, `mkDefinitionError({ message, details })`, `mkValidationError({ message, path })` — imported from `'../machines/types.js'`.
- **Ajv CJS interop** for input validation against `inputSchema`: Use the same pattern from `DefinitionValidator.ts` — `import AjvModule from 'ajv'` with runtime `.default` normalization. Or share the ajv instance from the validator module.
- **`MachineStore.updateInstance`** signature: `updateInstance(id, patch: Partial<Omit<MachineInstance, 'id' | 'createdAt'>>)` — the store auto-refreshes `updatedAt`.

---

## Steps

### 1. Per-state action timeout (`timeoutMs`)

When a `StateDefinition` has `timeoutMs` set:

- Wrap the action execution in `Effect.timeout(Duration.millis(timeoutMs))`
- If the action exceeds the timeout, it is interrupted and the machine transitions to the `error` terminal state
- The error message should indicate the timeout: `"Action '${actionId}' in state '${stateName}' timed out after ${timeoutMs}ms"`
- If `timeoutMs` is not set on the state, no timeout is applied (unbounded)

### 2. Machine-level timeout (`opts.timeoutMs`)

When `run()` is called with `opts.timeoutMs`:

- Wrap the entire state loop in `Effect.timeout(Duration.millis(opts.timeoutMs))`
- If the machine doesn't complete within the specified time, error with: `"Machine execution timed out after ${opts.timeoutMs}ms"`
- This is independent of per-state timeouts

### 3. Max depth enforcement (`MAX_MACHINE_DEPTH`)

Read `MAX_MACHINE_DEPTH` from environment variable (default: 10).

When `run()` is called with `opts.depth`:

- If `depth > MAX_MACHINE_DEPTH`, immediately fail with `DefinitionError`:
  - `message`: `"Maximum machine nesting depth (${MAX_MACHINE_DEPTH}) exceeded"`
  - `details`: `["Current depth: ${depth}", "Maximum allowed: ${MAX_MACHINE_DEPTH}"]`
- Depth 10 is allowed; depth 11 is rejected
- When spawning child machines (Task 11/12), pass `depth + 1` to the child's `run()` call

### 4. Structured error handling

Ensure all error paths produce the correct `MachineError` variant:

| Scenario                                   | Error Type        | Fields                           |
| ------------------------------------------ | ----------------- | -------------------------------- |
| Action throws/fails                        | `ActionError`     | `actionId`, `stateName`, `cause` |
| Input fails `inputSchema`                  | `ValidationError` | `message`, `path`                |
| Illegal transition                         | `DefinitionError` | `message` identifying from→to    |
| State data fails `dataSchema` (middleware) | `ValidationError` | `message`, `path`                |
| Timeout (per-state)                        | `ActionError`     | `cause: 'timeout'`               |
| Timeout (machine-level)                    | `ActionError`     | `cause: 'machine_timeout'`       |
| Depth exceeded                             | `DefinitionError` | `message`, `details`             |

### 5. Error → terminal state flow

When any error occurs during the state loop:

1. Catch the `MachineError`
2. Run middleware `onError` hooks (errors in `onError` are logged, not propagated)
3. Set `instance.status = 'error'`
4. Set `instance.error` to a descriptive message
5. Set `instance.currentState = 'error'` (the terminal state)
6. Persist via checkpoint 4
7. Return `MachineResult` with `status: 'error'`

### 6. Input validation on start

Before creating the instance, validate `input` against `definition.inputSchema` using `ajv`:

- If the definition has `inputSchema` and the input violates it, return `ValidationError` immediately (instance never created)
- If no `inputSchema`, any input is accepted

---

## Behavior Spec Coverage

- §4.3 — Input validation: input violating `inputSchema` returns error (machine never created); valid input proceeds
- §4.3 — Starting instance for non-existent definition → 404
- §6.1 — Action failure → error terminal state; instance `error` field populated; `status: 'error'`
- §6.2 — Illegal transition → `DefinitionError` with from→to message
- §6.3 — stateData fails `dataSchema` → machine transitions to error with schema details
- §6.4 — `beforeTransition` middleware failure → error terminal; `onError` hooks fire
- §7.1 — `timeoutMs: 500` on state → action exceeding 500ms causes timeout error
- §7.1 — State without `timeoutMs` → no artificial timeout
- §7.2 — Machine-level timeout causes error if not completed in time
- §7.3 — Depth 10 allowed; depth 11 rejected; error identifies depth limit

---

## Validation Checklist

- [ ] Per-state `timeoutMs` wraps action in `Effect.timeout`
- [ ] Machine-level `timeoutMs` wraps entire state loop
- [ ] `MAX_MACHINE_DEPTH` read from env var with default 10
- [ ] Depth 10 is allowed; depth 11 is rejected with `DefinitionError`
- [ ] Input validation against `inputSchema` works (reject on violation, skip if no schema)
- [ ] All error scenarios produce correct `MachineError` variant
- [ ] Errors transition machine to `error` terminal state
- [ ] `onError` middleware hooks fire on errors
- [ ] `pnpm --filter @aiflow/server run build` succeeds
