import { NodeRuntime } from '@effect/platform-node';
import { Effect } from 'effect';

import { startServer } from '@/lib/HttpServer.js';
import { ServerLoggerLive } from '@/lib/Logger.js';

/**
 * Main server entry point.
 *
 * 1. Launch the HTTP server
 * 2. Wire SIGTERM / SIGINT handlers for graceful shutdown
 *
 * Note: `suspendAll()` and `startupRecovery` are wired once the
 * StateMachineRunner is integrated into the HTTP layer (Tasks 18–21).
 * For now, the shutdown handlers log a message and exit cleanly.
 */
const main = Effect.gen(function* () {
  yield* Effect.sync(() => {
    const shutdown = (signal: string) => {
      Effect.log(`Received ${signal} — initiating graceful shutdown…`).pipe(
        Effect.provide(ServerLoggerLive),
        (eff) => {
          Effect.runFork(eff);
        },
      );
      // Future: call runner.suspendAll() here once wired (Task 21)
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
  Effect.tap(() => main),
  NodeRuntime.runMain,
);
