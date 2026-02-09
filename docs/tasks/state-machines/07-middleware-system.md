# Task 07 — Middleware System

> **Phase**: 1 (Core Engine)
> **Depends on**: Task 01 (types), Task 03 (definition validator — for ValidationMiddleware)
> **Blocks**: Task 09 (runner core)

---

## Objective

Implement the middleware framework and all 4 built-in middleware. Middleware wraps every state transition for cross-cutting concerns. The framework executes `beforeTransition` hooks in registration order and `afterTransition` hooks in reverse order (onion model). Middleware cannot short-circuit transitions — it can only observe, validate, or fail with an error.

---

## Implementation Notes from Completed Tasks

> These details emerged from Tasks 01–05 and affect this task's implementation.

- **Error constructors** use the `mk` prefix: `mkValidationError({ message, path })`, `mkDefinitionError({ message, details })`, etc. — imported from `../types.js`.
- **Ajv CJS interop** (needed by `ValidationMiddleware`): Follow the pattern established in `DefinitionValidator.ts` — `import AjvModule from 'ajv'` then normalize: `const Ajv = typeof (AjvModule as any).default === 'function' ? (AjvModule as any).default : AjvModule;`. Add the same eslint-disable comments.
- **`TransitionMiddleware` interface** (from `types.ts`): `beforeTransition` returns `Effect.Effect<void, MachineError>`, `afterTransition` receives `ctx & { result: TransitionResult }` returning `Effect.Effect<void, MachineError>`, `onError` receives `ctx & { error: MachineError }` returning `Effect.Effect<void>` (never fails).
- **Effect Service pattern**: Use `Context.GenericTag<MiddlewareExecutor>('MiddlewareExecutor')` — same pattern as `MachineStore` and `ActionRegistry`.
- **Module path convention**: Middleware files go under `server/src/machines/middleware/` subfolder, matching `store/` and `actions/` conventions.

---

## Steps

### 1. Create `server/src/machines/middleware/MiddlewareExecutor.ts`

Implement the middleware chain executor:

```typescript
interface MiddlewareExecutor {
  runBefore(ctx: MiddlewareContext): Effect.Effect<void, MachineError>;
  runAfter(
    ctx: MiddlewareContext & { result: TransitionResult },
  ): Effect.Effect<void, MachineError>;
  runOnError(ctx: MiddlewareContext & { error: MachineError }): Effect.Effect<void, never>;
}
```

- `runBefore`: Executes all middleware `beforeTransition` hooks in registration order (first registered → first to run)
- `runAfter`: Executes all middleware `afterTransition` hooks in **reverse** registration order (onion model)
- `runOnError`: Executes all middleware `onError` hooks; errors in `onError` are logged but do not propagate (never fails)
- If any `beforeTransition` fails with `MachineError`, execution stops and the error propagates (machine transitions to error)
- If any `afterTransition` fails, same behavior

### 2. Create `server/src/machines/middleware/ValidationMiddleware.ts`

- In `beforeTransition`: If the current state has a `dataSchema`, validate `stateData` against it using `ajv`
- Use the same ajv CJS interop pattern from `DefinitionValidator.ts` (see Implementation Notes above)
- Fail with `mkValidationError({ message: '...schema details...', path: stateName })` on validation failure
- Skips validation if no `dataSchema` is defined on the state

### 3. Create `server/src/machines/middleware/LoggingMiddleware.ts`

- In `beforeTransition`: Logs state entry with `Effect.log` annotated with `machineDefId`, `instanceId`, `stateName`
- In `afterTransition`: Logs transition result with `nextState`, `durationMs`
- Uses Effect's structured logger (JSON output)

### 4. Create `server/src/machines/middleware/AuditMiddleware.ts`

- In `afterTransition`: Creates an immutable audit record with:
  - `actor` (system or user identifier — initially "system" for automated execution)
  - `timestamp`
  - `instanceId`, `stateName`, `fromState`, `toState`
  - `transitionData`
- Stores audit records (in-memory list initially; interface ready for DB)

### 5. Create `server/src/machines/middleware/TelemetryMiddleware.ts`

- In `beforeTransition`: Starts a timing measurement
- In `afterTransition`: Records duration as an OpenTelemetry span with attributes:
  - `machineDefId`, `instanceId`, `stateName`, `actionId`
- Initially implements a no-op / logging-only version; full OTel integration in Task 31 (Observability)
- Uses `Effect.logSpan` for timing annotations

### 6. Create `server/src/machines/middleware/index.ts`

Re-export all middleware and the executor. Provide a default middleware stack:

```typescript
export const defaultMiddleware: TransitionMiddleware[] = [
  ValidationMiddleware,
  LoggingMiddleware,
  TelemetryMiddleware,
  AuditMiddleware,
];
```

### 7. Unit tests — `server/src/machines/middleware/middleware.test.ts`

- `beforeTransition` hooks fire in registration order
- `afterTransition` hooks fire in reverse registration order
- Multiple middleware execute correctly
- `ValidationMiddleware` rejects stateData that violates `dataSchema`
- `ValidationMiddleware` passes when no `dataSchema` is defined
- `ValidationMiddleware` passes when stateData conforms to schema
- `LoggingMiddleware` produces structured log output
- `AuditMiddleware` creates audit records with correct fields
- `onError` hooks fire when an action or middleware fails
- Middleware failure propagates as `MachineError`
- `onError` handler errors are swallowed (logged but do not propagate)

---

## Behavior Spec Coverage

- §14.1 — `beforeTransition` fires before each action; `afterTransition` fires after
- §14.1 — Registration order for before, reverse for after (onion model)
- §14.2 — `ValidationMiddleware` validates `dataSchema` before action runs
- §14.2 — `LoggingMiddleware` produces structured log output
- §14.2 — `AuditMiddleware` creates immutable audit records
- §14.2 — `TelemetryMiddleware` creates spans per transition (stubbed; full OTel in Task 31)
- §6.4 — `beforeTransition` middleware failure → machine transitions to error
- §6.4 — `onError` hooks fire on middleware/action failure

---

## Validation Checklist

- [ ] `server/src/machines/middleware/MiddlewareExecutor.ts` exists and compiles
- [ ] All 4 built-in middleware are implemented
- [ ] Execution order: before = registration order, after = reverse order
- [ ] `ValidationMiddleware` uses `ajv` to validate `dataSchema`
- [ ] `AuditMiddleware` produces immutable records
- [ ] `onError` hooks are called on failures
- [ ] Unit tests cover execution order, validation, and error propagation
- [ ] `pnpm --filter @aiflow/server run test` passes
