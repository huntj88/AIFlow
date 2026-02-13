# Task 16 — Server E2E Test Updates

> **Phase**: 8 (Tests)
> **Depends on**: Task 10 (instance payload updates), Task 15 (server unit tests)
> **Blocks**: Task 17 (client E2E tests)

---

## Objective

Update and add server E2E tests (HTTP-level) to validate the new working directory
model, workspace root validation, CLI helper, family root inheritance, and the
removal of artifact endpoints. These tests run against the live server.

> **Prerequisite**: The server must be running. If not already started, prompt
> the user to start it.

---

## Existing E2E Test Files to Update

All E2E tests that create instances must be updated to include `workspaceRoot`:

```
server/src/__e2e__/
  00-smoke.e2e.test.ts            — No instance creation (unchanged)
  01-definitions.e2e.test.ts      — No instance creation (unchanged)
  02-actions.e2e.test.ts           — No instance creation (unchanged)
  03-linear-execution.e2e.test.ts  — Creates instances → add workspaceRoot
  04-errors-timeouts.e2e.test.ts   — Creates instances → add workspaceRoot
  05-child-machines.e2e.test.ts    — Creates instances → add workspaceRoot
  06-concurrency-cancel.e2e.test.ts — Creates instances → add workspaceRoot
  07-suspend-resume.e2e.test.ts    — Creates instances → add workspaceRoot
  08-middleware.e2e.test.ts        — Creates instances → add workspaceRoot
  09-artifacts.e2e.test.ts         — DELETE or replace entirely
  10-websocket.e2e.test.ts         — Creates instances → add workspaceRoot
  11-edge-cases.e2e.test.ts        — Creates instances → add workspaceRoot
```

---

## Steps

### 1. Create a shared test workspace directory

Add a setup helper that creates a temporary workspace directory for E2E tests:

```typescript
// In the E2E test setup/fixtures:
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

let testWorkspaceRoot: string;

beforeAll(async () => {
  testWorkspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aiflow-e2e-'));
});

afterAll(async () => {
  await fs.rm(testWorkspaceRoot, { recursive: true, force: true });
});
```

### 2. Update all instance creation calls

In every E2E test that creates an instance via `POST /api/machines/instances`:

```typescript
// BEFORE:
const response = await fetch(`${BASE_URL}/api/machines/instances`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ definitionId: def.id, input: {} }),
});

// AFTER:
const response = await fetch(`${BASE_URL}/api/machines/instances`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    definitionId: def.id,
    input: {},
    workspaceRoot: testWorkspaceRoot,
  }),
});
```

### 3. Add workspace root validation E2E tests

New test file or section: `server/src/__e2e__/workspace.e2e.test.ts`

```typescript
describe('Workspace Root Validation (§4.4)', () => {
  it('returns 400 when workspaceRoot is missing', async () => {
    const res = await fetch(`${BASE_URL}/api/machines/instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definitionId: defId, input: {} }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for relative workspaceRoot', async () => {
    const res = await createInstance({ workspaceRoot: './relative/path' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-existent workspaceRoot', async () => {
    const res = await createInstance({ workspaceRoot: '/nonexistent/path/abc' });
    expect(res.status).toBe(400);
  });

  it('succeeds with valid absolute workspaceRoot', async () => {
    const res = await createInstance({ workspaceRoot: testWorkspaceRoot });
    expect(res.status).toBe(201);
  });
});
```

### 4. Add instance payload E2E tests

```typescript
describe('Instance Payload (§15.5)', () => {
  it('includes workspaceRoot in instance response', async () => {
    const instance = await createAndGetInstance();
    expect(instance.workspaceRoot).toBe(testWorkspaceRoot);
  });

  it('includes familyRootInstanceId equal to own id for root instance', async () => {
    const instance = await createAndGetInstance();
    expect(instance.familyRootInstanceId).toBe(instance.id);
  });

  it('includes artifactsPath pointing to family root', async () => {
    const instance = await createAndGetInstance();
    expect(instance.artifactsPath).toContain(instance.familyRootInstanceId);
  });

  it('does NOT include artifacts array', async () => {
    const instance = await createAndGetInstance();
    expect(instance).not.toHaveProperty('artifacts');
  });
});
```

### 5. Add child inheritance E2E tests

```typescript
describe('Child Workspace Inheritance (§8.5)', () => {
  it('child inherits parent workspaceRoot', async () => {
    // Create parent-child definition, start parent
    // Wait for child, verify child.workspaceRoot === parent.workspaceRoot
  });

  it('child inherits familyRootInstanceId from root', async () => {
    // Verify child.familyRootInstanceId === parent.id (root)
  });

  it('child artifactsPath matches parent', async () => {
    // Verify child.artifactsPath === parent.artifactsPath
  });

  it('parallel children inherit workspace and family root (§9.6)', async () => {
    // Create parallel children definition
    // Verify all children have same workspaceRoot and familyRootInstanceId
  });
});
```

### 6. Delete artifact E2E tests entirely

> **Decision 9:** Delete `server/src/__e2e__/09-artifacts.e2e.test.ts` entirely.
> Do NOT port or adapt the old tests. Write fresh `workspace.e2e.test.ts` tests
> from scratch (steps 3–5 above already cover the new workspace behavior).

Delete the file and add tests to verify the old endpoints are gone:

```typescript
describe('Removed Artifact Endpoints (§15.6)', () => {
  it('GET /instances/:id/artifacts returns 404', async () => {
    const res = await fetch(`${BASE_URL}/api/machines/instances/${instanceId}/artifacts`);
    expect(res.status).toBe(404);
  });

  it('GET /instances/:id/artifacts/:name returns 404', async () => {
    const res = await fetch(`${BASE_URL}/api/machines/instances/${instanceId}/artifacts/test.txt`);
    expect(res.status).toBe(404);
  });

  it('GET /instances/:id/artifacts?tree=true returns 404', async () => {
    const res = await fetch(`${BASE_URL}/api/machines/instances/${instanceId}/artifacts?tree=true`);
    expect(res.status).toBe(404);
  });
});
```

### 7. Add CLI helper E2E tests

```typescript
describe('CLI Helper via Action (§16)', () => {
  // Register a test action that uses ctx.cli.exec() and returns the result as stateData

  it('action can exec a command and return stdout', async () => {
    // Run machine with CLI action, verify output includes stdout
  });

  it('action can branch on exit code', async () => {
    // Two definitions: one with success command, one with failing command
    // Verify different terminal states reached
  });

  it('CLI default cwd is workspace root', async () => {
    // Action runs `pwd`, verify stdout matches workspaceRoot
  });

  it('WORKSPACE_ROOT env var is set', async () => {
    // Action runs `echo $WORKSPACE_ROOT`, verify matches
  });

  it('ARTIFACTS_ROOT env var is set', async () => {
    // Action runs `echo $ARTIFACTS_ROOT`, verify matches
  });
});
```

### 8. Update WebSocket E2E tests

Remove any `artifact_created` event assertions from WebSocket tests:

```typescript
// DELETE assertions like:
expect(events).toContainEqual(expect.objectContaining({ type: 'artifact_created' }));
```

Verify `artifact_created` is never received.

---

## Behavior Spec Coverage

- **§4.1** — Instance creation with workspace fields (E2E)
- **§4.4** — Workspace root validation (E2E)
- **§8.5** — Child workspace inheritance (E2E)
- **§9.6** — Parallel children workspace inheritance (E2E)
- **§15.5** — Instance payload includes workspace fields (E2E)
- **§15.6** — Artifact endpoints return 404 (E2E)
- **§16.1–16.6** — CLI helper via actions (E2E)

---

## Validation Checklist

- [x] All existing E2E tests updated with `workspaceRoot`
- [x] Workspace root validation E2E tests pass
- [x] Instance payload E2E tests verify new fields
- [x] Child inheritance E2E tests pass
- [x] Artifact endpoint removal E2E tests pass (404s)
- [x] CLI helper E2E tests pass
- [x] WebSocket E2E tests updated (no artifact_created)
- [x] `pnpm --filter @aiflow/server run test:e2e` passes
