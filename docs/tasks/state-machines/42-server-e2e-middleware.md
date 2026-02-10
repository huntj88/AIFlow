# Task 42 — Server E2E: Middleware Observability

> **Phase**: 7 (Server E2E Validation)
> **Depends on**: Task 34 (infrastructure), Task 37 (linear execution)
> **Blocks**: None
> **Validates**: §14 Middleware

---

## Objective

Validate the 11 behaviors from §14 (Middleware) via HTTP requests and observable
side effects. Middleware operates as cross-cutting concerns; we verify them through
their externally observable effects: logs, audit records, validation rejections,
and OpenTelemetry spans.

---

## Testability Analysis

| Middleware               | Observable Via                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------- |
| **ValidationMiddleware** | Machine errors when `dataSchema` violated (verifiable via instance status + error) |
| **LoggingMiddleware**    | Structured log entries in `GET /instances/:id/logs`                                |
| **AuditMiddleware**      | Audit records (if exposed via API or stored in instance)                           |
| **TelemetryMiddleware**  | OTel spans (requires OTel collector; best tested via otel test)                    |

---

## Behavior Checklist → Test Mapping

### §14.1 Execution Order (4 behaviors)

| #   | Behavior                                                          | Test                           |
| --- | ----------------------------------------------------------------- | ------------------------------ |
| 1   | `beforeTransition` fires before each action                       | `before fires before action`   |
| 2   | `afterTransition` fires after each action with `TransitionResult` | `after fires after action`     |
| 3   | Multiple middleware execute in registration order for `before`    | `before: registration order`   |
| 4   | Multiple middleware execute in reverse order for `after` (onion)  | `after: reverse order (onion)` |

> **Strategy**: Register test middleware that appends to a shared log. Verify
> the log entries' order after a machine completes. Since we can't register
> custom middleware via HTTP, these tests require the in-process handler with
> custom middleware registration.

### §14.2 Cross-Cutting Concerns (4 behaviors)

| #   | Behavior                                                           | Test                               |
| --- | ------------------------------------------------------------------ | ---------------------------------- |
| 1   | ValidationMiddleware: `dataSchema` violation → error before action | `validation middleware rejects`    |
| 2   | LoggingMiddleware: structured log output per transition            | `logging middleware produces logs` |
| 3   | AuditMiddleware: immutable audit record per transition             | `audit records created`            |
| 4   | TelemetryMiddleware: OTel span per transition                      | `otel spans created`               |

### §14.3 Child Machine Middleware (3 behaviors)

| #   | Behavior                                                 | Test                                    |
| --- | -------------------------------------------------------- | --------------------------------------- |
| 1   | Middleware fires on child transitions independently      | `child middleware fires independently`  |
| 2   | Child with 5 transitions → middleware fires 5 times      | `middleware fires per child transition` |
| 3   | `parentInstanceId` allows distinguishing child vs parent | `parentInstanceId in middleware ctx`    |

---

## Test Structure

```typescript
// server/src/__e2e__/08-middleware.e2e.test.ts

describe('§14 — Middleware', () => {
  describe('§14.1 Execution Order', () => {
    it('beforeTransition middleware fires before action (log appears before transition)');
    it('afterTransition middleware fires after action (log appears after transition)');
    it('multiple beforeTransition run in registration order');
    it('multiple afterTransition run in reverse registration order (onion)');
  });

  describe('§14.2 Cross-Cutting Concerns', () => {
    it('ValidationMiddleware: state with dataSchema and bad data → machine errors');
    it('LoggingMiddleware: completed machine has structured log entries for each transition');
    it('AuditMiddleware: completed machine has audit records (verified via logs or store)');
    it('TelemetryMiddleware: OTel spans created per transition (if OTel enabled)');
  });

  describe('§14.3 Child Machine Middleware', () => {
    it('middleware fires on child machine transitions independently of parent');
    it('child with multiple transitions → middleware fires for each');
    it('middleware context includes parentInstanceId for child transitions');
  });
});
```

---

## Testing Strategy

### Execution Order (§14.1)

Since middleware execution order is internal, we verify it through **observable
side effects**:

1. **LoggingMiddleware** produces log entries with timestamps. If `beforeTransition`
   log appears before the action's own log, and `afterTransition` log appears after,
   we've confirmed ordering.

2. For multi-middleware ordering, use the test handler with custom middleware that
   writes numbered log entries (e.g., "MW1-before", "MW2-before", "MW2-after",
   "MW1-after").

```typescript
// Custom test middleware that records execution order
function makeOrderTracker(label: string) {
  return {
    beforeTransition: (ctx) => {
      ctx.logger.info(`${label}-before`);
      return Effect.void;
    },
    afterTransition: (ctx, result) => {
      ctx.logger.info(`${label}-after`);
      return Effect.void;
    },
  };
}
```

### Validation Middleware (§14.2)

Use a definition with a `dataSchema` on a state, then send data that violates it:

```typescript
// State 'validated_state' has dataSchema: { type: 'object', required: ['score'] }
// Send input that leads to stateData without 'score' → machine should error
```

### Logging & Audit Middleware (§14.2)

After a machine completes, `GET /instances/:id/logs` should contain structured
entries from LoggingMiddleware. AuditMiddleware records may be in logs or a
separate store — verify based on implementation.

### Telemetry Middleware (§14.2)

If OTel is configured in tests (via `docker-compose.otel.yml`), verify spans
are exported. Otherwise, mark as "requires OTel collector" and verify the
middleware doesn't crash when OTel is disabled.

### Child Middleware (§14.3)

1. Create a parent→child machine. After completion, check child's logs for
   middleware entries.
2. Count middleware log entries for a child with N transitions → should be N.
3. Verify child log entries contain `parentInstanceId`.

---

## Key Assertions

- **Execution order**: Log timestamps confirm before → action → after ordering
- **Validation**: `dataSchema` violation → `status === 'error'`, error mentions schema
- **Logging**: `GET /instances/:id/logs` has entries for each transition
- **Audit**: Transition records or log entries contain audit information
- **Child middleware**: Child's logs show middleware activity, count matches transition count
- **OTel**: No crashes when OTel disabled; spans exported when enabled

---

## Notes

- §14.1 behaviors 3 and 4 (multi-middleware ordering) require registering custom
  middleware in the test handler, which means the test layer needs
  `makeMiddlewareExecutorLayer([...customMiddleware, ...defaultMiddleware])`.
- §14.2 behavior 4 (TelemetryMiddleware) is best verified in integration with
  an OTel collector (Task 31). Here we verify it doesn't error.
- The full middleware stack should be enabled for all E2E tests (Task 34's
  `makeE2ETestLayer()` uses `defaultMiddlewareStack`).

---

## Behavior Spec Coverage

- §14 Middleware (§14.1 Execution Order, §14.2 Cross-Cutting Concerns, §14.3 Child Machine Middleware) — 11 behaviors

---

## Validation Checklist

- [x] All 4 §14.1 execution order behaviors verified
- [x] All 4 §14.2 cross-cutting concern behaviors verified (OTel = smoke test)
- [x] All 3 §14.3 child middleware behaviors verified
- [x] Test file: `server/src/__e2e__/08-middleware.e2e.test.ts`
