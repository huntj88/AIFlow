/**
 * AuditMiddleware — Immutable audit trail (Task 07)
 *
 * Creates an immutable audit record after every successful transition
 * and stores it in an in-memory list. The interface is designed to be
 * swapped for a durable store (DB) later.
 *
 * @module
 */

import { Effect } from 'effect';

import type { MiddlewareContext, TransitionMiddleware, TransitionResult } from '../types.js';

// ────────────────────────────────────────────────────────────────────────────
// Audit Record Type
// ────────────────────────────────────────────────────────────────────────────

/** Immutable record of a single transition for audit purposes. */
export interface AuditRecord {
  readonly actor: string;
  readonly timestamp: string;
  readonly instanceId: string;
  readonly machineDefId: string;
  readonly stateName: string;
  readonly nextState: string;
  readonly transitionData?: unknown;
}

// ────────────────────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────────────────────

export interface AuditMiddlewareInstance extends TransitionMiddleware {
  /** Retrieve all audit records collected so far. */
  getRecords(): readonly AuditRecord[];
  /** Clear collected records (useful for testing). */
  clear(): void;
}

/**
 * Create an `AuditMiddleware` backed by an in-memory list.
 * Each invocation returns a fresh middleware instance with its own record store.
 */
export function createAuditMiddleware(actor = 'system'): AuditMiddlewareInstance {
  const records: AuditRecord[] = [];

  return {
    name: 'AuditMiddleware',

    afterTransition(ctx: MiddlewareContext & { readonly result: TransitionResult }) {
      return Effect.sync(() => {
        const record: AuditRecord = {
          actor,
          timestamp: new Date().toISOString(),
          instanceId: ctx.instance.id,
          machineDefId: ctx.definition.id,
          stateName: ctx.stateName,
          nextState: ctx.result.nextState,
          transitionData: ctx.result.data,
        };
        records.push(record);
      });
    },

    getRecords() {
      return records;
    },

    clear() {
      records.length = 0;
    },
  };
}

/**
 * Default singleton instance using `actor: 'system'` for automated execution.
 */
export const AuditMiddleware: AuditMiddlewareInstance = createAuditMiddleware();
