/**
 * OpenTelemetry SDK initialization & Effect bridge layers (Task 31).
 *
 * Conditionally enabled via the `OTEL_ENABLED` environment variable.
 * When enabled, creates span processors and metric readers that export
 * to an OTLP-compatible collector (e.g. Jaeger). When disabled, provides
 * no-op layers so the rest of the app works unchanged.
 *
 * The `@effect/opentelemetry` bridge layers convert every `Effect.withSpan`
 * call into a real OTel span automatically.
 *
 * @module
 */

import {
  NodeSdk,
  Metrics as OtelMetrics,
  Resource as OtelResource,
  Tracer as OtelTracer,
} from '@effect/opentelemetry';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { Effect, Layer } from 'effect';

// ────────────────────────────────────────────────────────────────────────────
// Environment configuration
// ────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/dot-notation */
const OTEL_ENABLED = process.env['OTEL_ENABLED'] === 'true';
const OTEL_EXPORTER_ENDPOINT =
  process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318';
const OTEL_SERVICE_NAME = process.env['OTEL_SERVICE_NAME'] ?? 'aiflow-server';
/* eslint-enable @typescript-eslint/dot-notation */

// ────────────────────────────────────────────────────────────────────────────
// Layer construction
// ────────────────────────────────────────────────────────────────────────────

/**
 * When OTel is enabled, builds a full `NodeSdk` + `Tracer` + `Metrics` stack
 * that bridges Effect's built-in tracing and metrics into OTel exporters.
 *
 * When OTel is **disabled**, returns `Layer.empty` so callers can always
 * `.pipe(Layer.provide(OtelLive))` without conditional logic.
 */
const makeOtelLive = (): Layer.Layer<never> => {
  if (!OTEL_ENABLED) {
    return Layer.empty;
  }

  // Resource identifies this service in all telemetry
  const ResourceLive = OtelResource.layer({
    serviceName: OTEL_SERVICE_NAME,
    serviceVersion: '0.1.0',
  });

  // Span exporter → OTLP/HTTP
  const spanProcessor = new BatchSpanProcessor(
    new OTLPTraceExporter({
      url: `${OTEL_EXPORTER_ENDPOINT}/v1/traces`,
    }),
  );

  // Metric reader → OTLP/HTTP (periodic, every 60 s)
  const metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${OTEL_EXPORTER_ENDPOINT}/v1/metrics`,
    }),
    exportIntervalMillis: 60_000,
  });

  // NodeSdk: wires span processor + metric reader into the OTel SDK
  const SdkLive = NodeSdk.layer(() => ({
    spanProcessor,
    metricReader,
    resource: {
      serviceName: OTEL_SERVICE_NAME,
      serviceVersion: '0.1.0',
    },
  }));

  // Tracer bridge: Effect.withSpan → OTel spans
  const TracerLive = OtelTracer.layerGlobal;

  // Metrics bridge: Effect metrics → OTel metrics
  const MetricsLive = OtelMetrics.layer(() => metricReader);

  // Compose: Resource → SDK → Tracer + Metrics
  return SdkLive.pipe(
    Layer.provideMerge(TracerLive),
    Layer.provideMerge(MetricsLive),
    Layer.provide(ResourceLive),
  );
};

/**
 * The main OTel layer to add to the server's layer composition.
 *
 * - When `OTEL_ENABLED=true`: activates tracing + metrics export.
 * - Otherwise: returns `Layer.empty` (zero overhead, no external deps needed).
 */
export const OtelLive: Layer.Layer<never> = makeOtelLive();

/**
 * Whether OpenTelemetry is currently enabled.
 * Useful for conditional logic in middleware & logging.
 */
export const isOtelEnabled = OTEL_ENABLED;

/**
 * Side-effecting log message at startup. Call once from the server entry point.
 */
export const logOtelStatus = OTEL_ENABLED
  ? Effect.log(
      `OpenTelemetry enabled — exporting to ${OTEL_EXPORTER_ENDPOINT} as "${OTEL_SERVICE_NAME}"`,
    )
  : Effect.log('OpenTelemetry disabled (set OTEL_ENABLED=true to enable)');
