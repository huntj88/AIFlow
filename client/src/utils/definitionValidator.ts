// ────────────────────────────────────────────────────────────────────────────
// Client-side definition validator
// Implements rules 1–11 & 14 from the server's DefinitionValidator.
// ────────────────────────────────────────────────────────────────────────────

import type { StateMachineDefinition, TransitionRule } from '../types/machines';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface ValidationError {
  readonly rule: string;
  readonly stateName?: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

/** Partial definition shape accepted during editing (id/version/metadata optional). */
export type PartialDefinition = Partial<StateMachineDefinition> &
  Pick<StateMachineDefinition, 'states' | 'transitions' | 'initialState'>;

// ────────────────────────────────────────────────────────────────────────────
// Required terminal states
// ────────────────────────────────────────────────────────────────────────────

const REQUIRED_TERMINALS = ['completed', 'cancelled', 'error'] as const;

// ────────────────────────────────────────────────────────────────────────────
// Individual rules
// ────────────────────────────────────────────────────────────────────────────

/** Rule 1: `initialState` must reference an existing key in `states`. */
function rule1(def: PartialDefinition): ValidationError[] {
  if (def.initialState === '') {
    return [{ rule: 'rule-1', message: 'initialState is required.', severity: 'error' }];
  }
  if (!(def.initialState in def.states)) {
    return [
      {
        rule: 'rule-1',
        message: `initialState "${def.initialState}" does not reference an existing state.`,
        severity: 'error',
      },
    ];
  }
  return [];
}

/** Rule 2: All three required terminal states must exist with type 'terminal'. */
function rule2(def: PartialDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const name of REQUIRED_TERMINALS) {
    if (!(name in def.states)) {
      errors.push({
        rule: 'rule-2',
        stateName: name,
        message: `Required terminal state "${name}" is missing.`,
        severity: 'error',
      });
    } else if (def.states[name].type !== 'terminal') {
      errors.push({
        rule: 'rule-2',
        stateName: name,
        message: `State "${name}" must have type "terminal" but has "${def.states[name].type}".`,
        severity: 'error',
      });
    }
  }
  return errors;
}

/** Rule 3: No transitions may originate FROM a terminal state. */
function rule3(def: PartialDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  const terminals = new Set(
    Object.entries(def.states)
      .filter(([, s]) => s.type === 'terminal')
      .map(([name]) => name),
  );
  for (const tr of def.transitions) {
    if (terminals.has(tr.from)) {
      errors.push({
        rule: 'rule-3',
        stateName: tr.from,
        message: `Terminal state "${tr.from}" must not have outgoing transitions (→ "${tr.to}").`,
        severity: 'error',
      });
    }
  }
  return errors;
}

/** Rule 4: Every `from` and `to` in transitions must reference an existing state. */
function rule4(def: PartialDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  const stateNames = new Set(Object.keys(def.states));
  for (const tr of def.transitions) {
    if (!stateNames.has(tr.from)) {
      errors.push({
        rule: 'rule-4',
        stateName: tr.from,
        message: `Transition references unknown source state "${tr.from}".`,
        severity: 'error',
      });
    }
    if (!stateNames.has(tr.to)) {
      errors.push({
        rule: 'rule-4',
        stateName: tr.to,
        message: `Transition references unknown target state "${tr.to}".`,
        severity: 'error',
      });
    }
  }
  return errors;
}

/** Rule 5: Every non-terminal state must have at least one outgoing transition. */
function rule5(def: PartialDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  const outgoing = new Set(def.transitions.map((tr: TransitionRule) => tr.from));
  for (const [name, state] of Object.entries(def.states)) {
    if (state.type !== 'terminal' && !outgoing.has(name)) {
      errors.push({
        rule: 'rule-5',
        stateName: name,
        message: `Non-terminal state "${name}" has no outgoing transitions.`,
        severity: 'error',
      });
    }
  }
  return errors;
}

/** Rule 6: No orphan non-terminal states — every non-terminal reachable from initialState. */
function rule6(def: PartialDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!def.initialState || !(def.initialState in def.states)) return errors;

  // BFS from initialState
  const reachable = new Set<string>();
  const queue = [def.initialState];
  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) break;
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const tr of def.transitions) {
      if (tr.from === current && !reachable.has(tr.to)) {
        queue.push(tr.to);
      }
    }
  }

  for (const [name, state] of Object.entries(def.states)) {
    if (state.type !== 'terminal' && !reachable.has(name)) {
      errors.push({
        rule: 'rule-6',
        stateName: name,
        message: `Non-terminal state "${name}" is unreachable from initialState.`,
        severity: 'warning',
      });
    }
  }
  return errors;
}

/** Rule 7: StateDefinition.name must match its key in the states record. */
function rule7(def: PartialDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [key, state] of Object.entries(def.states)) {
    if (state.name !== key) {
      errors.push({
        rule: 'rule-7',
        stateName: key,
        message: `State key "${key}" does not match state.name "${state.name}".`,
        severity: 'error',
      });
    }
  }
  return errors;
}

/** Rule 8: action states must have an actionId. */
function rule8(def: PartialDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [name, state] of Object.entries(def.states)) {
    if (state.type === 'action' && !state.actionId) {
      errors.push({
        rule: 'rule-8',
        stateName: name,
        message: `Action state "${name}" is missing actionId.`,
        severity: 'error',
      });
    }
  }
  return errors;
}

/** Rule 9: child_machine states must have actionId, childMachineDefId, and childInputMapping. */
function rule9(def: PartialDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [name, state] of Object.entries(def.states)) {
    if (state.type === 'child_machine') {
      if (!state.actionId) {
        errors.push({
          rule: 'rule-9',
          stateName: name,
          message: `Child machine state "${name}" is missing actionId.`,
          severity: 'error',
        });
      }
      if (!state.childMachineDefId) {
        errors.push({
          rule: 'rule-9',
          stateName: name,
          message: `Child machine state "${name}" is missing childMachineDefId.`,
          severity: 'error',
        });
      }
      if (!state.childInputMapping) {
        errors.push({
          rule: 'rule-9',
          stateName: name,
          message: `Child machine state "${name}" is missing childInputMapping.`,
          severity: 'error',
        });
      }
    }
  }
  return errors;
}

/** Rule 10: parallel_children states must have actionId and non-empty children[]. */
function rule10(def: PartialDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [name, state] of Object.entries(def.states)) {
    if (state.type === 'parallel_children') {
      if (!state.actionId) {
        errors.push({
          rule: 'rule-10',
          stateName: name,
          message: `Parallel children state "${name}" is missing actionId.`,
          severity: 'error',
        });
      }
      if (!state.children || state.children.length === 0) {
        errors.push({
          rule: 'rule-10',
          stateName: name,
          message: `Parallel children state "${name}" must have at least one child.`,
          severity: 'error',
        });
      }
    }
  }
  return errors;
}

/** Rule 11: terminal states must NOT have actionId, childMachineDefId, or children. */
function rule11(def: PartialDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [name, state] of Object.entries(def.states)) {
    if (state.type === 'terminal') {
      if (state.actionId) {
        errors.push({
          rule: 'rule-11',
          stateName: name,
          message: `Terminal state "${name}" must not have actionId.`,
          severity: 'error',
        });
      }
      if (state.childMachineDefId) {
        errors.push({
          rule: 'rule-11',
          stateName: name,
          message: `Terminal state "${name}" must not have childMachineDefId.`,
          severity: 'error',
        });
      }
      if (state.children && state.children.length > 0) {
        errors.push({
          rule: 'rule-11',
          stateName: name,
          message: `Terminal state "${name}" must not have children.`,
          severity: 'error',
        });
      }
    }
  }
  return errors;
}

/** Rule 14: All key values within parallel_children children[] must be unique. */
function rule14(def: PartialDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [name, state] of Object.entries(def.states)) {
    if (state.type === 'parallel_children' && state.children) {
      const seen = new Set<string>();
      for (const child of state.children) {
        if (seen.has(child.key)) {
          errors.push({
            rule: 'rule-14',
            stateName: name,
            message: `Parallel children state "${name}" has duplicate child key "${child.key}".`,
            severity: 'error',
          });
        }
        seen.add(child.key);
      }
    }
  }
  return errors;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validate a (partial) state machine definition on the client side.
 * Returns an array of structured validation errors/warnings.
 */
export function validateDefinition(def: PartialDefinition): ValidationError[] {
  if (Object.keys(def.states).length === 0) return [];
  return [
    ...rule1(def),
    ...rule2(def),
    ...rule3(def),
    ...rule4(def),
    ...rule5(def),
    ...rule6(def),
    ...rule7(def),
    ...rule8(def),
    ...rule9(def),
    ...rule10(def),
    ...rule11(def),
    ...rule14(def),
  ];
}

/**
 * Convenience: returns true if there are no errors (warnings are OK).
 */
export function isDefinitionValid(def: PartialDefinition): boolean {
  return validateDefinition(def).filter((e) => e.severity === 'error').length === 0;
}
