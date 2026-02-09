# Task 33 — End-to-End Playwright Tests

> **Phase**: 6 (Polish & Integration)
> **Depends on**: Task 32 (integration wiring), all prior tasks
> **Blocks**: None (final task)

---

## Objective

Write comprehensive end-to-end tests using Playwright that exercise all major user workflows from the behavior spec §20 (End-to-End Workflows) and §21 (Negative / Edge-Case Behaviors). Tests run against a real server + client, ensuring the full stack works together.

---

## Setup

### Test infrastructure

Extend `client/playwright.config.ts`:

- Ensure `webServer` config starts both server and client
- Add a project/suite specifically for machine tests
- Set a reasonable timeout (e.g., 60s per test, machines may take time)

```typescript
// client/playwright.config.ts additions
webServer: [
  {
    command: 'pnpm --filter @aiflow/server run dev',
    port: 3001,
    reuseExistingServer: !process.env.CI,
  },
  {
    command: 'pnpm --filter @aiflow/client run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
  },
],
```

### Test helpers

Create `client/e2e/helpers/machine-helpers.ts`:

```typescript
// Helper functions for machine E2E tests
export async function createDefinition(page: Page, definition: object): Promise<string>;
export async function startInstance(
  page: Page,
  definitionId: string,
  input?: object,
): Promise<string>;
export async function waitForInstanceStatus(
  page: Page,
  status: string,
  timeout?: number,
): Promise<void>;
export async function navigateToMachines(page: Page): Promise<void>;
export async function navigateToInstance(page: Page, instanceId: string): Promise<void>;
```

### Seed definitions

Create `client/e2e/fixtures/definitions.ts` with reusable test definitions:

```typescript
export const LINEAR_DEFINITION = {
  /* 3-state linear: init → process → done */
};
export const BRANCHING_DEFINITION = {
  /* action returns branch key → different targets */
};
export const ERROR_DEFINITION = {
  /* state that always errors → error terminal */
};
export const TIMEOUT_DEFINITION = {
  /* state with short timeout to trigger timeout error */
};
export const PARENT_CHILD_DEFINITION = {
  /* parent with child_machine state */
};
export const CHILD_DEFINITION = {
  /* simple child definition referenced by parent */
};
export const PARALLEL_DEFINITION = {
  /* parallel_children state with 2 children */
};
```

---

## Implementation Notes from Completed Tasks

> These details emerged from Tasks 01–22.1 and from the existing project scaffold.

1. **HashRouter URLs** — Client uses `HashRouter`, so Playwright URLs are `http://localhost:5173/#/machines`, `http://localhost:5173/#/machines/instances/:id`, etc. Use `page.goto('http://localhost:5173/#/machines')` or navigate via UI clicks.
2. **Server port 3001** — API is at `http://localhost:3001/api/...`. Helper functions that call the API directly (bypassing UI) should use this base URL.
3. **Error responses do NOT include `_tag`** — Server API error responses use `{ message, details[], id? }` format (not `_tag`). Specifically: 404 returns `{ message: "<Entity> not found", id }`, 400 returns `{ message, details[] }` or `{ message, path? }`, 409 returns `{ message, details[] }`. Test assertions on error responses should check `message` and `details` fields.
4. **`MachineStore` auto-generates IDs** — `saveDefinition` and `saveInstance` use `crypto.randomUUID()` for IDs and auto-set timestamps. Don't include `id` in seed fixture objects for creation; read it from the response.
5. **Schema validation** — Server uses `Schema.decodeUnknownEither` for request validation. Invalid payloads get 400 responses with `{ message, details[] }`.
6. **`MachineEvent` uses `type` field** — WebSocket events have `type: 'state_changed' | 'transition_recorded' | 'log_entry' | 'machine_completed' | ...` (10 total, not `_tag`). Tests that assert on WS messages should check the `type` field. All events have shape `{ type, instanceId, data }`.
7. **Existing Playwright config** — `client/playwright.config.ts` already exists. Extend it rather than replacing.
8. **Instance start is fire-and-forget** — `POST /api/machines/instances` returns 201 immediately with the full `MachineInstance` object. The machine runs asynchronously. Tests that need to verify completion must poll `GET /instances/:id` or wait for UI status badge updates.
9. **In-memory store** — The server uses `InMemoryMachineStore` — all data is lost on restart. E2E tests that restart the server will lose all definitions and instances. Seed data must be created at the start of each test or suite.
10. **Vite dev server** — Client runs on port 5173 with hot reload. API calls are proxied to port 3001.

---

## Test Suites

### Suite 1 — §20.1: Create → Run → View → Complete

File: `client/e2e/machines/create-run-complete.spec.ts`

```typescript
test('complete linear workflow', async ({ page }) => {
  // 1. Navigate to machines dashboard
  // 2. Click "Create New"
  // 3. Build a simple 3-state definition in the editor
  // 4. Save the definition
  // 5. Navigate back to dashboard
  // 6. Find the definition, click "Start"
  // 7. Verify redirect to instance viewer
  // 8. Wait for status to become "completed"
  // 9. Verify state diagram shows all states as visited
  // 10. Verify transition history shows all transitions
  // 11. Verify final result is present
});

test('view running instance updates in real time', async ({ page }) => {
  // 1. Create a definition with a delay action (e.g., 2s delay in middle state)
  // 2. Start instance
  // 3. Verify status shows "running"
  // 4. Verify current state highlights in diagram
  // 5. Wait for completion
  // 6. Verify all states visited
});
```

### Suite 2 — §20.2: Create → Run → Cancel

File: `client/e2e/machines/cancel-flow.spec.ts`

```typescript
test('cancel a running instance', async ({ page }) => {
  // 1. Create definition with a long-running delay action
  // 2. Start instance
  // 3. While running, click "Cancel" button
  // 4. Confirm cancellation dialog
  // 5. Verify status becomes "cancelled"
  // 6. Verify transition history ends at the cancelled state
});

test('cannot cancel an already completed instance', async ({ page }) => {
  // 1. Create and run a fast definition to completion
  // 2. Try to cancel → verify appropriate error/disabled button
});
```

### Suite 3 — §20.3: Parent-Child Composition

File: `client/e2e/machines/parent-child.spec.ts`

```typescript
test('parent spawns child and completes', async ({ page }) => {
  // 1. Create child definition via API
  // 2. Create parent definition referencing child
  // 3. Start parent instance
  // 4. Verify parent enters waiting_for_child status
  // 5. Verify child instance appears in ChildMachineTree
  // 6. Wait for child to complete
  // 7. Verify parent resumes and completes
  // 8. Click child in tree → navigate to child instance viewer
  // 9. Verify child instance data is correct
  // 10. Navigate back to parent via breadcrumb
});
```

### Suite 4 — §20.4: Parallel Children

File: `client/e2e/machines/parallel-children.spec.ts`

```typescript
test('parallel children all complete', async ({ page }) => {
  // 1. Create child definitions
  // 2. Create parent with parallel_children state
  // 3. Start parent
  // 4. Verify multiple children appear in tree
  // 5. Wait for all to complete
  // 6. Verify parent collects results and completes
});

test('parallel children with interrupt mode', async ({ page }) => {
  // 1. Create definition where one child errors
  // 2. parallelMode: 'all_or_interrupt'
  // 3. Start parent
  // 4. Verify when one child errors, others are cancelled
  // 5. Verify parent enters error terminal
});
```

### Suite 5 — §20.5: Suspend → Resume

File: `client/e2e/machines/suspend-resume.spec.ts`

```typescript
test('suspend and resume an instance', async ({ page }) => {
  // 1. Create definition with a delay state
  // 2. Start instance
  // 3. Trigger suspension (via API call since UI may not have suspend-all button)
  // 4. Verify status shows "suspended"
  // 5. Click "Resume" button on instance viewer
  // 6. Verify status returns to "running"
  // 7. Wait for completion
});
```

### Suite 6 — §20.6: Artifacts Workflow

File: `client/e2e/machines/artifacts.spec.ts`

```typescript
test('view artifacts produced by machine', async ({ page }) => {
  // 1. Create definition with an action that writes artifacts
  // 2. Start and wait for completion
  // 3. Navigate to instance viewer
  // 4. Open artifacts panel
  // 5. Verify artifact file(s) listed
  // 6. Click to download/preview an artifact
  // 7. Verify artifact content
});
```

### Suite 7 — §20.7: Definition Editing Round-Trip

File: `client/e2e/machines/definition-editor.spec.ts`

```typescript
test('create definition via editor', async ({ page }) => {
  // 1. Navigate to new definition page
  // 2. Set name and description
  // 3. Add states by clicking on canvas
  // 4. Connect states with transitions
  // 5. Configure action for each state
  // 6. Set initial state
  // 7. Mark terminal states
  // 8. Save
  // 9. Verify definition appears on dashboard
});

test('edit existing definition', async ({ page }) => {
  // 1. Create definition via API
  // 2. Navigate to edit page
  // 3. Verify editor loads with existing states
  // 4. Add a new state
  // 5. Save
  // 6. Reload page → verify changes persisted
});

test('import and export definition JSON', async ({ page }) => {
  // 1. Create definition in editor
  // 2. Click Export → verify JSON downloaded
  // 3. Navigate to new definition
  // 4. Click Import → upload the JSON
  // 5. Verify states and transitions populated
  // 6. Save → verify it works
});

test('undo and redo', async ({ page }) => {
  // 1. Add a state
  // 2. Add another state
  // 3. Undo → verify second state removed
  // 4. Undo → verify first state removed
  // 5. Redo → verify first state restored
});

test('unsaved changes warning', async ({ page }) => {
  // 1. Create definition, make a change
  // 2. Try to navigate away
  // 3. Verify confirmation dialog appears
  // 4. Cancel → stay on page
  // 5. Confirm → navigate away
});
```

### Suite 8 — §21: Negative & Edge Cases

File: `client/e2e/machines/edge-cases.spec.ts`

```typescript
test('start instance with invalid input shows error', async ({ page }) => {
  // 1. Create definition with inputSchema requiring specific fields
  // 2. Try to start with missing/invalid input
  // 3. Verify error shown (400 response surfaced in UI)
});

test('start instance for non-existent definition shows error', async ({ page }) => {
  // 1. Navigate directly to start with a fake definition ID
  // 2. Verify 404 error displayed
});

test('view non-existent instance shows not found', async ({ page }) => {
  // 1. Navigate to /machines/instances/nonexistent-id
  // 2. Verify "not found" error page
});

test('definition validation errors shown in editor', async ({ page }) => {
  // 1. Create definition with no terminal state
  // 2. Click Validate
  // 3. Verify validation errors listed
  // 4. Try to Save → verify server rejects
});

test('WebSocket reconnection', async ({ page }) => {
  // 1. Start an instance, verify live updates working
  // 2. Simulate WS disconnection (if possible)
  // 3. Verify reconnection indicator shown
  // 4. Verify updates resume after reconnection
});

test('concurrent instances on dashboard', async ({ page }) => {
  // 1. Create multiple instances simultaneously
  // 2. Verify dashboard shows all instances
  // 3. Verify status updates arrive for each
});
```

---

## Behavior Spec Coverage

| Suite   | Behavior Spec Sections                      |
| ------- | ------------------------------------------- |
| Suite 1 | §20.1 — Create → Run → View → Complete      |
| Suite 2 | §20.2 — Create → Run → Cancel, §11          |
| Suite 3 | §20.3 — Parent-child composition, §8, §18.4 |
| Suite 4 | §20.4 — Parallel children, §9               |
| Suite 5 | §20.5 — Suspend → Resume, §12               |
| Suite 6 | §20.6 — Artifacts workflow, §15             |
| Suite 7 | §20.7 — Definition editing, §19             |
| Suite 8 | §21.1–§21.6 — Negative & edge cases         |

---

## Validation Checklist

- [ ] Playwright test infrastructure set up (webServer config, helpers, fixtures)
- [ ] Suite 1: Create → Run → Complete passes
- [ ] Suite 2: Cancel flow passes
- [ ] Suite 3: Parent-child navigation passes
- [ ] Suite 4: Parallel children passes
- [ ] Suite 5: Suspend → Resume passes
- [ ] Suite 6: Artifacts passes
- [ ] Suite 7: Definition editor round-trip passes
- [ ] Suite 8: Edge cases pass
- [ ] All tests pass in CI: `pnpm --filter @aiflow/client run test:e2e`
- [ ] Tests are not flaky (run 3x in CI without failure)
- [ ] Test execution time is reasonable (< 5 minutes total)
