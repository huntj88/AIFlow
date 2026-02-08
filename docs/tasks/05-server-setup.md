# Task 05 — Server Setup (Effect-TS)

> **Phase**: 3 from SETUP_PLAN  
> **Depends on**: Task 01 (monorepo scaffolding)  
> **Blocks**: Task 06 (integration), Task 07 (wide logging)

---

## Objective

Create the Effect-TS HTTP server package with a hello world route, Vitest config, ESLint, and dev/build scripts. After this task, `pnpm --filter @aiflow/server run dev` starts a server that responds to `GET /api/hello` with `{ "message": "hello world" }`.

---

## Steps

### 1. Update `server/package.json`

Replace the placeholder from Task 01:

```jsonc
{
  "name": "@aiflow/server",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write \"src/**/*.{ts,json,md}\"",
    "format:check": "prettier --check \"src/**/*.{ts,json,md}\"",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### 2. Install production dependencies

```bash
cd server
pnpm add effect @effect/platform @effect/platform-node
```

### 3. Install dev dependencies

```bash
pnpm add -D typescript @types/node tsx \
  vitest @vitest/coverage-v8 \
  eslint typescript-eslint @eslint/js eslint-config-prettier globals
```

### 4. TypeScript configuration

**`server/tsconfig.json`**:

```jsonc
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    },
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.tsbuildinfo"
  },
  "include": ["src"]
}
```

### 5. Vitest configuration

**`server/vitest.config.ts`**:

```ts
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
```

### 6. ESLint configuration

**`server/eslint.config.ts`**:

```ts
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },

  js.configs.recommended,

  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Prettier compat (must be last)
  prettier,
);
```

### 7. Create folder structure

```
server/src/
  index.ts
  routes/
    hello.ts
  lib/
    HttpServer.ts
    Logger.ts
```

### 8. Hello route

**`server/src/routes/hello.ts`**:

```ts
import { HttpRouter, HttpServerResponse } from '@effect/platform';

export const HelloRouter = HttpRouter.empty.pipe(
  HttpRouter.get('/api/hello', HttpServerResponse.json({ message: 'hello world' })),
);
```

### 9. HTTP server layer

**`server/src/lib/HttpServer.ts`**:

```ts
import { HttpRouter, HttpServer } from '@effect/platform';
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { Layer, Effect } from 'effect';
import { createServer } from 'node:http';

import { HelloRouter } from '@/routes/hello.js';

const PORT = Number(process.env.PORT ?? 3001);

const ServerLive = NodeHttpServer.layer(() => createServer(), { port: PORT });

const HttpLive = HelloRouter.pipe(
  HttpServer.serve(),
  HttpServer.withLogAddress,
  Layer.provide(ServerLive),
);

export const startServer = Effect.gen(function* () {
  yield* Effect.log(`Server starting on port ${String(PORT)}`);
}).pipe(Effect.provide(HttpLive));
```

> **Note on imports**: With `moduleResolution: NodeNext`, local imports need `.js` extensions (e.g., `@/routes/hello.js`). TypeScript resolves `.js` → `.ts` at compile time.

### 10. Logger setup (basic — expanded in Task 07)

**`server/src/lib/Logger.ts`**:

```ts
import { Logger, LogLevel } from 'effect';

export const JsonLoggerLive = Logger.json;

export const LogLevelLive = Logger.minimumLogLevel(LogLevel.Debug);
```

### 11. Server entrypoint

**`server/src/index.ts`**:

```ts
import { NodeRuntime } from '@effect/platform-node';
import { Layer, Effect } from 'effect';

import { JsonLoggerLive, LogLevelLive } from '@/lib/Logger.js';
import { startServer } from '@/lib/HttpServer.js';

const MainLive = Layer.mergeAll(JsonLoggerLive, LogLevelLive);

startServer.pipe(Effect.provide(MainLive), NodeRuntime.runMain);
```

### 12. Smoke unit test

**`server/src/routes/hello.test.ts`**:

```ts
import { HttpApp } from '@effect/platform';
import { describe, expect, it } from 'vitest';

import { HelloRouter } from './hello.js';

describe('HelloRouter', () => {
  it('GET /api/hello returns hello world', async () => {
    const handler = HttpApp.toWebHandler(HelloRouter);
    const response = await handler(new Request('http://localhost/api/hello'));
    const body = await response.json();

    expect(body).toEqual({ message: 'hello world' });
  });
});
```

> **Note**: `HttpApp.toWebHandler` converts an `HttpRouter` into a standard `(request: Request) => Promise<Response>` function — no Effect runtime needed in the test. This is the current recommended pattern for testing routes.

---

## Validation Checklist

- [ ] `server/package.json` has all scripts: `dev`, `build`, `start`, `lint`, `lint:fix`, `format`, `format:check`, `test`, `test:watch`
- [ ] `server/package.json` has `"type": "module"`
- [ ] Production deps installed: `effect`, `@effect/platform`, `@effect/platform-node`
- [ ] Dev deps installed: `typescript`, `@types/node`, `tsx`, `vitest`, `@vitest/coverage-v8`, `eslint`, `typescript-eslint`, `@eslint/js`, `eslint-config-prettier`, `globals`
- [ ] `server/tsconfig.json` extends `../tsconfig.base.json`, sets `module: NodeNext`, `moduleResolution: NodeNext`
- [ ] `server/vitest.config.ts` exists with `globals: true`, `@` alias, coverage config
- [ ] `server/eslint.config.ts` exists with type-aware strict rules, node globals, prettier compat
- [ ] Folder structure: `src/index.ts`, `src/routes/hello.ts`, `src/lib/HttpServer.ts`, `src/lib/Logger.ts`
- [ ] `pnpm --filter @aiflow/server run dev` starts server
- [ ] `curl http://localhost:3001/api/hello` returns `{"message":"hello world"}`
- [ ] Server outputs structured JSON log lines to stdout
- [ ] `pnpm --filter @aiflow/server run lint` passes
- [ ] `pnpm --filter @aiflow/server run format:check` passes
- [ ] `pnpm --filter @aiflow/server run test` passes (hello route smoke test)
- [ ] `pnpm --filter @aiflow/server run build` succeeds (`dist/` appears with compiled JS)
- [ ] `cd server && node dist/index.js` starts the server from compiled output
- [ ] No TypeScript errors: `cd server && npx tsc --noEmit`
- [ ] `@/*` path alias resolves correctly (IDE + build + vitest)
