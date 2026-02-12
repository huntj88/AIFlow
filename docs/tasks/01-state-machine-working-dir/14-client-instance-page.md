# Task 14 — Client Instance Page Updates

> **Phase**: 7 (Client UI)
> **Depends on**: Task 12 (client API hooks migration), Task 13 (artifacts browser)
> **Blocks**: Task 17 (client E2E tests)

---

## Objective

Update `MachineInstancePage.tsx` and related components to use the new data model.
Replace the old artifact viewer integration, remove artifact store references,
display the new workspace fields, and integrate the new `ArtifactsBrowser` component.

---

## Steps

### 1. Remove `useMachineArtifacts` import and usage

```typescript
// DELETE:
import { useMachineArtifacts } from '@/hooks/useMachineArtifacts';

// DELETE:
const artifactsStore = useMachineArtifacts();

// DELETE (from useEffect):
void artifactsStore.fetchArtifacts(instanceId);
void artifactsStore.fetchArtifactTree(instanceId);
```

### 2. Remove `artifact_created` event handler

Already addressed in Task 12, but verify it's removed from the `handleEvent`
callback in `MachineInstancePage.tsx`:

```typescript
// DELETE this case from handleEvent:
case 'artifact_created':
  // ...
  break;
```

### 3. Replace `ArtifactViewer` with `ArtifactsBrowser`

```typescript
// BEFORE:
import { ArtifactViewer } from '@/components/machines/ArtifactViewer';

// In the artifacts tab:
<ArtifactViewer
  instanceId={instanceId}
  artifactTree={artifactsStore.artifactTree}
  artifacts={instance.artifacts}
/>

// AFTER:
import { ArtifactsBrowser } from '@/components/machines/ArtifactsBrowser';

// In the artifacts tab:
<ArtifactsBrowser
  instanceId={instanceId}
  artifactsPath={instance.artifactsPath}
/>
```

### 4. Display workspace information

Add a workspace info section to the instance page (e.g., in the header area
or a new "Details" tab):

```tsx
<div className="text-sm text-[var(--color-text-muted)]">
  <div>
    <span className="font-medium">Workspace:</span>{' '}
    <code className="text-xs">{instance.workspaceRoot}</code>
  </div>
  <div>
    <span className="font-medium">Artifacts:</span>{' '}
    <code className="text-xs">{instance.artifactsPath}</code>
  </div>
  <div>
    <span className="font-medium">Family Root:</span>{' '}
    <code className="text-xs">{instance.familyRootInstanceId}</code>
  </div>
</div>
```

### 5. Update child machine tree

The `ChildMachineTree` component may reference `artifacts` on child instances.
Update it to not expect artifact data:

- Remove any artifact count displays
- Remove any artifact-related badges or indicators

### 6. Update dashboard instance list

If the dashboard (`MachinesPage.tsx`) displays artifact counts or artifact-related
info in the instance list, remove those references:

```typescript
// DELETE any references to:
// instance.artifacts
// instance.artifacts.length
```

### 7. Update "Quick Start" / launch form

Ensure the launch form includes a workspace root input (from Task 12) and passes
it to the `startInstance` call. Add proper form validation:

- Required field
- Must be an absolute path (starts with `/`)
- Show validation error if invalid

### 8. Delete `ArtifactViewer.tsx`

After the new `ArtifactsBrowser` is integrated, delete the old component:

```
rm client/src/components/machines/ArtifactViewer.tsx
```

### 9. Update translations

Update `client/src/locales/en/` translation files:

- Remove artifact-related translation keys (e.g., `machines.instance.artifacts_empty`)
- Add workspace-related translation keys if needed
- Update any strings that reference "artifacts" in the old metadata sense

---

## Behavior Spec Coverage

- **§18** — Dashboard includes workspace root in launch form
- **§19.1** — Instance page renders correctly with new data model
- **§19.2** — Transition history unaffected (no artifact references)
- **§19.4** — Child machine tree unaffected (no artifact references)
- **§19.5** — Artifacts browser integrated into instance page

---

## Validation Checklist

- [ ] `MachineInstancePage` compiles without artifact-related imports
- [ ] `ArtifactViewer.tsx` deleted
- [ ] `ArtifactsBrowser` integrated in artifacts tab
- [ ] Instance page displays `workspaceRoot`, `artifactsPath`, `familyRootInstanceId`
- [ ] No references to `instance.artifacts` anywhere in client code
- [ ] No references to `ArtifactRecord` or `ArtifactTree` in client code
- [ ] Dashboard launch form includes workspace root field
- [ ] `pnpm --filter @aiflow/client exec tsc --noEmit` passes
- [ ] `pnpm --filter @aiflow/client run lint` passes
