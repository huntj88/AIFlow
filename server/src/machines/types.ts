import type { Effect } from 'effect';

// ────────────────────────────────────────────────────────────────────────────
// JSON Schema
// ────────────────────────────────────────────────────────────────────────────

/**
 * JSON Schema object (Draft 2020-12 or compatible).
 * Validated at runtime via `ajv`. Typed as a generic record here;
 * use `ajv`'s `JSONSchemaType<T>` for stricter compile-time checking
 * where the target type T is known.
 */
export type JsonSchema = Record<string, unknown>;

// ────────────────────────────────────────────────────────────────────────────
// Definition Types
// ────────────────────────────────────────────────────────────────────────────

/** Full declarative description of a state machine. */
export interface StateMachineDefinition {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  readonly states: Record<string, StateDefinition>;
  readonly initialState: string;
  readonly transitions: TransitionRule[];
  readonly metadata: {
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly description?: string;
    readonly tags?: string[];
  };
}

/** Per-state configuration within a definition. */
export interface StateDefinition {
  readonly name: string;
  readonly type: 'action' | 'child_machine' | 'parallel_children' | 'terminal';
  readonly actionId?: string;
  readonly childMachineDefId?: string;
  readonly childInputMapping?: string;
  readonly children?: ChildSpawnDefinition[];
  readonly description?: string;
  readonly dataSchema?: JsonSchema;
  readonly timeoutMs?: number;
  readonly parallelMode?: 'all_or_interrupt' | 'all_settled';
}

/** Defines one child machine to spawn within a `parallel_children` state. */
export interface ChildSpawnDefinition {
  readonly key: string;
  readonly machineDefId: string;
  readonly inputMapping: string;
}

/** An allowed transition between two states. */
export interface TransitionRule {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly description?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Runtime Types
// ────────────────────────────────────────────────────────────────────────────

/** Full runtime state of a machine execution. */
export interface MachineInstance {
  readonly id: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly status:
    | 'running'
    | 'completed'
    | 'cancelled'
    | 'error'
    | 'waiting_for_child'
    | 'suspended';
  readonly currentState: string;
  readonly stateData: unknown;
  readonly input: unknown;
  readonly output?: unknown;
  readonly error?: string;
  readonly parentInstanceId?: string;
  readonly childInstanceId?: string;
  readonly childInstanceIds?: Record<string, string>;
  readonly history: TransitionRecord[];
  readonly logs: LogEntry[];
  readonly workspaceRoot: string;
  readonly familyRootInstanceId: string;
  readonly artifactsPath: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A single completed transition recorded in `MachineInstance.history`. */
export interface TransitionRecord {
  readonly id: string;
  readonly fromState: string;
  readonly toState: string;
  readonly data?: unknown;
  readonly timestamp: string;
  readonly durationMs: number;
  readonly actionId?: string;
  readonly childInstanceId?: string;
  readonly childDefinitionId?: string;
  readonly childInstanceIds?: Record<string, string>;
  readonly middlewareResults?: Record<string, unknown>;
}

/** A single log entry produced by a state action. */
export interface LogEntry {
  readonly id: string;
  readonly instanceId: string;
  readonly stateName: string;
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly data?: unknown;
  readonly timestamp: string;
}

/** Terminal result of a machine execution. */
export type MachineResult<T = unknown> =
  | { readonly status: 'completed'; readonly output: T; readonly instanceId: string }
  | { readonly status: 'cancelled'; readonly instanceId: string }
  | { readonly status: 'error'; readonly error: string; readonly instanceId: string };

/** Collected results from a `parallel_children` state. */
export interface ParallelChildrenResult {
  readonly results: Record<string, MachineResult>;
  readonly childInstanceIds: Record<string, string>;
}

/** Filters for querying machine instances. */
export interface InstanceFilter {
  readonly status?: MachineInstance['status'];
  readonly definitionId?: string;
  readonly parentInstanceId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/** Runtime CLI directory policy provided when starting an instance. */
export interface CliDirectoryPolicy {
  readonly workspaceDirs: readonly string[];
  readonly artifactDirs: readonly string[];
}

/** Runtime CLI transcript capture policy provided when starting an instance. */
export interface CliOutputCapturePolicy {
  readonly enabled: boolean;
}

/** Runtime options required at start time for CLI directory + capture behavior. */
export interface MachineRuntimeOptions {
  readonly cliDirectoryPolicy: CliDirectoryPolicy;
  readonly cliOutputCapture: CliOutputCapturePolicy;
}

/** Payload for starting an instance via API. */
export interface StartInstanceRequest {
  readonly definitionId: string;
  readonly input: unknown;
  readonly workspaceRoot: string;
  readonly runtimeOptions: MachineRuntimeOptions;
}

// ────────────────────────────────────────────────────────────────────────────
// CLI Types
// ────────────────────────────────────────────────────────────────────────────

/** Result of executing a CLI command. */
export interface CliExecResult {
  readonly exitCode: number; // -1 = spawn failure
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly transcript?: {
    readonly workspace: 'workspace' | 'artifacts';
    readonly path: string;
    readonly resolvedPath: string;
    readonly label: string;
    readonly exitCode: number;
    readonly durationMs: number;
  };
}

/** Helper for executing CLI commands within an action. */
export interface CliHelper {
  exec(input: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  }): Effect.Effect<CliExecResult>;
}

// ────────────────────────────────────────────────────────────────────────────
// Workspace Types
// ────────────────────────────────────────────────────────────────────────────

/** Context for accessing a workspace directory. */
export interface WorkspaceContext {
  readonly root: string;
  /** Resolve a path within the workspace root. */
  resolve(relativePath: string): string;
}

// ────────────────────────────────────────────────────────────────────────────
// Action Types
// ────────────────────────────────────────────────────────────────────────────

/** Signature of every action function registered in the `ActionRegistry`. */
export type ActionFunction = (ctx: ActionContext) => Effect.Effect<TransitionResult, ActionError>;

/** Context passed to an action function when a state is entered. */
export interface ActionContext {
  readonly machineInstanceId: string;
  readonly machineDefId: string;
  readonly stateName: string;
  readonly stateData: unknown;
  readonly machineInput: unknown;
  readonly runtimeOptions: MachineRuntimeOptions;
  readonly parentContext?: {
    readonly parentInstanceId: string;
    readonly parentStateName: string;
  };
  readonly logger: StateLogger;
  readonly cli: CliHelper;
  readonly workspace: WorkspaceContext;
  readonly artifactsWorkspace: WorkspaceContext;
}

/** What an action returns to declare the next state. */
export interface TransitionResult {
  readonly nextState: string;
  readonly data?: unknown;
}

/** Scoped logger for a single state execution. */
export interface StateLogger {
  debug(message: string, data?: unknown): Effect.Effect<void>;
  info(message: string, data?: unknown): Effect.Effect<void>;
  warn(message: string, data?: unknown): Effect.Effect<void>;
  error(message: string, data?: unknown): Effect.Effect<void>;
}

/** Metadata describing a registered action. */
export interface ActionMetadata {
  readonly id: string;
  readonly description?: string;
  readonly inputSchema?: JsonSchema;
  readonly outputSchema?: JsonSchema;
}

// ────────────────────────────────────────────────────────────────────────────
// Middleware Types
// ────────────────────────────────────────────────────────────────────────────

/** Middleware that wraps every state transition. */
export interface TransitionMiddleware {
  readonly name: string;
  readonly beforeTransition?: (ctx: MiddlewareContext) => Effect.Effect<void, MachineError>;
  readonly afterTransition?: (
    ctx: MiddlewareContext & { readonly result: TransitionResult },
  ) => Effect.Effect<void, MachineError>;
  readonly onError?: (
    ctx: MiddlewareContext & { readonly error: MachineError },
  ) => Effect.Effect<void>;
}

/** Context provided to middleware hooks. */
export interface MiddlewareContext {
  readonly instance: MachineInstance;
  readonly stateName: string;
  readonly stateData: unknown;
  readonly definition: StateMachineDefinition;
}

// ────────────────────────────────────────────────────────────────────────────
// Event Types
// ────────────────────────────────────────────────────────────────────────────

/** Events emitted by the runner to the Effect PubSub for live client updates. */
export type MachineEvent =
  | {
      readonly type: 'state_changed';
      readonly instanceId: string;
      readonly data: {
        readonly previousState: string;
        readonly currentState: string;
        readonly stateData: unknown;
        readonly timestamp: string;
      };
    }
  | {
      readonly type: 'transition_recorded';
      readonly instanceId: string;
      readonly data: TransitionRecord;
    }
  | { readonly type: 'log_entry'; readonly instanceId: string; readonly data: LogEntry }
  | {
      readonly type: 'machine_completed';
      readonly instanceId: string;
      readonly data: MachineResult;
    }
  | {
      readonly type: 'machine_resumed';
      readonly instanceId: string;
      readonly data: {
        readonly previousState: string;
        readonly resumedState: string;
        readonly timestamp: string;
      };
    }
  | {
      readonly type: 'child_spawned';
      readonly instanceId: string;
      readonly data: { readonly childInstanceId: string; readonly childDefinitionId: string };
    }
  | {
      readonly type: 'child_completed';
      readonly instanceId: string;
      readonly data: { readonly childInstanceId: string; readonly result: MachineResult };
    }
  | {
      readonly type: 'children_spawned';
      readonly instanceId: string;
      readonly data: { readonly childInstanceIds: Record<string, string> };
    }
  | {
      readonly type: 'children_completed';
      readonly instanceId: string;
      readonly data: { readonly results: Record<string, MachineResult> };
    };

// ────────────────────────────────────────────────────────────────────────────
// Error Types
// ────────────────────────────────────────────────────────────────────────────

/** Top-level tagged union for all machine errors. */
export type MachineError =
  | ActionError
  | ValidationError
  | StoreError
  | NotFoundError
  | DefinitionError;

/** An action function failed during execution. */
export interface ActionError {
  readonly _tag: 'ActionError';
  readonly actionId: string;
  readonly stateName: string;
  readonly cause: unknown;
}

/** Schema or data validation failed. */
export interface ValidationError {
  readonly _tag: 'ValidationError';
  readonly message: string;
  readonly path?: string;
}

/** Persistence operation failed. */
export interface StoreError {
  readonly _tag: 'StoreError';
  readonly operation: string;
  readonly cause: unknown;
}

/** A definition, instance, or action was not found. */
export interface NotFoundError {
  readonly _tag: 'NotFoundError';
  readonly entityType: 'definition' | 'instance' | 'action';
  readonly id: string;
}

/**
 * The definition itself is invalid (orphan states, missing terminals, etc.).
 * Also used at runtime when an action returns an illegal `nextState` that
 * violates the definition's `transitions[]`.
 */
export interface DefinitionError {
  readonly _tag: 'DefinitionError';
  readonly message: string;
  readonly details?: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// Error Constructor Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Construct a tagged `ActionError`. */
export const mkActionError = (props: Omit<ActionError, '_tag'>): ActionError => ({
  _tag: 'ActionError',
  ...props,
});

/** Construct a tagged `ValidationError`. */
export const mkValidationError = (props: Omit<ValidationError, '_tag'>): ValidationError => ({
  _tag: 'ValidationError',
  ...props,
});

/** Construct a tagged `StoreError`. */
export const mkStoreError = (props: Omit<StoreError, '_tag'>): StoreError => ({
  _tag: 'StoreError',
  ...props,
});

/** Construct a tagged `NotFoundError`. */
export const mkNotFoundError = (props: Omit<NotFoundError, '_tag'>): NotFoundError => ({
  _tag: 'NotFoundError',
  ...props,
});

/** Construct a tagged `DefinitionError`. */
export const mkDefinitionError = (props: Omit<DefinitionError, '_tag'>): DefinitionError => ({
  _tag: 'DefinitionError',
  ...props,
});
