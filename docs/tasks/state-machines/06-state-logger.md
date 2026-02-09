# Task 06 — Scoped State Logger

> **Phase**: 1 (Core Engine)
> **Depends on**: Task 01 (types)
> **Blocks**: Task 09 (runner core)

---

## Objective

Implement `StateLogger` — a scoped logger for individual state executions within a machine instance. The logger wraps Effect's `Logger` with machine-specific annotations and appends `LogEntry` records to the running `MachineInstance`. Each action receives a `StateLogger` via `ctx.logger`.

---

## Implementation Notes from Completed Tasks

> These details emerged from Tasks 01–05 and affect this task's implementation.

- **`StateLogger` interface** (from `types.ts`): Each method (`debug`, `info`, `warn`, `error`) returns `Effect.Effect<void>` with NO error channel (i.e., `Effect.Effect<void, never>` — but expressed as `Effect.Effect<void>` in the type since `never` is the default). Logging must never fail.
- **`LogEntry` interface** (from `types.ts`): `{ id, instanceId, stateName, level: 'debug' | 'info' | 'warn' | 'error', message, data?, timestamp }`. The `id` field is a UUID (use `crypto.randomUUID()`). The `timestamp` field is an ISO string.
- **Module convention**: File goes at `server/src/machines/StateLogger.ts` (top-level in the `machines/` folder, not a subfolder).
- **UUID generation**: The existing store uses `crypto.randomUUID()` for IDs (built-in Node, no dependency needed).

---

## Steps

### 1. Create `server/src/machines/StateLogger.ts`

Implement a factory function that creates a scoped `StateLogger` for a specific instance + state:

```typescript
interface StateLoggerFactory {
  create(instanceId: string, stateName: string): StateLogger;
}
```

The `StateLogger` implementation:

- Each method (`debug`, `info`, `warn`, `error`) creates a `LogEntry` with:
  - `id` — UUID
  - `instanceId` — from factory scope
  - `stateName` — from factory scope
  - `level` — matching the method called
  - `message` — the passed message
  - `data` — optional structured data
  - `timestamp` — ISO string
- Each method returns `Effect.Effect<void, never>` — logging never fails
- Internally uses `Effect.log` with annotations for structured output to the server's logger
- Appends the `LogEntry` to a collector (mutable array ref or `Ref<LogEntry[]>`) that the runner reads after action execution to persist on the instance

### 2. Log collection strategy

The runner needs to collect logs produced during action execution and persist them on the instance. Two approaches:

**Option A — Mutable collector** (simpler):

- Factory creates a `LogEntry[]` array
- `StateLogger` methods push to this array
- Runner reads the array after action completes and appends to `instance.logs`

**Option B — Effect Ref** (more pure):

- Factory creates `Ref.make<LogEntry[]>([])`
- Logger methods use `Ref.update` to append
- Runner uses `Ref.get` after action completes

Recommend Option A for simplicity since the logger lifetime is scoped to a single action execution (no concurrency concerns within one action).

### 3. Also emit to Effect's structured logger

In addition to collecting `LogEntry` records, each log call should also emit via `Effect.log` with span annotations so that the server's JSON logger output includes these entries with full context:

```typescript
Effect.log(message).pipe(
  Effect.annotateLogs({
    machineInstanceId: instanceId,
    stateName,
    level,
    ...(data ? { data: JSON.stringify(data) } : {}),
  }),
);
```

### 4. Unit tests — `server/src/machines/StateLogger.test.ts`

- Logger produces `LogEntry` with correct fields
- `debug`, `info`, `warn`, `error` methods set correct `level`
- `data` parameter is captured when provided
- Timestamps are ISO format
- Entries are collected in order
- Logger never fails (Effect succeeds even with odd inputs)

---

## Behavior Spec Coverage

- §4.5 — `ctx.logger.info(...)` produces entries with `level: 'info'`
- §4.5 — `ctx.logger.error(...)` produces entries with `level: 'error'`
- §4.5 — Each log entry has `stateName`, `level`, `message`, `timestamp`

---

## Validation Checklist

- [ ] `server/src/machines/StateLogger.ts` exists and compiles
- [ ] Factory function creates a scoped logger for a given instanceId + stateName
- [ ] All 4 log levels produce correctly structured `LogEntry` records
- [ ] Log entries include `id`, `instanceId`, `stateName`, `level`, `message`, `timestamp`
- [ ] Optional `data` field is captured
- [ ] Entries are also emitted via `Effect.log` with annotations
- [ ] Unit tests pass
- [ ] `pnpm --filter @aiflow/server run test` passes
