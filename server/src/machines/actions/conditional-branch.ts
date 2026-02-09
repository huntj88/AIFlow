/**
 * Built-in action: conditional-branch (Task 05)
 *
 * Evaluates a condition on `stateData` and returns different `nextState`
 * values. Configuration via `stateData`:
 *   - `condition: { field: string; operator: 'eq' | 'neq' | 'gt' | 'lt' | 'exists'; value?: unknown }`
 *   - `trueState: string` — transition if condition is true
 *   - `falseState: string` — transition if condition is false
 *
 * @module
 */

import { Effect } from 'effect';

import type { ActionFunction } from '../types.js';
import { mkActionError } from '../types.js';

type Operator = 'eq' | 'neq' | 'gt' | 'lt' | 'exists';
const VALID_OPERATORS: Operator[] = ['eq', 'neq', 'gt', 'lt', 'exists'];

interface BranchCondition {
  field: string;
  operator: Operator;
  value?: unknown;
}

function evaluateCondition(fieldValue: unknown, condition: BranchCondition): boolean {
  switch (condition.operator) {
    case 'exists':
      return fieldValue !== undefined && fieldValue !== null;
    case 'eq':
      return fieldValue === condition.value;
    case 'neq':
      return fieldValue !== condition.value;
    case 'gt':
      return typeof fieldValue === 'number' && typeof condition.value === 'number'
        ? fieldValue > condition.value
        : false;
    case 'lt':
      return typeof fieldValue === 'number' && typeof condition.value === 'number'
        ? fieldValue < condition.value
        : false;
    default:
      return false;
  }
}

interface ConditionalBranchData {
  condition?: unknown;
  trueState?: unknown;
  falseState?: unknown;
  [key: string]: unknown;
}

export const conditionalBranchAction: ActionFunction = (ctx) => {
  const data = ctx.stateData as ConditionalBranchData | undefined;
  const condition = data?.condition as BranchCondition | undefined;
  const trueState = data?.trueState as string | undefined;
  const falseState = data?.falseState as string | undefined;

  if (!condition || typeof condition.field !== 'string') {
    return Effect.fail(
      mkActionError({
        actionId: 'conditional-branch',
        stateName: ctx.stateName,
        cause: new Error('stateData.condition must have a string "field" property'),
      }),
    );
  }

  if (!VALID_OPERATORS.includes(condition.operator)) {
    return Effect.fail(
      mkActionError({
        actionId: 'conditional-branch',
        stateName: ctx.stateName,
        cause: new Error(
          `stateData.condition.operator must be one of: ${VALID_OPERATORS.join(', ')}`,
        ),
      }),
    );
  }

  if (typeof trueState !== 'string') {
    return Effect.fail(
      mkActionError({
        actionId: 'conditional-branch',
        stateName: ctx.stateName,
        cause: new Error('stateData.trueState must be a string'),
      }),
    );
  }

  if (typeof falseState !== 'string') {
    return Effect.fail(
      mkActionError({
        actionId: 'conditional-branch',
        stateName: ctx.stateName,
        cause: new Error('stateData.falseState must be a string'),
      }),
    );
  }

  return Effect.gen(function* () {
    const fieldValue = data?.[condition.field];
    const result = evaluateCondition(fieldValue, condition);

    yield* ctx.logger.info(
      `Condition: ${condition.field} ${condition.operator} ${JSON.stringify(condition.value)} → ${String(result)}`,
    );

    return { nextState: result ? trueState : falseState, data: ctx.stateData };
  });
};
