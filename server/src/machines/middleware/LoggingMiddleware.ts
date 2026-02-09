/**
 * LoggingMiddleware — Structured transition logging (Task 07)
 *
 * Logs state entry in `beforeTransition` and transition result in
 * `afterTransition` using Effect's structured logger with machine-scoped
 * annotations.
 *
 * @module
 */

import { Effect } from 'effect';

import type { TransitionMiddleware } from '../types.js';

// ────────────────────────────────────────────────────────────────────────────
// Middleware
// ────────────────────────────────────────────────────────────────────────────

export const LoggingMiddleware: TransitionMiddleware = {
  name: 'LoggingMiddleware',

  beforeTransition(ctx) {
    return Effect.log(`Entering state "${ctx.stateName}"`).pipe(
      Effect.annotateLogs({
        middleware: 'LoggingMiddleware',
        phase: 'beforeTransition',
        machineDefId: ctx.definition.id,
        instanceId: ctx.instance.id,
        stateName: ctx.stateName,
      }),
    );
  },

  afterTransition(ctx) {
    return Effect.log(`Transition from "${ctx.stateName}" → "${ctx.result.nextState}"`).pipe(
      Effect.annotateLogs({
        middleware: 'LoggingMiddleware',
        phase: 'afterTransition',
        machineDefId: ctx.definition.id,
        instanceId: ctx.instance.id,
        stateName: ctx.stateName,
        nextState: ctx.result.nextState,
      }),
    );
  },

  onError(ctx) {
    return Effect.log(`Error in state "${ctx.stateName}": ${ctx.error._tag}`).pipe(
      Effect.annotateLogs({
        middleware: 'LoggingMiddleware',
        phase: 'onError',
        machineDefId: ctx.definition.id,
        instanceId: ctx.instance.id,
        stateName: ctx.stateName,
        errorTag: ctx.error._tag,
      }),
    );
  },
};
