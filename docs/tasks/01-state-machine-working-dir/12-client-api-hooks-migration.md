# Task 12 — Client API Client & Hooks Migration

> **Phase**: 6 (Client)
> **Depends on**: Task 08 (artifact API removed), Task 10 (instance payload updates),
> Task 11 (client type updates)
> **Blocks**: Task 13 (artifacts browser rework), Task 14 (instance page updates)

---

## Objective

Update the client-side API client, hooks, and WebSocket event handling to match the
new server contract. Remove artifact-related API calls, update `startInstance` to
include `workspaceRoot`, and remove `artifact_created` event handling.

---

## Steps

### 1. Update `apiClient` — `startInstance()`

Add `workspaceRoot` to the start-instance request:

```typescript
// In client/src/utils/apiClient.ts:

// BEFORE:
startInstance: (definitionId: string, input: unknown) =>
  makePostRequest('/api/machines/instances', { definitionId, input }),

// AFTER:
startInstance: (definitionId: string, input: unknown, workspaceRoot: string) =>
  makePostRequest('/api/machines/instances', { definitionId, input, workspaceRoot }),
```

### 2. Remove artifact API calls from `apiClient`

Delete these methods from `apiClient`:

```typescript
// DELETE:
getInstanceArtifacts: (instanceId: string) => ...,
getInstanceArtifactTree: (instanceId: string) => ...,
downloadArtifact: (instanceId: string, name: string) => ...,
```

### 3. Delete `useMachineArtifacts` hook

Remove the entire file:

```
rm client/src/hooks/useMachineArtifacts.ts
```

This Zustand store managed `artifacts`, `artifactTree`, `isLoading`, `error` and
had methods `fetchArtifacts`, `fetchArtifactTree`, `addArtifact`, `clearArtifacts`.
All of this is no longer needed.

### 4. Remove `artifact_created` event handling

Update `client/src/pages/MachineInstancePage.tsx` (or wherever WebSocket events
are handled) to remove the `artifact_created` case:

```typescript
// In the handleEvent callback:

// DELETE this case:
case 'artifact_created':
  artifactsStore.addArtifact(event.data);
  if (instanceId) {
    void artifactsStore.fetchArtifactTree(instanceId);
  }
  break;
```

### 5. Update `useMachineInstances` hook (if applicable)

If the instances hook or store references `artifacts` on the `MachineInstance`
type, update it to handle the new fields instead:

- Remove any `artifacts` references
- Ensure the store correctly handles instances with `workspaceRoot`,
  `familyRootInstanceId`, `artifactsPath`

### 6. Update `machineSocket` event handling

In `client/src/utils/machineSocket.ts`, if there is type-specific handling of
`artifact_created`, remove it. The `MachineEvent` type change (Task 11) should
handle this automatically, but verify no runtime code checks for it.

### 7. Update dashboard launch form

Add a `workspaceRoot` free-text input field to the dashboard's "Quick Start"
or "Launch" form. Keep it simple — no recent history or pre-filled defaults.

> **Decision 8:** Plain free-text input with client-side validation (must
> start with `/`). Keep client changes minimal.

```tsx
// In the launch form component:
<input
  type="text"
  placeholder="/path/to/workspace"
  value={workspaceRoot}
  onChange={(e) => setWorkspaceRoot(e.target.value)}
/>
```

Update the form submission to pass `workspaceRoot`:

```typescript
await runWithLogging(apiClient.startInstance(definitionId, input, workspaceRoot));
```

### 8. Update any other callers of `startInstance`

Search the client codebase for all calls to `apiClient.startInstance` or
`startInstance` and update them to include `workspaceRoot`.

---

## Behavior Spec Coverage

- **§4.1** — Client can start an instance with `workspaceRoot`
- **§15.6** — No artifact API calls in client
- **§17.2** — No `artifact_created` event handling in client
- **§18** — Dashboard "Quick Start" includes workspace root field

---

## Validation Checklist

- [x] `apiClient.startInstance()` includes `workspaceRoot` parameter
- [x] `apiClient.getInstanceArtifacts()` removed
- [x] `apiClient.getInstanceArtifactTree()` removed
- [x] `apiClient.downloadArtifact()` removed
- [x] `useMachineArtifacts.ts` hook deleted
- [x] `artifact_created` event handling removed from all components
- [x] Dashboard launch form includes workspace root input
- [x] `pnpm --filter @aiflow/client exec tsc --noEmit` passes (with expected errors
      in ArtifactViewer — fixed in Task 13)
