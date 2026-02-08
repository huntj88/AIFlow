# Task 07 — Wide Logging (Client + Server)

> **Phase**: 5 from SETUP_PLAN  
> **Depends on**: Task 06 (integration)  
> **Blocks**: Task 08 (quality gates — logging should be in place before final checks)

---

## Objective

Set up structured wide logging on both server and client using Effect-TS. Server logs are JSON to stdout. Client logs are structured to the browser console. Both use `Effect.logSpan` for automatic duration tracking and consistent annotations. After this task, every API request produces structured log output on both sides.

---

## Steps

### 1. Server — Expand logger layer

Update **`server/src/lib/Logger.ts`**:

```ts
import { Logger, LogLevel, Layer } from 'effect';

/**
 * Wide structured JSON logger for the server.
 * Outputs one JSON line per log entry with:
 *   timestamp, level, message, spans (with duration), annotations, fiber
 */
export const JsonLoggerLive = Logger.json;

/**
 * Minimum log level — Debug in dev, Info in production.
 */
export const LogLevelLive = Logger.minimumLogLevel(
  process.env.NODE_ENV === 'production' ? LogLevel.Info : LogLevel.Debug,
);

/**
 * Combined logger layer for the server.
 */
export const ServerLoggerLive = Layer.mergeAll(JsonLoggerLive, LogLevelLive);
```

### 2. Server — Add request logging middleware

Create **`server/src/lib/RequestLogger.ts`**:

```ts
import { HttpMiddleware, HttpServer } from '@effect/platform';

/**
 * Middleware that logs every incoming request with method, URL, status, and duration.
 * Uses Effect's built-in HttpMiddleware.logger which integrates with the configured logger layer.
 */
export const withRequestLogging = HttpMiddleware.logger;
```

### 3. Server — Wire middleware into HttpServer

Update **`server/src/lib/HttpServer.ts`** to include request logging:

```ts
import { HttpRouter, HttpServer } from '@effect/platform';
import { NodeHttpServer } from '@effect/platform-node';
import { Layer, Effect } from 'effect';
import { createServer } from 'node:http';

import { HelloRouter } from '@/routes/hello.js';
import { withRequestLogging } from '@/lib/RequestLogger.js';

const PORT = Number(process.env.PORT ?? 3001);

const ServerLive = NodeHttpServer.layer(() => createServer(), { port: PORT });

const HttpLive = HelloRouter.pipe(
  HttpServer.serve(withRequestLogging),
  HttpServer.withLogAddress,
  Layer.provide(ServerLive),
);

export const startServer = Effect.gen(function* () {
  yield* Effect.log(`Server starting on port ${String(PORT)}`);
}).pipe(Effect.provide(HttpLive));
```

### 4. Server — Update entrypoint to use combined logger

Update **`server/src/index.ts`**:

```ts
import { NodeRuntime } from '@effect/platform-node';
import { Effect } from 'effect';

import { startServer } from '@/lib/HttpServer.js';
import { ServerLoggerLive } from '@/lib/Logger.js';

startServer.pipe(Effect.provide(ServerLoggerLive), NodeRuntime.runMain);
```

### 5. Client — Create structured logger utility

Create **`client/src/utils/logger.ts`**:

```ts
import { Logger, LogLevel, Layer, Effect } from 'effect';

/**
 * Client-side structured logger.
 * Uses Effect's JSON logger which outputs structured entries to the console.
 * In production, set minimum level to Info to reduce noise.
 */
const logLevel =
  import.meta.env.MODE === 'production' ? LogLevel.Info : LogLevel.Debug;

export const ClientLoggerLive = Layer.mergeAll(
  Logger.json,
  Logger.minimumLogLevel(logLevel),
);

/**
 * Helper to run an Effect with the client logger.
 */
export const runWithLogging = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(Effect.provide(ClientLoggerLive), Effect.runPromise);
```

### 6. Client — Update apiClient to use logging + spans

Update **`client/src/utils/apiClient.ts`**:

```ts
import {
  FetchHttpClient,
  HttpClient,
  HttpClientResponse,
} from '@effect/platform';
import { Effect } from 'effect';

const makeRequest = (path: string) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const response = yield* client.get(path);
    return yield* HttpClientResponse.json(response);
  }).pipe(
    Effect.scoped,
    Effect.provide(FetchHttpClient.layer),
    Effect.tap((res) => Effect.log('API response received', { path, response: res })),
    Effect.withLogSpan(`api.GET ${path}`),
  );

export const apiClient = {
  hello: () => makeRequest('/api/hello') as Effect.Effect<{ message: string }, Error>,
};
```

### 7. Client — Update useHello hook to use logger

Update **`client/src/hooks/useHello.ts`**:

```ts
import { Effect } from 'effect';
import { useCallback, useState } from 'react';

import { apiClient } from '@/utils/apiClient';
import { runWithLogging } from '@/utils/logger';

interface HelloState {
  data: string | null;
  loading: boolean;
  error: string | null;
}

export function useHello() {
  const [state, setState] = useState<HelloState>({
    data: null,
    loading: false,
    error: null,
  });

  const fetchHello = useCallback(() => {
    setState({ data: null, loading: true, error: null });

    runWithLogging(apiClient.hello())
      .then((res) => setState({ data: res.message, loading: false, error: null }))
      .catch((err: unknown) =>
        setState({ data: null, loading: false, error: String(err) }),
      );
  }, []);

  return { ...state, fetchHello };
}
```

---

## What "wide logging" means in practice

| Property | Server | Client |
|----------|--------|--------|
| **Format** | JSON to stdout (one line per entry) | JSON to browser console |
| **Logger** | `Logger.json` (Effect built-in) | `Logger.json` (Effect built-in) |
| **Min level** | `Debug` (dev) / `Info` (prod) | `Debug` (dev) / `Info` (prod) |
| **Spans** | `Effect.withLogSpan` on request handling | `Effect.withLogSpan` on API calls |
| **Annotations** | method, path, status, duration (via HttpMiddleware.logger) | path, response body |
| **Duration** | Automatic via spans | Automatic via spans |

---

## Validation Checklist

- [x] `server/src/lib/Logger.ts` exports `ServerLoggerLive` combining JSON logger + log level
- [x] `server/src/lib/RequestLogger.ts` exports request logging middleware
- [x] `server/src/lib/HttpServer.ts` applies request logging middleware
- [x] `server/src/index.ts` provides `ServerLoggerLive` to the main program
- [x] Start server → `curl http://localhost:3001/api/hello` → stdout shows JSON log line with:
  - `timestamp`
  - `level`
  - `message`
  - `spans` (with duration)
  - Request details (method, path)
- [x] `client/src/utils/logger.ts` exports `ClientLoggerLive` and `runWithLogging`
- [x] `client/src/utils/apiClient.ts` uses `Effect.withLogSpan` and `Effect.log` for annotations
- [x] `client/src/hooks/useHello.ts` uses `runWithLogging` instead of raw `Effect.runPromise`
- [x] Click "Say Hello" in browser → open DevTools console → see structured JSON log entry with:
  - `timestamp`
  - `message` ("API response received")
  - `spans` with duration for `api.GET /api/hello`
  - `annotations` with path and response
- [x] Log level respects environment: dev shows Debug+, production would show Info+ only
- [x] All existing tests still pass (`pnpm test`)
- [x] All existing E2E tests still pass (`pnpm --filter @aiflow/client run test:e2e`)
- [x] `pnpm lint` passes for both workspaces
- [x] No TypeScript errors in either workspace
