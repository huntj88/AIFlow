/**
 * Definition Validation Engine — Task 03
 *
 * Validates a `StateMachineDefinition` against all 14 rules from the
 * feature spec §1 "Definition Validation". Collects **all** violations
 * (does not short-circuit) and returns them in a `DefinitionError`.
 *
 * Two modes:
 * - `save`    — used when a definition is created/updated via the API.
 *               Rule 8 is advisory (logged, not rejected).
 * - `runtime` — used before the runner executes a definition.
 *               Rule 8 is mandatory.
 *
 * @module
 */

import AjvModule from 'ajv';
import { Effect } from 'effect';

// ajv is CJS; under NodeNext `import X from 'ajv'` yields the module namespace.
// The actual class may be on `.default` or may be the import itself depending on
// the bundler / runtime interop. We normalise here.
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
const Ajv: typeof AjvModule.default =
  typeof (AjvModule as any).default === 'function'
    ? (AjvModule as any).default
    : (AjvModule as any);
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */

import type { DefinitionError, StateMachineDefinition } from './types.js';
import { mkDefinitionError } from './types.js';

// ────────────────────────────────────────────────────────────────────────────
// Public Types
// ────────────────────────────────────────────────────────────────────────────

/** Whether validation runs at save-time or run-time. */
export type ValidationMode = 'save' | 'runtime';

/** A single violation found during validation. */
export interface ValidationViolation {
  /** The rule number (1-14) that was violated. */
  readonly rule: number;
  /** Human-readable description of the violation. */
  readonly message: string;
  /** Optional context (state name, transition, etc.). */
  readonly context?: string;
}

/**
 * Minimal interface for looking up registered actions.
 * Only needed at runtime (Rule 8).
 */
export interface ActionRegistry {
  has(actionId: string): boolean;
}

/**
 * Callback to resolve a child definition by ID.
 * Only needed for Rule 12 (cycle detection across definitions).
 */
export type DefinitionResolver = (
  id: string,
) => Effect.Effect<StateMachineDefinition, { readonly _tag: 'NotFoundError' }>;

// ────────────────────────────────────────────────────────────────────────────
// Shared Ajv instance
// ────────────────────────────────────────────────────────────────────────────

const ajv = new Ajv({ allErrors: true });

// ────────────────────────────────────────────────────────────────────────────
// Rule Implementations
// ────────────────────────────────────────────────────────────────────────────

const REQUIRED_TERMINALS = ['completed', 'cancelled', 'error'] as const;

/** Rule 1: `initialState` must reference an existing key in `states`. */
function rule1(def: StateMachineDefinition): ValidationViolation[] {
  if (!(def.initialState in def.states)) {
    return [
      {
        rule: 1,
        message: `initialState "${def.initialState}" does not reference an existing state`,
        context: def.initialState,
      },
    ];
  }
  return [];
}

/** Rule 2: Required terminal states (`completed`, `cancelled`, `error`) with `type: 'terminal'`. */
function rule2(def: StateMachineDefinition): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  for (const key of REQUIRED_TERMINALS) {
    const state = def.states[key] as StateMachineDefinition['states'][string] | undefined;
    if (!state) {
      violations.push({
        rule: 2,
        message: `Required terminal state "${key}" is missing`,
        context: key,
      });
    } else if (state.type !== 'terminal') {
      violations.push({
        rule: 2,
        message: `State "${key}" must have type "terminal" but has type "${state.type}"`,
        context: key,
      });
    }
  }
  return violations;
}

/** Rule 3: No transitions from terminal states. */
function rule3(def: StateMachineDefinition): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  const terminalKeys = new Set(
    Object.entries(def.states)
      .filter(([, s]) => s.type === 'terminal')
      .map(([k]) => k),
  );
  for (const t of def.transitions) {
    if (terminalKeys.has(t.from)) {
      violations.push({
        rule: 3,
        message: `Transition from terminal state "${t.from}" to "${t.to}" is not allowed`,
        context: `${t.from} -> ${t.to}`,
      });
    }
  }
  return violations;
}

/** Rule 4: All `from`/`to` in transitions reference existing states. */
function rule4(def: StateMachineDefinition): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  const keys = new Set(Object.keys(def.states));
  for (const t of def.transitions) {
    if (!keys.has(t.from)) {
      violations.push({
        rule: 4,
        message: `Transition "from" references non-existent state "${t.from}"`,
        context: `${t.from} -> ${t.to}`,
      });
    }
    if (!keys.has(t.to)) {
      violations.push({
        rule: 4,
        message: `Transition "to" references non-existent state "${t.to}"`,
        context: `${t.from} -> ${t.to}`,
      });
    }
  }
  return violations;
}

/** Rule 5: Every non-terminal state must have ≥1 outgoing transition. */
function rule5(def: StateMachineDefinition): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  const outgoing = new Set<string>();
  for (const t of def.transitions) {
    outgoing.add(t.from);
  }
  for (const [key, state] of Object.entries(def.states)) {
    if (state.type !== 'terminal' && !outgoing.has(key)) {
      violations.push({
        rule: 5,
        message: `Non-terminal state "${key}" has no outgoing transitions`,
        context: key,
      });
    }
  }
  return violations;
}

/** Rule 6: No orphan non-terminal states — every non-terminal must be reachable from `initialState`. */
function rule6(def: StateMachineDefinition): ValidationViolation[] {
  const violations: ValidationViolation[] = [];

  // Build adjacency list from transitions (forward direction only).
  const adj = new Map<string, Set<string>>();
  for (const t of def.transitions) {
    let neighbors = adj.get(t.from);
    if (!neighbors) {
      neighbors = new Set();
      adj.set(t.from, neighbors);
    }
    neighbors.add(t.to);
  }

  // BFS from initialState.
  const reachable = new Set<string>();
  const queue: string[] = [def.initialState];
  reachable.add(def.initialState);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const neighbors = adj.get(current);
    if (neighbors) {
      for (const n of neighbors) {
        if (!reachable.has(n)) {
          reachable.add(n);
          queue.push(n);
        }
      }
    }
  }

  for (const [key, state] of Object.entries(def.states)) {
    if (state.type !== 'terminal' && !reachable.has(key)) {
      violations.push({
        rule: 6,
        message: `Non-terminal state "${key}" is not reachable from initialState "${def.initialState}"`,
        context: key,
      });
    }
  }
  return violations;
}

/** Rule 7: `StateDefinition.name` must match its key in the `states` record. */
function rule7(def: StateMachineDefinition): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  for (const [key, state] of Object.entries(def.states)) {
    if (state.name !== key) {
      violations.push({
        rule: 7,
        message: `State key "${key}" does not match state.name "${state.name}"`,
        context: key,
      });
    }
  }
  return violations;
}

/**
 * Rule 8: `action` states must have a valid `actionId`.
 * - save mode: advisory only (returned as warnings, not violations)
 * - runtime mode: hard error if actionId not in registry
 */
function rule8(
  def: StateMachineDefinition,
  mode: ValidationMode,
  actionRegistry?: ActionRegistry,
): { violations: ValidationViolation[]; warnings: ValidationViolation[] } {
  const violations: ValidationViolation[] = [];
  const warnings: ValidationViolation[] = [];

  for (const [key, state] of Object.entries(def.states)) {
    if (state.type === 'action' && state.actionId) {
      if (mode === 'runtime' && actionRegistry && !actionRegistry.has(state.actionId)) {
        violations.push({
          rule: 8,
          message: `Action state "${key}" references unregistered actionId "${state.actionId}"`,
          context: key,
        });
      } else if (mode === 'save') {
        // Advisory: we don't reject, but note it as a warning.
        if (actionRegistry && !actionRegistry.has(state.actionId)) {
          warnings.push({
            rule: 8,
            message: `Action state "${key}" references actionId "${state.actionId}" which is not currently registered (advisory)`,
            context: key,
          });
        }
      }
    }
  }
  return { violations, warnings };
}

/** Rule 9: `child_machine` states require `actionId`, `childMachineDefId`, `childInputMapping`. */
function rule9(def: StateMachineDefinition): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  for (const [key, state] of Object.entries(def.states)) {
    if (state.type === 'child_machine') {
      if (!state.actionId) {
        violations.push({
          rule: 9,
          message: `child_machine state "${key}" is missing required field "actionId"`,
          context: key,
        });
      }
      if (!state.childMachineDefId) {
        violations.push({
          rule: 9,
          message: `child_machine state "${key}" is missing required field "childMachineDefId"`,
          context: key,
        });
      }
      if (!state.childInputMapping) {
        violations.push({
          rule: 9,
          message: `child_machine state "${key}" is missing required field "childInputMapping"`,
          context: key,
        });
      }
    }
  }
  return violations;
}

/** Rule 10: `parallel_children` states require `actionId` and non-empty `children[]`. */
function rule10(def: StateMachineDefinition): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  for (const [key, state] of Object.entries(def.states)) {
    if (state.type === 'parallel_children') {
      if (!state.actionId) {
        violations.push({
          rule: 10,
          message: `parallel_children state "${key}" is missing required field "actionId"`,
          context: key,
        });
      }
      if (!state.children || state.children.length === 0) {
        violations.push({
          rule: 10,
          message: `parallel_children state "${key}" must have a non-empty "children" array`,
          context: key,
        });
      }
    }
  }
  return violations;
}

/** Rule 11: `terminal` states must NOT have `actionId`, `childMachineDefId`, or `children`. */
function rule11(def: StateMachineDefinition): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  for (const [key, state] of Object.entries(def.states)) {
    if (state.type === 'terminal') {
      if (state.actionId) {
        violations.push({
          rule: 11,
          message: `Terminal state "${key}" must not have "actionId"`,
          context: key,
        });
      }
      if (state.childMachineDefId) {
        violations.push({
          rule: 11,
          message: `Terminal state "${key}" must not have "childMachineDefId"`,
          context: key,
        });
      }
      if (state.children && state.children.length > 0) {
        violations.push({
          rule: 11,
          message: `Terminal state "${key}" must not have "children"`,
          context: key,
        });
      }
    }
  }
  return violations;
}

/**
 * Rule 12: No cycles in `childMachineDefId` / `children[].machineDefId` references.
 *
 * Builds a directed graph of definition → child definition references within
 * the definition itself (self-referential cycles). For cross-definition cycle
 * detection, a `DefinitionResolver` can be provided.
 */
function rule12(def: StateMachineDefinition): ValidationViolation[] {
  const violations: ValidationViolation[] = [];

  // Gather all child machine references from this definition.
  const childRefs = new Set<string>();
  for (const state of Object.values(def.states)) {
    if (state.type === 'child_machine' && state.childMachineDefId) {
      childRefs.add(state.childMachineDefId);
    }
    if (state.type === 'parallel_children' && state.children) {
      for (const child of state.children) {
        childRefs.add(child.machineDefId);
      }
    }
  }

  // Direct self-reference cycle: definition references itself.
  if (childRefs.has(def.id)) {
    violations.push({
      rule: 12,
      message: `Definition "${def.id}" references itself as a child machine, forming a cycle`,
      context: def.id,
    });
  }

  // For transitive cycle detection we would need the resolver to load other
  // definitions. This is checked synchronously for self-references and
  // deferred to the caller for cross-definition cycles via `resolver`.
  // The resolver-based transitive check is implemented in `validateDefinitionWithResolver`.

  // If no resolver provided, we can only detect direct self-references.
  // Transitive cycles require the resolver (see validateDefinitionWithResolver).

  return violations;
}

/** Rule 13: `inputSchema`, `outputSchema`, and all `dataSchema` are valid JSON Schema. */
function rule13(def: StateMachineDefinition): ValidationViolation[] {
  const violations: ValidationViolation[] = [];

  function checkSchema(schema: Record<string, unknown>, label: string): void {
    const valid = ajv.validateSchema(schema);
    if (!valid) {
      violations.push({
        rule: 13,
        message: `${label} is not a valid JSON Schema`,
        context: label,
      });
    }
  }

  checkSchema(def.inputSchema, 'inputSchema');
  checkSchema(def.outputSchema, 'outputSchema');

  for (const [key, state] of Object.entries(def.states)) {
    if (state.dataSchema) {
      checkSchema(state.dataSchema, `states.${key}.dataSchema`);
    }
  }

  return violations;
}

/** Rule 14: Unique `key` values in `parallel_children` state's `children[]`. */
function rule14(def: StateMachineDefinition): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  for (const [key, state] of Object.entries(def.states)) {
    if (state.type === 'parallel_children' && state.children) {
      const seen = new Set<string>();
      for (const child of state.children) {
        if (seen.has(child.key)) {
          violations.push({
            rule: 14,
            message: `Duplicate child key "${child.key}" in parallel_children state "${key}"`,
            context: `${key}.children[].key="${child.key}"`,
          });
        }
        seen.add(child.key);
      }
    }
  }
  return violations;
}

// ────────────────────────────────────────────────────────────────────────────
// Main Validator
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validate a `StateMachineDefinition` against all 14 rules.
 *
 * Returns `Effect.void` on success. On failure, returns a `DefinitionError`
 * whose `details[]` contains all collected violation messages.
 *
 * @param def - The definition to validate.
 * @param mode - `'save'` (advisory Rule 8) or `'runtime'` (mandatory Rule 8).
 * @param actionRegistry - Optional action lookup; required for runtime Rule 8.
 */
export const validateDefinition = (
  def: StateMachineDefinition,
  mode: ValidationMode,
  actionRegistry?: ActionRegistry,
): Effect.Effect<void, DefinitionError> => {
  const violations: ValidationViolation[] = [];
  const warnings: ValidationViolation[] = [];

  // Run all rules and collect violations.
  violations.push(...rule1(def));
  violations.push(...rule2(def));
  violations.push(...rule3(def));
  violations.push(...rule4(def));
  violations.push(...rule5(def));
  violations.push(...rule6(def));
  violations.push(...rule7(def));

  const r8 = rule8(def, mode, actionRegistry);
  violations.push(...r8.violations);
  warnings.push(...r8.warnings);

  violations.push(...rule9(def));
  violations.push(...rule10(def));
  violations.push(...rule11(def));
  violations.push(...rule12(def));
  violations.push(...rule13(def));
  violations.push(...rule14(def));

  if (violations.length > 0) {
    return Effect.fail(
      mkDefinitionError({
        message: 'Definition validation failed',
        details: violations.map((v) => `Rule ${String(v.rule)}: ${v.message}`),
      }),
    ).pipe(
      Effect.withSpan('machine.definition.validate', {
        attributes: {
          'machine.definition_id': def.id,
          'validation.mode': mode,
          'validation.passed': false,
        },
      }),
    );
  }

  // Warnings are logged but do not cause rejection.
  if (warnings.length > 0) {
    return Effect.logWarning(
      `Definition validation warnings: ${warnings.map((w) => `Rule ${String(w.rule)}: ${w.message}`).join('; ')}`,
    ).pipe(
      Effect.as(undefined),
      Effect.withSpan('machine.definition.validate', {
        attributes: {
          'machine.definition_id': def.id,
          'validation.mode': mode,
          'validation.passed': true,
        },
      }),
    );
  }

  return Effect.void.pipe(
    Effect.withSpan('machine.definition.validate', {
      attributes: {
        'machine.definition_id': def.id,
        'validation.mode': mode,
        'validation.passed': true,
      },
    }),
  );
};

/**
 * Extended validation that supports transitive cycle detection across
 * definitions via a `DefinitionResolver`.
 *
 * Runs all 14 rules plus cross-definition cycle detection (Rule 12 extended).
 */
export const validateDefinitionWithResolver = (
  def: StateMachineDefinition,
  mode: ValidationMode,
  resolver: DefinitionResolver,
  actionRegistry?: ActionRegistry,
): Effect.Effect<void, DefinitionError> => {
  return Effect.gen(function* () {
    // First run the standard validation.
    const violations: ValidationViolation[] = [];
    const warnings: ValidationViolation[] = [];

    violations.push(...rule1(def));
    violations.push(...rule2(def));
    violations.push(...rule3(def));
    violations.push(...rule4(def));
    violations.push(...rule5(def));
    violations.push(...rule6(def));
    violations.push(...rule7(def));

    const r8 = rule8(def, mode, actionRegistry);
    violations.push(...r8.violations);
    warnings.push(...r8.warnings);

    violations.push(...rule9(def));
    violations.push(...rule10(def));
    violations.push(...rule11(def));
    violations.push(...rule13(def));
    violations.push(...rule14(def));

    // Extended Rule 12: transitive cycle detection.
    const cycleViolations = yield* detectTransitiveCycles(def, resolver);
    violations.push(...cycleViolations);

    if (violations.length > 0) {
      return yield* Effect.fail(
        mkDefinitionError({
          message: 'Definition validation failed',
          details: violations.map((v) => `Rule ${String(v.rule)}: ${v.message}`),
        }),
      );
    }

    if (warnings.length > 0) {
      yield* Effect.logWarning(
        `Definition validation warnings: ${warnings.map((w) => `Rule ${String(w.rule)}: ${w.message}`).join('; ')}`,
      );
    }
  });
};

/** Gather child machine definition IDs referenced by a definition. */
function getChildRefs(d: StateMachineDefinition): Set<string> {
  const refs = new Set<string>();
  for (const state of Object.values(d.states)) {
    if (state.type === 'child_machine' && state.childMachineDefId) {
      refs.add(state.childMachineDefId);
    }
    if (state.type === 'parallel_children' && state.children) {
      for (const child of state.children) {
        refs.add(child.machineDefId);
      }
    }
  }
  return refs;
}

/**
 * Detect transitive cycles in child machine references using iterative DFS.
 * Visits the definition graph starting from `def` and follows
 * `childMachineDefId` / `children[].machineDefId` edges.
 */
function detectTransitiveCycles(
  rootDef: StateMachineDefinition,
  resolver: DefinitionResolver,
): Effect.Effect<ValidationViolation[]> {
  const violations: ValidationViolation[] = [];
  const visited = new Set<string>();

  // Iterative DFS using an explicit stack.
  // Each stack frame tracks: the definition id, the path so far, and
  // the list of child refs still to visit.
  interface Frame {
    defId: string;
    path: string[];
    children: string[];
    index: number;
  }

  const resolveDef = (id: string): Effect.Effect<StateMachineDefinition | null> =>
    id === rootDef.id
      ? Effect.succeed(rootDef)
      : Effect.catchAll(resolver(id), () => Effect.succeed(null as StateMachineDefinition | null));

  // The DFS is implemented as a loop within Effect.gen to allow yielding the resolver.
  return Effect.gen(function* () {
    const stack: Frame[] = [];
    const inStack = new Set<string>();

    // Initialize with the root definition.
    const rootChildren = getChildRefs(rootDef);
    stack.push({ defId: rootDef.id, path: [], children: [...rootChildren], index: 0 });
    inStack.add(rootDef.id);
    visited.add(rootDef.id);

    while (stack.length > 0) {
      const frame = stack.at(-1);
      if (!frame) break;

      if (frame.index >= frame.children.length) {
        // All children of this frame have been visited — backtrack.
        inStack.delete(frame.defId);
        stack.pop();
        continue;
      }

      const childId = frame.children.at(frame.index);
      if (!childId) {
        frame.index++;
        continue;
      }
      frame.index++;

      if (inStack.has(childId)) {
        const cyclePath = [...frame.path, frame.defId, childId].join(' -> ');
        violations.push({
          rule: 12,
          message: `Cycle detected in child machine references: ${cyclePath}`,
          context: cyclePath,
        });
        continue;
      }

      if (visited.has(childId)) continue;

      visited.add(childId);

      // Resolve child definition to discover its own children.
      const childDef = yield* resolveDef(childId);
      if (childDef) {
        const grandChildren = getChildRefs(childDef);
        inStack.add(childId);
        stack.push({
          defId: childId,
          path: [...frame.path, frame.defId],
          children: [...grandChildren],
          index: 0,
        });
      }
    }

    return violations;
  });
}
