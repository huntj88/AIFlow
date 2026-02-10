/**
 * StateMachineRunner — Core execution loop (Tasks 09–15)
 *
 * Implements the core `StateMachineRunner` Effect Service — the main execution
 * engine for state machines. Covers linear execution (action states), single
 * child machine spawning (child_machine), parallel children
 * (parallel_children with all_or_interrupt and all_settled modes), global
 * semaphore-based concurrency control (ExecutionSemaphore), instance
 * cancellation via `cancel()`, graceful suspension via `suspendAll()`,
 * resume via `resume()`, and optional startup recovery.
 *
 * The runner implements the state loop, middleware integration, transition
 * validation, persistence checkpoints, and `MachineResult` resolution.
 * A permit from the global ExecutionSemaphore is held only during active
 * computation — parents release their permit before waiting for children
 * (release-before-wait pattern), preventing deadlock on recursive spawning.
 *
 * Each `run()` call forks its execution as an Effect `Fiber`, tracked in an
 * in-memory `fiberMap`. `cancel()` interrupts the fiber (cooperative),
 * triggering an `Effect.onInterrupt` finalizer that persists the `cancelled`
 * terminal state. Children of a cancelled parent are recursively cancelled.
 *
 * `suspendAll()` gracefully interrupts all in-flight instances, setting their
 * status to `'suspended'` (distinct from `'cancelled'`). `resume()` re-enters
 * a suspended instance at its last persisted `currentState`, re-executing the
 * interrupted action and continuing the state loop. Startup recovery
 * auto-resumes top-level suspended instances when `AUTO_RESUME_ON_STARTUP=true`.
 *
 * PubSub events are published at each significant point during execution
 * (Task 16) via an Effect PubSub<MachineEvent>.
 *
 * @module
 */

import AjvModule from 'ajv';
import { Cause, Context, Duration, Effect, Either, Exit, Fiber, Layer, PubSub } from 'effect';
import { JSONPath } from 'jsonpath-plus';

import * as MachineMetrics from '@/lib/MachineMetrics.js';
import { ActionRegistry } from './ActionRegistry.js';
import { validateDefinition } from './DefinitionValidator.js';
import { MachineEventPubSub } from './EventPubSub.js';
import { ExecutionSemaphore } from './ExecutionSemaphore.js';
import { createStateLoggerFactory } from './StateLogger.js';
import { ArtifactStoreFactory } from './artifacts/ArtifactStoreFactory.js';
import { MiddlewareExecutor } from './middleware/MiddlewareExecutor.js';
import { MachineStore } from './store/MachineStore.js';
import type {
  ActionContext,
  ActionError,
  ArtifactStore,
  ChildSpawnDefinition,
  DefinitionError,
  LogEntry,
  MachineError,
  MachineEvent,
  MachineInstance,
  MachineResult,
  NotFoundError,
  ParallelChildrenResult,
  StateMachineDefinition,
  TransitionRecord,
  TransitionResult,
  TransitionRule,
} from './types.js';
import { mkActionError, mkDefinitionError, mkNotFoundError, mkValidationError } from './types.js';

// ────────────────────────────────────────────────────────────────────────────
// Ajv CJS interop
// ────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
const Ajv: typeof AjvModule.default =
  typeof (AjvModule as any).default === 'function'
    ? (AjvModule as any).default
    : (AjvModule as any);
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */

const ajv = new Ajv({ allErrors: true });

// ────────────────────────────────────────────────────────────────────────────
// Run Options
// ────────────────────────────────────────────────────────────────────────────

/** Options for a single machine run. */
export interface RunOptions {
  /** Machine-level timeout (ms). */
  readonly timeoutMs?: number;
  /** If this is a child machine, the parent instance ID. */
  readonly parentInstanceId?: string;
  /** Parent state that spawned this child. */
  readonly parentStateName?: string;
  /** Current nesting depth (for MAX_MACHINE_DEPTH check). */
  readonly depth?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Service Interface
// ────────────────────────────────────────────────────────────────────────────

export interface StateMachineRunner {
  /**
   * Execute a state machine definition with the given input.
   * Returns a `MachineResult` on completion (or error/cancellation).
   */
  run(
    definition: StateMachineDefinition,
    input: unknown,
    opts?: RunOptions,
  ): Effect.Effect<MachineResult, MachineError>;

  /**
   * Cancel a running or suspended machine instance.
   *
   * - `running` / `waiting_for_child` → interrupt fiber → `cancelled`
   * - `suspended` → direct transition → `cancelled` (no fiber)
   * - `completed` / `cancelled` / `error` → 409 Conflict (DefinitionError)
   *
   * Children are recursively cancelled when the parent is `waiting_for_child`.
   */
  cancel(instanceId: string): Effect.Effect<void, NotFoundError | DefinitionError>;

  /**
   * Resume a previously suspended machine instance.
   *
   * - Verifies `status === 'suspended'` (other statuses → 409 Conflict)
   * - Checks definition exists and version matches
   * - Recursively resumes children if they are suspended
   * - Re-enters `currentState`, re-executes the interrupted action
   * - Continues the normal state loop to completion
   */
  resume(instanceId: string): Effect.Effect<MachineResult, MachineError>;

  /**
   * Gracefully suspend all running instances (for server shutdown).
   *
   * 1. Stops accepting new `run()` / `resume()` calls
   * 2. Interrupts all in-flight fibers
   * 3. `Effect.onInterrupt` finalizers set status to `'suspended'`
   * 4. Waits for all finalizers, bounded by `SHUTDOWN_TIMEOUT_MS`
   */
  suspendAll(): Effect.Effect<void, MachineError>;
}

// ────────────────────────────────────────────────────────────────────────────
// Service Tag
// ────────────────────────────────────────────────────────────────────────────

export const StateMachineRunner = Context.GenericTag<StateMachineRunner>('StateMachineRunner');

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Check whether a transition from `from` to `to` is allowed
 * by the definition's `transitions[]`.
 */
const isLegalTransition = (
  from: string,
  to: string,
  transitions: readonly TransitionRule[],
): boolean => transitions.some((t) => t.from === from && t.to === to);

// ────────────────────────────────────────────────────────────────────────────
// Layer (Live implementation)
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Shared mutable context for the state loop (Task 17.1 refactor)
// ────────────────────────────────────────────────────────────────────────────

/** Mutable context threaded through the shared state loop. */
interface LoopState {
  readonly instanceId: string;
  readonly definition: StateMachineDefinition;
  readonly machineInput: unknown;
  readonly parentContext?: { parentInstanceId: string; parentStateName: string };
  readonly parentInstanceId?: string;
  readonly depth: number;
  currentState: string;
  stateData: unknown;
  history: TransitionRecord[];
  allLogs: LogEntry[];
  errorResult: MachineResult | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Layer (Live implementation)
// ────────────────────────────────────────────────────────────────────────────

export const StateMachineRunnerLive = Layer.effect(
  StateMachineRunner,
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const registry = yield* ActionRegistry;
    const artifactFactory = yield* ArtifactStoreFactory;
    const middlewareExec = yield* MiddlewareExecutor;
    const semaphore = yield* ExecutionSemaphore;
    const pubsub = yield* MachineEventPubSub;

    /** Publish a machine event (fire-and-forget — never fails the caller). */
    const publishEvent = (event: MachineEvent) =>
      PubSub.publish(pubsub, event).pipe(Effect.catchAll(() => Effect.void));

    /**
     * In-memory fiber tracking for running instances.
     * Maps instance ID → forked fiber handle. Used by `cancel()` to
     * interrupt a running machine. NOT persisted — process-lifetime only.
     */
    const fiberMap = new Map<string, Fiber.RuntimeFiber<MachineResult, MachineError>>();

    /**
     * When `true`, the server is shutting down. Fiber interrupts during
     * shutdown persist status as `'suspended'` instead of `'cancelled'`.
     */
    let isShuttingDown = false;

    /**
     * When `false`, new `run()` and `resume()` calls are rejected.
     * Set to `false` by `suspendAll()` before interrupting fibers.
     */
    let isAcceptingNew = true;

    /* eslint-disable @typescript-eslint/dot-notation */
    const SHUTDOWN_TIMEOUT_MS = parseInt(process.env['SHUTDOWN_TIMEOUT_MS'] ?? '10000', 10);
    /* eslint-enable @typescript-eslint/dot-notation */

    // ──────────────────────────────────────────────────────────────────
    // Shared helper: persistError (Task 17.1 — step 1)
    // ──────────────────────────────────────────────────────────────────

    /** Build a `persistError` closure bound to the loop's mutable state. */
    const makePersistError =
      (ls: LoopState) => (errorMessage: string, actionId: string | undefined, durationMs: number) =>
        Effect.gen(function* () {
          const errorTransitionRecord: TransitionRecord = {
            id: crypto.randomUUID(),
            fromState: ls.currentState,
            toState: 'error',
            timestamp: new Date().toISOString(),
            durationMs,
            actionId,
          };

          ls.history = [...ls.history, errorTransitionRecord];

          yield* store.updateInstance(ls.instanceId, {
            status: 'error',
            currentState: 'error',
            stateData: ls.stateData,
            error: errorMessage,
            history: ls.history,
            logs: ls.allLogs,
            updatedAt: new Date().toISOString(),
          });

          ls.errorResult = {
            status: 'error',
            error: errorMessage,
            instanceId: ls.instanceId,
          };

          // Publish machine_completed event with error status
          yield* publishEvent({
            type: 'machine_completed',
            instanceId: ls.instanceId,
            data: ls.errorResult,
          });
        });

    // ──────────────────────────────────────────────────────────────────
    // Shared helper: executeAction (Task 17.1 — step 2)
    // ──────────────────────────────────────────────────────────────────

    const makeExecuteAction =
      (ls: LoopState, persistError: ReturnType<typeof makePersistError>) =>
      (
        actionId: string,
        actionCtx: ActionContext,
        stateDef: { readonly timeoutMs?: number },
        middlewareCtx: {
          instance: MachineInstance;
          stateName: string;
          stateData: unknown;
          definition: StateMachineDefinition;
        },
        loggerFactory: ReturnType<typeof createStateLoggerFactory>,
      ) =>
        Effect.gen(function* () {
          const { fn: actionFn } = yield* registry.get(actionId);

          const startTime = Date.now();

          // Apply per-state timeout if configured
          const rawAction = actionFn(actionCtx);
          const timedAction = stateDef.timeoutMs
            ? rawAction.pipe(
                Effect.timeoutFail({
                  duration: Duration.millis(stateDef.timeoutMs),
                  onTimeout: () =>
                    mkActionError({
                      actionId,
                      stateName: ls.currentState,
                      cause: 'timeout',
                    }),
                }),
              )
            : rawAction;

          const transitionResult = yield* timedAction.pipe(
            Effect.catchAll((actionError: ActionError) =>
              Effect.gen(function* () {
                // Build the MachineError
                const machineError: MachineError = mkActionError({
                  actionId,
                  stateName: ls.currentState,
                  cause: actionError.cause ?? actionError,
                });

                // Run middleware onError (never fails)
                yield* middlewareExec.runOnError({
                  ...middlewareCtx,
                  error: machineError,
                });

                // Collect logs from the failed action
                const errorLogs = [...loggerFactory.getEntries()];
                ls.allLogs = [...ls.allLogs, ...errorLogs];

                // Build descriptive error message
                const isTimeout = actionError.cause === 'timeout';
                const errorMessage = isTimeout
                  ? `Action '${actionId}' in state '${ls.currentState}' timed out after ${String(stateDef.timeoutMs ?? 0)}ms`
                  : actionError.cause instanceof Error
                    ? actionError.cause.message
                    : typeof actionError.cause === 'string'
                      ? actionError.cause
                      : `Action "${actionId}" failed in state "${ls.currentState}"`;

                const durationMs = Date.now() - startTime;

                // Persist error terminal state + set errorResult
                yield* persistError(errorMessage, actionId, durationMs);

                // Return a dummy TransitionResult (not used — errorResult is checked)
                return { nextState: 'error' } as TransitionResult;
              }),
            ),
          );

          const durationMs = Date.now() - startTime;
          return { transitionResult, durationMs };
        }).pipe(
          Effect.withSpan(`machine.action.${actionId}`, {
            attributes: {
              'machine.instance_id': ls.instanceId,
              'machine.state': ls.currentState,
              'machine.action_id': actionId,
            },
          }),
        );

    // ──────────────────────────────────────────────────────────────────
    // Shared helper: runPreamble (Task 17.1 — step 3)
    // ──────────────────────────────────────────────────────────────────

    const makeRunPreamble = (ls: LoopState) => () =>
      Effect.gen(function* () {
        // a. Checkpoint 2: Persist BEFORE action runs
        yield* store.updateInstance(ls.instanceId, {
          currentState: ls.currentState,
          stateData: ls.stateData,
          history: ls.history,
          updatedAt: new Date().toISOString(),
        });

        // b. Create scoped StateLogger and ArtifactStore
        const loggerFactory = createStateLoggerFactory();
        const logger = loggerFactory.create(ls.instanceId, ls.currentState);
        const rawArtifacts = artifactFactory.makeScoped(
          ls.instanceId,
          ls.currentState,
          ls.parentInstanceId,
        );

        // Wrap artifact store to publish artifact_created events on write
        const artifacts: ArtifactStore = {
          ...rawArtifacts,
          write: (name, content, meta?) =>
            rawArtifacts.write(name, content, meta).pipe(
              Effect.tap((record) =>
                publishEvent({
                  type: 'artifact_created',
                  instanceId: ls.instanceId,
                  data: record,
                }),
              ),
            ),
        };

        // c. Build ActionContext
        const actionCtx: ActionContext = {
          machineInstanceId: ls.instanceId,
          machineDefId: ls.definition.id,
          stateName: ls.currentState,
          stateData: ls.stateData,
          machineInput: ls.machineInput,
          parentContext: ls.parentContext,
          logger,
          artifacts,
        };

        // d. Run middleware beforeTransition
        const latestInstance = yield* store.getInstance(ls.instanceId);
        const middlewareCtx = {
          instance: latestInstance,
          stateName: ls.currentState,
          stateData: ls.stateData,
          definition: ls.definition,
        };

        yield* middlewareExec.runBefore(middlewareCtx);

        return { loggerFactory, actionCtx, middlewareCtx };
      });

    // ──────────────────────────────────────────────────────────────────
    // Shared helper: post-child action (shared by child_machine branches)
    // ──────────────────────────────────────────────────────────────────

    const executePostChildAction = (
      ls: LoopState,
      executeAction: ReturnType<typeof makeExecuteAction>,
      preamble: {
        loggerFactory: ReturnType<typeof createStateLoggerFactory>;
        actionCtx: ActionContext;
        middlewareCtx: {
          instance: MachineInstance;
          stateName: string;
          stateData: unknown;
          definition: StateMachineDefinition;
        };
      },
      childResult: MachineResult,
      stateDef: {
        readonly actionId?: string;
        readonly childMachineDefId?: string;
        readonly timeoutMs?: number;
      },
      startTime: number | null,
    ) =>
      Effect.gen(function* () {
        yield* store.updateInstance(ls.instanceId, {
          status: 'running',
          childInstanceId: childResult.instanceId,
          updatedAt: new Date().toISOString(),
        });

        ls.stateData = childResult;

        const actionId = stateDef.actionId;
        if (!actionId) {
          return yield* Effect.fail(
            mkDefinitionError({
              message: `State "${ls.currentState}" of type "child_machine" has no actionId`,
            }),
          );
        }

        const childActionCtx: ActionContext = {
          ...preamble.actionCtx,
          stateData: ls.stateData,
        };

        const { transitionResult, durationMs } = yield* executeAction(
          actionId,
          childActionCtx,
          stateDef,
          { ...preamble.middlewareCtx, stateData: ls.stateData },
          preamble.loggerFactory,
        );

        if (ls.errorResult) return;

        if (
          !isLegalTransition(ls.currentState, transitionResult.nextState, ls.definition.transitions)
        ) {
          return yield* Effect.fail(
            mkDefinitionError({
              message: `Illegal transition from "${ls.currentState}" to "${transitionResult.nextState}"`,
              details: [
                `Action "${actionId}" returned nextState "${transitionResult.nextState}" which is not in the definition's transitions`,
              ],
            }),
          );
        }

        yield* middlewareExec.runAfter({
          ...preamble.middlewareCtx,
          stateData: ls.stateData,
          result: transitionResult,
        });

        const totalDurationMs = startTime !== null ? Date.now() - startTime : 0;
        const transitionRecord: TransitionRecord = {
          id: crypto.randomUUID(),
          fromState: ls.currentState,
          toState: transitionResult.nextState,
          data: transitionResult.data,
          timestamp: new Date().toISOString(),
          durationMs: startTime !== null && totalDurationMs > 0 ? totalDurationMs : durationMs,
          actionId,
          childInstanceId: childResult.instanceId,
          childDefinitionId: stateDef.childMachineDefId,
        };

        ls.history = [...ls.history, transitionRecord];

        const logEntries = [...preamble.loggerFactory.getEntries()];
        ls.allLogs = [...ls.allLogs, ...logEntries];

        const nextState = transitionResult.nextState;
        const nextStateData = transitionResult.data ?? ls.stateData;

        yield* store.updateInstance(ls.instanceId, {
          currentState: nextState,
          stateData: nextStateData,
          childInstanceId: undefined,
          history: ls.history,
          logs: ls.allLogs,
          updatedAt: new Date().toISOString(),
        });

        // Publish state_changed event
        yield* publishEvent({
          type: 'state_changed',
          instanceId: ls.instanceId,
          data: {
            previousState: ls.currentState,
            currentState: nextState,
            stateData: nextStateData,
            timestamp: new Date().toISOString(),
          },
        });

        // Publish log_entry events (before transition_recorded)
        for (const entry of logEntries) {
          yield* publishEvent({
            type: 'log_entry',
            instanceId: ls.instanceId,
            data: entry,
          });
        }

        // Publish transition_recorded event
        yield* publishEvent({
          type: 'transition_recorded',
          instanceId: ls.instanceId,
          data: transitionRecord,
        });

        ls.currentState = nextState;
        ls.stateData = nextStateData;
      });

    // ──────────────────────────────────────────────────────────────────
    // Shared helper: executeStateLoop (Task 17.1 — step 4)
    // ──────────────────────────────────────────────────────────────────

    /**
     * The shared state loop used by both `run()` and `resume()`.
     *
     * For resume, `resumeContext` provides already-completed child info
     * so the loop can skip re-spawning children that finished before suspension.
     */
    const executeStateLoop = (
      ls: LoopState,
      executeAction: ReturnType<typeof makeExecuteAction>,
      runPreamble: ReturnType<typeof makeRunPreamble>,
      opts?: { timeoutMs?: number; depth?: number },
      resumeContext?: {
        instance: MachineInstance;
      },
    ) =>
      Effect.gen(function* () {
        while (ls.definition.states[ls.currentState].type !== 'terminal') {
          const stateDef = ls.definition.states[ls.currentState];

          // ────────────────────────────────────────────────────────
          // Type-based branching (semaphore: permit per active step)
          // ────────────────────────────────────────────────────────

          if (stateDef.type === 'child_machine') {
            // ── CHILD MACHINE SPAWNING ──

            // On resume: check if child already completed
            if (resumeContext) {
              const existingChildId = resumeContext.instance.childInstanceId;
              let childResult: MachineResult | null = null;

              if (existingChildId) {
                const childInstance = yield* store
                  .getInstance(existingChildId)
                  .pipe(
                    Effect.catchTag('NotFoundError', () =>
                      Effect.succeed(null as MachineInstance | null),
                    ),
                  );

                if (
                  childInstance &&
                  (childInstance.status === 'completed' ||
                    childInstance.status === 'error' ||
                    childInstance.status === 'cancelled')
                ) {
                  childResult =
                    childInstance.status === 'completed'
                      ? {
                          status: 'completed',
                          output: childInstance.output,
                          instanceId: childInstance.id,
                        }
                      : childInstance.status === 'error'
                        ? {
                            status: 'error',
                            error: childInstance.error ?? 'Child errored',
                            instanceId: childInstance.id,
                          }
                        : {
                            status: 'cancelled',
                            instanceId: childInstance.id,
                          };
                }
              }

              if (childResult) {
                // Child already done — proceed to post-child action
                const resolvedChild = childResult;
                yield* semaphore.withPermits(1)(
                  Effect.gen(function* () {
                    const preamble = yield* runPreamble();
                    yield* executePostChildAction(
                      ls,
                      executeAction,
                      preamble,
                      resolvedChild,
                      stateDef,
                      null,
                    );
                  }),
                );

                if (ls.errorResult) return;
                // After processing the resumed child, clear resumeContext
                // so subsequent iterations use the fresh-run path
                resumeContext = undefined;
                continue;
              }
            }

            // Phase 1: Preamble + pre-spawn validation (WITH permit)
            const childSpawnInfo = yield* semaphore.withPermits(1)(
              Effect.gen(function* () {
                const preamble = yield* runPreamble();

                // i. Validate childMachineDefId exists
                const childDefId = stateDef.childMachineDefId;
                if (!childDefId) {
                  return yield* Effect.fail(
                    mkDefinitionError({
                      message: `State "${ls.currentState}" of type "child_machine" has no childMachineDefId`,
                    }),
                  );
                }

                // ii. Load child definition from store
                const childDefinition = yield* store.getDefinition(childDefId).pipe(
                  Effect.catchTag('NotFoundError', (err: NotFoundError) =>
                    Effect.fail(
                      mkNotFoundError({
                        entityType: err.entityType,
                        id: err.id,
                      }),
                    ),
                  ),
                );

                // iii. Evaluate childInputMapping via JSONPath
                const mappingExpr = stateDef.childInputMapping;
                if (!mappingExpr) {
                  return yield* Effect.fail(
                    mkDefinitionError({
                      message: `State "${ls.currentState}" of type "child_machine" has no childInputMapping`,
                    }),
                  );
                }

                let childInput: unknown;
                try {
                  const jsonPathResult: unknown[] = JSONPath({
                    path: mappingExpr,
                    json: {
                      stateData: ls.stateData,
                      machineInput: ls.machineInput,
                      stateName: ls.currentState,
                    },
                  });

                  if (!Array.isArray(jsonPathResult) || jsonPathResult.length === 0) {
                    return yield* Effect.fail(
                      mkActionError({
                        actionId: 'child_machine',
                        stateName: ls.currentState,
                        cause: `childInputMapping "${mappingExpr}" returned no results`,
                      }),
                    );
                  }

                  // JSONPath always returns an array; unwrap single result
                  childInput = jsonPathResult.length === 1 ? jsonPathResult[0] : jsonPathResult;
                } catch (jsonPathError) {
                  return yield* Effect.fail(
                    mkActionError({
                      actionId: 'child_machine',
                      stateName: ls.currentState,
                      cause:
                        jsonPathError instanceof Error
                          ? `Invalid childInputMapping: ${jsonPathError.message}`
                          : `Invalid childInputMapping: ${String(jsonPathError)}`,
                    }),
                  );
                }

                // iv. Set parent status to 'waiting_for_child'
                yield* store.updateInstance(ls.instanceId, {
                  status: 'waiting_for_child',
                  updatedAt: new Date().toISOString(),
                });

                return {
                  childDefId,
                  childDefinition,
                  childInput,
                  ...preamble,
                };
              }),
            );

            // Phase 2: Spawn child machine (NO permit — release-before-wait)
            const childStartTime = Date.now();
            const childRunDepth = resumeContext ? 1 : (opts?.depth ?? 0) + 1;

            // Publish child_spawned event
            yield* publishEvent({
              type: 'child_spawned',
              instanceId: ls.instanceId,
              data: {
                childInstanceId: 'pending', // instanceId assigned inside run()
                childDefinitionId: childSpawnInfo.childDefId,
              },
            });

            const childResult: MachineResult = yield* runner.run(
              childSpawnInfo.childDefinition,
              childSpawnInfo.childInput,
              {
                parentInstanceId: ls.instanceId,
                parentStateName: ls.currentState,
                depth: childRunDepth,
              },
            );

            // Publish child_completed event
            yield* publishEvent({
              type: 'child_completed',
              instanceId: ls.instanceId,
              data: {
                childInstanceId: childResult.instanceId,
                result: childResult,
              },
            });

            // Phase 3: Post-child action execution (WITH permit)
            yield* semaphore.withPermits(1)(
              Effect.gen(function* () {
                yield* executePostChildAction(
                  ls,
                  executeAction,
                  childSpawnInfo,
                  childResult,
                  stateDef,
                  childStartTime,
                );
              }),
            );

            if (ls.errorResult) return;
            // After first iteration on resume, clear resumeContext
            if (resumeContext) resumeContext = undefined;
          } else if (stateDef.type === 'parallel_children') {
            // ── PARALLEL CHILDREN ──

            // On resume: check if all children have already reached terminal state
            if (resumeContext) {
              const existingChildIds = resumeContext.instance.childInstanceIds;
              const rChildResults: Record<string, MachineResult> = {};
              const rChildInstanceIds: Record<string, string> = {};
              let allChildrenDone = true;

              if (existingChildIds) {
                for (const [key, childId] of Object.entries(existingChildIds)) {
                  const childInstance = yield* store
                    .getInstance(childId)
                    .pipe(
                      Effect.catchTag('NotFoundError', () =>
                        Effect.succeed(null as MachineInstance | null),
                      ),
                    );

                  if (
                    childInstance &&
                    (childInstance.status === 'completed' ||
                      childInstance.status === 'error' ||
                      childInstance.status === 'cancelled')
                  ) {
                    rChildResults[key] =
                      childInstance.status === 'completed'
                        ? {
                            status: 'completed',
                            output: childInstance.output,
                            instanceId: childInstance.id,
                          }
                        : childInstance.status === 'error'
                          ? {
                              status: 'error',
                              error: childInstance.error ?? 'Child errored',
                              instanceId: childInstance.id,
                            }
                          : {
                              status: 'cancelled',
                              instanceId: childInstance.id,
                            };
                    rChildInstanceIds[key] = childInstance.id;
                  } else {
                    allChildrenDone = false;
                  }
                }
              } else {
                allChildrenDone = false;
              }

              if (!allChildrenDone) {
                return yield* Effect.fail(
                  mkDefinitionError({
                    message: `Cannot resume parallel_children state "${ls.currentState}" — not all children have reached terminal state`,
                  }),
                );
              }

              // All children done — proceed to post-children action
              yield* semaphore.withPermits(1)(
                Effect.gen(function* () {
                  const preamble = yield* runPreamble();

                  const parallelResult: ParallelChildrenResult = {
                    results: rChildResults,
                    childInstanceIds: rChildInstanceIds,
                  };

                  yield* store.updateInstance(ls.instanceId, {
                    status: 'running',
                    childInstanceIds: rChildInstanceIds,
                    updatedAt: new Date().toISOString(),
                  });

                  ls.stateData = parallelResult;

                  const actionId = stateDef.actionId;
                  if (!actionId) {
                    return yield* Effect.fail(
                      mkDefinitionError({
                        message: `State "${ls.currentState}" of type "parallel_children" has no actionId`,
                      }),
                    );
                  }

                  const parallelActionCtx: ActionContext = {
                    ...preamble.actionCtx,
                    stateData: ls.stateData,
                  };

                  const { transitionResult, durationMs } = yield* executeAction(
                    actionId,
                    parallelActionCtx,
                    stateDef,
                    { ...preamble.middlewareCtx, stateData: ls.stateData },
                    preamble.loggerFactory,
                  );

                  if (ls.errorResult) return;

                  if (
                    !isLegalTransition(
                      ls.currentState,
                      transitionResult.nextState,
                      ls.definition.transitions,
                    )
                  ) {
                    return yield* Effect.fail(
                      mkDefinitionError({
                        message: `Illegal transition from "${ls.currentState}" to "${transitionResult.nextState}"`,
                      }),
                    );
                  }

                  yield* middlewareExec.runAfter({
                    ...preamble.middlewareCtx,
                    stateData: ls.stateData,
                    result: transitionResult,
                  });

                  const transitionRecord: TransitionRecord = {
                    id: crypto.randomUUID(),
                    fromState: ls.currentState,
                    toState: transitionResult.nextState,
                    data: transitionResult.data,
                    timestamp: new Date().toISOString(),
                    durationMs,
                    actionId,
                    childInstanceIds: rChildInstanceIds,
                  };

                  ls.history = [...ls.history, transitionRecord];

                  const logEntries = [...preamble.loggerFactory.getEntries()];
                  ls.allLogs = [...ls.allLogs, ...logEntries];

                  const nextState = transitionResult.nextState;
                  const nextStateData = transitionResult.data ?? ls.stateData;

                  yield* store.updateInstance(ls.instanceId, {
                    currentState: nextState,
                    stateData: nextStateData,
                    childInstanceIds: undefined,
                    history: ls.history,
                    logs: ls.allLogs,
                    updatedAt: new Date().toISOString(),
                  });

                  // Publish state_changed event
                  yield* publishEvent({
                    type: 'state_changed',
                    instanceId: ls.instanceId,
                    data: {
                      previousState: ls.currentState,
                      currentState: nextState,
                      stateData: nextStateData,
                      timestamp: new Date().toISOString(),
                    },
                  });

                  // Publish log_entry events (before transition_recorded)
                  for (const entry of logEntries) {
                    yield* publishEvent({
                      type: 'log_entry',
                      instanceId: ls.instanceId,
                      data: entry,
                    });
                  }

                  // Publish transition_recorded event
                  yield* publishEvent({
                    type: 'transition_recorded',
                    instanceId: ls.instanceId,
                    data: transitionRecord,
                  });

                  ls.currentState = nextState;
                  ls.stateData = nextStateData;
                }),
              );

              if (ls.errorResult) return;
              resumeContext = undefined;
              continue;
            }

            // Fresh-run parallel children path

            // Phase 1: Preamble + pre-spawn validation (WITH permit)
            const parallelSpawnInfo = yield* semaphore.withPermits(1)(
              Effect.gen(function* () {
                const preamble = yield* runPreamble();

                // i. Validate children[] exists and is non-empty
                const children: ChildSpawnDefinition[] = stateDef.children ?? [];
                if (children.length === 0) {
                  return yield* Effect.fail(
                    mkDefinitionError({
                      message: `State "${ls.currentState}" of type "parallel_children" has no children`,
                    }),
                  );
                }

                // ii. Validate actionId exists
                const actionId = stateDef.actionId;
                if (!actionId) {
                  return yield* Effect.fail(
                    mkDefinitionError({
                      message: `State "${ls.currentState}" of type "parallel_children" has no actionId`,
                    }),
                  );
                }

                // iii. Evaluate each child's inputMapping and load definitions
                const childSpecs: {
                  key: string;
                  definition: StateMachineDefinition;
                  input: unknown;
                }[] = [];

                for (const child of children) {
                  // Load child definition
                  const childDef = yield* store.getDefinition(child.machineDefId).pipe(
                    Effect.catchTag('NotFoundError', (err: NotFoundError) =>
                      Effect.fail(
                        mkNotFoundError({
                          entityType: err.entityType,
                          id: err.id,
                        }),
                      ),
                    ),
                  );

                  // Evaluate inputMapping via JSONPath
                  let childInput: unknown;
                  try {
                    const jsonPathResult: unknown[] = JSONPath({
                      path: child.inputMapping,
                      json: {
                        stateData: ls.stateData,
                        machineInput: ls.machineInput,
                        stateName: ls.currentState,
                      },
                    });

                    if (!Array.isArray(jsonPathResult) || jsonPathResult.length === 0) {
                      return yield* Effect.fail(
                        mkActionError({
                          actionId: 'parallel_children',
                          stateName: ls.currentState,
                          cause: `inputMapping "${child.inputMapping}" for child "${child.key}" returned no results`,
                        }),
                      );
                    }

                    childInput = jsonPathResult.length === 1 ? jsonPathResult[0] : jsonPathResult;
                  } catch (jsonPathError) {
                    return yield* Effect.fail(
                      mkActionError({
                        actionId: 'parallel_children',
                        stateName: ls.currentState,
                        cause:
                          jsonPathError instanceof Error
                            ? `Invalid inputMapping for child "${child.key}": ${jsonPathError.message}`
                            : `Invalid inputMapping for child "${child.key}": ${String(jsonPathError)}`,
                      }),
                    );
                  }

                  childSpecs.push({
                    key: child.key,
                    definition: childDef,
                    input: childInput,
                  });
                }

                // iv. Set parent status to 'waiting_for_child'
                yield* store.updateInstance(ls.instanceId, {
                  status: 'waiting_for_child',
                  updatedAt: new Date().toISOString(),
                });

                return { childSpecs, actionId, ...preamble };
              }),
            );

            // Phase 2: Spawn parallel children (NO permit — release-before-wait)
            const parallelStartTime = Date.now();
            const parallelMode = stateDef.parallelMode ?? 'all_or_interrupt';

            const childResults: Record<string, MachineResult> = {};
            const childInstanceIds: Record<string, string> = {};

            if (parallelMode === 'all_settled') {
              // ── all_settled: run all children, collect all results ──
              const outcomes = yield* Effect.forEach(
                parallelSpawnInfo.childSpecs,
                (spec) =>
                  runner
                    .run(spec.definition, spec.input, {
                      parentInstanceId: ls.instanceId,
                      parentStateName: ls.currentState,
                      depth: (opts?.depth ?? 0) + 1,
                    })
                    .pipe(Effect.either),
                { concurrency: 'unbounded' },
              );

              for (let i = 0; i < parallelSpawnInfo.childSpecs.length; i++) {
                const spec = parallelSpawnInfo.childSpecs[i];
                const outcome = outcomes[i];

                if (Either.isRight(outcome)) {
                  const result = outcome.right;
                  childResults[spec.key] = result;
                  childInstanceIds[spec.key] = result.instanceId;
                } else {
                  // Child failed with a MachineError (validation/store error)
                  // Create an error MachineResult for this child
                  const machineError = outcome.left;
                  const errorMessage =
                    'message' in machineError
                      ? (machineError as { message: string }).message
                      : 'cause' in machineError
                        ? String((machineError as { cause: unknown }).cause)
                        : `Child "${spec.key}" failed`;
                  childResults[spec.key] = {
                    status: 'error',
                    error: errorMessage,
                    instanceId: 'unknown',
                  };
                  childInstanceIds[spec.key] = 'unknown';
                }
              }
            } else {
              // ── all_or_interrupt (default): first failure interrupts siblings ──
              // Spawn each child as a fiber
              const fibers: {
                key: string;
                fiber: Fiber.RuntimeFiber<MachineResult, MachineError>;
              }[] = [];

              for (const spec of parallelSpawnInfo.childSpecs) {
                const fiber = yield* Effect.fork(
                  runner.run(spec.definition, spec.input, {
                    parentInstanceId: ls.instanceId,
                    parentStateName: ls.currentState,
                    depth: (opts?.depth ?? 0) + 1,
                  }),
                );
                fibers.push({ key: spec.key, fiber: fiber });
              }

              // Wait for all fibers, interrupting on first failure
              let firstError: MachineError | null = null;
              const completedKeys = new Set<string>();

              // Join each fiber; if one fails, interrupt the rest
              for (const { key, fiber } of fibers) {
                if (firstError) {
                  // A previous child failed — interrupt remaining fibers
                  yield* Fiber.interrupt(fiber);
                  childResults[key] = {
                    status: 'cancelled',
                    instanceId: 'interrupted',
                  };
                  childInstanceIds[key] = 'interrupted';
                  continue;
                }

                const exit = yield* Fiber.await(fiber);

                if (Exit.isSuccess(exit)) {
                  const result = exit.value;
                  childResults[key] = result;
                  childInstanceIds[key] = result.instanceId;
                  completedKeys.add(key);

                  // Check if the child itself errored (returned error MachineResult)
                  if (result.status === 'error') {
                    firstError = mkActionError({
                      actionId: 'parallel_children',
                      stateName: ls.currentState,
                      cause: `Child "${key}" errored: ${result.error}`,
                    });
                  }
                } else {
                  // Child Effect failed (validation/store error)
                  const cause = Exit.causeOption(exit);
                  const errorMessage =
                    cause._tag === 'Some' ? String(cause.value) : `Child "${key}" failed`;

                  childResults[key] = {
                    status: 'error',
                    error: errorMessage,
                    instanceId: 'unknown',
                  };
                  childInstanceIds[key] = 'unknown';

                  firstError = mkActionError({
                    actionId: 'parallel_children',
                    stateName: ls.currentState,
                    cause: `Child "${key}" failed: ${errorMessage}`,
                  });
                }
              }

              // If there was an error and remaining fibers, interrupt them
              // (already handled in the loop above via the firstError check)
            }

            // Publish children_spawned event
            yield* publishEvent({
              type: 'children_spawned',
              instanceId: ls.instanceId,
              data: { childInstanceIds },
            });

            // Publish children_completed event
            yield* publishEvent({
              type: 'children_completed',
              instanceId: ls.instanceId,
              data: { results: childResults },
            });

            // Phase 3: Post-children action execution (WITH permit)
            yield* semaphore.withPermits(1)(
              Effect.gen(function* () {
                // vi. Build ParallelChildrenResult
                const parallelResult: ParallelChildrenResult = {
                  results: childResults,
                  childInstanceIds,
                };

                // vii. Update parent: set childInstanceIds and restore status
                yield* store.updateInstance(ls.instanceId, {
                  status: 'running',
                  childInstanceIds,
                  updatedAt: new Date().toISOString(),
                });

                // viii. Set stateData to the parallel result for the parent action
                ls.stateData = parallelResult;

                // ix. Rebuild ActionContext with updated stateData
                const parallelActionCtx: ActionContext = {
                  ...parallelSpawnInfo.actionCtx,
                  stateData: ls.stateData,
                };

                const { transitionResult, durationMs } = yield* executeAction(
                  parallelSpawnInfo.actionId,
                  parallelActionCtx,
                  stateDef,
                  { ...parallelSpawnInfo.middlewareCtx, stateData: ls.stateData },
                  parallelSpawnInfo.loggerFactory,
                );

                // If an error occurred during action execution, break out
                if (ls.errorResult) return;

                // x. Validate nextState is a legal transition
                if (
                  !isLegalTransition(
                    ls.currentState,
                    transitionResult.nextState,
                    ls.definition.transitions,
                  )
                ) {
                  return yield* Effect.fail(
                    mkDefinitionError({
                      message: `Illegal transition from "${ls.currentState}" to "${transitionResult.nextState}"`,
                      details: [
                        `Action "${parallelSpawnInfo.actionId}" returned nextState "${transitionResult.nextState}" which is not in the definition's transitions`,
                      ],
                    }),
                  );
                }

                // xi. Run middleware afterTransition
                yield* middlewareExec.runAfter({
                  ...parallelSpawnInfo.middlewareCtx,
                  stateData: ls.stateData,
                  result: transitionResult,
                });

                // xii. Record TransitionRecord with parallel children info
                const totalParallelDurationMs = Date.now() - parallelStartTime;
                const parallelTransitionRecord: TransitionRecord = {
                  id: crypto.randomUUID(),
                  fromState: ls.currentState,
                  toState: transitionResult.nextState,
                  data: transitionResult.data,
                  timestamp: new Date().toISOString(),
                  durationMs: totalParallelDurationMs > 0 ? totalParallelDurationMs : durationMs,
                  actionId: parallelSpawnInfo.actionId,
                  childInstanceIds,
                };

                ls.history = [...ls.history, parallelTransitionRecord];

                // xiii. Collect log entries
                const parallelLogEntries = [...parallelSpawnInfo.loggerFactory.getEntries()];
                ls.allLogs = [...ls.allLogs, ...parallelLogEntries];

                // xiv. Checkpoint: Persist and advance state
                const nextState = transitionResult.nextState;
                const nextStateData = transitionResult.data ?? ls.stateData;

                yield* store.updateInstance(ls.instanceId, {
                  currentState: nextState,
                  stateData: nextStateData,
                  childInstanceIds: undefined,
                  history: ls.history,
                  logs: ls.allLogs,
                  updatedAt: new Date().toISOString(),
                });

                // Publish state_changed event
                yield* publishEvent({
                  type: 'state_changed',
                  instanceId: ls.instanceId,
                  data: {
                    previousState: ls.currentState,
                    currentState: nextState,
                    stateData: nextStateData,
                    timestamp: new Date().toISOString(),
                  },
                });

                // Publish log_entry events (before transition_recorded)
                for (const entry of parallelLogEntries) {
                  yield* publishEvent({
                    type: 'log_entry',
                    instanceId: ls.instanceId,
                    data: entry,
                  });
                }

                // Publish transition_recorded event
                yield* publishEvent({
                  type: 'transition_recorded',
                  instanceId: ls.instanceId,
                  data: parallelTransitionRecord,
                });

                ls.currentState = nextState;
                ls.stateData = nextStateData;
              }),
            );

            if (ls.errorResult) return;
          } else {
            // ── ACTION EXECUTION (WITH permit for entire step) ──

            yield* semaphore.withPermits(1)(
              Effect.gen(function* () {
                const { loggerFactory, actionCtx, middlewareCtx } = yield* runPreamble();

                // Look up actionId in ActionRegistry
                const actionId = stateDef.actionId;
                if (!actionId) {
                  return yield* Effect.fail(
                    mkDefinitionError({
                      message: `State "${ls.currentState}" of type "action" has no actionId`,
                    }),
                  );
                }

                const { transitionResult, durationMs } = yield* executeAction(
                  actionId,
                  actionCtx,
                  stateDef,
                  middlewareCtx,
                  loggerFactory,
                );

                // If an error occurred, break out of the loop
                if (ls.errorResult) return;

                // Validate nextState is a legal transition
                if (
                  !isLegalTransition(
                    ls.currentState,
                    transitionResult.nextState,
                    ls.definition.transitions,
                  )
                ) {
                  return yield* Effect.fail(
                    mkDefinitionError({
                      message: `Illegal transition from "${ls.currentState}" to "${transitionResult.nextState}"`,
                      details: [
                        `Action "${actionId}" returned nextState "${transitionResult.nextState}" which is not in the definition's transitions`,
                      ],
                    }),
                  );
                }

                // Run middleware afterTransition
                yield* middlewareExec.runAfter({
                  ...middlewareCtx,
                  result: transitionResult,
                });

                // Record TransitionRecord in history
                const transitionRecord: TransitionRecord = {
                  id: crypto.randomUUID(),
                  fromState: ls.currentState,
                  toState: transitionResult.nextState,
                  data: transitionResult.data,
                  timestamp: new Date().toISOString(),
                  durationMs,
                  actionId,
                };

                ls.history = [...ls.history, transitionRecord];

                // Collect log entries from StateLogger
                const logEntries = [...loggerFactory.getEntries()];
                ls.allLogs = [...ls.allLogs, ...logEntries];

                // Checkpoint 3: Persist history + logs + advance state
                const nextState = transitionResult.nextState;
                const nextStateData = transitionResult.data ?? ls.stateData;

                yield* store.updateInstance(ls.instanceId, {
                  currentState: nextState,
                  stateData: nextStateData,
                  history: ls.history,
                  logs: ls.allLogs,
                  updatedAt: new Date().toISOString(),
                });

                // Publish state_changed event
                yield* publishEvent({
                  type: 'state_changed',
                  instanceId: ls.instanceId,
                  data: {
                    previousState: ls.currentState,
                    currentState: nextState,
                    stateData: nextStateData,
                    timestamp: new Date().toISOString(),
                  },
                });

                // Publish log_entry events (before transition_recorded)
                for (const entry of logEntries) {
                  yield* publishEvent({
                    type: 'log_entry',
                    instanceId: ls.instanceId,
                    data: entry,
                  });
                }

                // Publish transition_recorded event
                yield* publishEvent({
                  type: 'transition_recorded',
                  instanceId: ls.instanceId,
                  data: transitionRecord,
                });

                // Advance loop variables
                ls.currentState = nextState;
                ls.stateData = nextStateData;
              }),
            );

            if (ls.errorResult) return;
          }
        }
      }).pipe(
        Effect.withSpan('machine.state_loop', {
          attributes: {
            'machine.instance_id': ls.instanceId,
            'machine.definition_id': ls.definition.id,
            'machine.initial_state': ls.currentState,
          },
        }),
      );

    // ──────────────────────────────────────────────────────────────────
    // Shared helper: resolveTerminalState (Task 17.1 — step 5)
    // ──────────────────────────────────────────────────────────────────

    const resolveTerminalState = (ls: LoopState) =>
      Effect.gen(function* () {
        let result: MachineResult;

        if (ls.currentState === 'completed') {
          const output =
            ls.history.length > 0 ? ls.history[ls.history.length - 1].data : ls.stateData;

          yield* store.updateInstance(ls.instanceId, {
            status: 'completed',
            currentState: ls.currentState,
            output,
            history: ls.history,
            logs: ls.allLogs,
            updatedAt: new Date().toISOString(),
          });

          result = {
            status: 'completed',
            output,
            instanceId: ls.instanceId,
          };
        } else if (ls.currentState === 'error') {
          const errorMsg =
            ls.history.length > 0
              ? `Machine reached error state`
              : 'Machine entered error terminal state';

          yield* store.updateInstance(ls.instanceId, {
            status: 'error',
            currentState: ls.currentState,
            error: errorMsg,
            history: ls.history,
            logs: ls.allLogs,
            updatedAt: new Date().toISOString(),
          });

          result = {
            status: 'error',
            error: errorMsg,
            instanceId: ls.instanceId,
          };
        } else if (ls.currentState === 'cancelled') {
          yield* store.updateInstance(ls.instanceId, {
            status: 'cancelled',
            currentState: ls.currentState,
            history: ls.history,
            logs: ls.allLogs,
            updatedAt: new Date().toISOString(),
          });

          result = {
            status: 'cancelled',
            instanceId: ls.instanceId,
          };
        } else {
          // Unexpected terminal state
          yield* store.updateInstance(ls.instanceId, {
            status: 'error',
            currentState: ls.currentState,
            error: `Unexpected terminal state "${ls.currentState}"`,
            history: ls.history,
            logs: ls.allLogs,
            updatedAt: new Date().toISOString(),
          });

          result = {
            status: 'error',
            error: `Unexpected terminal state "${ls.currentState}"`,
            instanceId: ls.instanceId,
          };
        }

        // Publish machine_completed event for all terminal states
        yield* publishEvent({
          type: 'machine_completed',
          instanceId: ls.instanceId,
          data: result,
        });

        return result;
      });

    // ──────────────────────────────────────────────────────────────────
    // Shared helper: onInterrupt finalizer (Task 17.1 — step 6)
    // ──────────────────────────────────────────────────────────────────

    const makeOnInterruptFinalizer = (instanceId: string) =>
      Effect.gen(function* () {
        // Read the latest persisted state (may have been checkpointed)
        const latestInstance = yield* store
          .getInstance(instanceId)
          .pipe(Effect.catchAll(() => Effect.succeed(null as MachineInstance | null)));
        if (!latestInstance) return;

        // Skip if already in a terminal state (another code path handled it)
        if (
          latestInstance.status === 'cancelled' ||
          latestInstance.status === 'completed' ||
          latestInstance.status === 'error' ||
          latestInstance.status === 'suspended'
        ) {
          return;
        }

        // Distinguish suspension from cancellation
        const reason: 'suspended' | 'cancelled' = isShuttingDown ? 'suspended' : 'cancelled';

        if (reason === 'suspended') {
          // Checkpoint 5: Preserve currentState for resume —
          // do NOT add a transition record (the action was interrupted,
          // not completed). Keep currentState pointing at the
          // interrupted state so resume can re-enter it.
          yield* store
            .updateInstance(instanceId, {
              status: 'suspended',
              updatedAt: new Date().toISOString(),
            })
            .pipe(Effect.catchAll(() => Effect.void));
        } else {
          const cancellationRecord: TransitionRecord = {
            id: crypto.randomUUID(),
            fromState: latestInstance.currentState,
            toState: 'cancelled',
            timestamp: new Date().toISOString(),
            durationMs: 0,
          };

          yield* store
            .updateInstance(instanceId, {
              status: 'cancelled',
              currentState: 'cancelled',
              history: [...latestInstance.history, cancellationRecord],
              updatedAt: new Date().toISOString(),
            })
            .pipe(Effect.catchAll(() => Effect.void));
        }
      }).pipe(Effect.catchAll(() => Effect.void));

    // ──────────────────────────────────────────────────────────────────
    // Shared helper: fork, track, await, cleanup (Task 17.1 — step 7)
    // ──────────────────────────────────────────────────────────────────

    const forkTrackAwait = (instanceId: string, exec: Effect.Effect<MachineResult, MachineError>) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(exec);
        fiberMap.set(instanceId, fiber);

        const exit = yield* Fiber.await(fiber);
        fiberMap.delete(instanceId);

        if (Exit.isSuccess(exit)) {
          return exit.value;
        }

        // Fiber was interrupted — onInterrupt finalizer already persisted state.
        if (Exit.isFailure(exit) && Cause.isInterruptedOnly(exit.cause)) {
          if (isShuttingDown) {
            return { status: 'cancelled' as const, instanceId } as MachineResult;
          }
          return { status: 'cancelled' as const, instanceId } as MachineResult;
        }

        // Re-raise non-interruption failures
        return yield* Effect.failCause(exit.cause);
      });

    // ──────────────────────────────────────────────────────────────────
    // Runner implementation
    // ──────────────────────────────────────────────────────────────────

    const runner: StateMachineRunner = {
      // ────────────────────────────────────────────────────────────────
      // run() — Setup + shared loop (Task 17.1 — step 7)
      // ────────────────────────────────────────────────────────────────

      run(definition, input, opts) {
        return Effect.gen(function* () {
          // ── Reject if shutting down ──
          if (!isAcceptingNew) {
            return yield* Effect.fail(
              mkDefinitionError({
                message: 'Server is shutting down — not accepting new machine runs',
              }),
            );
          }

          // ── 1. Validate definition at runtime ──
          const registryEntries = yield* registry.list();
          const registryIds = new Set(registryEntries.map((m) => m.id));
          const syncRegistry = { has: (id: string) => registryIds.has(id) };
          yield* validateDefinition(definition, 'runtime', syncRegistry);

          // ── 1b. Enforce max depth (MAX_MACHINE_DEPTH) ──
          /* eslint-disable @typescript-eslint/dot-notation */
          const MAX_MACHINE_DEPTH = parseInt(process.env['MAX_MACHINE_DEPTH'] ?? '10', 10);
          /* eslint-enable @typescript-eslint/dot-notation */
          const depth = opts?.depth ?? 0;

          if (depth > MAX_MACHINE_DEPTH) {
            return yield* Effect.fail(
              mkDefinitionError({
                message: `Maximum machine nesting depth (${String(MAX_MACHINE_DEPTH)}) exceeded`,
                details: [
                  `Current depth: ${String(depth)}`,
                  `Maximum allowed: ${String(MAX_MACHINE_DEPTH)}`,
                ],
              }),
            );
          }

          // ── 2. Validate input against definition.inputSchema ──
          if (Object.keys(definition.inputSchema).length > 0) {
            const validate = ajv.compile(definition.inputSchema);
            const valid = validate(input);
            if (!valid) {
              const errors = validate.errors
                ?.map((e) => `${e.instancePath || '/'}: ${e.message ?? 'unknown'}`)
                .join('; ');
              return yield* Effect.fail(
                mkValidationError({
                  message: `Input validation failed: ${errors ?? 'unknown error'}`,
                }),
              );
            }
          }

          // ── 3. Create MachineInstance — Checkpoint 1 ──
          const savedInstance = yield* store.saveInstance({
            definitionId: definition.id,
            definitionVersion: definition.version,
            status: 'running',
            currentState: definition.initialState,
            stateData: input,
            input,
            history: [],
            logs: [],
            artifacts: [],
            ...(opts?.parentInstanceId ? { parentInstanceId: opts.parentInstanceId } : {}),
          });

          const instanceId = savedInstance.id;

          // Record instance started metric
          MachineMetrics.instancesStarted.add(1, {
            'machine.definition_id': definition.id,
            'machine.instance_id': instanceId,
          });

          const parentContext =
            opts?.parentInstanceId && opts.parentStateName
              ? {
                  parentInstanceId: opts.parentInstanceId,
                  parentStateName: opts.parentStateName,
                }
              : undefined;

          // ── 4. Build LoopState ──
          const ls: LoopState = {
            instanceId,
            definition,
            machineInput: input,
            parentContext,
            parentInstanceId: opts?.parentInstanceId,
            depth,
            currentState: definition.initialState,
            stateData: input,
            history: [],
            allLogs: savedInstance.logs,
            errorResult: null,
          };

          const persistError = makePersistError(ls);
          const executeAction = makeExecuteAction(ls, persistError);
          const runPreamble = makeRunPreamble(ls);

          // ── 5. Machine execution (forked as fiber for cancellation) ──
          const machineExec = Effect.gen(function* () {
            // The core state loop
            const stateLoop = executeStateLoop(ls, executeAction, runPreamble, opts);

            // Apply machine-level timeout if configured
            const timedStateLoop = opts?.timeoutMs
              ? stateLoop.pipe(
                  Effect.timeoutFail({
                    duration: Duration.millis(opts.timeoutMs),
                    onTimeout: () =>
                      mkActionError({
                        actionId: 'machine',
                        stateName: ls.currentState,
                        cause: 'machine_timeout',
                      }),
                  }),
                )
              : stateLoop;

            // Execute the state loop, handling machine-level timeout and
            // other unhandled errors (DefinitionError, ValidationError, etc.)
            yield* timedStateLoop.pipe(
              Effect.catchAll((err: MachineError) =>
                Effect.gen(function* () {
                  if (err._tag === 'ActionError' && err.cause === 'machine_timeout') {
                    const timeoutVal = opts?.timeoutMs ?? 0;
                    const errorMessage = `Machine execution timed out after ${String(timeoutVal)}ms`;

                    yield* middlewareExec.runOnError({
                      instance: yield* store.getInstance(instanceId),
                      stateName: ls.currentState,
                      stateData: ls.stateData,
                      definition,
                      error: err,
                    });

                    yield* persistError(errorMessage, undefined, timeoutVal);
                    return;
                  }

                  // Catch all other MachineErrors (DefinitionError from illegal
                  // transitions / depth limits, ValidationError from middleware
                  // dataSchema checks, etc.) and persist as error terminal state.
                  const errorMessage =
                    'message' in err
                      ? (err as { message: string }).message
                      : 'cause' in err
                        ? String((err as { cause: unknown }).cause)
                        : `Machine failed: ${err._tag}`;

                  yield* middlewareExec
                    .runOnError({
                      instance: yield* store.getInstance(instanceId).pipe(
                        Effect.catchAll(() =>
                          Effect.succeed({
                            id: instanceId,
                            currentState: ls.currentState,
                            stateData: ls.stateData,
                          } as MachineInstance),
                        ),
                      ),
                      stateName: ls.currentState,
                      stateData: ls.stateData,
                      definition,
                      error: err,
                    })
                    .pipe(Effect.catchAll(() => Effect.void));

                  yield* persistError(errorMessage, undefined, 0);
                  return;
                }),
              ),
            );

            if (ls.errorResult) {
              return ls.errorResult;
            }

            // ── Terminal state resolution — Checkpoint 4 ──
            return yield* resolveTerminalState(ls);
          }).pipe(Effect.onInterrupt(() => makeOnInterruptFinalizer(instanceId)));

          // ── 6. Fork, track, await, cleanup ──
          const result = yield* forkTrackAwait(instanceId, machineExec);

          // ── 7. Record metrics ──
          const metricsAttrs = {
            'machine.definition_id': definition.id,
            'machine.instance_id': instanceId,
          };
          if (result.status === 'completed') {
            MachineMetrics.instancesCompleted.add(1, metricsAttrs);
          } else if (result.status === 'error') {
            MachineMetrics.instancesFailed.add(1, metricsAttrs);
          } else {
            MachineMetrics.instancesCancelled.add(1, metricsAttrs);
          }
          MachineMetrics.statesVisited.record(ls.history.length, metricsAttrs);

          return result;
        }).pipe(
          Effect.withSpan('machine.run', {
            attributes: {
              'machine.definition_id': definition.id,
            },
          }),
        );
      },

      cancel(instanceId) {
        return Effect.gen(function* () {
          // 1. Look up instance from store
          const instance = yield* store.getInstance(instanceId);
          const { status } = instance;

          // 2. Terminal states → 409 Conflict
          if (status === 'completed' || status === 'cancelled' || status === 'error') {
            return yield* Effect.fail(
              mkDefinitionError({
                message: `Cannot cancel instance with status: ${status}`,
              }),
            );
          }

          // 3. Recursively cancel children if waiting_for_child
          if (status === 'waiting_for_child') {
            // Single child
            if (instance.childInstanceId) {
              yield* runner
                .cancel(instance.childInstanceId)
                .pipe(Effect.catchAll(() => Effect.void));
            }
            // Parallel children
            if (instance.childInstanceIds) {
              yield* Effect.forEach(
                Object.values(instance.childInstanceIds),
                (childId) => runner.cancel(childId).pipe(Effect.catchAll(() => Effect.void)),
                { concurrency: 'unbounded' },
              );
            }
          }

          // 4. Interrupt fiber or persist cancellation directly
          const fiber = fiberMap.get(instanceId);
          if (fiber) {
            // Interrupt the fiber — the onInterrupt finalizer handles persistence
            yield* Fiber.interrupt(fiber);
          } else {
            // No fiber (suspended or edge case) — direct transition
            const cancellationRecord: TransitionRecord = {
              id: crypto.randomUUID(),
              fromState: instance.currentState,
              toState: 'cancelled',
              timestamp: new Date().toISOString(),
              durationMs: 0,
            };

            yield* store.updateInstance(instanceId, {
              status: 'cancelled',
              currentState: 'cancelled',
              history: [...instance.history, cancellationRecord],
              updatedAt: new Date().toISOString(),
            });
          }

          MachineMetrics.instancesCancelled.add(1, { 'machine.instance_id': instanceId });
        }).pipe(
          Effect.withSpan('machine.cancel', {
            attributes: { 'machine.instance_id': instanceId },
          }),
        );
      },

      // ────────────────────────────────────────────────────────────────
      // resume() — Setup + shared loop (Task 17.1 — step 8)
      // ────────────────────────────────────────────────────────────────

      resume(instanceId) {
        return Effect.gen(function* () {
          // ── Reject if shutting down ──
          if (!isAcceptingNew) {
            return yield* Effect.fail(
              mkDefinitionError({
                message: 'Server is shutting down — not accepting resume requests',
              }),
            );
          }

          // 1. Load instance and verify status === 'suspended'
          const instance = yield* store.getInstance(instanceId);

          if (instance.status !== 'suspended') {
            return yield* Effect.fail(
              mkDefinitionError({
                message: `Cannot resume instance with status: ${instance.status}`,
                details: ['Only suspended instances can be resumed'],
              }),
            );
          }

          // 2. Load definition and verify it still exists + version matches
          const definition = yield* store.getDefinition(instance.definitionId).pipe(
            Effect.catchTag('NotFoundError', (err: NotFoundError) =>
              Effect.fail(
                mkNotFoundError({
                  entityType: err.entityType,
                  id: err.id,
                }),
              ),
            ),
          );

          if (definition.version !== instance.definitionVersion) {
            return yield* Effect.fail(
              mkDefinitionError({
                message: `Definition version changed since suspension`,
                details: [
                  `Instance was suspended with version ${String(instance.definitionVersion)}`,
                  `Current definition version is ${String(definition.version)}`,
                ],
              }),
            );
          }

          // 3. Re-validate definition at runtime
          const registryEntries = yield* registry.list();
          const registryIds = new Set(registryEntries.map((m) => m.id));
          const syncRegistry = { has: (id: string) => registryIds.has(id) };
          yield* validateDefinition(definition, 'runtime', syncRegistry);

          // 4. Handle child resumption first
          if (instance.childInstanceId) {
            const childInstance = yield* store
              .getInstance(instance.childInstanceId)
              .pipe(
                Effect.catchTag('NotFoundError', () =>
                  Effect.succeed(null as MachineInstance | null),
                ),
              );

            if (childInstance?.status === 'suspended') {
              yield* runner.resume(childInstance.id);
            }
          }

          if (instance.childInstanceIds) {
            for (const childId of Object.values(instance.childInstanceIds)) {
              const childInstance = yield* store
                .getInstance(childId)
                .pipe(
                  Effect.catchTag('NotFoundError', () =>
                    Effect.succeed(null as MachineInstance | null),
                  ),
                );

              if (childInstance?.status === 'suspended') {
                yield* runner.resume(childInstance.id);
              }
            }
          }

          // 5. Set status back to 'running'
          yield* store.updateInstance(instanceId, {
            status: 'running',
            updatedAt: new Date().toISOString(),
          });

          // Publish machine_resumed event
          yield* publishEvent({
            type: 'machine_resumed',
            instanceId,
            data: {
              previousState: instance.currentState,
              resumedState: instance.currentState,
              timestamp: new Date().toISOString(),
            },
          });

          // 6. Build LoopState from persisted instance
          const parentContext = instance.parentInstanceId
            ? {
                parentInstanceId: instance.parentInstanceId,
                parentStateName:
                  instance.history.length > 0
                    ? instance.history[instance.history.length - 1].fromState
                    : instance.currentState,
              }
            : undefined;

          const ls: LoopState = {
            instanceId,
            definition,
            machineInput: instance.input,
            parentContext,
            parentInstanceId: instance.parentInstanceId,
            depth: 0,
            currentState: instance.currentState,
            stateData: instance.stateData,
            history: [...instance.history],
            allLogs: [...instance.logs],
            errorResult: null,
          };

          const persistError = makePersistError(ls);
          const executeAction = makeExecuteAction(ls, persistError);
          const runPreamble = makeRunPreamble(ls);

          // 7. Build resumeExec = executeStateLoop + resolveTerminalState
          const resumeExec = Effect.gen(function* () {
            const stateLoop = executeStateLoop(ls, executeAction, runPreamble, undefined, {
              instance,
            });

            yield* stateLoop;

            if (ls.errorResult) {
              return ls.errorResult;
            }

            return yield* resolveTerminalState(ls);
          }).pipe(Effect.onInterrupt(() => makeOnInterruptFinalizer(instanceId)));

          // 8. Fork, track, await, cleanup
          MachineMetrics.instancesResumed.add(1, { 'machine.instance_id': instanceId });
          return yield* forkTrackAwait(instanceId, resumeExec);
        }).pipe(
          Effect.withSpan('machine.resume', {
            attributes: { 'machine.instance_id': instanceId },
          }),
        );
      },

      // ────────────────────────────────────────────────────────────────
      // suspendAll() — Task 15: Graceful shutdown
      // ────────────────────────────────────────────────────────────────

      suspendAll() {
        return Effect.gen(function* () {
          // 1. Stop accepting new run() / resume() calls
          isAcceptingNew = false;
          isShuttingDown = true;

          // 2. Collect all in-flight fibers
          const entries = [...fiberMap.entries()];

          if (entries.length === 0) {
            return;
          }

          // 3. Recursively suspend children for instances in waiting_for_child
          for (const [instId] of entries) {
            const inst = yield* store
              .getInstance(instId)
              .pipe(Effect.catchAll(() => Effect.succeed(null as MachineInstance | null)));

            if (inst?.status === 'waiting_for_child') {
              // Single child
              if (inst.childInstanceId) {
                const childFiber = fiberMap.get(inst.childInstanceId);
                if (childFiber) {
                  yield* Fiber.interrupt(childFiber).pipe(Effect.catchAll(() => Effect.void));
                } else {
                  // No fiber — directly set to suspended
                  const childInst = yield* store
                    .getInstance(inst.childInstanceId)
                    .pipe(Effect.catchAll(() => Effect.succeed(null as MachineInstance | null)));
                  if (
                    childInst &&
                    childInst.status !== 'completed' &&
                    childInst.status !== 'cancelled' &&
                    childInst.status !== 'error' &&
                    childInst.status !== 'suspended'
                  ) {
                    yield* store
                      .updateInstance(childInst.id, {
                        status: 'suspended',
                        updatedAt: new Date().toISOString(),
                      })
                      .pipe(Effect.catchAll(() => Effect.void));
                  }
                }
              }
              // Parallel children
              if (inst.childInstanceIds) {
                for (const childId of Object.values(inst.childInstanceIds)) {
                  const childFiber = fiberMap.get(childId);
                  if (childFiber) {
                    yield* Fiber.interrupt(childFiber).pipe(Effect.catchAll(() => Effect.void));
                  } else {
                    const childInst = yield* store
                      .getInstance(childId)
                      .pipe(Effect.catchAll(() => Effect.succeed(null as MachineInstance | null)));
                    if (
                      childInst &&
                      childInst.status !== 'completed' &&
                      childInst.status !== 'cancelled' &&
                      childInst.status !== 'error' &&
                      childInst.status !== 'suspended'
                    ) {
                      yield* store
                        .updateInstance(childInst.id, {
                          status: 'suspended',
                          updatedAt: new Date().toISOString(),
                        })
                        .pipe(Effect.catchAll(() => Effect.void));
                    }
                  }
                }
              }
            }
          }

          // 4. Interrupt all parent fibers — finalizers will set status to 'suspended'
          const interruptAll = Effect.forEach(
            entries,
            ([, fiber]) => Fiber.interrupt(fiber).pipe(Effect.catchAll(() => Effect.void)),
            { concurrency: 'unbounded' },
          );

          // 5. Wait with timeout
          yield* interruptAll.pipe(
            Effect.timeoutTo({
              duration: Duration.millis(SHUTDOWN_TIMEOUT_MS),
              onTimeout: () => Effect.void,
              onSuccess: () => Effect.void,
            }),
            Effect.catchAll(() => Effect.void),
          );
        });
      },
    };

    return runner;
  }),
);

// ────────────────────────────────────────────────────────────────────────────
// Startup Recovery (Task 15)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Auto-resume top-level suspended instances on server startup.
 * Controlled by `AUTO_RESUME_ON_STARTUP` env var (default: `false`).
 *
 * Top-level instances (no parent, or parent not suspended) are resumed
 * oldest-first. Children are resumed by the parent's protocol.
 * Instances that fail to resume are moved to `'error'` status.
 */
export const startupRecovery = Effect.gen(function* () {
  /* eslint-disable @typescript-eslint/dot-notation */
  if (process.env['AUTO_RESUME_ON_STARTUP'] !== 'true') return;
  /* eslint-enable @typescript-eslint/dot-notation */

  const store = yield* MachineStore;
  const runner = yield* StateMachineRunner;

  const suspended = yield* store.listInstances({ status: 'suspended' });

  // Top-level instances only: no parentInstanceId, or parent not in the suspended set
  const suspendedIds = new Set(suspended.map((i) => i.id));
  const topLevel = suspended.filter(
    (i) => !i.parentInstanceId || !suspendedIds.has(i.parentInstanceId),
  );

  // Sort oldest first
  topLevel.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

  for (const instance of topLevel) {
    yield* runner.resume(instance.id).pipe(
      Effect.catchAll((error: MachineError) =>
        store
          .updateInstance(instance.id, {
            status: 'error',
            error: `Resume failed: ${'message' in error ? (error as { message: string }).message : JSON.stringify(error)}`,
            updatedAt: new Date().toISOString(),
          })
          .pipe(Effect.catchAll(() => Effect.void)),
      ),
    );
  }
});
