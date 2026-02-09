/**
 * StateLogger — Scoped logger for state executions (Task 06)
 *
 * Provides a factory function that creates a `StateLogger` scoped to a specific
 * machine instance and state name. Each log call produces a `LogEntry` record
 * appended to a mutable collector array *and* emits via `Effect.log` with
 * structured annotations for the server's JSON logger.
 *
 * @module
 */

import { Effect } from 'effect';

import type { LogEntry, StateLogger } from './types.js';

// ────────────────────────────────────────────────────────────────────────────
// Factory Interface
// ────────────────────────────────────────────────────────────────────────────

export interface StateLoggerFactory {
  /** Create a scoped logger for a specific instance + state. */
  create(instanceId: string, stateName: string): StateLogger;

  /** Retrieve all log entries collected so far. */
  getEntries(): readonly LogEntry[];

  /** Clear all collected entries (useful between action executions). */
  clear(): void;
}

// ────────────────────────────────────────────────────────────────────────────
// Implementation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a `StateLoggerFactory` backed by a mutable collector array.
 *
 * Each `StateLogger` produced by the factory pushes `LogEntry` records to the
 * shared collector. The runner reads the collector after action execution and
 * persists entries on the `MachineInstance`.
 *
 * Uses the mutable-collector approach (Option A from the task spec) because
 * the logger lifetime is scoped to a single action execution with no
 * concurrency concerns within one action.
 */
export function createStateLoggerFactory(): StateLoggerFactory {
  const entries: LogEntry[] = [];

  function create(instanceId: string, stateName: string): StateLogger {
    const makeLog =
      (level: LogEntry['level']) =>
      (message: string, data?: unknown): Effect.Effect<void> =>
        Effect.gen(function* () {
          const entry: LogEntry = {
            id: crypto.randomUUID(),
            instanceId,
            stateName,
            level,
            message,
            data,
            timestamp: new Date().toISOString(),
          };

          entries.push(entry);

          // Also emit to Effect's structured logger with annotations
          yield* Effect.log(message).pipe(
            Effect.annotateLogs({
              machineInstanceId: instanceId,
              stateName,
              level,
              ...(data !== undefined ? { data: JSON.stringify(data) } : {}),
            }),
          );
        });

    return {
      debug: makeLog('debug'),
      info: makeLog('info'),
      warn: makeLog('warn'),
      error: makeLog('error'),
    };
  }

  return {
    create,
    getEntries: () => entries,
    clear: () => {
      entries.length = 0;
    },
  };
}
