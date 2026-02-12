# Task 13 — Client Artifacts Path Display

> **Phase**: 7 (Client UI)
> **Depends on**: Task 12 (client API hooks migration)
> **Blocks**: Task 14 (instance page updates)

---

## Objective

Remove the `ArtifactViewer` component (which relied on `ArtifactRecord` metadata
and the artifact API). Replace it with a simple read-only display of the instance's
`artifactsPath` string. No file browser, directory listing endpoint, or download
functionality — the user accesses the artifacts workspace directory on their own
filesystem.

> **Decision 5:** Display `artifactsPath` only. No server-side directory listing
> endpoint and no file browser component. Keep client changes minimal and focus
> on the server.

---

## Steps

### 1. Delete `ArtifactViewer` component

```bash
rm client/src/components/machines/ArtifactViewer.tsx
```

Remove any barrel exports that reference `ArtifactViewer`.

### 2. Create `ArtifactsPathDisplay` component

Create a simple component that shows the artifacts path as read-only text:

```typescript
// client/src/components/machines/ArtifactsPathDisplay.tsx

interface ArtifactsPathDisplayProps {
  readonly artifactsPath: string;
}

export function ArtifactsPathDisplay({ artifactsPath }: ArtifactsPathDisplayProps) {
  return (
    <div className="text-sm text-[var(--color-text-muted)]">
      <span className="font-medium">Artifacts Directory:</span>{' '}
      <code className="text-xs select-all">{artifactsPath}</code>
    </div>
  );
}
```

> **Note:** Artifact API calls are removed in Task 12 (Step 2),
> `useMachineArtifacts` is deleted in Task 12 (Step 3), and artifact types
> are removed in Task 11 (Steps 3–4). Those deletions are not repeated here.

---

## Behavior Spec Coverage

- **§19.5** — Artifacts panel displays `artifactsPath` as a filesystem path

---

## Validation Checklist

- [ ] `ArtifactViewer.tsx` deleted
- [ ] `ArtifactsPathDisplay` component created and renders `artifactsPath`
- [ ] `pnpm --filter @aiflow/client exec tsc --noEmit` passes
