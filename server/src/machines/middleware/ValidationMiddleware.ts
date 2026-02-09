/**
 * ValidationMiddleware — Schema validation before state transitions (Task 07)
 *
 * Validates `stateData` against the current state's `dataSchema` (if defined)
 * using `ajv`. Fails with `ValidationError` when data does not conform.
 * Skips validation silently when no `dataSchema` is present.
 *
 * @module
 */

import AjvModule from 'ajv';
import { Effect } from 'effect';

// ajv is CJS; normalise the import for ESM interop (same pattern as DefinitionValidator.ts)
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
const Ajv: typeof AjvModule.default =
  typeof (AjvModule as any).default === 'function'
    ? (AjvModule as any).default
    : (AjvModule as any);
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */

import type { TransitionMiddleware } from '../types.js';
import { mkValidationError } from '../types.js';

// ────────────────────────────────────────────────────────────────────────────
// Shared Ajv instance
// ────────────────────────────────────────────────────────────────────────────

const ajv = new Ajv({ allErrors: true });

// ────────────────────────────────────────────────────────────────────────────
// Middleware
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validates `stateData` against the current state's `dataSchema` before
 * each transition. Skips validation when no schema is defined.
 */
export const ValidationMiddleware: TransitionMiddleware = {
  name: 'ValidationMiddleware',

  beforeTransition(ctx) {
    return Effect.suspend(() => {
      const stateDef = ctx.definition.states[ctx.stateName];

      // No schema defined → nothing to validate
      if (!stateDef.dataSchema || Object.keys(stateDef.dataSchema).length === 0) {
        return Effect.void;
      }

      const validate = ajv.compile(stateDef.dataSchema);
      const valid = validate(ctx.stateData);

      if (!valid) {
        const errorMessages = (validate.errors ?? [])
          .map((e) => `${e.instancePath || '/'} ${e.message ?? 'unknown error'}`)
          .join('; ');

        return Effect.fail(
          mkValidationError({
            message: `State data validation failed for "${ctx.stateName}": ${errorMessages}`,
            path: ctx.stateName,
          }),
        );
      }

      return Effect.void;
    });
  },
};
