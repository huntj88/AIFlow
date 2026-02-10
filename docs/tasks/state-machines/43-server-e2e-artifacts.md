# Task 43 — Server E2E: Artifacts

> **Phase**: 7 (Server E2E Validation)
> **Depends on**: Task 34 (infrastructure), Task 37 (linear execution)
> **Blocks**: None
> **Validates**: §15 Artifacts

---

## Objective

Validate all 16 behaviors from §15 (Artifacts) via HTTP requests. These tests
confirm artifact write/read, path traversal prevention, parent-child artifact
access, REST API endpoints, and the filesystem directory structure.

---

## Behavior Checklist → Test Mapping

### §15.1 Write & Read (4 behaviors)

| #   | Behavior                                                                    | Test                         |
| --- | --------------------------------------------------------------------------- | ---------------------------- |
| 1   | `ctx.artifacts.write()` creates file at `<ROOT>/<instanceId>/name`          | `write creates file`         |
| 2   | `ArtifactRecord` appended with name, instanceId, stateName, size, createdAt | `artifact record correct`    |
| 3   | `ctx.artifacts.read()` retrieves file content                               | `read retrieves content`     |
| 4   | `ctx.artifacts.list()` returns instance artifacts (not children)            | `list returns own artifacts` |

### §15.2 Sandbox / Path Traversal (3 behaviors)

| #   | Behavior                                           | Test                               |
| --- | -------------------------------------------------- | ---------------------------------- |
| 1   | Filename with `../` → rejected                     | `path traversal ../  rejected`     |
| 2   | Absolute path filename → rejected                  | `absolute path rejected`           |
| 3   | `readChild` with non-descendant ID → NotFoundError | `readChild non-descendant → error` |

### §15.3 Parent-Child Artifact Access (3 behaviors)

| #   | Behavior                                                   | Test                                       |
| --- | ---------------------------------------------------------- | ------------------------------------------ |
| 1   | Parent reads child artifact via `readChild(childId, name)` | `parent reads child artifact`              |
| 2   | Parent reads each parallel child's artifacts               | `parent reads parallel children artifacts` |
| 3   | `listChild(childId)` returns child's artifact list         | `listChild returns child list`             |

### §15.4 REST API (4 behaviors)

| #   | Behavior                                                          | Test                              |
| --- | ----------------------------------------------------------------- | --------------------------------- |
| 1   | `GET /instances/:id/artifacts` → flat list of ArtifactRecords     | `GET artifacts → flat list`       |
| 2   | `GET /instances/:id/artifacts/:name` → downloads content          | `GET artifact → file download`    |
| 3   | `GET /instances/:id/artifacts/:name` non-existent → 404           | `GET non-existent artifact → 404` |
| 4   | `GET /instances/:id/artifacts?tree=true` → recursive ArtifactTree | `GET artifacts tree → recursive`  |

### §15.5 Directory Structure (3 behaviors)

| #   | Behavior                                                        | Test                     |
| --- | --------------------------------------------------------------- | ------------------------ |
| 1   | Parent at `<ROOT>/<parentId>/`                                  | `parent dir correct`     |
| 2   | Child at `<ROOT>/<parentId>/children/<childId>/`                | `child dir correct`      |
| 3   | Grandchild at `.../children/<childId>/children/<grandchildId>/` | `grandchild dir correct` |

---

## Test Structure

```typescript
// server/src/__e2e__/09-artifacts.e2e.test.ts

describe('§15 — Artifacts', () => {
  describe('§15.1 Write & Read', () => {
    it('action writing artifact creates file at correct path');
    it('ArtifactRecord has name, instanceId, stateName, size, createdAt');
    it('action reading artifact retrieves correct content');
    it('list() returns only this instance artifacts (not children)');
  });

  describe('§15.2 Sandbox / Path Traversal', () => {
    it('writing filename with ../ is rejected');
    it('writing absolute path filename is rejected');
    it('readChild with non-descendant instanceId → NotFoundError');
  });

  describe('§15.3 Parent-Child Artifact Access', () => {
    it('parent reads child artifact via readChild()');
    it('parent reads each parallel child artifact');
    it('listChild() returns child artifact list');
  });

  describe('§15.4 REST API', () => {
    it('GET /instances/:id/artifacts returns flat ArtifactRecord list');
    it('GET /instances/:id/artifacts/:name downloads file content');
    it('GET /instances/:id/artifacts/:name for non-existent → 404');
    it('GET /instances/:id/artifacts?tree=true returns recursive tree');
  });

  describe('§15.5 Directory Structure', () => {
    it('parent artifacts at <ROOT>/<parentId>/');
    it('child artifacts at <ROOT>/<parentId>/children/<childId>/');
    it('grandchild artifacts nest further');
  });
});
```

---

## Custom Test Actions

```typescript
// Action that writes an artifact
registry.register(
  'test-write-artifact',
  (ctx) =>
    Effect.gen(function* () {
      const input = ctx.stateData as { filename?: string; content?: string; nextState?: string };
      const filename = input.filename ?? 'output.txt';
      const content = input.content ?? 'hello from artifact';
      const nextState = input.nextState ?? 'completed';

      yield* ctx.artifacts.write(filename, new TextEncoder().encode(content));
      yield* ctx.logger.info(`Wrote artifact: ${filename}`);

      return { nextState, data: { artifact: filename } };
    }),
  { description: 'Writes an artifact file' },
);

// Action that writes artifact with path traversal (for security test)
registry.register(
  'test-write-traversal',
  (ctx) =>
    Effect.gen(function* () {
      const input = ctx.stateData as { filename: string; nextState?: string };
      yield* ctx.artifacts.write(input.filename, new TextEncoder().encode('malicious'));
      return { nextState: input.nextState ?? 'completed', data: {} };
    }),
  { description: 'Attempts to write artifact with potentially malicious path' },
);

// Action that reads a child artifact (for parent-child access test)
registry.register(
  'test-read-child-artifact',
  (ctx) =>
    Effect.gen(function* () {
      const input = ctx.stateData as {
        childInstanceId: string;
        childArtifactName: string;
        nextState?: string;
      };
      const content = yield* ctx.artifacts.readChild(
        input.childInstanceId,
        input.childArtifactName,
      );
      return {
        nextState: input.nextState ?? 'completed',
        data: { childContent: new TextDecoder().decode(content) },
      };
    }),
  { description: 'Reads a child instance artifact' },
);
```

---

## Fixtures Needed

```typescript
// Artifact-producing machine
const ARTIFACT_DEF = {
  name: 'e2e-artifact',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'write_file',
  states: {
    write_file: { name: 'write_file', type: 'action', actionId: 'test-write-artifact' },
    completed: { name: 'completed', type: 'terminal' },
    cancelled: { name: 'cancelled', type: 'terminal' },
    error: { name: 'error', type: 'terminal' },
  },
  transitions: [{ from: 'write_file', to: 'completed' }],
};

// Parent that spawns artifact-producing child, then reads child artifact
const makeArtifactParentDef = (childDefId: string) => ({
  name: 'e2e-artifact-parent',
  inputSchema: { type: 'object' },
  outputSchema: { type: 'object' },
  initialState: 'spawn_child',
  states: {
    spawn_child: {
      name: 'spawn_child',
      type: 'child_machine',
      actionId: 'test-read-child-artifact',
      childMachineDefId: childDefId,
      childInputMapping: '$.machineInput',
    },
    completed: { name: 'completed', type: 'terminal' },
    cancelled: { name: 'cancelled', type: 'terminal' },
    error: { name: 'error', type: 'terminal' },
  },
  transitions: [
    { from: 'spawn_child', to: 'completed' },
    { from: 'spawn_child', to: 'error' },
  ],
});
```

---

## Key Assertions

- **Write**: `GET /instances/:id/artifacts` returns list containing artifact name
- **Read**: `GET /instances/:id/artifacts/:name` returns correct file content
- **Record shape**: Each ArtifactRecord has `name`, `instanceId`, `stateName`, `size`, `createdAt`
- **Path traversal**: Machine errors when attempting `../` or absolute paths
- **Parent-child access**: Parent's artifact list doesn't include child artifacts;
  `readChild()` correctly reads child's artifact
- **Tree**: `?tree=true` response includes nested `children` with their artifacts
- **Directory**: Verify filesystem paths match expected hierarchy (may need direct
  fs access in tests or trust the FsArtifactStore implementation)

---

## Behavior Spec Coverage

- §15 Artifacts (§15.1–§15.5) — 17 behaviors

---

## Validation Checklist

- [ ] All 4 §15.1 write/read behaviors verified
- [ ] All 3 §15.2 sandbox behaviors verified
- [ ] All 3 §15.3 parent-child access behaviors verified
- [ ] All 4 §15.4 REST API behaviors verified
- [ ] All 3 §15.5 directory structure behaviors verified
- [ ] Test file: `server/src/__e2e__/09-artifacts.e2e.test.ts`
