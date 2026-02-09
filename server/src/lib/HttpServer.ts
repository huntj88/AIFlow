import { HttpMiddleware, HttpRouter, HttpServer } from '@effect/platform';
import { NodeHttpServer } from '@effect/platform-node';
import { Effect, Layer } from 'effect';
import { createServer } from 'node:http';

import { ActionRegistryLive } from '@/machines/ActionRegistry.js';
import { FsArtifactStoreLive } from '@/machines/artifacts/FsArtifactStore.js';
import { MachineEventPubSubLive } from '@/machines/EventPubSub.js';
import { ExecutionSemaphoreLive } from '@/machines/ExecutionSemaphore.js';
import { makeMiddlewareExecutorLayer } from '@/machines/middleware/MiddlewareExecutor.js';
import { StateMachineRunnerLive } from '@/machines/StateMachineRunner.js';
import { InMemoryMachineStoreLive } from '@/machines/store/index.js';
import { HelloRouter } from '@/routes/hello.js';
import { MachineRouter } from '@/routes/machines/index.js';

const PORT = Number(process.env.PORT ?? 3001);

const ServerLive = NodeHttpServer.layer(() => createServer(), { port: PORT });

// ── Route composition ───────────────────────────────────────────────────────

const AppRouter = HttpRouter.empty.pipe(
  HttpRouter.mount('/', HelloRouter),
  HttpRouter.mount('/', MachineRouter),
);

// ── Layer composition ───────────────────────────────────────────────────────

// Base layers (no dependencies)
const StoreLive = InMemoryMachineStoreLive;
const RegistryLive = ActionRegistryLive;
const MiddlewareLive = makeMiddlewareExecutorLayer([]);
const SemaphoreLive = ExecutionSemaphoreLive;
const PubSubLive = MachineEventPubSubLive;

// ArtifactStoreFactory depends on MachineStore
const ArtifactLive = FsArtifactStoreLive.pipe(Layer.provide(StoreLive));

// Runner depends on all six services
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

// All machine service layers merged
export const MachineLive = Layer.mergeAll(
  StoreLive,
  RegistryLive,
  ArtifactLive,
  RunnerLive,
  SemaphoreLive,
  PubSubLive,
);

// ── HTTP server ─────────────────────────────────────────────────────────────

export const HttpLive = AppRouter.pipe(
  HttpServer.serve(HttpMiddleware.logger),
  HttpServer.withLogAddress,
  Layer.provide(ServerLive),
  Layer.provide(MachineLive),
);

export const startServer = Layer.launch(HttpLive).pipe(
  Effect.tap(() => Effect.log(`Server starting on port ${String(PORT)}`)),
);
