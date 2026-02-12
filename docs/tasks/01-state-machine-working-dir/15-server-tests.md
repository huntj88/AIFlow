# Task 15 — Server Unit & Integration Tests

> **Phase**: 8 (Tests)
> **Depends on**: Task 06 (runner child inheritance), Task 09 (start-instance API)
> **Blocks**: Task 16 (server E2E tests)

---

## Objective

Add and update unit and integration tests for all new server-side functionality:
CLI helper, workspace helpers, runner ActionContext changes, workspace root
validation, family root inheritance, and the removal of artifact infrastructure.

---

## Test Categories

### 1. CLI Helper Tests (`server/src/machines/cli/CliHelper.test.ts`)

> These tests are written as part of Task 03. This section confirms coverage
> and documents any additional integration-level tests.

Confirm these tests exist and pass:

- Basic execution (`echo hello` → exitCode 0, stdout matches)
- Non-zero exit code (no error channel failure)
- Spawn failure → exitCode -1, stderr has message
- Custom cwd
- Default cwd = workspace root
- `WORKSPACE_ROOT` env var set
- `ARTIFACTS_ROOT` env var set
- Custom env merge
- Output truncation (stdout > 1 MiB)
- Fiber interruption kills child process

### 2. Workspace Helper Tests (`server/src/machines/workspace/WorkspaceHelper.test.ts`)

> These tests are written as part of Task 04. Confirm coverage.

- `makeWorkspaceContext` root and resolve
- `makeArtifactsWorkspaceContext` root and resolve
- `computeArtifactsPath` returns correct path
- `ensureArtifactsDir` creates directory
- No path traversal enforcement

### 3. Runner Integration Tests — ActionContext

Add tests to existing runner test files or create new ones:

```typescript
// server/src/machines/StateMachineRunner.test.ts or similar

describe('ActionContext — workspace and CLI', () => {
  it('provides ctx.workspace.root matching workspaceRoot', async () => {
    // Register a test action that captures ctx.workspace.root
    // Start an instance with a known workspaceRoot
    // Verify the captured value matches
  });

  it('provides ctx.workspace.resolve() that resolves paths', async () => {
    // Register a test action that calls ctx.workspace.resolve('sub/file.txt')
    // Verify the result is <workspaceRoot>/sub/file.txt
  });

  it('provides ctx.artifactsWorkspace.root matching family root', async () => {
    // Register a test action that captures ctx.artifactsWorkspace.root
    // Start a root instance
    // Verify root = <ARTIFACT_ROOT>/<instanceId>/
  });

  it('provides ctx.artifactsWorkspace.resolve() that resolves paths', async () => {
    // Register a test action that calls ctx.artifactsWorkspace.resolve('report.json')
    // Verify path is within artifacts root
  });

  it('provides ctx.cli with working exec()', async () => {
    // Register a test action that calls ctx.cli.exec({ command: 'echo', args: ['test'] })
    // Verify the action completes without error
  });

  it('does NOT provide ctx.artifacts (removed)', async () => {
    // Register a test action that checks 'artifacts' in ctx
    // Verify it's not present
  });
});
```

### 4. Runner Integration Tests — Family Root Inheritance

```typescript
describe('Family root inheritance', () => {
  it('root instance has familyRootInstanceId equal to own id', async () => {
    // Start a root instance
    // Verify instance.familyRootInstanceId === instance.id
  });

  it('child instance inherits parent familyRootInstanceId', async () => {
    // Create a parent-child definition
    // Start the parent with workspaceRoot
    // Wait for child to be created
    // Verify child.familyRootInstanceId === parent.familyRootInstanceId
  });

  it('grandchild inherits root familyRootInstanceId', async () => {
    // Create parent → child → grandchild chain
    // Verify grandchild.familyRootInstanceId === root.id
  });

  it('child inherits parent workspaceRoot', async () => {
    // Verify child.workspaceRoot === parent.workspaceRoot
  });

  it('child artifactsPath matches parent artifactsPath', async () => {
    // Verify child.artifactsPath === parent.artifactsPath
  });

  it('parallel children all inherit family root', async () => {
    // Spawn parallel children
    // Verify all have same familyRootInstanceId and artifactsPath
  });
});
```

### 5. Runner Integration Tests — Workspace Root Validation

```typescript
describe('workspaceRoot validation', () => {
  it('rejects missing workspaceRoot', async () => {
    // Attempt to start instance without workspaceRoot
    // Verify error
  });

  it('rejects relative workspaceRoot', async () => {
    // Attempt with './relative/path'
    // Verify validation error
  });

  it('rejects non-existent workspaceRoot', async () => {
    // Attempt with '/nonexistent/path/abc123'
    // Verify validation error
  });

  it('accepts valid absolute workspaceRoot', async () => {
    // Create a temp directory
    // Attempt with the temp directory path
    // Verify success
  });
});
```

### 6. Runner Integration Tests — CLI Branching

```typescript
describe('CLI exit code branching', () => {
  it('action can branch on exitCode === 0 (success path)', async () => {
    // Register an action that runs a CLI command and routes based on exitCode
    // Verify the machine follows the success path
  });

  it('action can branch on exitCode !== 0 (error path)', async () => {
    // Same but with a failing command
    // Verify the machine follows the error path
  });

  it('action can parse stdout to determine next state', async () => {
    // Register an action that parses JSON from stdout
    // Verify routing based on parsed data
  });

  it('non-zero exit does not automatically fail the machine', async () => {
    // Verify the action decides, not the runner
  });
});
```

### 7. Artifact Infrastructure Removal Tests

```typescript
describe('artifact infrastructure removal', () => {
  it('MachineInstance does not have artifacts field', () => {
    // Type-level check (compile time) + runtime check
  });

  it('MachineEvent does not include artifact_created', () => {
    // Type-level check
  });

  it('no artifact_created events are published', async () => {
    // Run a machine, subscribe to events
    // Verify no artifact_created events
  });
});
```

### 8. Update existing tests

Update all existing test files that reference:

- `artifacts: []` in instance creation → remove
- `ArtifactStoreFactory` in test Layer composition → remove
- `FsArtifactStoreLive` in test layers → remove
- `instance.artifacts` assertions → remove
- `artifact_created` event assertions → remove

Add `workspaceRoot` to all test instance creation calls:

```typescript
// Before:
runner.run(definition, input);

// After:
runner.run(definition, input, { workspaceRoot: '/tmp/test-workspace' });
```

---

## Behavior Spec Coverage

- **§4.1** — Instance creation with workspace fields
- **§4.4** — Workspace root validation
- **§8.5** — Child workspace inheritance
- **§9.6** — Parallel children workspace inheritance
- **§15.1–15.4** — Workspace and artifacts workspace context
- **§15.6** — No artifact types in codebase
- **§16.1–16.6** — CLI helper functionality
- **§16.6** — CLI exit code branching

---

## Validation Checklist

- [x] CLI helper tests pass
- [x] Workspace helper tests pass
- [x] Runner ActionContext tests cover `cli`, `workspace`, `artifactsWorkspace`
- [x] Family root inheritance tests pass for single child, grandchild, parallel
- [x] Workspace root validation tests cover all error cases
- [x] CLI branching tests verify exit code routing
- [x] All existing tests updated to include `workspaceRoot`
- [x] No test references to artifact infrastructure remain
- [x] `pnpm --filter @aiflow/server run test` passes with full suite
