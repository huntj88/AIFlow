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
 * PubSub events are added in subsequent tasks.
 *
 * @module
 */

import AjvModule from 'ajv';
import { Cause, Context, Duration, Effect, Either, Exit, Fiber, Layer } from 'effect';
import { JSONPath } from 'jsonpath-plus';

import { ActionRegistry } from './ActionRegistry.js';
import { validateDefinition } from './DefinitionValidator.js';
import { ExecutionSemaphore } from './ExecutionSemaphore.js';
import { createStateLoggerFactory } from './StateLogger.js';
import { ArtifactStoreFactory } from './artifacts/ArtifactStoreFactory.js';
import { MiddlewareExecutor } from './middleware/MiddlewareExecutor.js';
import { MachineStore } from './store/MachineStore.js';
import type {
  ActionContext,
  ActionError,
  ChildSpawnDefinition,
  DefinitionError,
  MachineError,
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

export const StateMachineRunnerLive = Layer.effect(
  StateMachineRunner,
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const registry = yield* ActionRegistry;
    const artifactFactory = yield* ArtifactStoreFactory;
    const middlewareExec = yield* MiddlewareExecutor;
    const semaphore = yield* ExecutionSemaphore;

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

    const runner: StateMachineRunner = {
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
          // ──────────────────────────────────────────────────────────────
          // 1. Validate definition at runtime
          // ──────────────────────────────────────────────────────────────

          // Build synchronous adapter for the validator's ActionRegistry
          const registryEntries = yield* registry.list();
          const registryIds = new Set(registryEntries.map((m) => m.id));
          const syncRegistry = { has: (id: string) => registryIds.has(id) };

          yield* validateDefinition(definition, 'runtime', syncRegistry);

          // ──────────────────────────────────────────────────────────────
          // 1b. Enforce max depth (MAX_MACHINE_DEPTH)
          // ──────────────────────────────────────────────────────────────

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

          // ──────────────────────────────────────────────────────────────
          // 2. Validate input against definition.inputSchema
          // ──────────────────────────────────────────────────────────────

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

          // ──────────────────────────────────────────────────────────────
          // 3. Create MachineInstance — Checkpoint 1
          // ──────────────────────────────────────────────────────────────

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

          // Build parent context for ActionContext (if child machine)
          const parentContext =
            opts?.parentInstanceId && opts.parentStateName
              ? {
                  parentInstanceId: opts.parentInstanceId,
                  parentStateName: opts.parentStateName,
                }
              : undefined;

          // ──────────────────────────────────────────────────────────────
          // 4. Machine execution (forked as fiber for cancellation — Task 14)
          // ──────────────────────────────────────────────────────────────

          const machineExec = Effect.gen(function* () {
            let currentState = definition.initialState;
            let stateData: unknown = input;
            let history: TransitionRecord[] = [];
            let allLogs = savedInstance.logs;
            let errorResult: MachineResult | null = null;

            // ── Helper: persist error terminal state and build MachineResult ──
            const persistError = (
              errorMessage: string,
              actionId: string | undefined,
              durationMs: number,
            ) =>
              Effect.gen(function* () {
                const errorTransitionRecord: TransitionRecord = {
                  id: crypto.randomUUID(),
                  fromState: currentState,
                  toState: 'error',
                  timestamp: new Date().toISOString(),
                  durationMs,
                  actionId,
                };

                history = [...history, errorTransitionRecord];

                yield* store.updateInstance(instanceId, {
                  status: 'error',
                  currentState: 'error',
                  stateData,
                  error: errorMessage,
                  history,
                  logs: allLogs,
                  updatedAt: new Date().toISOString(),
                });

                errorResult = {
                  status: 'error',
                  error: errorMessage,
                  instanceId,
                };
              });

            // ── Helper: execute an action with timeout, error handling, and middleware ──
            const executeAction = (
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
                            stateName: currentState,
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
                        stateName: currentState,
                        cause: actionError.cause ?? actionError,
                      });

                      // Run middleware onError (never fails)
                      yield* middlewareExec.runOnError({
                        ...middlewareCtx,
                        error: machineError,
                      });

                      // Collect logs from the failed action
                      const errorLogs = [...loggerFactory.getEntries()];
                      allLogs = [...allLogs, ...errorLogs];

                      // Build descriptive error message
                      const isTimeout = actionError.cause === 'timeout';
                      const errorMessage = isTimeout
                        ? `Action '${actionId}' in state '${currentState}' timed out after ${String(stateDef.timeoutMs ?? 0)}ms`
                        : actionError.cause instanceof Error
                          ? actionError.cause.message
                          : typeof actionError.cause === 'string'
                            ? actionError.cause
                            : `Action "${actionId}" failed in state "${currentState}"`;

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
              });

            // ── The core state loop as a separate Effect (for machine-level timeout) ──
            const stateLoop = Effect.gen(function* () {
              // ── Helper: common preamble (checkpoint, logger, ActionContext, middleware) ──
              const runPreamble = () =>
                Effect.gen(function* () {
                  // a. Checkpoint 2: Persist BEFORE action runs
                  yield* store.updateInstance(instanceId, {
                    currentState,
                    stateData,
                    history,
                    updatedAt: new Date().toISOString(),
                  });

                  // b. Create scoped StateLogger and ArtifactStore
                  const loggerFactory = createStateLoggerFactory();
                  const logger = loggerFactory.create(instanceId, currentState);
                  const artifacts = artifactFactory.makeScoped(
                    instanceId,
                    currentState,
                    opts?.parentInstanceId,
                  );

                  // c. Build ActionContext
                  const actionCtx: ActionContext = {
                    machineInstanceId: instanceId,
                    machineDefId: definition.id,
                    stateName: currentState,
                    stateData,
                    machineInput: input,
                    parentContext,
                    logger,
                    artifacts,
                  };

                  // d. Run middleware beforeTransition
                  const latestInstance = yield* store.getInstance(instanceId);
                  const middlewareCtx = {
                    instance: latestInstance,
                    stateName: currentState,
                    stateData,
                    definition,
                  };

                  yield* middlewareExec.runBefore(middlewareCtx);

                  return { loggerFactory, actionCtx, middlewareCtx };
                });

              while (definition.states[currentState].type !== 'terminal') {
                const stateDef = definition.states[currentState];

                // ────────────────────────────────────────────────────────
                // Type-based branching (semaphore: permit per active step)
                // ────────────────────────────────────────────────────────

                if (stateDef.type === 'child_machine') {
                  // ── CHILD MACHINE SPAWNING (Task 11 + Task 13 semaphore) ──

                  // Phase 1: Preamble + pre-spawn validation (WITH permit)
                  const childSpawnInfo = yield* semaphore.withPermits(1)(
                    Effect.gen(function* () {
                      const preamble = yield* runPreamble();

                      // i. Validate childMachineDefId exists
                      const childDefId = stateDef.childMachineDefId;
                      if (!childDefId) {
                        return yield* Effect.fail(
                          mkDefinitionError({
                            message: `State "${currentState}" of type "child_machine" has no childMachineDefId`,
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
                            message: `State "${currentState}" of type "child_machine" has no childInputMapping`,
                          }),
                        );
                      }

                      let childInput: unknown;
                      try {
                        const jsonPathResult: unknown[] = JSONPath({
                          path: mappingExpr,
                          json: {
                            stateData,
                            machineInput: input,
                            stateName: currentState,
                          },
                        });

                        if (!Array.isArray(jsonPathResult) || jsonPathResult.length === 0) {
                          return yield* Effect.fail(
                            mkActionError({
                              actionId: 'child_machine',
                              stateName: currentState,
                              cause: `childInputMapping "${mappingExpr}" returned no results`,
                            }),
                          );
                        }

                        // JSONPath always returns an array; unwrap single result
                        childInput =
                          jsonPathResult.length === 1 ? jsonPathResult[0] : jsonPathResult;
                      } catch (jsonPathError) {
                        return yield* Effect.fail(
                          mkActionError({
                            actionId: 'child_machine',
                            stateName: currentState,
                            cause:
                              jsonPathError instanceof Error
                                ? `Invalid childInputMapping: ${jsonPathError.message}`
                                : `Invalid childInputMapping: ${String(jsonPathError)}`,
                          }),
                        );
                      }

                      // iv. Set parent status to 'waiting_for_child'
                      yield* store.updateInstance(instanceId, {
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
                  const childResult: MachineResult = yield* runner.run(
                    childSpawnInfo.childDefinition,
                    childSpawnInfo.childInput,
                    {
                      parentInstanceId: instanceId,
                      parentStateName: currentState,
                      depth: (opts?.depth ?? 0) + 1,
                    },
                  );

                  // Phase 3: Post-child action execution (WITH permit)
                  yield* semaphore.withPermits(1)(
                    Effect.gen(function* () {
                      // vi. Update parent: set childInstanceId and restore status
                      yield* store.updateInstance(instanceId, {
                        status: 'running',
                        childInstanceId: childResult.instanceId,
                        updatedAt: new Date().toISOString(),
                      });

                      // vii. Set stateData to child's MachineResult for the parent action
                      stateData = childResult;

                      // viii. Execute the parent state's actionId with child result
                      const actionId = stateDef.actionId;
                      if (!actionId) {
                        return yield* Effect.fail(
                          mkDefinitionError({
                            message: `State "${currentState}" of type "child_machine" has no actionId`,
                          }),
                        );
                      }

                      // Rebuild ActionContext with updated stateData (child result)
                      const childActionCtx: ActionContext = {
                        ...childSpawnInfo.actionCtx,
                        stateData,
                      };

                      const { transitionResult, durationMs } = yield* executeAction(
                        actionId,
                        childActionCtx,
                        stateDef,
                        { ...childSpawnInfo.middlewareCtx, stateData },
                        childSpawnInfo.loggerFactory,
                      );

                      // If an error occurred during action execution, break out
                      if (errorResult) return;

                      // ix. Validate nextState is a legal transition
                      if (
                        !isLegalTransition(
                          currentState,
                          transitionResult.nextState,
                          definition.transitions,
                        )
                      ) {
                        return yield* Effect.fail(
                          mkDefinitionError({
                            message: `Illegal transition from "${currentState}" to "${transitionResult.nextState}"`,
                            details: [
                              `Action "${actionId}" returned nextState "${transitionResult.nextState}" which is not in the definition's transitions`,
                            ],
                          }),
                        );
                      }

                      // x. Run middleware afterTransition
                      yield* middlewareExec.runAfter({
                        ...childSpawnInfo.middlewareCtx,
                        stateData,
                        result: transitionResult,
                      });

                      // xi. Record TransitionRecord with child info
                      const totalDurationMs = Date.now() - childStartTime;
                      const transitionRecord: TransitionRecord = {
                        id: crypto.randomUUID(),
                        fromState: currentState,
                        toState: transitionResult.nextState,
                        data: transitionResult.data,
                        timestamp: new Date().toISOString(),
                        durationMs: totalDurationMs > 0 ? totalDurationMs : durationMs,
                        actionId,
                        childInstanceId: childResult.instanceId,
                        childDefinitionId: childSpawnInfo.childDefId,
                      };

                      history = [...history, transitionRecord];

                      // xii. Collect log entries
                      const logEntries = [...childSpawnInfo.loggerFactory.getEntries()];
                      allLogs = [...allLogs, ...logEntries];

                      // xiii. Checkpoint 3: Persist and advance state
                      const nextState = transitionResult.nextState;
                      const nextStateData = transitionResult.data ?? stateData;

                      yield* store.updateInstance(instanceId, {
                        currentState: nextState,
                        stateData: nextStateData,
                        childInstanceId: undefined,
                        history,
                        logs: allLogs,
                        updatedAt: new Date().toISOString(),
                      });

                      currentState = nextState;
                      stateData = nextStateData;
                    }),
                  );

                  if (errorResult) return;
                } else if (stateDef.type === 'parallel_children') {
                  // ── PARALLEL CHILDREN (Task 12 + Task 13 semaphore) ──

                  // Phase 1: Preamble + pre-spawn validation (WITH permit)
                  const parallelSpawnInfo = yield* semaphore.withPermits(1)(
                    Effect.gen(function* () {
                      const preamble = yield* runPreamble();

                      // i. Validate children[] exists and is non-empty
                      const children: ChildSpawnDefinition[] = stateDef.children ?? [];
                      if (children.length === 0) {
                        return yield* Effect.fail(
                          mkDefinitionError({
                            message: `State "${currentState}" of type "parallel_children" has no children`,
                          }),
                        );
                      }

                      // ii. Validate actionId exists
                      const actionId = stateDef.actionId;
                      if (!actionId) {
                        return yield* Effect.fail(
                          mkDefinitionError({
                            message: `State "${currentState}" of type "parallel_children" has no actionId`,
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
                              stateData,
                              machineInput: input,
                              stateName: currentState,
                            },
                          });

                          if (!Array.isArray(jsonPathResult) || jsonPathResult.length === 0) {
                            return yield* Effect.fail(
                              mkActionError({
                                actionId: 'parallel_children',
                                stateName: currentState,
                                cause: `inputMapping "${child.inputMapping}" for child "${child.key}" returned no results`,
                              }),
                            );
                          }

                          childInput =
                            jsonPathResult.length === 1 ? jsonPathResult[0] : jsonPathResult;
                        } catch (jsonPathError) {
                          return yield* Effect.fail(
                            mkActionError({
                              actionId: 'parallel_children',
                              stateName: currentState,
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
                      yield* store.updateInstance(instanceId, {
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
                            parentInstanceId: instanceId,
                            parentStateName: currentState,
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
                          parentInstanceId: instanceId,
                          parentStateName: currentState,
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
                            stateName: currentState,
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
                          stateName: currentState,
                          cause: `Child "${key}" failed: ${errorMessage}`,
                        });
                      }
                    }

                    // If there was an error and remaining fibers, interrupt them
                    // (already handled in the loop above via the firstError check)
                  }

                  // Phase 3: Post-children action execution (WITH permit)
                  yield* semaphore.withPermits(1)(
                    Effect.gen(function* () {
                      // vi. Build ParallelChildrenResult
                      const parallelResult: ParallelChildrenResult = {
                        results: childResults,
                        childInstanceIds,
                      };

                      // vii. Update parent: set childInstanceIds and restore status
                      yield* store.updateInstance(instanceId, {
                        status: 'running',
                        childInstanceIds,
                        updatedAt: new Date().toISOString(),
                      });

                      // viii. Set stateData to the parallel result for the parent action
                      stateData = parallelResult;

                      // ix. Rebuild ActionContext with updated stateData
                      const parallelActionCtx: ActionContext = {
                        ...parallelSpawnInfo.actionCtx,
                        stateData,
                      };

                      const { transitionResult, durationMs } = yield* executeAction(
                        parallelSpawnInfo.actionId,
                        parallelActionCtx,
                        stateDef,
                        { ...parallelSpawnInfo.middlewareCtx, stateData },
                        parallelSpawnInfo.loggerFactory,
                      );

                      // If an error occurred during action execution, break out
                      if (errorResult) return;

                      // x. Validate nextState is a legal transition
                      if (
                        !isLegalTransition(
                          currentState,
                          transitionResult.nextState,
                          definition.transitions,
                        )
                      ) {
                        return yield* Effect.fail(
                          mkDefinitionError({
                            message: `Illegal transition from "${currentState}" to "${transitionResult.nextState}"`,
                            details: [
                              `Action "${parallelSpawnInfo.actionId}" returned nextState "${transitionResult.nextState}" which is not in the definition's transitions`,
                            ],
                          }),
                        );
                      }

                      // xi. Run middleware afterTransition
                      yield* middlewareExec.runAfter({
                        ...parallelSpawnInfo.middlewareCtx,
                        stateData,
                        result: transitionResult,
                      });

                      // xii. Record TransitionRecord with parallel children info
                      const totalParallelDurationMs = Date.now() - parallelStartTime;
                      const parallelTransitionRecord: TransitionRecord = {
                        id: crypto.randomUUID(),
                        fromState: currentState,
                        toState: transitionResult.nextState,
                        data: transitionResult.data,
                        timestamp: new Date().toISOString(),
                        durationMs:
                          totalParallelDurationMs > 0 ? totalParallelDurationMs : durationMs,
                        actionId: parallelSpawnInfo.actionId,
                        childInstanceIds,
                      };

                      history = [...history, parallelTransitionRecord];

                      // xiii. Collect log entries
                      const parallelLogEntries = [...parallelSpawnInfo.loggerFactory.getEntries()];
                      allLogs = [...allLogs, ...parallelLogEntries];

                      // xiv. Checkpoint: Persist and advance state
                      const nextState = transitionResult.nextState;
                      const nextStateData = transitionResult.data ?? stateData;

                      yield* store.updateInstance(instanceId, {
                        currentState: nextState,
                        stateData: nextStateData,
                        childInstanceIds: undefined,
                        history,
                        logs: allLogs,
                        updatedAt: new Date().toISOString(),
                      });

                      currentState = nextState;
                      stateData = nextStateData;
                    }),
                  );

                  if (errorResult) return;
                } else {
                  // ── ACTION EXECUTION (WITH permit for entire step) ──

                  yield* semaphore.withPermits(1)(
                    Effect.gen(function* () {
                      const { loggerFactory, actionCtx, middlewareCtx } = yield* runPreamble();

                      // e. Look up actionId in ActionRegistry
                      const actionId = stateDef.actionId;
                      if (!actionId) {
                        return yield* Effect.fail(
                          mkDefinitionError({
                            message: `State "${currentState}" of type "action" has no actionId`,
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
                      if (errorResult) return;

                      // g. Validate nextState is a legal transition
                      if (
                        !isLegalTransition(
                          currentState,
                          transitionResult.nextState,
                          definition.transitions,
                        )
                      ) {
                        return yield* Effect.fail(
                          mkDefinitionError({
                            message: `Illegal transition from "${currentState}" to "${transitionResult.nextState}"`,
                            details: [
                              `Action "${actionId}" returned nextState "${transitionResult.nextState}" which is not in the definition's transitions`,
                            ],
                          }),
                        );
                      }

                      // h. Run middleware afterTransition
                      yield* middlewareExec.runAfter({
                        ...middlewareCtx,
                        result: transitionResult,
                      });

                      // i. Record TransitionRecord in history
                      const transitionRecord: TransitionRecord = {
                        id: crypto.randomUUID(),
                        fromState: currentState,
                        toState: transitionResult.nextState,
                        data: transitionResult.data,
                        timestamp: new Date().toISOString(),
                        durationMs,
                        actionId,
                      };

                      history = [...history, transitionRecord];

                      // j. Collect log entries from StateLogger
                      const logEntries = [...loggerFactory.getEntries()];
                      allLogs = [...allLogs, ...logEntries];

                      // k. Checkpoint 3: Persist history + logs + advance state
                      const nextState = transitionResult.nextState;
                      const nextStateData = transitionResult.data ?? stateData;

                      yield* store.updateInstance(instanceId, {
                        currentState: nextState,
                        stateData: nextStateData,
                        history,
                        logs: allLogs,
                        updatedAt: new Date().toISOString(),
                      });

                      // Advance loop variables
                      currentState = nextState;
                      stateData = nextStateData;
                    }),
                  );

                  if (errorResult) return;
                }
              }
            });

            // ── Apply machine-level timeout if configured ──
            const timedStateLoop = opts?.timeoutMs
              ? stateLoop.pipe(
                  Effect.timeoutFail({
                    duration: Duration.millis(opts.timeoutMs),
                    onTimeout: () =>
                      mkActionError({
                        actionId: 'machine',
                        stateName: currentState,
                        cause: 'machine_timeout',
                      }),
                  }),
                )
              : stateLoop;

            // Execute the state loop, handling machine-level timeout
            yield* timedStateLoop.pipe(
              Effect.catchAll((err: MachineError) =>
                Effect.gen(function* () {
                  if (err._tag === 'ActionError' && err.cause === 'machine_timeout') {
                    const timeoutVal = opts?.timeoutMs ?? 0;
                    const errorMessage = `Machine execution timed out after ${String(timeoutVal)}ms`;

                    // Run middleware onError (never fails)
                    yield* middlewareExec.runOnError({
                      instance: yield* store.getInstance(instanceId),
                      stateName: currentState,
                      stateData,
                      definition,
                      error: err,
                    });

                    yield* persistError(errorMessage, undefined, timeoutVal);
                    return;
                  }
                  // Re-throw non-timeout errors
                  return yield* Effect.fail(err);
                }),
              ),
            );

            // If any error occurred during the loop, return the error result
            // (errorResult is mutated inside Effect closures — TS can't track it)
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (errorResult) {
              return errorResult;
            }

            // ──────────────────────────────────────────────────────────────
            // 5. Terminal state resolution — Checkpoint 4
            // ──────────────────────────────────────────────────────────────

            let result: MachineResult;

            if (currentState === 'completed') {
              const output = history.length > 0 ? history[history.length - 1].data : stateData;

              yield* store.updateInstance(instanceId, {
                status: 'completed',
                currentState,
                output,
                history,
                logs: allLogs,
                updatedAt: new Date().toISOString(),
              });

              result = {
                status: 'completed',
                output,
                instanceId,
              };
            } else if (currentState === 'error') {
              const errorMsg =
                history.length > 0
                  ? `Machine reached error state`
                  : 'Machine entered error terminal state';

              yield* store.updateInstance(instanceId, {
                status: 'error',
                currentState,
                error: errorMsg,
                history,
                logs: allLogs,
                updatedAt: new Date().toISOString(),
              });

              result = {
                status: 'error',
                error: errorMsg,
                instanceId,
              };
            } else if (currentState === 'cancelled') {
              yield* store.updateInstance(instanceId, {
                status: 'cancelled',
                currentState,
                history,
                logs: allLogs,
                updatedAt: new Date().toISOString(),
              });

              result = {
                status: 'cancelled',
                instanceId,
              };
            } else {
              // Unexpected terminal state
              yield* store.updateInstance(instanceId, {
                status: 'error',
                currentState,
                error: `Unexpected terminal state "${currentState}"`,
                history,
                logs: allLogs,
                updatedAt: new Date().toISOString(),
              });

              result = {
                status: 'error',
                error: `Unexpected terminal state "${currentState}"`,
                instanceId,
              };
            }

            return result;
          }).pipe(
            Effect.onInterrupt(() =>
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
                const reason: 'suspended' | 'cancelled' = isShuttingDown
                  ? 'suspended'
                  : 'cancelled';

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
              }).pipe(Effect.catchAll(() => Effect.void)),
            ),
          );

          // ──────────────────────────────────────────────────────────────
          // 5. Fork as fiber, track, await, cleanup
          // ──────────────────────────────────────────────────────────────

          const fiber = yield* Effect.fork(machineExec);
          fiberMap.set(instanceId, fiber);

          const exit = yield* Fiber.await(fiber);
          fiberMap.delete(instanceId);

          if (Exit.isSuccess(exit)) {
            return exit.value;
          }

          // Fiber was interrupted — onInterrupt finalizer already persisted state.
          // Distinguish suspended (shutdown) from cancelled (explicit cancel).
          if (Exit.isFailure(exit) && Cause.isInterruptedOnly(exit.cause)) {
            if (isShuttingDown) {
              return { status: 'cancelled' as const, instanceId } as MachineResult;
            }
            return { status: 'cancelled' as const, instanceId } as MachineResult;
          }

          // Re-raise non-interruption failures
          return yield* Effect.failCause(exit.cause);
        });
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
        });
      },

      // ────────────────────────────────────────────────────────────────
      // resume() — Task 15: Resume a suspended machine instance
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
            // Single child — resume if suspended, skip if already completed
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
            // Parallel children — resume each suspended child
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

          // 6. Re-run the machine from the persisted currentState.
          //    We call runner.run() with the original definition + input,
          //    but we need to fast-forward past already-completed transitions.
          //    Instead, we build a "trimmed" run that enters the state loop
          //    at instance.currentState with instance.stateData.
          const resumeExec = Effect.gen(function* () {
            let currentState = instance.currentState;
            let stateData: unknown = instance.stateData;
            let history: TransitionRecord[] = [...instance.history];
            let allLogs = [...instance.logs];
            let errorResult: MachineResult | null = null;

            // Build parent context (if child machine)
            const parentContext = instance.parentInstanceId
              ? {
                  parentInstanceId: instance.parentInstanceId,
                  parentStateName:
                    instance.history.length > 0
                      ? instance.history[instance.history.length - 1].fromState
                      : instance.currentState,
                }
              : undefined;

            const persistError = (
              errorMessage: string,
              actionId: string | undefined,
              durationMs: number,
            ) =>
              Effect.gen(function* () {
                const errorTransitionRecord: TransitionRecord = {
                  id: crypto.randomUUID(),
                  fromState: currentState,
                  toState: 'error',
                  timestamp: new Date().toISOString(),
                  durationMs,
                  actionId,
                };

                history = [...history, errorTransitionRecord];

                yield* store.updateInstance(instanceId, {
                  status: 'error',
                  currentState: 'error',
                  stateData,
                  error: errorMessage,
                  history,
                  logs: allLogs,
                  updatedAt: new Date().toISOString(),
                });

                errorResult = {
                  status: 'error',
                  error: errorMessage,
                  instanceId,
                };
              });

            const executeAction = (
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

                const rawAction = actionFn(actionCtx);
                const timedAction = stateDef.timeoutMs
                  ? rawAction.pipe(
                      Effect.timeoutFail({
                        duration: Duration.millis(stateDef.timeoutMs),
                        onTimeout: () =>
                          mkActionError({
                            actionId,
                            stateName: currentState,
                            cause: 'timeout',
                          }),
                      }),
                    )
                  : rawAction;

                const transitionResult = yield* timedAction.pipe(
                  Effect.catchAll((actionError: ActionError) =>
                    Effect.gen(function* () {
                      const machineError: MachineError = mkActionError({
                        actionId,
                        stateName: currentState,
                        cause: actionError.cause ?? actionError,
                      });

                      yield* middlewareExec.runOnError({
                        ...middlewareCtx,
                        error: machineError,
                      });

                      const errorLogs = [...loggerFactory.getEntries()];
                      allLogs = [...allLogs, ...errorLogs];

                      const isTimeout = actionError.cause === 'timeout';
                      const errorMessage = isTimeout
                        ? `Action '${actionId}' in state '${currentState}' timed out after ${String(stateDef.timeoutMs ?? 0)}ms`
                        : actionError.cause instanceof Error
                          ? actionError.cause.message
                          : typeof actionError.cause === 'string'
                            ? actionError.cause
                            : `Action "${actionId}" failed in state "${currentState}"`;

                      const durationMs = Date.now() - startTime;
                      yield* persistError(errorMessage, actionId, durationMs);

                      return { nextState: 'error' } as TransitionResult;
                    }),
                  ),
                );

                const durationMs = Date.now() - startTime;
                return { transitionResult, durationMs };
              });

            // ── Resume state loop ──
            const stateLoop = Effect.gen(function* () {
              const runPreamble = () =>
                Effect.gen(function* () {
                  yield* store.updateInstance(instanceId, {
                    currentState,
                    stateData,
                    history,
                    updatedAt: new Date().toISOString(),
                  });

                  const loggerFactory = createStateLoggerFactory();
                  const logger = loggerFactory.create(instanceId, currentState);
                  const artifacts = artifactFactory.makeScoped(
                    instanceId,
                    currentState,
                    instance.parentInstanceId,
                  );

                  const actionCtx: ActionContext = {
                    machineInstanceId: instanceId,
                    machineDefId: definition.id,
                    stateName: currentState,
                    stateData,
                    machineInput: instance.input,
                    parentContext,
                    logger,
                    artifacts,
                  };

                  const latestInstance = yield* store.getInstance(instanceId);
                  const middlewareCtx = {
                    instance: latestInstance,
                    stateName: currentState,
                    stateData,
                    definition,
                  };

                  yield* middlewareExec.runBefore(middlewareCtx);

                  return { loggerFactory, actionCtx, middlewareCtx };
                });

              // The state loop — identical to the run() loop but starting
              // from the resumed currentState.
              while (definition.states[currentState].type !== 'terminal') {
                const stateDef = definition.states[currentState];

                if (stateDef.type === 'child_machine') {
                  // For child_machine states on resume:
                  // Check if the child has already completed. If so, use
                  // its result directly. Otherwise, re-spawn.
                  const existingChildId = instance.childInstanceId;
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
                      // Child already reached terminal — use its stored result
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

                        yield* store.updateInstance(instanceId, {
                          status: 'running',
                          childInstanceId: resolvedChild.instanceId,
                          updatedAt: new Date().toISOString(),
                        });

                        stateData = resolvedChild;

                        const actionId = stateDef.actionId;
                        if (!actionId) {
                          return yield* Effect.fail(
                            mkDefinitionError({
                              message: `State "${currentState}" of type "child_machine" has no actionId`,
                            }),
                          );
                        }

                        const childActionCtx: ActionContext = {
                          ...preamble.actionCtx,
                          stateData,
                        };

                        const { transitionResult, durationMs } = yield* executeAction(
                          actionId,
                          childActionCtx,
                          stateDef,
                          { ...preamble.middlewareCtx, stateData },
                          preamble.loggerFactory,
                        );

                        if (errorResult) return;

                        if (
                          !isLegalTransition(
                            currentState,
                            transitionResult.nextState,
                            definition.transitions,
                          )
                        ) {
                          return yield* Effect.fail(
                            mkDefinitionError({
                              message: `Illegal transition from "${currentState}" to "${transitionResult.nextState}"`,
                            }),
                          );
                        }

                        yield* middlewareExec.runAfter({
                          ...preamble.middlewareCtx,
                          stateData,
                          result: transitionResult,
                        });

                        const transitionRecord: TransitionRecord = {
                          id: crypto.randomUUID(),
                          fromState: currentState,
                          toState: transitionResult.nextState,
                          data: transitionResult.data,
                          timestamp: new Date().toISOString(),
                          durationMs,
                          actionId,
                          childInstanceId: resolvedChild.instanceId,
                          childDefinitionId: stateDef.childMachineDefId,
                        };

                        history = [...history, transitionRecord];

                        const logEntries = [...preamble.loggerFactory.getEntries()];
                        allLogs = [...allLogs, ...logEntries];

                        const nextState = transitionResult.nextState;
                        const nextStateData = transitionResult.data ?? stateData;

                        yield* store.updateInstance(instanceId, {
                          currentState: nextState,
                          stateData: nextStateData,
                          childInstanceId: undefined,
                          history,
                          logs: allLogs,
                          updatedAt: new Date().toISOString(),
                        });

                        currentState = nextState;
                        stateData = nextStateData;
                      }),
                    );

                    if (errorResult) return;
                  } else {
                    // Child needs to be (re-)spawned — delegate to normal run path
                    // by re-using the same child_machine logic from run()
                    const childSpawnInfo = yield* semaphore.withPermits(1)(
                      Effect.gen(function* () {
                        const preamble = yield* runPreamble();

                        const childDefId = stateDef.childMachineDefId;
                        if (!childDefId) {
                          return yield* Effect.fail(
                            mkDefinitionError({
                              message: `State "${currentState}" of type "child_machine" has no childMachineDefId`,
                            }),
                          );
                        }

                        const childDefinition = yield* store
                          .getDefinition(childDefId)
                          .pipe(
                            Effect.catchTag('NotFoundError', (err: NotFoundError) =>
                              Effect.fail(
                                mkNotFoundError({ entityType: err.entityType, id: err.id }),
                              ),
                            ),
                          );

                        const mappingExpr = stateDef.childInputMapping;
                        if (!mappingExpr) {
                          return yield* Effect.fail(
                            mkDefinitionError({
                              message: `State "${currentState}" of type "child_machine" has no childInputMapping`,
                            }),
                          );
                        }

                        let childInput: unknown;
                        try {
                          const jsonPathResult: unknown[] = JSONPath({
                            path: mappingExpr,
                            json: {
                              stateData,
                              machineInput: instance.input,
                              stateName: currentState,
                            },
                          });

                          if (!Array.isArray(jsonPathResult) || jsonPathResult.length === 0) {
                            return yield* Effect.fail(
                              mkActionError({
                                actionId: 'child_machine',
                                stateName: currentState,
                                cause: `childInputMapping "${mappingExpr}" returned no results`,
                              }),
                            );
                          }

                          childInput =
                            jsonPathResult.length === 1 ? jsonPathResult[0] : jsonPathResult;
                        } catch (jsonPathError) {
                          return yield* Effect.fail(
                            mkActionError({
                              actionId: 'child_machine',
                              stateName: currentState,
                              cause:
                                jsonPathError instanceof Error
                                  ? `Invalid childInputMapping: ${jsonPathError.message}`
                                  : `Invalid childInputMapping: ${String(jsonPathError)}`,
                            }),
                          );
                        }

                        yield* store.updateInstance(instanceId, {
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

                    const childStartTime = Date.now();
                    const freshChildResult: MachineResult = yield* runner.run(
                      childSpawnInfo.childDefinition,
                      childSpawnInfo.childInput,
                      {
                        parentInstanceId: instanceId,
                        parentStateName: currentState,
                        depth: 1, // resumed children start at depth 1
                      },
                    );

                    yield* semaphore.withPermits(1)(
                      Effect.gen(function* () {
                        yield* store.updateInstance(instanceId, {
                          status: 'running',
                          childInstanceId: freshChildResult.instanceId,
                          updatedAt: new Date().toISOString(),
                        });

                        stateData = freshChildResult;

                        const actionId = stateDef.actionId;
                        if (!actionId) {
                          return yield* Effect.fail(
                            mkDefinitionError({
                              message: `State "${currentState}" of type "child_machine" has no actionId`,
                            }),
                          );
                        }

                        const childActionCtx: ActionContext = {
                          ...childSpawnInfo.actionCtx,
                          stateData,
                        };

                        const { transitionResult, durationMs } = yield* executeAction(
                          actionId,
                          childActionCtx,
                          stateDef,
                          { ...childSpawnInfo.middlewareCtx, stateData },
                          childSpawnInfo.loggerFactory,
                        );

                        if (errorResult) return;

                        if (
                          !isLegalTransition(
                            currentState,
                            transitionResult.nextState,
                            definition.transitions,
                          )
                        ) {
                          return yield* Effect.fail(
                            mkDefinitionError({
                              message: `Illegal transition from "${currentState}" to "${transitionResult.nextState}"`,
                            }),
                          );
                        }

                        yield* middlewareExec.runAfter({
                          ...childSpawnInfo.middlewareCtx,
                          stateData,
                          result: transitionResult,
                        });

                        const totalDurationMs = Date.now() - childStartTime;
                        const transitionRecord: TransitionRecord = {
                          id: crypto.randomUUID(),
                          fromState: currentState,
                          toState: transitionResult.nextState,
                          data: transitionResult.data,
                          timestamp: new Date().toISOString(),
                          durationMs: totalDurationMs > 0 ? totalDurationMs : durationMs,
                          actionId,
                          childInstanceId: freshChildResult.instanceId,
                          childDefinitionId: childSpawnInfo.childDefId,
                        };

                        history = [...history, transitionRecord];

                        const logEntries = [...childSpawnInfo.loggerFactory.getEntries()];
                        allLogs = [...allLogs, ...logEntries];

                        const nextState = transitionResult.nextState;
                        const nextStateData = transitionResult.data ?? stateData;

                        yield* store.updateInstance(instanceId, {
                          currentState: nextState,
                          stateData: nextStateData,
                          childInstanceId: undefined,
                          history,
                          logs: allLogs,
                          updatedAt: new Date().toISOString(),
                        });

                        currentState = nextState;
                        stateData = nextStateData;
                      }),
                    );

                    if (errorResult) return;
                  }
                } else if (stateDef.type === 'parallel_children') {
                  // For parallel_children on resume: check if all children
                  // have reached terminal state. If so, collect results.
                  // Otherwise re-spawn the incomplete ones.
                  const existingChildIds = instance.childInstanceIds;
                  const childResults: Record<string, MachineResult> = {};
                  const childInstanceIds: Record<string, string> = {};
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
                        childResults[key] =
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
                        childInstanceIds[key] = childInstance.id;
                      } else {
                        allChildrenDone = false;
                      }
                    }
                  } else {
                    allChildrenDone = false;
                  }

                  if (!allChildrenDone) {
                    // Not all children are done — this shouldn't normally happen
                    // after recursive resume, but handle gracefully by re-running
                    // the parallel_children state as if fresh.
                    // For now, fail with a descriptive error.
                    return yield* Effect.fail(
                      mkDefinitionError({
                        message: `Cannot resume parallel_children state "${currentState}" — not all children have reached terminal state`,
                      }),
                    );
                  }

                  // All children done — proceed to post-children action
                  yield* semaphore.withPermits(1)(
                    Effect.gen(function* () {
                      const preamble = yield* runPreamble();

                      const parallelResult: ParallelChildrenResult = {
                        results: childResults,
                        childInstanceIds,
                      };

                      yield* store.updateInstance(instanceId, {
                        status: 'running',
                        childInstanceIds,
                        updatedAt: new Date().toISOString(),
                      });

                      stateData = parallelResult;

                      const actionId = stateDef.actionId;
                      if (!actionId) {
                        return yield* Effect.fail(
                          mkDefinitionError({
                            message: `State "${currentState}" of type "parallel_children" has no actionId`,
                          }),
                        );
                      }

                      const parallelActionCtx: ActionContext = {
                        ...preamble.actionCtx,
                        stateData,
                      };

                      const { transitionResult, durationMs } = yield* executeAction(
                        actionId,
                        parallelActionCtx,
                        stateDef,
                        { ...preamble.middlewareCtx, stateData },
                        preamble.loggerFactory,
                      );

                      if (errorResult) return;

                      if (
                        !isLegalTransition(
                          currentState,
                          transitionResult.nextState,
                          definition.transitions,
                        )
                      ) {
                        return yield* Effect.fail(
                          mkDefinitionError({
                            message: `Illegal transition from "${currentState}" to "${transitionResult.nextState}"`,
                          }),
                        );
                      }

                      yield* middlewareExec.runAfter({
                        ...preamble.middlewareCtx,
                        stateData,
                        result: transitionResult,
                      });

                      const transitionRecord: TransitionRecord = {
                        id: crypto.randomUUID(),
                        fromState: currentState,
                        toState: transitionResult.nextState,
                        data: transitionResult.data,
                        timestamp: new Date().toISOString(),
                        durationMs,
                        actionId,
                        childInstanceIds,
                      };

                      history = [...history, transitionRecord];

                      const logEntries = [...preamble.loggerFactory.getEntries()];
                      allLogs = [...allLogs, ...logEntries];

                      const nextState = transitionResult.nextState;
                      const nextStateData = transitionResult.data ?? stateData;

                      yield* store.updateInstance(instanceId, {
                        currentState: nextState,
                        stateData: nextStateData,
                        childInstanceIds: undefined,
                        history,
                        logs: allLogs,
                        updatedAt: new Date().toISOString(),
                      });

                      currentState = nextState;
                      stateData = nextStateData;
                    }),
                  );

                  if (errorResult) return;
                } else {
                  // ── Normal action execution (same as run() loop) ──
                  yield* semaphore.withPermits(1)(
                    Effect.gen(function* () {
                      const { loggerFactory, actionCtx, middlewareCtx } = yield* runPreamble();

                      const actionId = stateDef.actionId;
                      if (!actionId) {
                        return yield* Effect.fail(
                          mkDefinitionError({
                            message: `State "${currentState}" of type "action" has no actionId`,
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

                      if (errorResult) return;

                      if (
                        !isLegalTransition(
                          currentState,
                          transitionResult.nextState,
                          definition.transitions,
                        )
                      ) {
                        return yield* Effect.fail(
                          mkDefinitionError({
                            message: `Illegal transition from "${currentState}" to "${transitionResult.nextState}"`,
                          }),
                        );
                      }

                      yield* middlewareExec.runAfter({
                        ...middlewareCtx,
                        result: transitionResult,
                      });

                      const transitionRecord: TransitionRecord = {
                        id: crypto.randomUUID(),
                        fromState: currentState,
                        toState: transitionResult.nextState,
                        data: transitionResult.data,
                        timestamp: new Date().toISOString(),
                        durationMs,
                        actionId,
                      };

                      history = [...history, transitionRecord];

                      const logEntries = [...loggerFactory.getEntries()];
                      allLogs = [...allLogs, ...logEntries];

                      const nextState = transitionResult.nextState;
                      const nextStateData = transitionResult.data ?? stateData;

                      yield* store.updateInstance(instanceId, {
                        currentState: nextState,
                        stateData: nextStateData,
                        history,
                        logs: allLogs,
                        updatedAt: new Date().toISOString(),
                      });

                      currentState = nextState;
                      stateData = nextStateData;
                    }),
                  );

                  if (errorResult) return;
                }
              }
            });

            yield* stateLoop;

            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (errorResult) {
              return errorResult;
            }

            // ── Terminal state resolution ──
            let result: MachineResult;

            if (currentState === 'completed') {
              const output = history.length > 0 ? history[history.length - 1].data : stateData;

              yield* store.updateInstance(instanceId, {
                status: 'completed',
                currentState,
                output,
                history,
                logs: allLogs,
                updatedAt: new Date().toISOString(),
              });

              result = { status: 'completed', output, instanceId };
            } else if (currentState === 'error') {
              const errorMsg =
                history.length > 0
                  ? 'Machine reached error state'
                  : 'Machine entered error terminal state';

              yield* store.updateInstance(instanceId, {
                status: 'error',
                currentState,
                error: errorMsg,
                history,
                logs: allLogs,
                updatedAt: new Date().toISOString(),
              });

              result = { status: 'error', error: errorMsg, instanceId };
            } else if (currentState === 'cancelled') {
              yield* store.updateInstance(instanceId, {
                status: 'cancelled',
                currentState,
                history,
                logs: allLogs,
                updatedAt: new Date().toISOString(),
              });

              result = { status: 'cancelled', instanceId };
            } else {
              yield* store.updateInstance(instanceId, {
                status: 'error',
                currentState,
                error: `Unexpected terminal state "${currentState}"`,
                history,
                logs: allLogs,
                updatedAt: new Date().toISOString(),
              });

              result = {
                status: 'error',
                error: `Unexpected terminal state "${currentState}"`,
                instanceId,
              };
            }

            return result;
          }).pipe(
            Effect.onInterrupt(() =>
              Effect.gen(function* () {
                const latestInstance = yield* store
                  .getInstance(instanceId)
                  .pipe(Effect.catchAll(() => Effect.succeed(null as MachineInstance | null)));
                if (!latestInstance) return;

                if (
                  latestInstance.status === 'cancelled' ||
                  latestInstance.status === 'completed' ||
                  latestInstance.status === 'error' ||
                  latestInstance.status === 'suspended'
                ) {
                  return;
                }

                const reason: 'suspended' | 'cancelled' = isShuttingDown
                  ? 'suspended'
                  : 'cancelled';

                if (reason === 'suspended') {
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
              }).pipe(Effect.catchAll(() => Effect.void)),
            ),
          );

          // Fork as fiber, track, await, cleanup
          const fiber = yield* Effect.fork(resumeExec);
          fiberMap.set(instanceId, fiber);

          const exit = yield* Fiber.await(fiber);
          fiberMap.delete(instanceId);

          if (Exit.isSuccess(exit)) {
            return exit.value;
          }

          if (Exit.isFailure(exit) && Cause.isInterruptedOnly(exit.cause)) {
            if (isShuttingDown) {
              return { status: 'cancelled' as const, instanceId } as MachineResult;
            }
            return { status: 'cancelled' as const, instanceId } as MachineResult;
          }

          return yield* Effect.failCause(exit.cause);
        });
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
