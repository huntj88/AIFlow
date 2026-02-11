/**
 * Shared E2E test handler factory (Task 34).
 *
 * Builds a full in-process HTTP handler wired with the MachineRouter and all
 * middleware enabled. Unlike existing route tests (which use empty middleware),
 * this uses the default middleware stack to verify cross-cutting concerns.
 *
 * Each `describe` block should call `makeTestHandler()` in `beforeAll` to get
 * a fully isolated handler — no shared mutable state across test suites.
 *
 * @module
 */

import { HttpApp, HttpRouter } from '@effect/platform';
import { Effect, Layer, ManagedRuntime } from 'effect';

import { ActionRegistry, ActionRegistryLive } from '@/machines/ActionRegistry.js';
import { FsArtifactStoreLive } from '@/machines/artifacts/FsArtifactStore.js';
import { MachineEventPubSubLive } from '@/machines/EventPubSub.js';
import { ExecutionSemaphoreLive } from '@/machines/ExecutionSemaphore.js';
import { makeMiddlewareExecutorLayer } from '@/machines/middleware/MiddlewareExecutor.js';
import { defaultMiddleware } from '@/machines/middleware/index.js';
import type { TransitionMiddleware } from '@/machines/types.js';
import { StateMachineRunnerLive } from '@/machines/StateMachineRunner.js';
import { InMemoryMachineStoreLive } from '@/machines/store/index.js';
import { MachineRouter } from '@/routes/machines/index.js';

// ────────────────────────────────────────────────────────────────────────────
// Layer Factory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the full E2E test layer with all middleware enabled.
 * Optionally accepts a custom middleware stack to override the default.
 */
export function makeE2ETestLayer(middleware?: readonly TransitionMiddleware[]) {
  const StoreLive = InMemoryMachineStoreLive;
  const RegistryLive = ActionRegistryLive;
  const MiddlewareLive = makeMiddlewareExecutorLayer(middleware ?? defaultMiddleware);
  const SemaphoreLive = ExecutionSemaphoreLive;
  const PubSubLive = MachineEventPubSubLive;
  const ArtifactLive = FsArtifactStoreLive.pipe(Layer.provide(StoreLive));
  const RunnerLive = StateMachineRunnerLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        StoreLive,
        RegistryLive,
        ArtifactLive,
        MiddlewareLive,
        SemaphoreLive,
        PubSubLive,
      ),
    ),
  );
  return Layer.mergeAll(
    StoreLive,
    RegistryLive,
    ArtifactLive,
    RunnerLive,
    SemaphoreLive,
    PubSubLive,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Handler Factory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create an in-process HTTP handler wired with the full MachineRouter.
 * Optionally registers custom test-only actions via `registerActions`.
 *
 * Returns the handler (for HTTP calls) and the `ManagedRuntime` (for cleanup
 * in `afterAll`).
 */
export async function makeTestHandler(opts?: {
  registerActions?: (registry: ActionRegistry) => Effect.Effect<void>;
  middleware?: readonly TransitionMiddleware[];
}) {
  const TestLayer = makeE2ETestLayer(opts?.middleware);
  const managedRuntime = ManagedRuntime.make(TestLayer);
  const runtime = await managedRuntime.runtime();

  const registerActions = opts?.registerActions;
  if (registerActions) {
    await managedRuntime.runPromise(
      Effect.gen(function* () {
        const registry = yield* ActionRegistry;
        yield* registerActions(registry);
      }),
    );
  }

  const served = MachineRouter.pipe(HttpRouter.use((httpApp) => Effect.provide(httpApp, runtime)));

  return {
    handler: HttpApp.toWebHandler(served),
    runtime: managedRuntime,
  };
}
