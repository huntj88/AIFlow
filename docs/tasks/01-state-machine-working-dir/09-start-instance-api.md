# Task 09 — Start-Instance API Changes

> **Phase**: 5 (API)
> **Depends on**: Task 02 (schema updates), Task 06 (runner child inheritance)
> **Blocks**: Task 10 (instance payload updates), Task 15 (tests)

---

## Objective

Update the `POST /api/machines/instances` route to require `workspaceRoot` in the
request body, validate it, and pass it through to the runner. This is the entry point
where the user specifies the working directory for the machine instance.

---

## Current State

The current `POST /instances` route:

1. Decodes the request body via `StartInstanceRequestSchema` (`{ definitionId, input }`)
2. Loads the definition from the store
3. Forks `runner.run(definition, input)` as a background fiber
4. Returns the newly created instance

There is no `workspaceRoot` field in the request.

---

## Steps

### 1. Update request body decoding

The `StartInstanceRequestSchema` was updated in Task 02 to include `workspaceRoot`.
The route handler now receives:

```typescript
const { definitionId, input, workspaceRoot } = decodedBody;
```

### 2. Validate `workspaceRoot`

Before calling the runner, validate using a composable Effect function. This is
consistent with how schema decoding and runner invocation use Effect in the
route pipeline.

> **Decision 3:** Use an Effect function, not Express-style early returns.

1. **Presence**: `workspaceRoot` is required (handled by schema).
2. **Absolute path**: Must start with `/` (on Linux/macOS).
3. **Exists on disk**: Use `fs.stat()` to verify the directory exists.

```typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const validateWorkspaceRoot = (workspaceRoot: string) =>
  Effect.gen(function* () {
    if (!path.isAbsolute(workspaceRoot)) {
      return yield* Effect.fail(
        mkValidationError({
          message: 'workspaceRoot must be an absolute path',
        }),
      );
    }
    const stat = yield* Effect.tryPromise({
      try: () => fs.stat(workspaceRoot),
      catch: () =>
        mkValidationError({
          message: `workspaceRoot does not exist: ${workspaceRoot}`,
        }),
    });
    if (!stat.isDirectory()) {
      return yield* Effect.fail(
        mkValidationError({
          message: `workspaceRoot is not a directory: ${workspaceRoot}`,
        }),
      );
    }
  });
```

### 3. Pass `workspaceRoot` to the runner

Update the `runner.run()` call to include `workspaceRoot`:

```typescript
// BEFORE:
yield * Effect.fork(runner.run(definition, input));

// AFTER:
yield * Effect.fork(runner.run(definition, input, { workspaceRoot }));
```

### 4. Update error responses

Map validation errors to HTTP responses:

| Condition                          | Status | Response                                                |
| ---------------------------------- | ------ | ------------------------------------------------------- |
| Missing `workspaceRoot`            | 400    | Schema validation error (from Effect Schema)            |
| Relative `workspaceRoot`           | 400    | `{ message: 'workspaceRoot must be an absolute path' }` |
| `workspaceRoot` does not exist     | 400    | `{ message: 'workspaceRoot does not exist' }`           |
| `workspaceRoot` is not a directory | 400    | `{ message: 'workspaceRoot must be a directory' }`      |
| Definition not found               | 404    | `{ message: 'Definition not found', id: '...' }`        |
| Valid request                      | 201    | `MachineInstance` payload                               |

### 5. Verify instance response includes new fields

After the runner creates the instance (Checkpoint 1 in the runner), the
`GET /instances/:id` or the returned instance should include:

- `workspaceRoot` — the validated absolute path
- `familyRootInstanceId` — same as instance `id` for root instances
- `artifactsPath` — `<ARTIFACT_ROOT>/<familyRootInstanceId>/`

This is handled by the runner (Task 05) and the instance payload (Task 10).

---

## Behavior Spec Coverage

- **§4.1** — `POST /instances` with valid `workspaceRoot` returns 201 with instance
- **§4.1** — Returned instance includes `workspaceRoot`, `familyRootInstanceId`, `artifactsPath`
- **§4.1** — For a root instance, `familyRootInstanceId` equals own `id`
- **§4.4** — Missing `workspaceRoot` → 400 Bad Request
- **§4.4** — Relative `workspaceRoot` → validation error
- **§4.4** — Non-existent `workspaceRoot` → validation error
- **§4.4** — Valid absolute `workspaceRoot` that exists → succeeds

---

## Validation Checklist

- [x] `POST /instances` requires `workspaceRoot` in request body
- [x] Missing `workspaceRoot` returns 400
- [x] Relative path returns 400 with descriptive message
- [x] Non-existent path returns 400 with descriptive message
- [x] Non-directory path returns 400
- [x] Valid `workspaceRoot` is passed to `runner.run()` via `RunOptions`
- [x] Returned instance includes `workspaceRoot`, `familyRootInstanceId`, `artifactsPath`
- [ ] `pnpm --filter @aiflow/server exec tsc --noEmit` passes
      <!-- Blocked: StateMachineRunner.test.ts, suspend-resume.test.ts, types.test.ts, etc. still have pre-existing artifact/opts errors — fixed in Tasks 15-16 -->
