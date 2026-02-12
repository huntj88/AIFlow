# Task 01 — Server Type Updates

> **Phase**: 1 (Data Model)
> **Depends on**: All 00-state-machine tasks complete
> **Blocks**: Tasks 02–10, 15

---

## Objective

Update the foundational TypeScript types in `server/src/machines/types.ts` to reflect
the new working directory model. This adds new interfaces (`CliHelper`, `CliExecResult`,
workspace helpers), updates `ActionContext` and `MachineInstance`, and marks artifact
types for removal.

---

## Current State (from 00-state-machine)

### `ActionContext` (current)

```typescript
export interface ActionContext {
  readonly machineInstanceId: string;
  readonly machineDefId: string;
  readonly stateName: string;
  readonly stateData: unknown;
  readonly machineInput: unknown;
  readonly parentContext?: {
    readonly parentInstanceId: string;
    readonly parentStateName: string;
  };
  readonly logger: StateLogger;
  readonly artifacts: ArtifactStore;
}
```

### `MachineInstance` (current)

```typescript
export interface MachineInstance {
  // ... existing fields ...
  readonly artifacts: ArtifactRecord[];
  // no workspaceRoot, familyRootInstanceId, or artifactsPath
}
```

### Artifact types (current — to be removed)

- `ArtifactStore` — write, read, list, readChild, listChild, resolvePath
- `ArtifactRecord` — name, instanceId, stateName, size, mimeType?, metadata?, createdAt
- `ArtifactMetadata` — description?, tags?, [key: string]: unknown
- `ArtifactTree` — instanceId, definitionName, artifacts, children

### `MachineEvent` (current — 10 variants including `artifact_created`)

---

## Steps

### 1. Add CLI types

Add the following interfaces to `server/src/machines/types.ts`:

```typescript
export interface CliExecResult {
  readonly exitCode: number; // -1 = spawn failure
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface CliHelper {
  exec(input: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  }): Effect.Effect<CliExecResult>;
}
```

### 2. Add workspace helper types

```typescript
export interface WorkspaceContext {
  readonly root: string;
  /** Resolve a path within the workspace root. */
  resolve(relativePath: string): string;
}
```

### 3. Update `ActionContext`

Replace the `artifacts: ArtifactStore` field with the new helpers:

```typescript
export interface ActionContext {
  // Retained (unchanged):
  readonly machineInstanceId: string;
  readonly machineDefId: string;
  readonly stateName: string;
  readonly stateData: unknown;
  readonly machineInput: unknown;
  readonly parentContext?: {
    readonly parentInstanceId: string;
    readonly parentStateName: string;
  };
  readonly logger: StateLogger;

  // REMOVED: artifacts: ArtifactStore

  // NEW: CLI helper
  readonly cli: CliHelper;

  // NEW: User workspace context
  readonly workspace: WorkspaceContext;

  // NEW: Artifacts workspace context (family-scoped)
  readonly artifactsWorkspace: WorkspaceContext;
}
```

### 4. Update `MachineInstance`

```typescript
export interface MachineInstance {
  // ... all existing fields retained EXCEPT artifacts ...
  // REMOVED: readonly artifacts: ArtifactRecord[];

  // NEW fields:
  readonly workspaceRoot: string;
  readonly familyRootInstanceId: string;
  readonly artifactsPath: string;

  // Existing fields unchanged:
  readonly id: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly status:
    | 'running'
    | 'completed'
    | 'cancelled'
    | 'error'
    | 'waiting_for_child'
    | 'suspended';
  readonly currentState: string;
  readonly stateData: unknown;
  readonly input: unknown;
  readonly output?: unknown;
  readonly error?: string;
  readonly parentInstanceId?: string;
  readonly childInstanceId?: string;
  readonly childInstanceIds?: Record<string, string>;
  readonly history: TransitionRecord[];
  readonly logs: LogEntry[];
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

### 5. Update `MachineEvent`

Remove the `artifact_created` variant:

```typescript
export type MachineEvent =
  | { type: 'state_changed'; instanceId: string; data: { ... } }
  | { type: 'transition_recorded'; instanceId: string; data: TransitionRecord }
  | { type: 'log_entry'; instanceId: string; data: LogEntry }
  | { type: 'machine_completed'; instanceId: string; data: MachineResult }
  | { type: 'machine_resumed'; instanceId: string; data: { ... } }
  | { type: 'child_spawned'; instanceId: string; data: { ... } }
  | { type: 'child_completed'; instanceId: string; data: { ... } }
  | { type: 'children_spawned'; instanceId: string; data: { ... } }
  | { type: 'children_completed'; instanceId: string; data: { ... } };
  // REMOVED: artifact_created
```

### 6. Remove artifact types

Remove these types from `types.ts`:

- `ArtifactStore` interface
- `ArtifactRecord` interface
- `ArtifactMetadata` interface
- `ArtifactTree` interface

> **Note:** Do not delete the types file or the types themselves yet if other files
> still import them. Instead, mark them with `@deprecated` comments. Full deletion
> happens in Task 07 after all usages are removed.
>
> If you can remove them without breaking compilation (i.e., no other files import
> them yet because the runner/API haven't been updated), prefer immediate removal.
> Otherwise add `/** @deprecated — removed in Task 07 */` annotations.

### 7. Update `StartInstanceInput` (if exists) or add it

If there is a `StartInstanceInput` type or similar for the request body, add
`workspaceRoot: string`. Otherwise, note that schemas (Task 02) will handle
the request shape.

---

## Behavior Spec Coverage

This task provides the type foundation for:

- **§4.1** — `MachineInstance` includes `workspaceRoot`, `familyRootInstanceId`, `artifactsPath`
- **§15.1** — `WorkspaceContext` interface with `root` and `resolve()`
- **§15.2** — `WorkspaceContext` used for both workspace and artifactsWorkspace
- **§15.5** — Instance payload fields (`workspaceRoot`, `familyRootInstanceId`, `artifactsPath`)
- **§15.6** — `ArtifactRecord`, `ArtifactStore`, `ArtifactTree` types removed
- **§16.1** — `CliExecResult` and `CliHelper` interfaces defined

---

## Validation Checklist

- [ ] `CliExecResult` interface with `exitCode`, `stdout`, `stderr`, `durationMs`
- [ ] `CliHelper` interface with `exec()` method returning `Effect.Effect<CliExecResult>`
- [ ] `WorkspaceContext` interface with `root` and `resolve()`
- [ ] `ActionContext` has `cli`, `workspace`, `artifactsWorkspace` — no `artifacts`
- [ ] `MachineInstance` has `workspaceRoot`, `familyRootInstanceId`, `artifactsPath` — no `artifacts`
- [ ] `MachineEvent` has 9 variants — no `artifact_created`
- [ ] `ArtifactStore`, `ArtifactRecord`, `ArtifactMetadata`, `ArtifactTree` removed or deprecated
- [ ] `pnpm --filter @aiflow/server exec tsc --noEmit` passes (may have errors in downstream files — that's expected; they will be fixed in subsequent tasks)
