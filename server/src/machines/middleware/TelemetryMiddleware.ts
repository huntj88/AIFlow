/**
 * TelemetryMiddleware — OpenTelemetry-backed transition instrumentation (Task 31)
 *
 * Creates an OTel span per state transition with machine-specific attributes.
 * Records custom metrics (counters & histograms) for transitions, errors, and
 * timing. Falls back to basic timing when OTel is disabled.
 *
 * Replaces the logging-only stub from Task 07.
 *
 * @module
 */

import { metrics, SpanStatusCode, trace } from '@opentelemetry/api';
import { Effect } from 'effect';

import { isOtelEnabled } from '@/lib/Telemetry.js';
import type { TransitionMiddleware } from '../types.js';

// ────────────────────────────────────────────────────────────────────────────
// OTel Instruments
// ────────────────────────────────────────────────────────────────────────────

const tracer = trace.getTracer('aiflow-state-machines', '0.1.0');
const meter = metrics.getMeter('aiflow-state-machines', '0.1.0');

/** Counter: total state transitions executed. */
const transitionsTotal = meter.createCounter('machine.transitions.total', {
  description: 'Total state transitions executed',
});

/** Counter: transitions that resulted in an error. */
const transitionErrors = meter.createCounter('machine.transitions.errors', {
  description: 'State transitions that resulted in an error',
});

/** Histogram: duration of a single state transition in ms. */
const transitionDuration = meter.createHistogram('machine.state.duration_ms', {
  description: 'Duration of a single state transition in milliseconds',
  unit: 'ms',
});

// ────────────────────────────────────────────────────────────────────────────
// Per-transition span + timing tracking
// ────────────────────────────────────────────────────────────────────────────

interface TransitionSpanInfo {
  span: ReturnType<typeof tracer.startSpan>;
  startTime: number;
}

const activeSpans = new Map<string, TransitionSpanInfo>();

function spanKey(instanceId: string, stateName: string): string {
  return `${instanceId}:${stateName}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Middleware
// ────────────────────────────────────────────────────────────────────────────

export const TelemetryMiddleware: TransitionMiddleware = {
  name: 'TelemetryMiddleware',

  beforeTransition(ctx) {
    return Effect.sync(() => {
      const key = spanKey(ctx.instance.id, ctx.stateName);
      const stateType = ctx.definition.states[ctx.stateName].type;

      if (isOtelEnabled) {
        const span = tracer.startSpan(`state:${ctx.stateName}`, {
          attributes: {
            'machine.definition_id': ctx.definition.id,
            'machine.instance_id': ctx.instance.id,
            'machine.state': ctx.stateName,
            'machine.state_type': stateType,
            'machine.action_id': ctx.definition.states[ctx.stateName].actionId ?? '',
          },
        });
        activeSpans.set(key, { span, startTime: Date.now() });
      } else {
        // Lightweight fallback: track timing only
        activeSpans.set(key, {
          span: undefined as unknown as TransitionSpanInfo['span'],
          startTime: Date.now(),
        });
      }
    });
  },

  afterTransition(ctx) {
    return Effect.gen(function* () {
      const key = spanKey(ctx.instance.id, ctx.stateName);
      const info = activeSpans.get(key);
      const durationMs = info ? Date.now() - info.startTime : -1;
      activeSpans.delete(key);

      const attrs = {
        'machine.definition_id': ctx.definition.id,
        'machine.instance_id': ctx.instance.id,
        'machine.state': ctx.stateName,
      };

      // Record metrics
      transitionsTotal.add(1, attrs);
      if (durationMs >= 0) {
        transitionDuration.record(durationMs, attrs);
      }

      if (isOtelEnabled && info?.span) {
        info.span.setStatus({ code: SpanStatusCode.OK });
        info.span.setAttribute('machine.next_state', ctx.result.nextState);
        info.span.setAttribute('machine.transition_duration_ms', durationMs);
        info.span.end();
      }

      // Structured log (preserved from original stub for non-OTel visibility)
      yield* Effect.log('Transition completed').pipe(
        Effect.annotateLogs({
          middleware: 'TelemetryMiddleware',
          machineDefId: ctx.definition.id,
          instanceId: ctx.instance.id,
          stateName: ctx.stateName,
          nextState: ctx.result.nextState,
          durationMs: String(durationMs),
          actionId: ctx.definition.states[ctx.stateName].actionId ?? 'unknown',
        }),
      );
    });
  },

  onError(ctx) {
    return Effect.sync(() => {
      const key = spanKey(ctx.instance.id, ctx.stateName);
      const info = activeSpans.get(key);
      const durationMs = info ? Date.now() - info.startTime : -1;
      activeSpans.delete(key);

      const attrs = {
        'machine.definition_id': ctx.definition.id,
        'machine.instance_id': ctx.instance.id,
        'machine.state': ctx.stateName,
      };

      // Record error metrics
      transitionErrors.add(1, attrs);
      if (durationMs >= 0) {
        transitionDuration.record(durationMs, attrs);
      }

      if (isOtelEnabled && info?.span) {
        const errorMessage =
          'message' in ctx.error
            ? (ctx.error as { message: string }).message
            : 'cause' in ctx.error
              ? String((ctx.error as { cause: unknown }).cause)
              : 'Unknown error';
        info.span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
        info.span.setAttribute('error', true);
        info.span.setAttribute('error.message', errorMessage);
        info.span.setAttribute('error.type', ctx.error._tag);
        info.span.end();
      }
    });
  },
};
