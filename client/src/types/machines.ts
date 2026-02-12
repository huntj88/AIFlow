// ────────────────────────────────────────────────────────────────────────────
// Client-side machine types — mirrors server/src/machines/types.ts
// ────────────────────────────────────────────────────────────────────────────

/** JSON Schema object (Draft 2020-12 or compatible). */
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

/** Metadata describing a registered action. */
export interface ActionMetadata {
  readonly id: string;
  readonly description?: string;
  readonly inputSchema?: JsonSchema;
  readonly outputSchema?: JsonSchema;
}

// ────────────────────────────────────────────────────────────────────────────
// Instance Filter
// ────────────────────────────────────────────────────────────────────────────

/** Filters for querying machine instances. */
export interface InstanceFilter {
  readonly status?: MachineInstance['status'];
  readonly definitionId?: string;
  readonly parentInstanceId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Event Types (for WebSocket — used in Task 25)
// ────────────────────────────────────────────────────────────────────────────

/** Terminal result of a machine execution. */
export type MachineResult<T = unknown> =
  | { readonly status: 'completed'; readonly output: T; readonly instanceId: string }
  | { readonly status: 'cancelled'; readonly instanceId: string }
  | { readonly status: 'error'; readonly error: string; readonly instanceId: string };

/** Events emitted by the runner for live client updates. */
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
      readonly data: {
        readonly childInstanceId: string;
        readonly childDefinitionId: string;
      };
    }
  | {
      readonly type: 'child_completed';
      readonly instanceId: string;
      readonly data: {
        readonly childInstanceId: string;
        readonly result: MachineResult;
      };
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
// Client Error Types
// ────────────────────────────────────────────────────────────────────────────

/** API error response shapes returned by the server. */
export interface ApiValidationError {
  readonly message: string;
  readonly details?: string[];
  readonly path?: string;
}

export interface ApiNotFoundError {
  readonly message: string;
  readonly id: string;
}

export interface ApiConflictError {
  readonly message: string;
  readonly details?: string[];
}

export interface ApiServerError {
  readonly message: string;
}
