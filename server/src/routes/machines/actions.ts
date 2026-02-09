/**
 * REST API routes for browsing the action registry (Task 19).
 *
 * Routes:
 *   GET /api/machines/actions      — List all registered action metadata
 *   GET /api/machines/actions/:id  — Get metadata for a specific action
 *
 * @module
 */

import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { Effect } from 'effect';

import { ActionRegistry } from '@/machines/ActionRegistry.js';

// ────────────────────────────────────────────────────────────────────────────
// Router
// ────────────────────────────────────────────────────────────────────────────

export const ActionsRouter = HttpRouter.empty.pipe(
  // ── GET /api/machines/actions ─────────────────────────────────────────
  HttpRouter.get(
    '/api/machines/actions',
    Effect.gen(function* () {
      const registry = yield* ActionRegistry;
      const actions = yield* registry.list();
      return yield* HttpServerResponse.json(actions);
    }).pipe(
      Effect.catchAll(() =>
        HttpServerResponse.json({ message: 'Internal server error' }, { status: 500 }),
      ),
    ),
  ),

  // ── GET /api/machines/actions/:id ─────────────────────────────────────
  HttpRouter.get(
    '/api/machines/actions/:id',
    Effect.gen(function* () {
      const params = yield* HttpRouter.params;
      const id = params.id ?? '';
      const registry = yield* ActionRegistry;
      const { metadata } = yield* registry.get(id);
      return yield* HttpServerResponse.json(metadata);
    }).pipe(
      Effect.catchTag('NotFoundError', (err) =>
        HttpServerResponse.json({ message: 'Action not found', id: err.id }, { status: 404 }),
      ),
      Effect.catchAll(() =>
        HttpServerResponse.json({ message: 'Internal server error' }, { status: 500 }),
      ),
    ),
  ),
);
