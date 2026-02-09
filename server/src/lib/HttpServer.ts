import { HttpMiddleware, HttpRouter, HttpServer } from '@effect/platform';
import { NodeHttpServer } from '@effect/platform-node';
import { Effect, Layer } from 'effect';
import type Http from 'node:http';
import { createServer } from 'node:http';

import { ActionRegistryLive } from '@/machines/ActionRegistry.js';
import { FsArtifactStoreLive } from '@/machines/artifacts/FsArtifactStore.js';
import { MachineEventPubSubLive } from '@/machines/EventPubSub.js';
import { ExecutionSemaphoreLive } from '@/machines/ExecutionSemaphore.js';
import { WebSocketManagerLive } from '@/machines/live/WebSocketManager.js';
import { makeMiddlewareExecutorLayer } from '@/machines/middleware/MiddlewareExecutor.js';
import { StateMachineRunnerLive } from '@/machines/StateMachineRunner.js';
import { InMemoryMachineStoreLive } from '@/machines/store/index.js';
import { HelloRouter } from '@/routes/hello.js';
import { MachineRouter } from '@/routes/machines/index.js';

const PORT = Number(process.env.PORT ?? 3001);

/**
 * Underlying Node.js HTTP server instance.
 *
 * Exported so that the WebSocket manager (Task 23) can attach an `upgrade`
 * handler on the same port without creating a second server.
 */
export const nodeHttpServer: Http.Server = createServer();

const ServerLive = NodeHttpServer.layer(() => nodeHttpServer, { port: PORT });

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

// All machine service layers merged (excluding WsManager — it's scoped and
// belongs in the long-lived AppLive layer, not in the ephemeral MachineLive
// used by the `main` effect).
export const MachineLive = Layer.mergeAll(
  StoreLive,
  RegistryLive,
  ArtifactLive,
  RunnerLive,
  SemaphoreLive,
  PubSubLive,
);

// ── HTTP + WebSocket server ─────────────────────────────────────────────────

/**
 * Complete application layer: HTTP routes + WebSocket manager.
 *
 * Both the HTTP route handlers and the WS manager share the same `MachineLive`
 * layer (and therefore the same `PubSub` instance), ensuring events published
 * by the runner reach connected WebSocket clients.
 */
export const HttpLive = Layer.merge(
  AppRouter.pipe(
    HttpServer.serve(HttpMiddleware.logger),
    HttpServer.withLogAddress,
    Layer.provide(ServerLive),
  ),
  WebSocketManagerLive,
).pipe(Layer.provide(MachineLive));

export const startServer = Layer.launch(HttpLive).pipe(
  Effect.tap(() => Effect.log(`Server starting on port ${String(PORT)}`)),
);
