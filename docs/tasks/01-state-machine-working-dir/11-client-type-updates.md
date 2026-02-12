# Task 11 — Client Type Updates

> **Phase**: 6 (Client)
> **Depends on**: Task 01 (server type updates — defines the new contract)
> **Blocks**: Task 12 (client API migration)

---

## Objective

Update `client/src/types/machines.ts` to mirror the server type changes. The client
types must match the server's API response shapes exactly. Add new types, remove
artifact types, and update the `MachineEvent` union.

---

## Current State

### `MachineInstance` (client — current)

```typescript
export interface MachineInstance {
  // ... all existing fields ...
  readonly artifacts: ArtifactRecord[];
  // no workspaceRoot, familyRootInstanceId, or artifactsPath
}
```

### Artifact types (client — current)

- `ArtifactRecord` — `name`, `instanceId`, `stateName`, `size`, `mimeType?`, `metadata?`, `createdAt`
- `ArtifactMetadata` — `description?`, `tags?`, `[key: string]: unknown`
- `ArtifactTree` — `instanceId`, `definitionName`, `artifacts`, `children`

### `MachineEvent` (client — current)

10 variants including `artifact_created`.

---

## Steps

### 1. ~~Add `CliExecResult` type~~ — SKIPPED

> **Decision 4:** Skip. `CliExecResult` is server-side only. State data is
> `unknown` on the client — no compile-time benefit. Can be added later if needed.

### 2. Update `MachineInstance`

```typescript
export interface MachineInstance {
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
  // REMOVED: readonly artifacts: ArtifactRecord[];
  readonly workspaceRoot: string; // NEW
  readonly familyRootInstanceId: string; // NEW
  readonly artifactsPath: string; // NEW
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

### 3. Remove artifact types

Delete from `client/src/types/machines.ts`:

- `ArtifactRecord` interface
- `ArtifactMetadata` interface
- `ArtifactTree` interface

### 4. Update `MachineEvent`

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

### 5. Add `StartInstanceInput` type

Add to `client/src/types/machines.ts` (alongside all other machine types):

> **Decision 12:** Define in `client/src/types/machines.ts` as the single
> source of truth for all machine-related types.

```typescript
export interface StartInstanceInput {
  readonly definitionId: string;
  readonly input: unknown;
  readonly workspaceRoot: string; // NEW — required
}
```

### 6. Fix downstream TypeScript errors

After removing artifact types, fix any compile errors in files that import them:

- `client/src/hooks/useMachineArtifacts.ts` — will break (addressed in Task 12)
- `client/src/components/machines/ArtifactViewer.tsx` — will break (addressed in Task 13)
- `client/src/pages/MachineInstancePage.tsx` — will break (addressed in Task 14)

For this task, focus on `types/machines.ts` only. Downstream breakage is expected
and will be fixed in subsequent tasks.

---

## Behavior Spec Coverage

- **§15.5** — Client `MachineInstance` type includes `workspaceRoot`, `familyRootInstanceId`, `artifactsPath`
- **§15.6** — No `ArtifactRecord`, `ArtifactTree` types in client
- **§17.2** — No `artifact_created` in client event types

---

## Validation Checklist

- [x] `MachineInstance` has `workspaceRoot`, `familyRootInstanceId`, `artifactsPath`
- [x] `MachineInstance` does NOT have `artifacts: ArtifactRecord[]`
- [x] `ArtifactRecord`, `ArtifactMetadata`, `ArtifactTree` removed from client types
- [x] `MachineEvent` has 9 variants — no `artifact_created`
- [x] `StartInstanceInput` includes `workspaceRoot`
- [x] Types file compiles (downstream errors in hooks/components expected)
