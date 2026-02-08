# Task 05 — Action Registry & Built-in Actions

> **Phase**: 1 (Core Engine)
> **Depends on**: Task 01 (types)
> **Blocks**: Task 09 (runner core), Task 19 (API actions)

---

## Objective

Create the `ActionRegistry` Effect Service and implement the 5 built-in action functions. The registry stores action functions by ID along with metadata (description, schemas). Actions are Effect programs that receive `ActionContext` and return `TransitionResult`.

---

## Steps

### 1. Create `server/src/machines/ActionRegistry.ts`

Define as an Effect Service (Tag + Layer pattern):

```typescript
interface ActionRegistry {
  register(
    id: string,
    fn: ActionFunction,
    metadata?: Omit<ActionMetadata, 'id'>,
  ): Effect.Effect<void, never>;
  get(id: string): Effect.Effect<{ fn: ActionFunction; metadata: ActionMetadata }, NotFoundError>;
  list(): Effect.Effect<ActionMetadata[], never>;
  has(id: string): Effect.Effect<boolean, never>;
}
```

Implementation:

- Internal `Map<string, { fn: ActionFunction; metadata: ActionMetadata }>`
- `register` stores both the function and metadata
- `get` returns the function + metadata or `NotFoundError`
- `list` returns metadata only (not the functions) for API consumption
- `has` for quick existence checks (used by Rule 8 validation)

### 2. Create built-in action functions

#### `server/src/machines/actions/http-request.ts`

Makes an HTTP request using `Effect.tryPromise` wrapping `fetch`. Configuration passed via `stateData`:

- `url`, `method`, `headers?`, `body?`
- Returns response body as `data` in `TransitionResult`
- Fails with `ActionError` on network/HTTP errors

#### `server/src/machines/actions/delay.ts`

Waits for a configurable duration. Configuration via `stateData`:

- `delayMs: number` — milliseconds to wait
- `nextState: string` — state to transition to after delay
- Uses `Effect.sleep` (interruptible — cooperates with cancellation)

#### `server/src/machines/actions/transform-data.ts`

Applies a JSONPath expression to `stateData` and returns the result. Configuration:

- `expression: string` — JSONPath expression
- `nextState: string`
- Uses `jsonpath-plus` for evaluation

#### `server/src/machines/actions/log-message.ts`

Logs a message using `ctx.logger` and passes data through. Configuration via `stateData`:

- `message: string`, `level?: 'debug' | 'info' | 'warn' | 'error'`
- `nextState: string`
- Calls `ctx.logger[level](message, stateData)` and transitions

#### `server/src/machines/actions/conditional-branch.ts`

Evaluates a condition on `stateData` and returns different `nextState` values. Configuration:

- `condition: { field: string; operator: 'eq' | 'neq' | 'gt' | 'lt' | 'exists'; value?: unknown }`
- `trueState: string` — transition if condition is true
- `falseState: string` — transition if condition is false
- Extracts `field` from `stateData`, evaluates operator, returns appropriate state

### 3. Create `server/src/machines/actions/index.ts`

Re-export all built-in actions and provide a `registerBuiltinActions` function:

```typescript
export const registerBuiltinActions = (registry: ActionRegistry): Effect.Effect<void, never> =>
  Effect.all([
    registry.register('http-request', httpRequestAction, { description: 'Make an HTTP request' }),
    registry.register('delay', delayAction, { description: 'Wait for a specified duration' }),
    registry.register('transform-data', transformDataAction, {
      description: 'Apply JSONPath transform',
    }),
    registry.register('log-message', logMessageAction, {
      description: 'Log a message and pass through',
    }),
    registry.register('conditional-branch', conditionalBranchAction, {
      description: 'Branch based on condition',
    }),
  ]);
```

### 4. Create the Layer

`ActionRegistryLive` — Layer that creates the registry and pre-registers all built-in actions.

### 5. Unit tests

#### `server/src/machines/ActionRegistry.test.ts`

- Register and retrieve an action
- Retrieve non-existent action → `NotFoundError`
- List actions returns metadata for all registered
- `has` returns true/false correctly
- Built-in actions are present after Layer construction

#### `server/src/machines/actions/actions.test.ts`

- `delay` action waits and transitions
- `log-message` action logs and transitions
- `conditional-branch` routes correctly based on condition
- `transform-data` applies JSONPath and transitions
- `http-request` makes a request (mock fetch) and transitions
- Actions fail with `ActionError` on invalid input

---

## Behavior Spec Coverage

- §3 — `GET /api/machines/actions` returns registered actions with metadata (metadata structure tested here; API tested in Task 19)
- §3 — Built-in actions present on server startup: `http-request`, `delay`, `transform-data`, `log-message`, `conditional-branch`
- §5 — `conditional-branch` routes to different states based on condition in stateData
- §4.2 — Actions receive correct `ctx` fields (machineInstanceId, stateName, etc.)

---

## Validation Checklist

- [ ] `server/src/machines/ActionRegistry.ts` defines Effect Service Tag and interface
- [ ] All 5 built-in actions are implemented in separate files under `server/src/machines/actions/`
- [ ] `server/src/machines/actions/index.ts` re-exports and provides `registerBuiltinActions`
- [ ] `ActionRegistryLive` Layer pre-registers all built-in actions
- [ ] `delay` action uses `Effect.sleep` (interruptible)
- [ ] `conditional-branch` evaluates conditions and routes correctly
- [ ] Unit tests pass for registry and all actions
- [ ] `pnpm --filter @aiflow/server run test` passes
