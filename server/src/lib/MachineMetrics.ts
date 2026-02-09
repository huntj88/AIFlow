/**
 * Machine-level OTel metrics — Task 31
 *
 * Provides counters and histograms for tracking machine instance lifecycle
 * events. These are recorded from key code paths (runner, API handlers)
 * via simple function calls.
 *
 * All instruments are created eagerly from the global OTel MeterProvider.
 * When OTel is disabled the global provider returns no-op meters, so these
 * calls are safe to make unconditionally.
 *
 * @module
 */

import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('aiflow-state-machines', '0.1.0');

// ────────────────────────────────────────────────────────────────────────────
// Counters
// ────────────────────────────────────────────────────────────────────────────

/** Machine instances that have been started. */
export const instancesStarted = meter.createCounter('machine.instances.started', {
  description: 'Number of machine instances started',
});

/** Machine instances that completed successfully. */
export const instancesCompleted = meter.createCounter('machine.instances.completed', {
  description: 'Number of machine instances that completed successfully',
});

/** Machine instances that terminated with an error. */
export const instancesFailed = meter.createCounter('machine.instances.failed', {
  description: 'Number of machine instances that terminated with an error',
});

/** Machine instances that were cancelled. */
export const instancesCancelled = meter.createCounter('machine.instances.cancelled', {
  description: 'Number of machine instances that were cancelled',
});

/** Machine instances that were suspended. */
export const instancesSuspended = meter.createCounter('machine.instances.suspended', {
  description: 'Number of machine instances that were suspended',
});

/** Machine instances that were resumed. */
export const instancesResumed = meter.createCounter('machine.instances.resumed', {
  description: 'Number of machine instances that were resumed',
});

// ────────────────────────────────────────────────────────────────────────────
// Histograms
// ────────────────────────────────────────────────────────────────────────────

/** Total machine execution duration in ms (start → terminal state). */
export const executionDuration = meter.createHistogram('machine.execution.duration_ms', {
  description: 'Total duration of a machine instance execution in milliseconds',
  unit: 'ms',
});

/** Number of states visited during a single machine execution. */
export const statesVisited = meter.createHistogram('machine.execution.states_visited', {
  description: 'Number of states visited in a single machine execution',
});
