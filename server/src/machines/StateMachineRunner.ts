/**
 * StateMachineRunner — Core linear execution loop (Task 09)
 *
 * Implements the core `StateMachineRunner` Effect Service — the main execution
 * engine for state machines. This task covers the **linear execution path** only:
 * `action` type states running in sequence. Child machine spawning, cancellation,
 * suspension/resume, and PubSub are added in subsequent tasks.
 *
 * The runner implements the state loop, middleware integration, transition
 * validation, persistence checkpoints, and `MachineResult` resolution.
 *
 * @module
 */

import AjvModule from 'ajv';
import { Context, Effect, Layer } from 'effect';

import { ActionRegistry } from './ActionRegistry.js';
import { validateDefinition } from './DefinitionValidator.js';
import { createStateLoggerFactory } from './StateLogger.js';
import { ArtifactStoreFactory } from './artifacts/ArtifactStoreFactory.js';
import { MiddlewareExecutor } from './middleware/MiddlewareExecutor.js';
import { MachineStore } from './store/MachineStore.js';
import type {
  ActionContext,
  ActionError,
  MachineError,
  MachineResult,
  StateMachineDefinition,
  TransitionRecord,
  TransitionRule,
} from './types.js';
import { mkActionError, mkDefinitionError, mkValidationError } from './types.js';

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

    const runner: StateMachineRunner = {
      run(definition, input, opts) {
        return Effect.gen(function* () {
          // ──────────────────────────────────────────────────────────────
          // 1. Validate definition at runtime
          // ──────────────────────────────────────────────────────────────

          // Build synchronous adapter for the validator's ActionRegistry
          const registryEntries = yield* registry.list();
          const registryIds = new Set(registryEntries.map((m) => m.id));
          const syncRegistry = { has: (id: string) => registryIds.has(id) };

          yield* validateDefinition(definition, 'runtime', syncRegistry);

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
          // 4. State loop
          // ──────────────────────────────────────────────────────────────

          let currentState = definition.initialState;
          let stateData: unknown = input;
          let history: TransitionRecord[] = [];
          let allLogs = savedInstance.logs;

          while (definition.states[currentState].type !== 'terminal') {
            const stateDef = definition.states[currentState];

            // ── a. Checkpoint 2: Persist BEFORE action runs ──
            yield* store.updateInstance(instanceId, {
              currentState,
              stateData,
              history,
              updatedAt: new Date().toISOString(),
            });

            // ── b. Create scoped StateLogger and ArtifactStore ──
            const loggerFactory = createStateLoggerFactory();
            const logger = loggerFactory.create(instanceId, currentState);
            const artifacts = artifactFactory.makeScoped(
              instanceId,
              currentState,
              opts?.parentInstanceId,
            );

            // ── c. Build ActionContext ──
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

            // ── d. Run middleware beforeTransition ──
            // Fetch latest instance for middleware context
            const latestInstance = yield* store.getInstance(instanceId);
            const middlewareCtx = {
              instance: latestInstance,
              stateName: currentState,
              stateData,
              definition,
            };

            yield* middlewareExec.runBefore(middlewareCtx);

            // ── e. Look up actionId in ActionRegistry ──
            const actionId = stateDef.actionId;
            if (!actionId) {
              return yield* Effect.fail(
                mkDefinitionError({
                  message: `State "${currentState}" of type "action" has no actionId`,
                }),
              );
            }

            const { fn: actionFn } = yield* registry.get(actionId);

            // ── f. Execute the action → get TransitionResult ──
            const startTime = Date.now();

            const transitionResult = yield* actionFn(actionCtx).pipe(
              Effect.catchAll((actionError: ActionError) =>
                Effect.gen(function* () {
                  // Run middleware onError
                  const machineError: MachineError = mkActionError({
                    actionId: actionId,
                    stateName: currentState,
                    cause: actionError.cause ?? actionError,
                  });

                  yield* middlewareExec.runOnError({
                    ...middlewareCtx,
                    error: machineError,
                  });

                  // Collect logs from the failed action
                  const errorLogs = [...loggerFactory.getEntries()];
                  allLogs = [...allLogs, ...errorLogs];

                  // Transition to error terminal state
                  const errorMessage =
                    actionError.cause instanceof Error
                      ? actionError.cause.message
                      : typeof actionError.cause === 'string'
                        ? actionError.cause
                        : `Action "${actionId}" failed in state "${currentState}"`;

                  const durationMs = Date.now() - startTime;

                  // Record the error transition in history
                  const errorTransitionRecord: TransitionRecord = {
                    id: crypto.randomUUID(),
                    fromState: currentState,
                    toState: 'error',
                    timestamp: new Date().toISOString(),
                    durationMs,
                    actionId,
                  };

                  history = [...history, errorTransitionRecord];

                  // Checkpoint 4: Persist final error status
                  yield* store.updateInstance(instanceId, {
                    status: 'error',
                    currentState: 'error',
                    stateData,
                    error: errorMessage,
                    history,
                    logs: allLogs,
                    updatedAt: new Date().toISOString(),
                  });

                  return yield* Effect.fail(machineError);
                }),
              ),
            );

            const durationMs = Date.now() - startTime;

            // ── g. Validate nextState is a legal transition ──
            if (
              !isLegalTransition(currentState, transitionResult.nextState, definition.transitions)
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

            // ── h. Run middleware afterTransition ──
            yield* middlewareExec.runAfter({
              ...middlewareCtx,
              result: transitionResult,
            });

            // ── i. Record TransitionRecord in history ──
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

            // ── j. Collect log entries from StateLogger ──
            const logEntries = [...loggerFactory.getEntries()];
            allLogs = [...allLogs, ...logEntries];

            // ── k. Checkpoint 3: Persist history + logs + advance state ──
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
        });
      },
    };

    return runner;
  }),
);
