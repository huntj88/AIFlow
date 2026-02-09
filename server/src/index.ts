import { NodeRuntime } from '@effect/platform-node';
import { Effect } from 'effect';

import { startServer } from '@/lib/HttpServer.js';
import { MachineLive } from '@/lib/HttpServer.js';
import { ServerLoggerLive } from '@/lib/Logger.js';
import { logOtelStatus } from '@/lib/Telemetry.js';
import { StateMachineRunner } from '@/machines/StateMachineRunner.js';

/**
 * Main server entry point.
 *
 * 1. Launch the HTTP server with all machine service layers
 * 2. WebSocket server is started as part of the HttpLive layer (Task 23)
 * 3. Wire SIGTERM / SIGINT handlers for graceful shutdown via `suspendAll()`
 *
 * `NodeRuntime.runMain` handles SIGTERM/SIGINT by interrupting the running
 * Effect, which triggers the `onInterrupt` finalizer chain. We also register
 * explicit signal handlers that call `runner.suspendAll()` to persist
 * in-flight machines as `'suspended'` before the process exits.
 */
const main = Effect.gen(function* () {
  const runner = yield* StateMachineRunner;

  yield* Effect.sync(() => {
    const shutdown = (signal: string) => {
      Effect.log(`Received ${signal} — suspending all running machines…`).pipe(
        Effect.andThen(() => runner.suspendAll()),
        Effect.andThen(() => Effect.log('All machines suspended, shutting down.')),
        Effect.catchAll((err: unknown) =>
          Effect.log(`Shutdown error: ${err instanceof Error ? err.message : JSON.stringify(err)}`),
        ),
        Effect.provide(ServerLoggerLive),
        Effect.runFork,
      );
    };

    process.on('SIGTERM', () => {
      shutdown('SIGTERM');
    });
    process.on('SIGINT', () => {
      shutdown('SIGINT');
    });
  });
});

startServer.pipe(
  Effect.provide(ServerLoggerLive),
  Effect.tap(() => logOtelStatus),
  Effect.tap(() => main.pipe(Effect.provide(MachineLive))),
  NodeRuntime.runMain,
);
