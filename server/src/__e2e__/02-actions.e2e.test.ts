/**
 * E2E: Action Registry (Task 36).
 *
 * Validates all 4 behaviors from §3 (Action Registry) via HTTP requests
 * against an in-process handler, confirming that the server exposes the
 * built-in action registry correctly.
 *
 * @module
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type ApiHelpers, makeApiHelpers } from './helpers/api-helpers.js';
import { makeTestHandler } from './helpers/test-handler.js';

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const BUILT_IN_IDS = [
  'http-request',
  'delay',
  'transform-data',
  'log-message',
  'conditional-branch',
] as const;

// ════════════════════════════════════════════════════════════════════════════
// §3 — Action Registry
// ════════════════════════════════════════════════════════════════════════════

describe('§3 — Action Registry', () => {
  let api: ApiHelpers;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const { handler, runtime } = await makeTestHandler();
    api = makeApiHelpers(handler);
    cleanup = () => runtime.dispose().then(() => undefined);
  });

  afterAll(async () => {
    await cleanup();
  });

  // ── §3.1 List all actions ─────────────────────────────────────────────

  it('GET /actions returns list of all registered actions with metadata', async () => {
    const res = await api.getActions();
    expect(res.status).toBe(200);

    const list = (await res.json()) as { id: string; description?: string }[];
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(5);

    for (const action of list) {
      expect(action).toHaveProperty('id');
      expect(action).toHaveProperty('description');
    }
  });

  // ── §3.2 All 5 built-in actions present ───────────────────────────────

  it('all 5 built-in actions are present on server startup', async () => {
    const res = await api.getActions();
    const list = (await res.json()) as { id: string }[];
    const ids = list.map((a) => a.id);

    for (const expected of BUILT_IN_IDS) {
      expect(ids).toContain(expected);
    }
  });

  // ── §3.3 Get action by ID ────────────────────────────────────────────

  it.each([...BUILT_IN_IDS])('GET /actions/%s returns metadata', async (actionId) => {
    const res = await api.getAction(actionId);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { id: string; description?: string };
    expect(body.id).toBe(actionId);
    expect(body).toHaveProperty('description');
  });

  // ── §3.4 Non-existent action → 404 ───────────────────────────────────

  it('GET /actions/:id for non-existent action → 404', async () => {
    const res = await api.getAction('does-not-exist');
    expect(res.status).toBe(404);

    const body = (await res.json()) as { message: string };
    expect(body).toHaveProperty('message');
    expect(body.message).toContain('not found');
  });
});
