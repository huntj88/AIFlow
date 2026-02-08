import { Effect, Either } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ActionRegistry, ValidationMode } from './DefinitionValidator.js';
import { validateDefinition, validateDefinitionWithResolver } from './DefinitionValidator.js';
import type { StateMachineDefinition } from './types.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Run `validateDefinition` and return the result as an Either. */
function runValidation(
  def: StateMachineDefinition,
  mode: ValidationMode = 'save',
  actionRegistry?: ActionRegistry,
) {
  return Effect.runSync(Effect.either(validateDefinition(def, mode, actionRegistry)));
}

/**
 * Build a minimal **valid** definition. All 14 rules pass on this baseline.
 * Tests mutate specific parts to trigger individual rule failures.
 */
function validDefinition(overrides?: Partial<StateMachineDefinition>): StateMachineDefinition {
  return {
    id: 'def-001',
    name: 'test-machine',
    version: 1,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    states: {
      start: { name: 'start', type: 'action', actionId: 'do-stuff' },
      completed: { name: 'completed', type: 'terminal' },
      cancelled: { name: 'cancelled', type: 'terminal' },
      error: { name: 'error', type: 'terminal' },
    },
    initialState: 'start',
    transitions: [{ from: 'start', to: 'completed' }],
    metadata: {
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    ...overrides,
  };
}

/** Assert validation succeeds. */
function expectSuccess(result: Either.Either<void, unknown>) {
  expect(Either.isRight(result)).toBe(true);
}

/** Assert validation fails and return the details array. */
function expectFailure(
  result: Either.Either<void, { readonly _tag: string; readonly details?: string[] }>,
) {
  expect(Either.isLeft(result)).toBe(true);
  if (Either.isLeft(result)) {
    expect(result.left._tag).toBe('DefinitionError');
    return result.left.details ?? [];
  }
  return [];
}

/** Assert that a details array contains at least one entry matching the given rule number. */
function expectRuleViolation(details: string[], ruleNum: number) {
  expect(details.some((d) => d.startsWith(`Rule ${String(ruleNum)}:`))).toBe(true);
}

// ────────────────────────────────────────────────────────────────────────────
// Valid definition passes
// ────────────────────────────────────────────────────────────────────────────

describe('DefinitionValidator', () => {
  it('accepts a valid definition', () => {
    const result = runValidation(validDefinition());
    expectSuccess(result);
  });

  it('accepts a valid definition in runtime mode', () => {
    const registry: ActionRegistry = { has: () => true };
    const result = runValidation(validDefinition(), 'runtime', registry);
    expectSuccess(result);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Rule 1 — initialState must reference an existing state key
  // ──────────────────────────────────────────────────────────────────────

  describe('Rule 1 — initialState', () => {
    it('rejects when initialState references a non-existent state', () => {
      const def = validDefinition({ initialState: 'nonexistent' });
      const details = expectFailure(runValidation(def));
      expectRuleViolation(details, 1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Rule 2 — Required terminal states
  // ──────────────────────────────────────────────────────────────────────

  describe('Rule 2 — required terminal states', () => {
    it('rejects when "completed" terminal is missing', () => {
      const def = validDefinition();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { completed: _completed, ...rest } = def.states;
      const details = expectFailure(runValidation({ ...def, states: rest }));
      expectRuleViolation(details, 2);
    });

    it('rejects when "cancelled" terminal is missing', () => {
      const def = validDefinition();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { cancelled: _cancelled, ...rest } = def.states;
      const details = expectFailure(runValidation({ ...def, states: rest }));
      expectRuleViolation(details, 2);
    });

    it('rejects when "error" terminal is missing', () => {
      const def = validDefinition();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { error: _error, ...rest } = def.states;
      const details = expectFailure(runValidation({ ...def, states: rest }));
      expectRuleViolation(details, 2);
    });

    it('rejects when a terminal state has the wrong type', () => {
      const def = validDefinition({
        states: {
          ...validDefinition().states,
          completed: { name: 'completed', type: 'action', actionId: 'oops' },
        },
      });
      const details = expectFailure(runValidation(def));
      expectRuleViolation(details, 2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Rule 3 — No transitions from terminal states
  // ──────────────────────────────────────────────────────────────────────

  describe('Rule 3 — no transitions from terminal states', () => {
    it('rejects transitions originating from a terminal state', () => {
      const def = validDefinition({
        transitions: [
          { from: 'start', to: 'completed' },
          { from: 'completed', to: 'start' },
        ],
      });
      const details = expectFailure(runValidation(def));
      expectRuleViolation(details, 3);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Rule 4 — Transition references existing states
  // ──────────────────────────────────────────────────────────────────────

  describe('Rule 4 — transition state references', () => {
    it('rejects transition with non-existent "from" state', () => {
      const def = validDefinition({
        transitions: [
          { from: 'start', to: 'completed' },
          { from: 'ghost', to: 'completed' },
        ],
      });
      const details = expectFailure(runValidation(def));
      expectRuleViolation(details, 4);
    });

    it('rejects transition with non-existent "to" state', () => {
      const def = validDefinition({
        transitions: [{ from: 'start', to: 'nowhere' }],
      });
      const details = expectFailure(runValidation(def));
      expectRuleViolation(details, 4);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Rule 5 — Non-terminal states need outgoing transitions
  // ──────────────────────────────────────────────────────────────────────

  describe('Rule 5 — outgoing transitions for non-terminal states', () => {
    it('rejects non-terminal state with zero outgoing transitions', () => {
      const def = validDefinition({
        states: {
          ...validDefinition().states,
          orphan_action: { name: 'orphan_action', type: 'action', actionId: 'noop' },
        },
        transitions: [{ from: 'start', to: 'orphan_action' }],
      });
      // 'start' now has an outgoing but 'orphan_action' does not.
      // Also 'start' no longer transitions to completed — will trigger Rule 5 for 'orphan_action'.
      const details = expectFailure(runValidation(def));
      expectRuleViolation(details, 5);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Rule 6 — No orphan non-terminal states
  // ──────────────────────────────────────────────────────────────────────

  describe('Rule 6 — orphan states', () => {
    it('rejects non-terminal state not reachable from initialState', () => {
      const def = validDefinition({
        states: {
          ...validDefinition().states,
          island: { name: 'island', type: 'action', actionId: 'noop' },
        },
        transitions: [
          { from: 'start', to: 'completed' },
          { from: 'island', to: 'completed' }, // island has outgoing, but not reachable
        ],
      });
      const details = expectFailure(runValidation(def));
      expectRuleViolation(details, 6);
    });

    it('does NOT reject orphan terminal states (exempt)', () => {
      // cancelled and error are terminal but may not be reachable — that's OK.
      const result = runValidation(validDefinition());
      expectSuccess(result);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Rule 7 — name must match key
  // ──────────────────────────────────────────────────────────────────────

  describe('Rule 7 — name matches key', () => {
    it('rejects when state name does not match its key', () => {
      const def = validDefinition({
        states: {
          ...validDefinition().states,
          start: { name: 'wrong-name', type: 'action', actionId: 'do-stuff' },
        },
      });
      const details = expectFailure(runValidation(def));
      expectRuleViolation(details, 7);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Rule 8 — actionId must be registered
  // ──────────────────────────────────────────────────────────────────────

  describe('Rule 8 — actionId registration', () => {
    it('passes in save mode even with unknown actionId (advisory)', () => {
      const def = validDefinition();
      const result = runValidation(def, 'save');
      expectSuccess(result);
    });

    it('fails in runtime mode with unknown actionId', () => {
      const registry: ActionRegistry = { has: () => false };
      const def = validDefinition();
      const details = expectFailure(runValidation(def, 'runtime', registry));
      expectRuleViolation(details, 8);
    });

    it('passes in runtime mode when actionId is registered', () => {
      const registry: ActionRegistry = { has: (id: string) => id === 'do-stuff' };
      const def = validDefinition();
      const result = runValidation(def, 'runtime', registry);
      expectSuccess(result);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Rule 9 — child_machine required fields
  // ──────────────────────────────────────────────────────────────────────

  describe('Rule 9 — child_machine fields', () => {
    it('rejects child_machine state missing required fields', () => {
      const def = validDefinition({
        states: {
          ...validDefinition().states,
          start: { name: 'start', type: 'child_machine' }, // missing all three
        },
      });
      const details = expectFailure(runValidation(def));
      expectRuleViolation(details, 9);
      // Should have three violations for the three missing fields.
      const rule9Details = details.filter((d) => d.startsWith('Rule 9:'));
      expect(rule9Details.length).toBe(3);
    });

    it('accepts child_machine state with all required fields', () => {
      const def = validDefinition({
        states: {
          ...validDefinition().states,
          start: {
            name: 'start',
            type: 'child_machine',
            actionId: 'process-child',
            childMachineDefId: 'def-002',
            childInputMapping: '$.stateData',
          },
        },
      });
      const result = runValidation(def);
      expectSuccess(result);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Rule 10 — parallel_children required fields
  // ──────────────────────────────────────────────────────────────────────

  describe('Rule 10 — parallel_children fields', () => {
    it('rejects parallel_children with empty children array', () => {
      const def = validDefinition({
        states: {
          ...validDefinition().states,
          start: {
            name: 'start',
            type: 'parallel_children',
            actionId: 'aggregate',
            children: [],
          },
        },
      });
      const details = expectFailure(runValidation(def));
      expectRuleViolation(details, 10);
    });

    it('rejects parallel_children missing actionId', () => {
      const def = validDefinition({
        states: {
          ...validDefinition().states,
          start: {
            name: 'start',
            type: 'parallel_children',
            children: [{ key: 'a', machineDefId: 'def-002', inputMapping: '$.stateData' }],
          },
        },
      });
      const details = expectFailure(runValidation(def));
      expectRuleViolation(details, 10);
    });

    it('accepts parallel_children with actionId and non-empty children', () => {
      const def = validDefinition({
        states: {
          ...validDefinition().states,
          start: {
            name: 'start',
            type: 'parallel_children',
            actionId: 'aggregate',
            children: [{ key: 'a', machineDefId: 'def-002', inputMapping: '$.stateData' }],
          },
        },
      });
      const result = runValidation(def);
      expectSuccess(result);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Rule 11 — terminal states must not have forbidden fields
  // ──────────────────────────────────────────────────────────────────────

  describe('Rule 11 — terminal state forbidden fields', () => {
    it('rejects terminal state with actionId', () => {
      const def = validDefinition({
        states: {
          ...validDefinition().states,
          completed: { name: 'completed', type: 'terminal', actionId: 'oops' },
        },
      });
      const details = expectFailure(runValidation(def));
      expectRuleViolation(details, 11);
    });

    it('rejects terminal state with childMachineDefId', () => {
      const def = validDefinition({
        states: {
          ...validDefinition().states,
          completed: { name: 'completed', type: 'terminal', childMachineDefId: 'def-002' },
        },
      });
      const details = expectFailure(runValidation(def));
      expectRuleViolation(details, 11);
    });

    it('rejects terminal state with children', () => {
      const def = validDefinition({
        states: {
          ...validDefinition().states,
          completed: {
            name: 'completed',
            type: 'terminal',
            children: [{ key: 'a', machineDefId: 'def-002', inputMapping: '$.stateData' }],
          },
        },
      });
      const details = expectFailure(runValidation(def));
      expectRuleViolation(details, 11);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Rule 12 — no cycles in child machine references
  // ──────────────────────────────────────────────────────────────────────

  describe('Rule 12 — cycle detection', () => {
    it('rejects definition that references itself as a child machine', () => {
      const def = validDefinition({
        states: {
          ...validDefinition().states,
          start: {
            name: 'start',
            type: 'child_machine',
            actionId: 'process-child',
            childMachineDefId: 'def-001', // self-reference
            childInputMapping: '$.stateData',
          },
        },
      });
      const details = expectFailure(runValidation(def));
      expectRuleViolation(details, 12);
    });

    it('rejects definition with self-reference in parallel_children', () => {
      const def = validDefinition({
        states: {
          ...validDefinition().states,
          start: {
            name: 'start',
            type: 'parallel_children',
            actionId: 'aggregate',
            children: [{ key: 'a', machineDefId: 'def-001', inputMapping: '$.stateData' }],
          },
        },
      });
      const details = expectFailure(runValidation(def));
      expectRuleViolation(details, 12);
    });

    it('accepts definition referencing a different definition', () => {
      const def = validDefinition({
        states: {
          ...validDefinition().states,
          start: {
            name: 'start',
            type: 'child_machine',
            actionId: 'process-child',
            childMachineDefId: 'def-other', // different def
            childInputMapping: '$.stateData',
          },
        },
      });
      const result = runValidation(def);
      expectSuccess(result);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Rule 12 Extended — transitive cycle detection with resolver
  // ──────────────────────────────────────────────────────────────────────

  describe('Rule 12 — transitive cycle detection (with resolver)', () => {
    it('detects transitive cycle: A → B → A', () => {
      const defA = validDefinition({
        id: 'def-A',
        states: {
          ...validDefinition().states,
          start: {
            name: 'start',
            type: 'child_machine',
            actionId: 'process',
            childMachineDefId: 'def-B',
            childInputMapping: '$.stateData',
          },
        },
      });

      const defB = validDefinition({
        id: 'def-B',
        states: {
          ...validDefinition().states,
          start: {
            name: 'start',
            type: 'child_machine',
            actionId: 'process',
            childMachineDefId: 'def-A', // cycle back to A
            childInputMapping: '$.stateData',
          },
        },
      });

      const resolver = (id: string) => {
        if (id === 'def-B') return Effect.succeed(defB);
        if (id === 'def-A') return Effect.succeed(defA);
        return Effect.fail({ _tag: 'NotFoundError' as const });
      };

      const result = Effect.runSync(
        Effect.either(validateDefinitionWithResolver(defA, 'save', resolver)),
      );
      const details = expectFailure(result);
      expectRuleViolation(details, 12);
    });

    it('accepts non-cyclic transitive references', () => {
      const defA = validDefinition({
        id: 'def-A',
        states: {
          ...validDefinition().states,
          start: {
            name: 'start',
            type: 'child_machine',
            actionId: 'process',
            childMachineDefId: 'def-B',
            childInputMapping: '$.stateData',
          },
        },
      });

      const defB = validDefinition({
        id: 'def-B',
        // No child machine references — no cycle
      });

      const resolver = (id: string) => {
        if (id === 'def-B') return Effect.succeed(defB);
        return Effect.fail({ _tag: 'NotFoundError' as const });
      };

      const result = Effect.runSync(
        Effect.either(validateDefinitionWithResolver(defA, 'save', resolver)),
      );
      expectSuccess(result);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Rule 13 — JSON Schema validation
  // ──────────────────────────────────────────────────────────────────────

  describe('Rule 13 — JSON Schema validity', () => {
    it('rejects invalid inputSchema', () => {
      const def = validDefinition({
        inputSchema: { type: 'not-a-real-type' } as Record<string, unknown>,
      });
      const details = expectFailure(runValidation(def));
      expectRuleViolation(details, 13);
    });

    it('rejects invalid outputSchema', () => {
      const def = validDefinition({
        outputSchema: { type: 12345 } as unknown as Record<string, unknown>,
      });
      const details = expectFailure(runValidation(def));
      expectRuleViolation(details, 13);
    });

    it('rejects invalid dataSchema on a state', () => {
      const def = validDefinition({
        states: {
          ...validDefinition().states,
          start: {
            name: 'start',
            type: 'action',
            actionId: 'do-stuff',
            dataSchema: { type: ['invalid'] } as unknown as Record<string, unknown>,
          },
        },
      });
      const details = expectFailure(runValidation(def));
      expectRuleViolation(details, 13);
    });

    it('accepts valid JSON Schema (empty object)', () => {
      // An empty object `{}` is a valid JSON Schema that accepts anything.
      const def = validDefinition({
        inputSchema: {},
        outputSchema: {},
      });
      const result = runValidation(def);
      expectSuccess(result);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Rule 14 — unique keys in parallel_children
  // ──────────────────────────────────────────────────────────────────────

  describe('Rule 14 — unique child keys', () => {
    it('rejects duplicate keys in parallel_children children[]', () => {
      const def = validDefinition({
        states: {
          ...validDefinition().states,
          start: {
            name: 'start',
            type: 'parallel_children',
            actionId: 'aggregate',
            children: [
              { key: 'dup', machineDefId: 'def-002', inputMapping: '$.stateData' },
              { key: 'dup', machineDefId: 'def-003', inputMapping: '$.stateData' },
            ],
          },
        },
      });
      const details = expectFailure(runValidation(def));
      expectRuleViolation(details, 14);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Multiple violations
  // ──────────────────────────────────────────────────────────────────────

  describe('Multiple violations', () => {
    it('reports multiple violations together', () => {
      const def = validDefinition({
        initialState: 'nonexistent',
        states: {
          start: { name: 'wrong-name', type: 'action', actionId: 'do-stuff' },
          // Missing all three required terminals
        },
        transitions: [{ from: 'start', to: 'nonexistent' }],
      });
      const details = expectFailure(runValidation(def));
      // Should have violations from multiple rules.
      expect(details.length).toBeGreaterThan(1);
      // At minimum: Rule 1 (initialState), Rule 2 (missing terminals), Rule 7 (name mismatch)
      expectRuleViolation(details, 1);
      expectRuleViolation(details, 2);
    });

    it('does not short-circuit — all applicable rules run', () => {
      const def = validDefinition({
        initialState: 'nonexistent',
        states: {
          start: { name: 'start', type: 'terminal', actionId: 'bad' },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        transitions: [],
      });
      const details = expectFailure(runValidation(def));
      // Rule 1 (bad initialState), Rule 11 (terminal with actionId)
      expectRuleViolation(details, 1);
      expectRuleViolation(details, 11);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Complex valid definition
  // ──────────────────────────────────────────────────────────────────────

  describe('Complex valid definitions', () => {
    it('accepts a definition with child_machine and parallel_children states', () => {
      const def = validDefinition({
        states: {
          start: {
            name: 'start',
            type: 'child_machine',
            actionId: 'process-child',
            childMachineDefId: 'def-002',
            childInputMapping: '$.stateData',
          },
          parallel: {
            name: 'parallel',
            type: 'parallel_children',
            actionId: 'aggregate',
            children: [
              { key: 'a', machineDefId: 'def-003', inputMapping: '$.stateData' },
              { key: 'b', machineDefId: 'def-004', inputMapping: '$.machineInput' },
            ],
          },
          completed: { name: 'completed', type: 'terminal' },
          cancelled: { name: 'cancelled', type: 'terminal' },
          error: { name: 'error', type: 'terminal' },
        },
        transitions: [
          { from: 'start', to: 'parallel' },
          { from: 'parallel', to: 'completed' },
        ],
      });
      const result = runValidation(def);
      expectSuccess(result);
    });

    it('accepts a definition with dataSchema on states', () => {
      const def = validDefinition({
        states: {
          ...validDefinition().states,
          start: {
            name: 'start',
            type: 'action',
            actionId: 'do-stuff',
            dataSchema: {
              type: 'object',
              properties: { value: { type: 'string' } },
            },
          },
        },
      });
      const result = runValidation(def);
      expectSuccess(result);
    });
  });
});
