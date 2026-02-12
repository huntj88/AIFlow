# Task 31 — Observability (OpenTelemetry)

> **Phase**: 6 (Polish & Integration)
> **Depends on**: Task 07 (middleware system), Task 09 (runner core), Task 21 (API wiring)
> **Blocks**: None (enhancement layer)

---

## Objective

Integrate OpenTelemetry into the server to instrument state machine execution with distributed traces and metrics. Replace the stub `TelemetryMiddleware` (from Task 07) with a real implementation. Wire Effect's built-in tracing into the OTel SDK.

---

## New Dependencies

```bash
# Server
pnpm --filter @aiflow/server add \
  @opentelemetry/api \
  @opentelemetry/sdk-node \
  @opentelemetry/sdk-trace-node \
  @opentelemetry/sdk-metrics \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-metrics-otlp-http \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions \
  @opentelemetry/instrumentation-http \
  @effect/opentelemetry
```

---

## Implementation Notes from Completed Tasks

> These details emerged from Tasks 01–17 and from the existing server scaffold.

1. **Layer composition pattern** — Current `HttpLive` in `server/src/lib/HttpServer.ts` uses `HelloRouter.pipe(HttpServer.serve(HttpMiddleware.logger), HttpServer.withLogAddress, Layer.provide(ServerLive))`. The OTel bridge layer should be merged into this composition or provided alongside it.
2. **Server entry point** — `server/src/index.ts` runs `startServer.pipe(Effect.provide(ServerLoggerLive), NodeRuntime.runMain)`. The OTel SDK init should happen before `NodeRuntime.runMain`.
3. **Effect Service Tag pattern** — All services use `Context.GenericTag<T>('name')`. If creating an `OtelService` tag, follow this pattern.
4. **Error types use `_tag` discriminant** — `MachineError` variants have `_tag: 'ActionError' | 'ValidationError' | ...`. TelemetryMiddleware can use `_tag` to categorize error spans.
5. **MachineEvent uses `type` discriminant** — Events have `type: 'state_changed' | 'transition_recorded' | 'log_entry' | 'machine_completed' | 'machine_resumed' | 'child_spawned' | 'child_completed' | 'children_spawned' | 'children_completed' | 'artifact_created'` (10 total). Metrics instrumentation should key off the `type` field, not `_tag`.
6. **TransitionMiddleware interface** — Defined in `types.ts` with `beforeTransition(ctx) → Effect<void, MachineError>`, `afterTransition(ctx & { result }) → Effect<void, MachineError>`, `onError(ctx & { error }) → Effect<void>` (never fails). The `MiddlewareContext` has fields: `instance` (MachineInstance), `stateName` (string), `stateData` (unknown), `definition` (StateMachineDefinition). Note: `MiddlewareContext` does NOT have `definitionId`, `instanceId`, `stateType` as top-level fields — these must be extracted from `ctx.instance` and `ctx.definition.states[ctx.stateName]`.
7. **MiddlewareExecutor factory** — Use `makeMiddlewareExecutorLayer([...middleware])` from `@/machines/middleware/MiddlewareExecutor.js`. The current server wiring passes an empty array `[]`. To add TelemetryMiddleware, update `HttpServer.ts` to pass it in the array.
8. **Layer composition** — `MachineLive` in `HttpServer.ts` merges `StoreLive, RegistryLive, ArtifactLive, RunnerLive, SemaphoreLive`. OTel layers should be added alongside without disturbing existing layers.
9. **Runner refactored** — Task 17.1 extracted a shared `executeStateLoop()` with `LoopState` interface. Effect spans added via `Effect.withSpan` in the runner may need to go inside `executeStateLoop`, `makeExecuteAction`, and `makeRunPreamble`.

---

## Steps

### 1. OTel SDK initialization

Create `server/src/lib/Telemetry.ts`:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

// Initialize before anything else in the process
export const initTelemetry = () => {
  const sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: 'aiflow-server',
      [ATTR_SERVICE_VERSION]: '0.1.0',
    }),
    traceExporter: new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces',
    }),
    metricReader: /* periodic exporting metric reader */,
  });
  sdk.start();
  return sdk;
};
```

Conditionally enable: only initialize if `OTEL_ENABLED=true` environment variable is set. Log a message when telemetry is active.

### 2. Effect ↔ OpenTelemetry bridge

Use `@effect/opentelemetry` to bridge Effect's built-in tracing to OTel:

```typescript
import { OtelTracer, OtelSpanExporter } from '@effect/opentelemetry';

// Create an Effect Layer that pipes Effect spans → OTel
export const OtelTracingLive = Layer.merge(OtelTracer.layer, OtelSpanExporter.layer);
```

Add this layer to the server's main layer composition (in `HttpServer.ts` or `index.ts`) so all `Effect.withSpan` calls automatically become OTel spans.

### 3. Implement TelemetryMiddleware

Replace the stub from Task 07 in `server/src/machines/middleware/TelemetryMiddleware.ts`:

```typescript
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';

const tracer = trace.getTracer('aiflow-state-machines');

export const TelemetryMiddleware: TransitionMiddleware = {
  name: 'telemetry',
  beforeTransition: (ctx) =>
    Effect.sync(() => {
      const span = tracer.startSpan(`state:${ctx.stateName}`, {
        kind: SpanKind.INTERNAL,
        attributes: {
          'machine.definition_id': ctx.definitionId,
          'machine.instance_id': ctx.instanceId,
          'machine.state': ctx.stateName,
          'machine.state_type': ctx.stateType,
        },
      });
      // Stash span in context for afterTransition
      return { ...ctx, _span: span };
    }),
  afterTransition: (ctx) =>
    Effect.sync(() => {
      const span = ctx._span;
      if (span) {
        if (ctx.error) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: ctx.error });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }
        span.setAttribute('machine.next_state', ctx.nextState ?? 'terminal');
        span.end();
      }
    }),
};
```

### 4. Instrument key code paths

Add `Effect.withSpan()` to critical operations (many of these may already exist from earlier tasks; verify and add where missing):

| Code Path                   | Span Name                     |
| --------------------------- | ----------------------------- |
| `StateMachineRunner.run()`  | `machine.run`                 |
| Each state execution        | `machine.state.{stateName}`   |
| Action execution            | `machine.action.{actionName}` |
| Child machine spawn         | `machine.child.spawn`         |
| Parallel children execution | `machine.parallel.execute`    |
| Definition validation       | `machine.definition.validate` |
| API route handlers          | `api.{method}.{path}`         |

### 5. Custom metrics

Record key metrics via OTel Metrics API:

```typescript
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('aiflow-state-machines');

// Counters
const instancesStarted = meter.createCounter('machine.instances.started');
const instancesCompleted = meter.createCounter('machine.instances.completed');
const instancesFailed = meter.createCounter('machine.instances.failed');
const instancesCancelled = meter.createCounter('machine.instances.cancelled');

// Histograms
const executionDuration = meter.createHistogram('machine.execution.duration_ms');
const stateExecutionDuration = meter.createHistogram('machine.state.duration_ms');

// Gauges (via observable)
const activeInstances = meter.createObservableGauge('machine.instances.active');
```

### 6. Structured log correlation

Ensure the existing Logger (from `server/src/lib/Logger.ts`) includes trace context in log entries when OTel is active:

```typescript
// Add trace_id and span_id to log entries
const activeSpan = trace.getActiveSpan();
if (activeSpan) {
  const spanContext = activeSpan.spanContext();
  logEntry.trace_id = spanContext.traceId;
  logEntry.span_id = spanContext.spanId;
}
```

### 7. Environment configuration

| Variable                      | Default                 | Description                 |
| ----------------------------- | ----------------------- | --------------------------- |
| `OTEL_ENABLED`                | `false`                 | Enable OTel instrumentation |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP collector endpoint     |
| `OTEL_SERVICE_NAME`           | `aiflow-server`         | Service name in traces      |

### 8. Docker Compose for local development (optional)

Add a `docker-compose.otel.yml` for local observability stack:

```yaml
services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - '16686:16686' # Jaeger UI
      - '4318:4318' # OTLP HTTP
    environment:
      COLLECTOR_OTLP_ENABLED: true
```

Document how to run: `docker compose -f docker-compose.otel.yml up -d`

---

## Behavior Spec Coverage

- **§14.2** — TelemetryMiddleware creates a span per state transition with machine.\*, records error status on failure
- Also supports general observability goals from the feature spec's "Middleware Pipeline" section

---

## Validation Checklist

- [x] OTel SDK initializes when `OTEL_ENABLED=true`
- [x] OTel SDK does NOT initialize when `OTEL_ENABLED` is unset/false
- [x] TelemetryMiddleware creates spans per state transition
- [x] Spans include correct attributes (definition_id, instance_id, state, type)
- [x] Error states are recorded with `SpanStatusCode.ERROR`
- [x] Custom metrics are recorded (counters, histograms)
- [x] Log entries include trace_id/span_id when OTel is active
- [x] Effect.withSpan calls appear as OTel spans via @effect/opentelemetry bridge
- [x] Server starts normally when OTel is disabled (no errors)
- [x] `pnpm --filter @aiflow/server run build` succeeds
- [x] `pnpm --filter @aiflow/server run test` passes
