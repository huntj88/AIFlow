import { NodeRuntime } from '@effect/platform-node';
import { Effect } from 'effect';

import { startServer } from '@/lib/HttpServer.js';
import { ServerLoggerLive } from '@/lib/Logger.js';

startServer.pipe(Effect.provide(ServerLoggerLive), NodeRuntime.runMain);
