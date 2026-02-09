/**
 * REST API routes for state machine definition CRUD operations (Task 18).
 *
 * Routes:
 *   GET    /api/machines/definitions       — List all definitions
 *   POST   /api/machines/definitions       — Create a new definition
 *   GET    /api/machines/definitions/:id   — Get a definition by ID
 *   PUT    /api/machines/definitions/:id   — Update a definition
 *   DELETE /api/machines/definitions/:id   — Delete a definition
 *
 * @module
 */

import { HttpRouter, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect, Either } from 'effect';

import { validateDefinition } from '@/machines/DefinitionValidator.js';
import { decodeCreateDefinition, decodeUpdateDefinition } from '@/machines/schemas.js';
import { MachineStore } from '@/machines/store/index.js';
import type { StateMachineDefinition } from '@/machines/types.js';
import { mkValidationError } from '@/machines/types.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Read the JSON request body, converting parse failures to a `ValidationError`
 * so they surface as HTTP 400 via the standard `catchTag` chain.
 */
const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  return yield* request.json.pipe(
    Effect.catchAll(() => Effect.fail(mkValidationError({ message: 'Invalid request body' }))),
  );
});

/**
 * Construct a temporary full `StateMachineDefinition` from a create/update
 * request body so the definition validator (which expects a complete definition
 * including `id`, `version`, `metadata`) can run pre-save.
 */
const buildTempDefinition = (body: Record<string, unknown>): StateMachineDefinition => {
  const now = new Date().toISOString();
  const b = body as unknown as {
    name: string;
    inputSchema: StateMachineDefinition['inputSchema'];
    outputSchema: StateMachineDefinition['outputSchema'];
    states: StateMachineDefinition['states'];
    initialState: string;
    transitions: StateMachineDefinition['transitions'];
    metadata?: { description?: string; tags?: string[] };
  };
  return {
    id: '__temp_validation__',
    name: b.name,
    version: 1,
    inputSchema: b.inputSchema,
    outputSchema: b.outputSchema,
    states: b.states,
    initialState: b.initialState,
    transitions: b.transitions,
    metadata: {
      createdAt: now,
      updatedAt: now,
      description: b.metadata?.description,
      tags: b.metadata?.tags,
    },
  };
};

// ────────────────────────────────────────────────────────────────────────────
// Router
// ────────────────────────────────────────────────────────────────────────────

export const DefinitionsRouter = HttpRouter.empty.pipe(
  // ── GET /api/machines/definitions ─────────────────────────────────────
  HttpRouter.get(
    '/api/machines/definitions',
    Effect.gen(function* () {
      const store = yield* MachineStore;
      const definitions = yield* store.listDefinitions();
      return yield* HttpServerResponse.json(definitions);
    }).pipe(
      Effect.catchTag('StoreError', (err) =>
        HttpServerResponse.json({ message: String(err.cause) }, { status: 500 }),
      ),
      Effect.catchAll(() =>
        HttpServerResponse.json({ message: 'Internal server error' }, { status: 500 }),
      ),
    ),
  ),

  // ── POST /api/machines/definitions ────────────────────────────────────
  HttpRouter.post(
    '/api/machines/definitions',
    Effect.gen(function* () {
      const rawBody: unknown = yield* readJsonBody;

      const decoded = decodeCreateDefinition(rawBody);
      if (Either.isLeft(decoded)) {
        return yield* HttpServerResponse.json(
          { message: 'Invalid request body', details: [decoded.left.message] },
          { status: 400 },
        );
      }
      const body = decoded.right;

      // Pre-save validation with a temporary full definition
      const tempDef = buildTempDefinition(body as unknown as Record<string, unknown>);
      yield* validateDefinition(tempDef, 'save');

      // Persist — store generates id, version: 1, timestamps
      const store = yield* MachineStore;
      const created = yield* store.saveDefinition(
        body as unknown as Parameters<typeof store.saveDefinition>[0],
      );
      return yield* HttpServerResponse.json(created, { status: 201 });
    }).pipe(
      Effect.catchTag('DefinitionError', (err) =>
        HttpServerResponse.json(
          { message: err.message, details: err.details ?? [] },
          { status: 400 },
        ),
      ),
      Effect.catchTag('ValidationError', (err) =>
        HttpServerResponse.json({ message: err.message, path: err.path }, { status: 400 }),
      ),
      Effect.catchTag('StoreError', (err) =>
        HttpServerResponse.json({ message: String(err.cause) }, { status: 500 }),
      ),
      Effect.catchAll(() =>
        HttpServerResponse.json({ message: 'Internal server error' }, { status: 500 }),
      ),
    ),
  ),

  // ── GET /api/machines/definitions/:id ─────────────────────────────────
  HttpRouter.get(
    '/api/machines/definitions/:id',
    Effect.gen(function* () {
      const params = yield* HttpRouter.params;
      const id = params.id ?? '';
      const store = yield* MachineStore;
      const definition = yield* store.getDefinition(id);
      return yield* HttpServerResponse.json(definition);
    }).pipe(
      Effect.catchTag('NotFoundError', (err) =>
        HttpServerResponse.json({ message: 'Definition not found', id: err.id }, { status: 404 }),
      ),
      Effect.catchAll(() =>
        HttpServerResponse.json({ message: 'Internal server error' }, { status: 500 }),
      ),
    ),
  ),

  // ── PUT /api/machines/definitions/:id ─────────────────────────────────
  HttpRouter.put(
    '/api/machines/definitions/:id',
    Effect.gen(function* () {
      const params = yield* HttpRouter.params;
      const id = params.id ?? '';
      const rawBody: unknown = yield* readJsonBody;

      const decoded = decodeUpdateDefinition(rawBody);
      if (Either.isLeft(decoded)) {
        return yield* HttpServerResponse.json(
          { message: 'Invalid request body', details: [decoded.left.message] },
          { status: 400 },
        );
      }
      const body = decoded.right;

      // Pre-update validation
      const tempDef = buildTempDefinition(body as unknown as Record<string, unknown>);
      yield* validateDefinition(tempDef, 'save');

      const store = yield* MachineStore;
      const updated = yield* store.updateDefinition(
        id,
        body as unknown as Parameters<typeof store.updateDefinition>[1],
      );
      return yield* HttpServerResponse.json(updated);
    }).pipe(
      Effect.catchTag('DefinitionError', (err) =>
        HttpServerResponse.json(
          { message: err.message, details: err.details ?? [] },
          { status: 400 },
        ),
      ),
      Effect.catchTag('ValidationError', (err) =>
        HttpServerResponse.json({ message: err.message, path: err.path }, { status: 400 }),
      ),
      Effect.catchTag('NotFoundError', (err) =>
        HttpServerResponse.json({ message: 'Definition not found', id: err.id }, { status: 404 }),
      ),
      Effect.catchAll(() =>
        HttpServerResponse.json({ message: 'Internal server error' }, { status: 500 }),
      ),
    ),
  ),

  // ── DELETE /api/machines/definitions/:id ──────────────────────────────
  HttpRouter.del(
    '/api/machines/definitions/:id',
    Effect.gen(function* () {
      const params = yield* HttpRouter.params;
      const id = params.id ?? '';
      const store = yield* MachineStore;
      yield* store.deleteDefinition(id);
      return HttpServerResponse.empty({ status: 204 });
    }).pipe(
      Effect.catchTag('NotFoundError', (err) =>
        HttpServerResponse.json({ message: 'Definition not found', id: err.id }, { status: 404 }),
      ),
      Effect.catchAll(() =>
        HttpServerResponse.json({ message: 'Internal server error' }, { status: 500 }),
      ),
    ),
  ),
);
