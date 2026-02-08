import { HttpMiddleware, HttpServer } from '@effect/platform';
import { NodeHttpServer } from '@effect/platform-node';
import { Effect, Layer } from 'effect';
import { createServer } from 'node:http';

import { HelloRouter } from '@/routes/hello.js';

const PORT = Number(process.env.PORT ?? 3001);

const ServerLive = NodeHttpServer.layer(() => createServer(), { port: PORT });

export const HttpLive = HelloRouter.pipe(
  HttpServer.serve(HttpMiddleware.logger),
  HttpServer.withLogAddress,
  Layer.provide(ServerLive),
);

export const startServer = Layer.launch(HttpLive).pipe(
  Effect.tap(() => Effect.log(`Server starting on port ${String(PORT)}`)),
);
