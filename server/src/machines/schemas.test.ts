import { Either, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  decodeCreateDefinition,
  decodeDefinition,
  decodeInstance,
  decodeInstanceFilter,
  decodeStartInstance,
  decodeUpdateDefinition,
  DefinitionErrorResponseSchema,
  NotFoundResponseSchema,
} from './schemas.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Return a shallow copy of `obj` without the given `keys`. */
function omit<T extends Record<string, unknown>>(obj: T, ...keys: string[]): Partial<T> {
  const keysToRemove = new Set(keys);
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => !keysToRemove.has(k)),
  ) as Partial<T>;
}

/** Minimal valid create-definition payload. */
const validCreatePayload = () => ({
  name: 'test-machine',
  inputSchema: {},
  outputSchema: {},
  states: {
    start: { name: 'start', type: 'action' as const, actionId: 'do-stuff' },
    done: { name: 'done', type: 'terminal' as const },
  },
  initialState: 'start',
  transitions: [{ from: 'start', to: 'done' }],
});

/** Minimal valid full definition payload (with server-generated fields). */
const validDefinitionPayload = () => ({
  ...validCreatePayload(),
  id: 'def-001',
  version: 1,
  metadata: {
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
});

/** Minimal valid start-instance payload. */
const validStartPayload = () => ({
  definitionId: 'def-001',
  input: { prompt: 'hello' },
  workspaceRoot: '/tmp/test-workspace',
});

/** Minimal valid machine instance payload. */
const validInstancePayload = () => ({
  id: 'inst-001',
  definitionId: 'def-001',
  definitionVersion: 1,
  status: 'running' as const,
  currentState: 'start',
  stateData: {},
  input: { prompt: 'hello' },
  history: [],
  logs: [],
  workspaceRoot: '/tmp/test-workspace',
  familyRootInstanceId: 'inst-001',
  artifactsPath: '/tmp/data/artifacts/inst-001',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

// ────────────────────────────────────────────────────────────────────────────
// CreateDefinitionRequestSchema
// ────────────────────────────────────────────────────────────────────────────

describe('CreateDefinitionRequestSchema', () => {
  it('accepts a valid create-definition payload', () => {
    const result = decodeCreateDefinition(validCreatePayload());
    expect(Either.isRight(result)).toBe(true);
  });

  it('accepts a payload with optional metadata', () => {
    const result = decodeCreateDefinition({
      ...validCreatePayload(),
      metadata: { description: 'A test machine', tags: ['test'] },
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it('rejects payload missing "name"', () => {
    const payload = omit(validCreatePayload(), 'name');
    const result = decodeCreateDefinition(payload);
    expect(Either.isLeft(result)).toBe(true);
  });

  it('rejects payload missing "states"', () => {
    const payload = omit(validCreatePayload(), 'states');
    const result = decodeCreateDefinition(payload);
    expect(Either.isLeft(result)).toBe(true);
  });

  it('rejects payload missing "initialState"', () => {
    const payload = omit(validCreatePayload(), 'initialState');
    const result = decodeCreateDefinition(payload);
    expect(Either.isLeft(result)).toBe(true);
  });

  it('rejects payload missing "transitions"', () => {
    const payload = omit(validCreatePayload(), 'transitions');
    const result = decodeCreateDefinition(payload);
    expect(Either.isLeft(result)).toBe(true);
  });

  it('rejects payload with invalid state type', () => {
    const payload = validCreatePayload();
    (payload.states.start as Record<string, unknown>).type = 'invalid';
    const result = decodeCreateDefinition(payload);
    expect(Either.isLeft(result)).toBe(true);
  });

  it('rejects completely empty object', () => {
    const result = decodeCreateDefinition({});
    expect(Either.isLeft(result)).toBe(true);
  });

  it('rejects non-object input', () => {
    expect(Either.isLeft(decodeCreateDefinition('not an object'))).toBe(true);
    expect(Either.isLeft(decodeCreateDefinition(42))).toBe(true);
    expect(Either.isLeft(decodeCreateDefinition(null))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// UpdateDefinitionRequestSchema (same shape as create)
// ────────────────────────────────────────────────────────────────────────────

describe('UpdateDefinitionRequestSchema', () => {
  it('accepts a valid update payload', () => {
    const result = decodeUpdateDefinition(validCreatePayload());
    expect(Either.isRight(result)).toBe(true);
  });

  it('rejects payload missing required fields', () => {
    const result = decodeUpdateDefinition({});
    expect(Either.isLeft(result)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// StateMachineDefinitionSchema
// ────────────────────────────────────────────────────────────────────────────

describe('StateMachineDefinitionSchema', () => {
  it('accepts a valid full definition', () => {
    const result = decodeDefinition(validDefinitionPayload());
    expect(Either.isRight(result)).toBe(true);
  });

  it('rejects definition without id', () => {
    const payload = omit(validDefinitionPayload(), 'id');
    const result = decodeDefinition(payload);
    expect(Either.isLeft(result)).toBe(true);
  });

  it('rejects definition without version', () => {
    const payload = omit(validDefinitionPayload(), 'version');
    const result = decodeDefinition(payload);
    expect(Either.isLeft(result)).toBe(true);
  });

  it('rejects definition without metadata', () => {
    const payload = omit(validDefinitionPayload(), 'metadata');
    const result = decodeDefinition(payload);
    expect(Either.isLeft(result)).toBe(true);
  });

  it('accepts definition with optional metadata fields', () => {
    const payload = {
      ...validDefinitionPayload(),
      metadata: {
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        description: 'A great machine',
        tags: ['ai', 'flow'],
      },
    };
    const result = decodeDefinition(payload);
    expect(Either.isRight(result)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// StartInstanceRequestSchema
// ────────────────────────────────────────────────────────────────────────────

describe('StartInstanceRequestSchema', () => {
  it('accepts a valid start-instance payload', () => {
    const result = decodeStartInstance(validStartPayload());
    expect(Either.isRight(result)).toBe(true);
  });

  it('requires definitionId', () => {
    const payload = omit(validStartPayload(), 'definitionId');
    const result = decodeStartInstance(payload);
    expect(Either.isLeft(result)).toBe(true);
  });

  it('accepts payload without input key (Unknown allows undefined)', () => {
    const payload = omit(validStartPayload(), 'input');
    const result = decodeStartInstance(payload);
    // Schema.Unknown accepts undefined, so a missing key is valid at the schema level.
    // The API route should enforce presence via its own check if needed.
    expect(Either.isRight(result)).toBe(true);
  });

  it('accepts null as input value', () => {
    const result = decodeStartInstance({
      definitionId: 'def-1',
      input: null,
      workspaceRoot: '/tmp/ws',
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it('accepts complex input value', () => {
    const result = decodeStartInstance({
      definitionId: 'def-1',
      input: { nested: { data: [1, 2, 3] } },
      workspaceRoot: '/tmp/ws',
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it('rejects non-object input', () => {
    expect(Either.isLeft(decodeStartInstance('not-an-object'))).toBe(true);
    expect(Either.isLeft(decodeStartInstance(null))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// MachineInstanceSchema
// ────────────────────────────────────────────────────────────────────────────

describe('MachineInstanceSchema', () => {
  it('accepts a valid machine instance', () => {
    const result = decodeInstance(validInstancePayload());
    expect(Either.isRight(result)).toBe(true);
  });

  it('accepts all 6 instance statuses', () => {
    const statuses = [
      'running',
      'completed',
      'cancelled',
      'error',
      'waiting_for_child',
      'suspended',
    ] as const;
    for (const status of statuses) {
      const payload = { ...validInstancePayload(), status };
      const result = decodeInstance(payload);
      expect(Either.isRight(result)).toBe(true);
    }
  });

  it('rejects an invalid status', () => {
    const payload = { ...validInstancePayload(), status: 'invalid' };
    const result = decodeInstance(payload);
    expect(Either.isLeft(result)).toBe(true);
  });

  it('rejects instance missing required id', () => {
    const payload = omit(validInstancePayload(), 'id');
    const result = decodeInstance(payload);
    expect(Either.isLeft(result)).toBe(true);
  });

  it('accepts instance with optional fields', () => {
    const payload = {
      ...validInstancePayload(),
      output: { result: 'done' },
      error: 'something went wrong',
      parentInstanceId: 'parent-001',
      childInstanceId: 'child-001',
      childInstanceIds: { sub1: 'child-002', sub2: 'child-003' },
    };
    const result = decodeInstance(payload);
    expect(Either.isRight(result)).toBe(true);
  });

  it('accepts instance with history entries', () => {
    const payload = {
      ...validInstancePayload(),
      history: [
        {
          id: 'tr-001',
          fromState: 'start',
          toState: 'done',
          timestamp: '2026-01-01T00:00:00Z',
          durationMs: 123,
        },
      ],
    };
    const result = decodeInstance(payload);
    expect(Either.isRight(result)).toBe(true);
  });

  it('accepts instance with log entries', () => {
    const payload = {
      ...validInstancePayload(),
      logs: [
        {
          id: 'log-001',
          instanceId: 'inst-001',
          stateName: 'start',
          level: 'info',
          message: 'Starting execution',
          timestamp: '2026-01-01T00:00:00Z',
        },
      ],
    };
    const result = decodeInstance(payload);
    expect(Either.isRight(result)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// InstanceFilterSchema
// ────────────────────────────────────────────────────────────────────────────

describe('InstanceFilterSchema', () => {
  it('accepts an empty filter (all optional)', () => {
    const result = decodeInstanceFilter({});
    expect(Either.isRight(result)).toBe(true);
  });

  it('accepts filter with all fields', () => {
    const result = decodeInstanceFilter({
      status: 'running',
      definitionId: 'def-001',
      parentInstanceId: 'parent-001',
      limit: 10,
      offset: 0,
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it('rejects filter with invalid status', () => {
    const result = decodeInstanceFilter({ status: 'invalid' });
    expect(Either.isLeft(result)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Response Schemas
// ────────────────────────────────────────────────────────────────────────────

describe('DefinitionErrorResponseSchema', () => {
  it('accepts a valid error response', () => {
    const result = Schema.decodeUnknownEither(DefinitionErrorResponseSchema)({
      message: 'Validation failed',
      details: ['missing terminal state', 'orphan state found'],
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it('rejects response missing message', () => {
    const result = Schema.decodeUnknownEither(DefinitionErrorResponseSchema)({
      details: ['error'],
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it('rejects response missing details', () => {
    const result = Schema.decodeUnknownEither(DefinitionErrorResponseSchema)({
      message: 'Validation failed',
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe('NotFoundResponseSchema', () => {
  it('accepts a valid not-found response', () => {
    const result = Schema.decodeUnknownEither(NotFoundResponseSchema)({
      message: 'Definition not found',
      id: 'def-999',
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it('rejects response missing id', () => {
    const result = Schema.decodeUnknownEither(NotFoundResponseSchema)({
      message: 'Not found',
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// StateDefinition edge cases
// ────────────────────────────────────────────────────────────────────────────

describe('StateDefinition variants', () => {
  it('accepts an action state with actionId', () => {
    const result = decodeCreateDefinition({
      ...validCreatePayload(),
      states: {
        fetch: {
          name: 'fetch',
          type: 'action',
          actionId: 'http-request',
          timeoutMs: 30000,
        },
        done: { name: 'done', type: 'terminal' },
      },
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it('accepts a child_machine state', () => {
    const result = decodeCreateDefinition({
      ...validCreatePayload(),
      states: {
        sub: {
          name: 'sub',
          type: 'child_machine',
          childMachineDefId: 'child-def-001',
          childInputMapping: '$.stateData',
        },
        done: { name: 'done', type: 'terminal' },
      },
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it('accepts a parallel_children state with children array', () => {
    const result = decodeCreateDefinition({
      ...validCreatePayload(),
      states: {
        parallel: {
          name: 'parallel',
          type: 'parallel_children',
          children: [
            { key: 'a', machineDefId: 'def-a', inputMapping: '$.data.a' },
            { key: 'b', machineDefId: 'def-b', inputMapping: '$.data.b' },
          ],
          parallelMode: 'all_settled',
        },
        done: { name: 'done', type: 'terminal' },
      },
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it('rejects state with invalid parallelMode', () => {
    const result = decodeCreateDefinition({
      ...validCreatePayload(),
      states: {
        parallel: {
          name: 'parallel',
          type: 'parallel_children',
          parallelMode: 'invalid_mode',
        },
        done: { name: 'done', type: 'terminal' },
      },
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Decode utilities return Either
// ────────────────────────────────────────────────────────────────────────────

describe('Decode utilities', () => {
  it('decodeCreateDefinition returns Right on valid input', () => {
    const result = decodeCreateDefinition(validCreatePayload());
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.name).toBe('test-machine');
    }
  });

  it('decodeCreateDefinition returns Left with parse error on invalid input', () => {
    const result = decodeCreateDefinition({ bad: 'data' });
    expect(Either.isLeft(result)).toBe(true);
  });

  it('decodeStartInstance returns Right on valid input', () => {
    const result = decodeStartInstance(validStartPayload());
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.definitionId).toBe('def-001');
    }
  });

  it('decodeDefinition returns Right on valid full definition', () => {
    const result = decodeDefinition(validDefinitionPayload());
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.id).toBe('def-001');
      expect(result.right.version).toBe(1);
    }
  });

  it('decodeInstance returns Right on valid instance', () => {
    const result = decodeInstance(validInstancePayload());
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.id).toBe('inst-001');
    }
  });

  it('decodeInstanceFilter returns Right on valid filter', () => {
    const result = decodeInstanceFilter({ status: 'completed', limit: 5 });
    expect(Either.isRight(result)).toBe(true);
  });

  it('decodeUpdateDefinition returns Right on valid input', () => {
    const result = decodeUpdateDefinition(validCreatePayload());
    expect(Either.isRight(result)).toBe(true);
  });
});
