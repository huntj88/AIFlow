/**
 * REST API routes for machine instance lifecycle (Task 20).
 *
 * Routes:
 *   POST   /api/machines/instances              — Start a new instance
 *   GET    /api/machines/instances              — List instances (with filters)
 *   GET    /api/machines/instances/:id          — Get instance by ID
 *   GET    /api/machines/instances/:id/history  — Get transition history
 *   GET    /api/machines/instances/:id/logs     — Get logs (optional ?state= filter)
 *   POST   /api/machines/instances/:id/cancel   — Cancel an instance
 *   POST   /api/machines/instances/:id/resume   — Resume a suspended instance
 *   GET    /api/machines/instances/:id/artifacts       — List artifacts (or ?tree=true)
 *   GET    /api/machines/instances/:id/artifacts/:name — Download artifact
 *
 * @module
 */

import { HttpRouter, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import AjvModule from 'ajv';
import { Effect, Either, Option } from 'effect';

import { ArtifactStoreFactory } from '@/machines/artifacts/index.js';
import { buildArtifactTree } from '@/machines/artifacts/ArtifactTreeBuilder.js';
import { decodeStartInstance } from '@/machines/schemas.js';
import { MachineStore } from '@/machines/store/index.js';
import { StateMachineRunner } from '@/machines/StateMachineRunner.js';
import type { InstanceFilter } from '@/machines/types.js';
import { mkDefinitionError, mkNotFoundError, mkValidationError } from '@/machines/types.js';

// ── Ajv setup (same pattern as StateMachineRunner) ──────────────────────────
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
const Ajv: typeof AjvModule.default =
  typeof (AjvModule as any).default === 'function'
    ? (AjvModule as any).default
    : (AjvModule as any);
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
const ajv = new Ajv({ allErrors: true });

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
 * Extract query parameters from the current request URL.
 * Returns a `URLSearchParams` object.
 */
const getSearchParams = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const urlOpt = HttpServerRequest.toURL(request);
  if (Option.isSome(urlOpt)) {
    return urlOpt.value.searchParams;
  }
  // Fallback: parse from the raw url property
  return new URL(request.url, 'http://localhost').searchParams;
});

// ────────────────────────────────────────────────────────────────────────────
// Router
// ────────────────────────────────────────────────────────────────────────────

export const InstancesRouter = HttpRouter.empty.pipe(
  // ── POST /api/machines/instances ──────────────────────────────────────
  HttpRouter.post(
    '/api/machines/instances',
    Effect.gen(function* () {
      const rawBody: unknown = yield* readJsonBody;

      const decoded = decodeStartInstance(rawBody);
      if (Either.isLeft(decoded)) {
        return yield* HttpServerResponse.json(
          { message: 'Invalid request body', details: [decoded.left.message] },
          { status: 400 },
        );
      }
      const body = decoded.right;

      // Load definition — 404 if not found
      const store = yield* MachineStore;
      const definition = yield* store.getDefinition(body.definitionId);

      // Validate input against definition.inputSchema (§4.3)
      if (Object.keys(definition.inputSchema).length > 0) {
        const validate = ajv.compile(definition.inputSchema as Record<string, unknown>);
        if (!validate(body.input)) {
          const details =
            validate.errors?.map((e) => `${e.instancePath || '/'}: ${e.message ?? 'unknown'}`) ??
            [];
          return yield* HttpServerResponse.json(
            { message: `Input validation failed: ${details.join('; ')}`, details },
            { status: 400 },
          );
        }
      }

      // Fork the run so the HTTP response returns immediately
      const runner = yield* StateMachineRunner;
      yield* Effect.forkDaemon(runner.run(definition, body.input));

      // Yield to the scheduler so the forked fiber can save the instance
      yield* Effect.yieldNow();

      // Query the store for the most recently created instance for this definition
      const instances = yield* store.listInstances({
        definitionId: body.definitionId,
      });

      if (instances.length === 0) {
        return yield* HttpServerResponse.json(
          { message: 'Instance creation failed' },
          { status: 500 },
        );
      }

      const newest = instances.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

      return yield* HttpServerResponse.json(newest, { status: 201 });
    }).pipe(
      Effect.withSpan('api.post.instances'),
      Effect.catchTag('NotFoundError', (err) =>
        HttpServerResponse.json(
          {
            message: `${err.entityType.charAt(0).toUpperCase() + err.entityType.slice(1)} not found`,
            id: err.id,
          },
          { status: 404 },
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

  // ── GET /api/machines/instances ───────────────────────────────────────
  HttpRouter.get(
    '/api/machines/instances',
    Effect.gen(function* () {
      const searchParams = yield* getSearchParams;

      const filter: InstanceFilter = {};
      const status = searchParams.get('status');
      if (status) {
        (filter as Record<string, unknown>).status = status;
      }
      const definitionId = searchParams.get('definitionId');
      if (definitionId) {
        (filter as Record<string, unknown>).definitionId = definitionId;
      }
      const parentInstanceId = searchParams.get('parentInstanceId');
      if (parentInstanceId) {
        (filter as Record<string, unknown>).parentInstanceId = parentInstanceId;
      }
      const limitStr = searchParams.get('limit');
      if (limitStr) {
        (filter as Record<string, unknown>).limit = Number(limitStr);
      }
      const offsetStr = searchParams.get('offset');
      if (offsetStr) {
        (filter as Record<string, unknown>).offset = Number(offsetStr);
      }

      const store = yield* MachineStore;
      const instances = yield* store.listInstances(
        Object.keys(filter).length > 0 ? filter : undefined,
      );
      return yield* HttpServerResponse.json(instances);
    }).pipe(
      Effect.catchTag('StoreError', (err) =>
        HttpServerResponse.json({ message: String(err.cause) }, { status: 500 }),
      ),
      Effect.catchAll(() =>
        HttpServerResponse.json({ message: 'Internal server error' }, { status: 500 }),
      ),
    ),
  ),

  // ── GET /api/machines/instances/:id ───────────────────────────────────
  HttpRouter.get(
    '/api/machines/instances/:id',
    Effect.gen(function* () {
      const params = yield* HttpRouter.params;
      const id = params.id ?? '';
      const store = yield* MachineStore;
      const instance = yield* store.getInstance(id);
      return yield* HttpServerResponse.json(instance);
    }).pipe(
      Effect.catchTag('NotFoundError', (err) =>
        HttpServerResponse.json({ message: 'Instance not found', id: err.id }, { status: 404 }),
      ),
      Effect.catchAll(() =>
        HttpServerResponse.json({ message: 'Internal server error' }, { status: 500 }),
      ),
    ),
  ),

  // ── GET /api/machines/instances/:id/history ───────────────────────────
  HttpRouter.get(
    '/api/machines/instances/:id/history',
    Effect.gen(function* () {
      const params = yield* HttpRouter.params;
      const id = params.id ?? '';
      const store = yield* MachineStore;
      const instance = yield* store.getInstance(id);
      return yield* HttpServerResponse.json(instance.history);
    }).pipe(
      Effect.catchTag('NotFoundError', (err) =>
        HttpServerResponse.json({ message: 'Instance not found', id: err.id }, { status: 404 }),
      ),
      Effect.catchAll(() =>
        HttpServerResponse.json({ message: 'Internal server error' }, { status: 500 }),
      ),
    ),
  ),

  // ── GET /api/machines/instances/:id/logs ──────────────────────────────
  HttpRouter.get(
    '/api/machines/instances/:id/logs',
    Effect.gen(function* () {
      const params = yield* HttpRouter.params;
      const id = params.id ?? '';
      const store = yield* MachineStore;
      const instance = yield* store.getInstance(id);

      const searchParams = yield* getSearchParams;
      const stateFilter = searchParams.get('state');

      const logs = stateFilter
        ? instance.logs.filter((log) => log.stateName === stateFilter)
        : instance.logs;

      return yield* HttpServerResponse.json(logs);
    }).pipe(
      Effect.catchTag('NotFoundError', (err) =>
        HttpServerResponse.json({ message: 'Instance not found', id: err.id }, { status: 404 }),
      ),
      Effect.catchAll(() =>
        HttpServerResponse.json({ message: 'Internal server error' }, { status: 500 }),
      ),
    ),
  ),

  // ── POST /api/machines/instances/:id/cancel ───────────────────────────
  HttpRouter.post(
    '/api/machines/instances/:id/cancel',
    Effect.gen(function* () {
      const params = yield* HttpRouter.params;
      const id = params.id ?? '';
      const runner = yield* StateMachineRunner;
      yield* runner.cancel(id);
      return yield* HttpServerResponse.json({ message: 'Instance cancelled' });
    }).pipe(
      Effect.withSpan('api.post.cancel'),
      Effect.catchTag('NotFoundError', (err) =>
        HttpServerResponse.json({ message: 'Instance not found', id: err.id }, { status: 404 }),
      ),
      Effect.catchTag('DefinitionError', (err) =>
        HttpServerResponse.json(
          { message: err.message, details: err.details ?? [] },
          { status: 409 },
        ),
      ),
      Effect.catchAll(() =>
        HttpServerResponse.json({ message: 'Internal server error' }, { status: 500 }),
      ),
    ),
  ),

  // ── POST /api/machines/instances/:id/resume ───────────────────────────
  HttpRouter.post(
    '/api/machines/instances/:id/resume',
    Effect.gen(function* () {
      const params = yield* HttpRouter.params;
      const id = params.id ?? '';
      const store = yield* MachineStore;

      // Pre-validate: instance must exist and be suspended
      const instance = yield* store.getInstance(id);
      if (instance.status !== 'suspended') {
        return yield* Effect.fail(
          mkDefinitionError({
            message: `Cannot resume instance with status: ${instance.status}`,
            details: ['Only suspended instances can be resumed'],
          }),
        );
      }

      // Verify the definition still exists and version matches
      const definition = yield* store
        .getDefinition(instance.definitionId)
        .pipe(
          Effect.mapError(() =>
            mkNotFoundError({ entityType: 'definition', id: instance.definitionId }),
          ),
        );
      if (definition.version !== instance.definitionVersion) {
        return yield* Effect.fail(
          mkDefinitionError({
            message: 'Definition version changed since suspension',
            details: [
              `Expected version ${String(instance.definitionVersion)}, found ${String(definition.version)}`,
            ],
          }),
        );
      }

      // Fork the resume so the HTTP response returns immediately
      const runner = yield* StateMachineRunner;
      yield* Effect.forkDaemon(runner.resume(id));

      return yield* HttpServerResponse.json({ message: 'Instance resuming' });
    }).pipe(
      Effect.withSpan('api.post.resume'),
      Effect.catchTag('NotFoundError', (err) =>
        HttpServerResponse.json(
          {
            message: `${err.entityType.charAt(0).toUpperCase() + err.entityType.slice(1)} not found`,
            id: err.id,
          },
          { status: 404 },
        ),
      ),
      Effect.catchTag('DefinitionError', (err) =>
        HttpServerResponse.json(
          { message: err.message, details: err.details ?? [] },
          { status: 409 },
        ),
      ),
      Effect.catchAll(() =>
        HttpServerResponse.json({ message: 'Internal server error' }, { status: 500 }),
      ),
    ),
  ),

  // ── GET /api/machines/instances/:id/artifacts ─────────────────────────
  HttpRouter.get(
    '/api/machines/instances/:id/artifacts',
    Effect.gen(function* () {
      const params = yield* HttpRouter.params;
      const id = params.id ?? '';
      const store = yield* MachineStore;

      const searchParams = yield* getSearchParams;
      const treeMode = searchParams.get('tree') === 'true';

      if (treeMode) {
        const tree = yield* buildArtifactTree(id, store);
        return yield* HttpServerResponse.json(tree);
      }

      const instance = yield* store.getInstance(id);
      return yield* HttpServerResponse.json(instance.artifacts);
    }).pipe(
      Effect.catchTag('NotFoundError', (err) =>
        HttpServerResponse.json({ message: 'Instance not found', id: err.id }, { status: 404 }),
      ),
      Effect.catchTag('StoreError', (err) =>
        HttpServerResponse.json({ message: String(err.cause) }, { status: 500 }),
      ),
      Effect.catchAll(() =>
        HttpServerResponse.json({ message: 'Internal server error' }, { status: 500 }),
      ),
    ),
  ),

  // ── GET /api/machines/instances/:id/artifacts/:name ───────────────────
  HttpRouter.get(
    '/api/machines/instances/:id/artifacts/:name',
    Effect.gen(function* () {
      const params = yield* HttpRouter.params;
      const id = params.id ?? '';
      const name = params.name ?? '';

      const store = yield* MachineStore;
      const instance = yield* store.getInstance(id);

      // Check that the artifact exists in the instance record
      const artifact = instance.artifacts.find((a) => a.name === name);
      if (!artifact) {
        return yield* Effect.fail(mkNotFoundError({ entityType: 'instance', id: name }));
      }

      // Read the artifact content via ArtifactStoreFactory
      const factory = yield* ArtifactStoreFactory;
      const artifactStore = factory.makeScoped(id, '', instance.parentInstanceId);
      const content = yield* artifactStore.read(name);

      const contentType = artifact.mimeType ?? 'application/octet-stream';
      return HttpServerResponse.uint8Array(content, { contentType });
    }).pipe(
      Effect.catchTag('NotFoundError', (err) =>
        HttpServerResponse.json(
          {
            message: `${err.entityType.charAt(0).toUpperCase() + err.entityType.slice(1)} not found`,
            id: err.id,
          },
          { status: 404 },
        ),
      ),
      Effect.catchTag('StoreError', (err) =>
        HttpServerResponse.json({ message: String(err.cause) }, { status: 500 }),
      ),
      Effect.catchAll(() =>
        HttpServerResponse.json({ message: 'Internal server error' }, { status: 500 }),
      ),
    ),
  ),
);
