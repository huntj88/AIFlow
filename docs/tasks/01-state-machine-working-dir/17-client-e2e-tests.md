# Task 17 — Client E2E Test Updates

> **Phase**: 8 (Tests)
> **Depends on**: Task 14 (client instance page), Task 16 (server E2E tests)
> **Blocks**: nothing (final task)

---

## Objective

Update Playwright E2E tests to account for the new working directory model.
All tests that launch machine instances must provide `workspaceRoot`, artifact-related
assertions must be removed, and new assertions for workspace fields must be added.

> **Prerequisite**: The server must be running. If not already started, prompt
> the user to start it.

---

## Existing E2E Test Files

```
client/e2e/
  home.spec.ts
  fixtures/
    definitions.ts
  helpers/
    machine-helpers.ts
  machines/
    artifacts.spec.ts
    cancel-flow.spec.ts
    create-run-complete.spec.ts
    definition-editor.spec.ts
    edge-cases.spec.ts
    parallel-children.spec.ts
    parent-child.spec.ts
    suspend-resume.spec.ts
```

---

## Steps

### 1. Update test fixtures — `definitions.ts`

If test definitions reference artifact-related fields, update them. No changes
needed to definition structure (definitions don't change in this migration).

### 2. Update test helpers — `machine-helpers.ts`

Update the helper function that launches instances to include `workspaceRoot`:

```typescript
// In machine-helpers.ts:

export async function launchInstance(
  page: Page,
  definitionName: string,
  input: unknown,
  workspaceRoot: string = '/tmp/aiflow-e2e-test',
) {
  // Fill in the workspace root field
  await page.fill('[data-testid="workspace-root-input"]', workspaceRoot);
  // ... rest of launch logic
}
```

Or if instances are launched via API in the helpers:

```typescript
export async function createInstanceViaApi(
  definitionId: string,
  input: unknown,
  workspaceRoot: string = '/tmp/aiflow-e2e-test',
) {
  const response = await fetch(`${BASE_URL}/api/machines/instances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ definitionId, input, workspaceRoot }),
  });
  return response.json();
}
```

### 3. Create test workspace directory — global setup/teardown

> **Decision 10:** Use Playwright global setup/teardown to manage the test
> workspace directory lifecycle.

Add a global setup file that creates the directory and a global teardown that
cleans it up:

```typescript
// client/e2e/global-setup.ts
import * as fs from 'node:fs';

const TEST_WORKSPACE = '/tmp/aiflow-e2e-test';

export default function globalSetup() {
  fs.mkdirSync(TEST_WORKSPACE, { recursive: true });
}
```

```typescript
// client/e2e/global-teardown.ts
import * as fs from 'node:fs';

const TEST_WORKSPACE = '/tmp/aiflow-e2e-test';

export default function globalTeardown() {
  fs.rmSync(TEST_WORKSPACE, { recursive: true, force: true });
}
```

Register in `playwright.config.ts`:

```typescript
export default defineConfig({
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  // ...
});
```

### 4. Update `create-run-complete.spec.ts`

- Add `workspaceRoot` to instance launch
- Add assertions for workspace fields in the instance viewer:

```typescript
// Verify workspace info is displayed
await expect(page.locator('[data-testid="workspace-root"]')).toContainText('/tmp/');
await expect(page.locator('[data-testid="artifacts-path"]')).toContainText('artifacts');
```

### 5. Update `parent-child.spec.ts`

- Add `workspaceRoot` to parent instance launch
- Verify child instance inherits workspace fields:

```typescript
// Navigate to child instance
// Verify child has same workspaceRoot as parent
// Verify child has same familyRootInstanceId as parent
```

### 6. Update `parallel-children.spec.ts`

- Add `workspaceRoot` to parent instance launch
- Verify all parallel children inherit workspace fields

### 7. Replace `artifacts.spec.ts`

Delete `client/e2e/machines/artifacts.spec.ts` and create a new test file that
verifies the artifacts path display (not a file browser — see Decision 5):

```typescript
// NEW: client/e2e/machines/artifacts-path.spec.ts

describe('Artifacts Path Display', () => {
  it('displays artifactsPath in the instance viewer', async () => {
    // Launch instance, navigate to instance page
    // Verify the artifacts path is displayed as text
    await expect(page.locator('[data-testid="artifacts-path"]')).toBeVisible();
    await expect(page.locator('[data-testid="artifacts-path"]')).toContainText('/tmp/');
  });

  it('shows workspace root in the instance viewer', async () => {
    // Verify workspaceRoot is displayed
    await expect(page.locator('[data-testid="workspace-root"]')).toBeVisible();
  });
});
```

### 8. Update `cancel-flow.spec.ts`

- Add `workspaceRoot` to instance launches

### 9. Update `suspend-resume.spec.ts`

- Add `workspaceRoot` to instance launches
- Verify workspace fields persist across suspend/resume

### 10. Update `edge-cases.spec.ts`

- Add `workspaceRoot` to instance launches
- Add workspace-specific edge case tests:

```typescript
it('displays validation error for missing workspace root', async () => {
  // Try to launch without filling workspace root
  // Verify error message
});
```

### 11. Remove artifact-related assertions

Search all E2E test files for:

- `artifact` references (except the new browser tests)
- `ArtifactViewer` data-testid references
- `artifact_created` event assertions
- `artifactTree` references

Remove or replace them.

---

## Behavior Spec Coverage

- **§4.1** — E2E: Launch instance with workspace root
- **§4.4** — E2E: Workspace root validation in UI
- **§8.5** — E2E: Child inherits workspace fields
- **§9.6** — E2E: Parallel children inherit workspace fields
- **§18** — E2E: Dashboard launch form includes workspace root
- **§19.5** — E2E: Artifacts path displayed in instance viewer

---

## Validation Checklist

- [x] All E2E tests provide `workspaceRoot` when launching instances
- [x] Test workspace directory created via global setup/teardown
- [x] `artifacts.spec.ts` replaced with `artifacts-path.spec.ts`
- [x] No artifact-related assertions remain (old model)
- [x] Workspace fields verified in instance viewer
- [x] Child inheritance verified in parent-child and parallel tests
- [x] Suspend/resume tests verify workspace field persistence
- [x] `pnpm --filter @aiflow/client run test:e2e` passes
