/**
 * Built-in Actions — Unit Tests (Task 05)
 *
 * Tests for all 5 built-in action functions: delay, log-message,
 * conditional-branch, transform-data, http-request.
 *
 * @module
 */

import { Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ActionContext, StateLogger } from '../types.js';
import { conditionalBranchAction } from './conditional-branch.js';
import { delayAction } from './delay.js';
import { httpRequestAction } from './http-request.js';
import { logMessageAction } from './log-message.js';
import { transformDataAction } from './transform-data.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Create a mock StateLogger that records calls. */
function mockLogger(): StateLogger & { calls: { level: string; message: string }[] } {
  const calls: { level: string; message: string }[] = [];
  const make =
    (level: string) =>
    (message: string): Effect.Effect<void> => {
      calls.push({ level, message });
      return Effect.void;
    };

  return {
    calls,
    debug: make('debug'),
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
  };
}

/** Build a minimal `ActionContext` with given stateData. */
function makeCtx(stateData: unknown, overrides?: Partial<ActionContext>): ActionContext {
  return {
    machineInstanceId: 'inst-001',
    machineDefId: 'def-001',
    stateName: 'test-state',
    stateData,
    machineInput: {},
    logger: mockLogger(),
    cli: {
      exec: () => Effect.succeed({ exitCode: 0, stdout: '', stderr: '', durationMs: 0 }),
    },
    workspace: {
      root: '/tmp/test-workspace',
      resolve: (p: string) => `/tmp/test-workspace/${p}`,
    },
    artifactsWorkspace: {
      root: '/tmp/data/artifacts/root-001',
      resolve: (p: string) => `/tmp/data/artifacts/root-001/${p}`,
    },
    ...overrides,
  };
}

/** Run an Effect, returning Either for error inspection. */
function runEither<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runSync(Effect.either(effect));
}

// ────────────────────────────────────────────────────────────────────────────
// delay
// ────────────────────────────────────────────────────────────────────────────

describe('delay action', () => {
  it('waits and transitions', async () => {
    const ctx = makeCtx({ delayMs: 10, nextState: 'next' });

    const result = await Effect.runPromise(delayAction(ctx));

    expect(result.nextState).toBe('next');
    expect(result.data).toEqual({ delayMs: 10, nextState: 'next' });
  });

  it('fails with ActionError on missing delayMs', () => {
    const ctx = makeCtx({ nextState: 'next' });
    const result = runEither(delayAction(ctx));

    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left._tag).toBe('ActionError');
      expect(result.left.actionId).toBe('delay');
    }
  });

  it('fails with ActionError on missing nextState', () => {
    const ctx = makeCtx({ delayMs: 10 });
    const result = runEither(delayAction(ctx));

    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left.actionId).toBe('delay');
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// log-message
// ────────────────────────────────────────────────────────────────────────────

describe('log-message action', () => {
  it('logs and transitions', () => {
    const logger = mockLogger();
    const ctx = makeCtx({ message: 'hello', nextState: 'next' }, { logger });

    const result = Effect.runSync(logMessageAction(ctx));

    expect(result.nextState).toBe('next');
    expect(logger.calls).toEqual([{ level: 'info', message: 'hello' }]);
  });

  it('uses the specified log level', () => {
    const logger = mockLogger();
    const ctx = makeCtx({ message: 'warning!', level: 'warn', nextState: 'next' }, { logger });

    Effect.runSync(logMessageAction(ctx));

    expect(logger.calls[0]?.level).toBe('warn');
  });

  it('fails with ActionError on missing message', () => {
    const ctx = makeCtx({ nextState: 'next' });
    const result = runEither(logMessageAction(ctx));

    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left.actionId).toBe('log-message');
    }
  });

  it('fails with ActionError on missing nextState', () => {
    const ctx = makeCtx({ message: 'hello' });
    const result = runEither(logMessageAction(ctx));

    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left.actionId).toBe('log-message');
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// conditional-branch
// ────────────────────────────────────────────────────────────────────────────

describe('conditional-branch action', () => {
  it('routes to trueState when condition is met (eq)', () => {
    const ctx = makeCtx({
      score: 100,
      condition: { field: 'score', operator: 'eq', value: 100 },
      trueState: 'pass',
      falseState: 'fail',
    });

    const result = Effect.runSync(conditionalBranchAction(ctx));
    expect(result.nextState).toBe('pass');
  });

  it('routes to falseState when condition is not met (eq)', () => {
    const ctx = makeCtx({
      score: 50,
      condition: { field: 'score', operator: 'eq', value: 100 },
      trueState: 'pass',
      falseState: 'fail',
    });

    const result = Effect.runSync(conditionalBranchAction(ctx));
    expect(result.nextState).toBe('fail');
  });

  it('handles neq operator', () => {
    const ctx = makeCtx({
      status: 'active',
      condition: { field: 'status', operator: 'neq', value: 'inactive' },
      trueState: 'continue',
      falseState: 'stop',
    });

    const result = Effect.runSync(conditionalBranchAction(ctx));
    expect(result.nextState).toBe('continue');
  });

  it('handles gt operator', () => {
    const ctx = makeCtx({
      count: 10,
      condition: { field: 'count', operator: 'gt', value: 5 },
      trueState: 'high',
      falseState: 'low',
    });

    const result = Effect.runSync(conditionalBranchAction(ctx));
    expect(result.nextState).toBe('high');
  });

  it('handles lt operator', () => {
    const ctx = makeCtx({
      count: 3,
      condition: { field: 'count', operator: 'lt', value: 5 },
      trueState: 'low',
      falseState: 'high',
    });

    const result = Effect.runSync(conditionalBranchAction(ctx));
    expect(result.nextState).toBe('low');
  });

  it('handles exists operator (field present)', () => {
    const ctx = makeCtx({
      token: 'abc123',
      condition: { field: 'token', operator: 'exists' },
      trueState: 'authenticated',
      falseState: 'anonymous',
    });

    const result = Effect.runSync(conditionalBranchAction(ctx));
    expect(result.nextState).toBe('authenticated');
  });

  it('handles exists operator (field missing)', () => {
    const ctx = makeCtx({
      condition: { field: 'token', operator: 'exists' },
      trueState: 'authenticated',
      falseState: 'anonymous',
    });

    const result = Effect.runSync(conditionalBranchAction(ctx));
    expect(result.nextState).toBe('anonymous');
  });

  it('fails with ActionError on missing condition', () => {
    const ctx = makeCtx({ trueState: 'a', falseState: 'b' });
    const result = runEither(conditionalBranchAction(ctx));

    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left.actionId).toBe('conditional-branch');
    }
  });

  it('fails with ActionError on invalid operator', () => {
    const ctx = makeCtx({
      condition: { field: 'x', operator: 'contains' },
      trueState: 'a',
      falseState: 'b',
    });
    const result = runEither(conditionalBranchAction(ctx));

    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left.actionId).toBe('conditional-branch');
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// transform-data
// ────────────────────────────────────────────────────────────────────────────

describe('transform-data action', () => {
  it('applies JSONPath and transitions', () => {
    const ctx = makeCtx({
      items: [1, 2, 3],
      expression: '$.items[0]',
      nextState: 'next',
    });

    const result = Effect.runSync(transformDataAction(ctx));

    expect(result.nextState).toBe('next');
    expect(result.data).toEqual([1]);
  });

  it('returns empty array for non-matching expression', () => {
    const ctx = makeCtx({
      expression: '$.nonexistent',
      nextState: 'next',
    });

    const result = Effect.runSync(transformDataAction(ctx));

    expect(result.nextState).toBe('next');
    expect(result.data).toEqual([]);
  });

  it('fails with ActionError on missing expression', () => {
    const ctx = makeCtx({ nextState: 'next' });
    const result = runEither(transformDataAction(ctx));

    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left.actionId).toBe('transform-data');
    }
  });

  it('fails with ActionError on missing nextState', () => {
    const ctx = makeCtx({ expression: '$.x' });
    const result = runEither(transformDataAction(ctx));

    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left.actionId).toBe('transform-data');
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// http-request
// ────────────────────────────────────────────────────────────────────────────

describe('http-request action', () => {
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    // Mock global fetch for all tests in this block
    globalThis.fetch = vi.fn();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('makes a request and returns response data', async () => {
    const mockResponse = { ok: true, status: 200, json: () => Promise.resolve({ result: 42 }) };
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

    const ctx = makeCtx({
      url: 'https://api.example.com/data',
      method: 'GET',
      nextState: 'done',
    });

    const result = await Effect.runPromise(httpRequestAction(ctx));

    expect(result.nextState).toBe('done');
    expect(result.data).toEqual({ result: 42 });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/data',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('sends POST with body', async () => {
    const mockResponse = { ok: true, status: 201, json: () => Promise.resolve({ id: 1 }) };
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

    const ctx = makeCtx({
      url: 'https://api.example.com/items',
      method: 'POST',
      body: { name: 'test' },
      nextState: 'created',
    });

    const result = await Effect.runPromise(httpRequestAction(ctx));

    expect(result.nextState).toBe('created');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/items',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'test' }),
      }),
    );
  });

  it('fails with ActionError on HTTP error response', async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not Found'),
    };
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

    const ctx = makeCtx({
      url: 'https://api.example.com/missing',
      nextState: 'done',
    });

    const result = await Effect.runPromise(Effect.either(httpRequestAction(ctx)));

    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left._tag).toBe('ActionError');
      expect(result.left.actionId).toBe('http-request');
    }
  });

  it('fails with ActionError on network error', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('Network failure'));

    const ctx = makeCtx({
      url: 'https://api.example.com/down',
      nextState: 'done',
    });

    const result = await Effect.runPromise(Effect.either(httpRequestAction(ctx)));

    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left._tag).toBe('ActionError');
      expect(result.left.actionId).toBe('http-request');
    }
  });

  it('fails with ActionError on missing url', () => {
    const ctx = makeCtx({ nextState: 'done' });
    const result = runEither(httpRequestAction(ctx));

    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left.actionId).toBe('http-request');
    }
  });

  it('fails with ActionError on missing nextState', () => {
    const ctx = makeCtx({ url: 'https://example.com' });
    const result = runEither(httpRequestAction(ctx));

    expect(result._tag).toBe('Left');
    if (result._tag === 'Left') {
      expect(result.left.actionId).toBe('http-request');
    }
  });
});
