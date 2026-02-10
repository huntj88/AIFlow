/**
 * Reusable definition & input fixtures for server E2E tests (Task 34).
 *
 * All definitions omit `id`, `version`, `createdAt`, `updatedAt` — the server
 * auto-generates those fields on creation.
 *
 * Action configuration (nextState, delayMs, etc.) is supplied at runtime via
 * the machine `input` which becomes the first state's `stateData`.
 *
 * @module
 */

// ────────────────────────────────────────────────────────────────────────────
// Simple 2-state: log → done  (completes instantly)
// ────────────────────────────────────────────────────────────────────────────

export const SIMPLE_DEFINITION = {
  name: 'E2E Simple Machine',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'start',
  states: {
    start: { name: 'start', type: 'action' as const, actionId: 'log-message' },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [{ from: 'start', to: 'completed' }],
  metadata: { description: 'Simple 2-state test machine', tags: ['e2e'] },
};

export const SIMPLE_INPUT = { message: 'E2E simple machine started', nextState: 'completed' };

// ────────────────────────────────────────────────────────────────────────────
// Linear 3-state: log → branch → done
// ────────────────────────────────────────────────────────────────────────────

export const LINEAR_DEFINITION = {
  name: 'E2E Linear Machine',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'init',
  states: {
    init: { name: 'init', type: 'action' as const, actionId: 'log-message' },
    process: { name: 'process', type: 'action' as const, actionId: 'conditional-branch' },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [
    { from: 'init', to: 'process' },
    { from: 'process', to: 'completed' },
  ],
  metadata: { description: '3-state linear test machine', tags: ['e2e'] },
};

export const LINEAR_INPUT = {
  message: 'E2E linear machine started',
  nextState: 'process',
  condition: { field: 'proceed', operator: 'eq', value: true },
  proceed: true,
  trueState: 'completed',
  falseState: 'completed',
};

// ────────────────────────────────────────────────────────────────────────────
// Branching: conditional-branch → success | failure
// ────────────────────────────────────────────────────────────────────────────

export const BRANCHING_DEFINITION = {
  name: 'E2E Branching Machine',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'check',
  states: {
    check: { name: 'check', type: 'action' as const, actionId: 'conditional-branch' },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [
    { from: 'check', to: 'completed' },
    { from: 'check', to: 'error' },
  ],
  metadata: { description: 'Branching test machine', tags: ['e2e'] },
};

export const BRANCHING_INPUT_TRUE = {
  condition: { field: 'score', operator: 'gt', value: 50 },
  score: 75,
  trueState: 'completed',
  falseState: 'error',
};

export const BRANCHING_INPUT_FALSE = {
  condition: { field: 'score', operator: 'gt', value: 50 },
  score: 25,
  trueState: 'completed',
  falseState: 'error',
};

// ────────────────────────────────────────────────────────────────────────────
// Delay: for cancel / suspend tests (configurable duration)
// ────────────────────────────────────────────────────────────────────────────

export const DELAY_DEFINITION = {
  name: 'E2E Delay Machine',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'waiting',
  states: {
    waiting: { name: 'waiting', type: 'action' as const, actionId: 'delay' },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [{ from: 'waiting', to: 'completed' }],
  metadata: { description: 'Machine with configurable delay', tags: ['e2e'] },
};

/** 30 seconds — long enough to cancel or suspend before it completes */
export const DELAY_INPUT_LONG = { delayMs: 30_000, nextState: 'completed' };

/** 500ms — completes quickly for smoke tests */
export const DELAY_INPUT_SHORT = { delayMs: 500, nextState: 'completed' };

// ────────────────────────────────────────────────────────────────────────────
// Error: delay with a short per-state timeout → always times out
// ────────────────────────────────────────────────────────────────────────────

export const ERROR_DEFINITION = {
  name: 'E2E Error Machine',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'will_timeout',
  states: {
    will_timeout: {
      name: 'will_timeout',
      type: 'action' as const,
      actionId: 'delay',
      timeoutMs: 200,
    },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [{ from: 'will_timeout', to: 'completed' }],
  metadata: { description: 'Machine that always errors via timeout', tags: ['e2e'] },
};

/** delayMs >> timeoutMs ⇒ the state will time out → error */
export const ERROR_INPUT = { delayMs: 60_000, nextState: 'completed' };

// ────────────────────────────────────────────────────────────────────────────
// Parent definition (child_machine state)
// ────────────────────────────────────────────────────────────────────────────

export const makeParentDefinition = (childDefId: string) => ({
  name: 'E2E Parent Machine',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'spawn_child',
  states: {
    spawn_child: {
      name: 'spawn_child',
      type: 'child_machine' as const,
      actionId: 'log-message',
      childMachineDefId: childDefId,
      childInputMapping: '$.machineInput',
    },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [
    { from: 'spawn_child', to: 'completed' },
    { from: 'spawn_child', to: 'error' },
  ],
  metadata: { description: 'Parent machine spawning a child', tags: ['e2e'] },
});

/** Child receives the parent's machineInput */
export const PARENT_INPUT = {
  message: 'E2E child started',
  nextState: 'completed',
};

// ────────────────────────────────────────────────────────────────────────────
// Child definition (simple log → done, used by parent)
// ────────────────────────────────────────────────────────────────────────────

export const CHILD_DEFINITION = {
  name: 'E2E Child Machine',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'child_start',
  states: {
    child_start: { name: 'child_start', type: 'action' as const, actionId: 'log-message' },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [{ from: 'child_start', to: 'completed' }],
  metadata: { description: 'Simple child machine', tags: ['e2e'] },
};

// ────────────────────────────────────────────────────────────────────────────
// Parallel children definition
// ────────────────────────────────────────────────────────────────────────────

export const makeParallelDefinition = (childDefId1: string, childDefId2: string) => ({
  name: 'E2E Parallel Machine',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'spawn_parallel',
  states: {
    spawn_parallel: {
      name: 'spawn_parallel',
      type: 'parallel_children' as const,
      actionId: 'log-message',
      children: [
        { key: 'child_a', machineDefId: childDefId1, inputMapping: '$.machineInput' },
        { key: 'child_b', machineDefId: childDefId2, inputMapping: '$.machineInput' },
      ],
      parallelMode: 'all_settled' as const,
    },
    completed: { name: 'completed', type: 'terminal' as const },
    cancelled: { name: 'cancelled', type: 'terminal' as const },
    error: { name: 'error', type: 'terminal' as const },
  },
  transitions: [
    { from: 'spawn_parallel', to: 'completed' },
    { from: 'spawn_parallel', to: 'error' },
  ],
  metadata: { description: 'Parallel children machine', tags: ['e2e'] },
});

export const PARALLEL_INPUT = {
  message: 'E2E parallel started',
  nextState: 'completed',
};

// ────────────────────────────────────────────────────────────────────────────
// Validation fixtures — invalid definitions for negative tests
// ────────────────────────────────────────────────────────────────────────────

/** Missing required `initialState` field */
export const INVALID_NO_INITIAL_STATE = {
  name: 'Invalid Machine',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  states: {
    start: { name: 'start', type: 'action' as const, actionId: 'log-message' },
    completed: { name: 'completed', type: 'terminal' as const },
  },
  transitions: [{ from: 'start', to: 'completed' }],
};

/** initialState references a state that does not exist */
export const INVALID_DANGLING_INITIAL = {
  name: 'Dangling Initial',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'nonexistent',
  states: {
    start: { name: 'start', type: 'action' as const, actionId: 'log-message' },
    completed: { name: 'completed', type: 'terminal' as const },
  },
  transitions: [{ from: 'start', to: 'completed' }],
};

/** No terminal state */
export const INVALID_NO_TERMINAL = {
  name: 'No Terminal',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'start',
  states: {
    start: { name: 'start', type: 'action' as const, actionId: 'log-message' },
  },
  transitions: [],
};

/** Empty name */
export const INVALID_EMPTY_NAME = {
  name: '',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'start',
  states: {
    start: { name: 'start', type: 'action' as const, actionId: 'log-message' },
    completed: { name: 'completed', type: 'terminal' as const },
  },
  transitions: [{ from: 'start', to: 'completed' }],
};
