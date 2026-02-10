# Task 34 — Server E2E Test Infrastructure

> **Phase**: 7 (Server E2E Validation)
> **Depends on**: Tasks 22.1 (all API routes wired), 23 (WebSocket)
> **Blocks**: Tasks 35–45

---

## Objective

Set up a dedicated server-only end-to-end test suite that validates all testable
behaviors from the [state-machine-behaviors.md](../../feature-specs/state-machine-behaviors.md)
spec via HTTP requests and WebSocket messages — no browser or Playwright required.

Tests use vitest with the **in-process `HttpApp.toWebHandler()`** pattern (already
proven in the existing route tests) for speed and reliability, plus a real WebSocket
server for §16 tests.

---

## Scope — What Can Be Tested Server-Only

| Behavior Spec Section              | Server-Only? | Task    |
| ---------------------------------- | ------------ | ------- |
| §1 Definition CRUD                 | ✅ Full      | 35      |
| §2 Definition Validation           | ✅ Full      | 35      |
| §3 Action Registry                 | ✅ Full      | 36      |
| §4 Linear Flow                     | ✅ Full      | 37      |
| §5 Branching                       | ✅ Full      | 37      |
| §6 Error Handling                  | ✅ Full      | 38      |
| §7 Timeouts & Safety Limits        | ✅ Full      | 38      |
| §8 Child Machine — Single          | ✅ Full      | 39      |
| §9 Parallel Children               | ✅ Full      | 39      |
| §10 Concurrency & Semaphore        | ✅ Full      | 40      |
| §11 Cancellation                   | ✅ Full      | 40      |
| §12 Resumability & Graceful Shutdn | ⚠️ Partial   | 41      |
| §13 Persistence Checkpoints        | ✅ Most      | 41      |
| §14 Middleware                     | ⚠️ Partial   | 42      |
| §15 Artifacts                      | ✅ Full      | 43      |
| §16 WebSocket — Live Updates       | ✅ Full      | 44      |
| §17–20 Client UI                   | ❌ Browser   | Task 33 |
| §21 Negative / Edge Cases (API)    | ✅ Full      | 45      |

---

## File Layout

```
server/src/__e2e__/
├── helpers/
│   ├── test-handler.ts      # Shared handler factory + layer composition
│   ├── api-helpers.ts        # HTTP helper functions (postDef, startInstance, poll, etc.)
│   ├── ws-helpers.ts         # WebSocket client helpers (connect, subscribe, collect events)
│   └── fixtures.ts           # Reusable definition & input fixtures
├── 01-definitions.e2e.test.ts
├── 02-actions.e2e.test.ts
├── 03-linear-execution.e2e.test.ts
├── 04-errors-timeouts.e2e.test.ts
├── 05-child-machines.e2e.test.ts
├── 06-concurrency-cancel.e2e.test.ts
├── 07-suspend-resume.e2e.test.ts
├── 08-middleware.e2e.test.ts
├── 09-artifacts.e2e.test.ts
├── 10-websocket.e2e.test.ts
└── 11-edge-cases.e2e.test.ts
```

---

## Implementation

### 1. Test Handler Factory (`test-handler.ts`)

Reuse the existing pattern from `instances.test.ts` but extract into a shared module:

```typescript
import { HttpApp, HttpRouter } from '@effect/platform';
import { Effect, Layer, ManagedRuntime } from 'effect';

import { ActionRegistry, ActionRegistryLive } from '@/machines/ActionRegistry.js';
import { FsArtifactStoreLive } from '@/machines/artifacts/FsArtifactStore.js';
import { MachineEventPubSubLive } from '@/machines/EventPubSub.js';
import { ExecutionSemaphoreLive } from '@/machines/ExecutionSemaphore.js';
import { makeMiddlewareExecutorLayer } from '@/machines/middleware/MiddlewareExecutor.js';
import { defaultMiddlewareStack } from '@/machines/middleware/index.js';
import { StateMachineRunnerLive } from '@/machines/StateMachineRunner.js';
import { InMemoryMachineStoreLive } from '@/machines/store/index.js';
import { MachineRouter } from '@/routes/machines/index.js';

/**
 * Build the full E2E test layer with all middleware enabled.
 * Unlike existing route tests (which use empty middleware), this uses the
 * default middleware stack to verify cross-cutting concerns.
 */
export function makeE2ETestLayer() {
  const StoreLive = InMemoryMachineStoreLive;
  const RegistryLive = ActionRegistryLive;
  const MiddlewareLive = makeMiddlewareExecutorLayer(defaultMiddlewareStack);
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

/**
 * Create an in-process HTTP handler wired with the full MachineRouter.
 * Optionally registers custom test-only actions.
 */
export async function makeTestHandler(opts?: {
  registerActions?: (registry: ActionRegistry) => Effect.Effect<void>;
}) {
  const TestLayer = makeE2ETestLayer();
  const managedRuntime = ManagedRuntime.make(TestLayer);
  const runtime = await managedRuntime.runtime();

  if (opts?.registerActions) {
    await managedRuntime.runPromise(
      Effect.gen(function* () {
        const registry = yield* ActionRegistry;
        yield* opts.registerActions!(registry);
      }),
    );
  }

  const served = MachineRouter.pipe(HttpRouter.use((httpApp) => Effect.provide(httpApp, runtime)));

  return {
    handler: HttpApp.toWebHandler(served),
    runtime: managedRuntime,
  };
}
```

### 2. API Helpers (`api-helpers.ts`)

```typescript
type Handler = (req: Request) => Promise<Response>;

export function makeApiHelpers(handler: Handler) {
  const BASE = 'http://localhost/api/machines';

  return {
    // Definition CRUD
    postDefinition: (body: unknown) =>
      handler(
        new Request(`${BASE}/definitions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      ),
    getDefinition: (id: string) => handler(new Request(`${BASE}/definitions/${id}`)),
    getDefinitions: () => handler(new Request(`${BASE}/definitions`)),
    putDefinition: (id: string, body: unknown) =>
      handler(
        new Request(`${BASE}/definitions/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      ),
    deleteDefinition: (id: string) =>
      handler(new Request(`${BASE}/definitions/${id}`, { method: 'DELETE' })),

    // Actions
    getActions: () => handler(new Request(`${BASE}/actions`)),
    getAction: (id: string) => handler(new Request(`${BASE}/actions/${id}`)),

    // Instances
    postInstance: (body: unknown) =>
      handler(
        new Request(`${BASE}/instances`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      ),
    getInstance: (id: string) => handler(new Request(`${BASE}/instances/${id}`)),
    getInstances: (query?: string) => handler(new Request(`${BASE}/instances${query ?? ''}`)),
    getHistory: (id: string) => handler(new Request(`${BASE}/instances/${id}/history`)),
    getLogs: (id: string, query?: string) =>
      handler(new Request(`${BASE}/instances/${id}/logs${query ?? ''}`)),
    postCancel: (id: string) =>
      handler(new Request(`${BASE}/instances/${id}/cancel`, { method: 'POST' })),
    postResume: (id: string) =>
      handler(new Request(`${BASE}/instances/${id}/resume`, { method: 'POST' })),
    getArtifacts: (id: string, query?: string) =>
      handler(new Request(`${BASE}/instances/${id}/artifacts${query ?? ''}`)),
    getArtifact: (id: string, name: string) =>
      handler(new Request(`${BASE}/instances/${id}/artifacts/${name}`)),

    // Composite helpers
    async createDef(body: unknown): Promise<{ id: string; version: number; [k: string]: unknown }> {
      const res = await this.postDefinition(body);
      if (res.status !== 201) throw new Error(`createDef failed: ${res.status}`);
      return res.json();
    },

    async startInst(
      defId: string,
      input: unknown = {},
    ): Promise<{ id: string; status: string; [k: string]: unknown }> {
      const res = await this.postInstance({ definitionId: defId, input });
      if (res.status !== 201) throw new Error(`startInst failed: ${res.status}`);
      return res.json();
    },

    async pollStatus(instId: string, targets: string[], timeoutMs = 15_000, intervalMs = 100) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const res = await this.getInstance(instId);
        const inst = (await res.json()) as { status: string; [k: string]: unknown };
        if (targets.includes(inst.status)) return inst;
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      throw new Error(`Instance ${instId} did not reach [${targets}] within ${timeoutMs}ms`);
    },
  };
}
```

### 3. Fixtures (`fixtures.ts`)

Extend from existing `client/e2e/fixtures/definitions.ts` plus additional fixtures
needed for validation tests, branching, error scenarios, etc. (See individual task
documents for specific fixture definitions.)

### 4. Vitest Configuration

Add an e2e-specific vitest config (or a workspace entry):

```typescript
// server/vitest.e2e.config.ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['src/__e2e__/**/*.e2e.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 15_000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
```

Add a script to `server/package.json`:

```json
{
  "scripts": {
    "test:e2e": "vitest run --config vitest.e2e.config.ts"
  }
}
```

---

## Behavior Spec Coverage

This task provides shared infrastructure for all server E2E validation tasks (35–45), covering:

- §1 Definition CRUD, §2 Definition Validation
- §3 Action Registry
- §4 Linear Flow, §5 Branching
- §6 Error Handling, §7 Timeouts & Safety Limits
- §8 Child Machine, §9 Parallel Children
- §10 Concurrency & Semaphore, §11 Cancellation
- §12 Resumability & Graceful Shutdown, §13 Persistence Checkpoints
- §14 Middleware, §15 Artifacts
- §16 WebSocket — Live Updates
- §21 Negative / Edge Cases

---

## Validation Checklist

- [ ] `server/src/__e2e__/helpers/test-handler.ts` creates handler with full middleware stack
- [ ] `server/src/__e2e__/helpers/api-helpers.ts` provides typed HTTP helpers for all endpoints
- [ ] `server/src/__e2e__/helpers/fixtures.ts` provides all definition/input fixtures
- [ ] `server/vitest.e2e.config.ts` runs only `__e2e__` files with extended timeouts
- [ ] `pnpm --filter @aiflow/server run test:e2e` executes successfully
- [ ] Tests are isolated — each describe block gets a fresh handler (no shared mutable state)
