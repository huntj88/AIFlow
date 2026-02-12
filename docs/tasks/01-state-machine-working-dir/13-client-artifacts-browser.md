# Task 13 — Client Artifacts Browser Rework

> **Phase**: 7 (Client UI)
> **Depends on**: Task 12 (client API hooks migration)
> **Blocks**: Task 14 (instance page updates)

---

## Objective

Replace the `ArtifactViewer` component (which relied on `ArtifactRecord` metadata
and the artifact API) with a new filesystem-based artifacts browser. The new browser
uses the instance's `artifactsPath` to show the artifacts workspace directory
contents.

---

## Design Decision

Since the artifact API has been removed, the client can no longer fetch artifact
metadata from the server via REST. Two approaches are available:

### Option A — Server-side directory listing endpoint (recommended)

Add a new lightweight endpoint that reads the filesystem:

```
GET /api/machines/instances/:id/files?path=<relativePath>
```

Returns a directory listing:

```json
[
  { "name": "report.json", "type": "file", "size": 1234 },
  { "name": "children", "type": "directory" }
]
```

And a file download endpoint:

```
GET /api/machines/instances/:id/files/download?path=<relativePath>
```

### Option B — Display `artifactsPath` only

Show the `artifactsPath` string and let the user browse it via their filesystem.
Simplest to implement but less useful.

**This task implements Option A** since the behavior spec (§19.5) requires a
file-explorer-style tree browser.

---

## Steps

### 1. Add file listing API endpoint (server)

Add to `server/src/routes/machines/instances.ts`:

```typescript
// GET /api/machines/instances/:id/files
// Query: ?path=<relative path within artifactsPath> (default: "")
// Returns: DirectoryEntry[]

interface DirectoryEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number; // only for files
}
```

Implementation:

```typescript
app.get('/api/machines/instances/:id/files', async (req, res) => {
  const instance = /* load instance */;
  const relativePath = (req.query.path as string) || '';
  const fullPath = path.resolve(instance.artifactsPath, relativePath);

  // Verify fullPath is within artifactsPath (basic safety)
  if (!fullPath.startsWith(instance.artifactsPath)) {
    return res.status(400).json({ message: 'Invalid path' });
  }

  const entries = await fs.readdir(fullPath, { withFileTypes: true });
  const result = await Promise.all(
    entries.map(async (entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
      size: entry.isFile()
        ? (await fs.stat(path.join(fullPath, entry.name))).size
        : undefined,
    })),
  );

  return res.json(result);
});
```

### 2. Add file download endpoint (server)

```typescript
// GET /api/machines/instances/:id/files/download
// Query: ?path=<relative path to file>

app.get('/api/machines/instances/:id/files/download', async (req, res) => {
  const instance = /* load instance */;
  const relativePath = req.query.path as string;
  const fullPath = path.resolve(instance.artifactsPath, relativePath);

  if (!fullPath.startsWith(instance.artifactsPath)) {
    return res.status(400).json({ message: 'Invalid path' });
  }

  // Send file
  res.sendFile(fullPath);
});
```

### 3. Add client API calls

Add to `client/src/utils/apiClient.ts`:

```typescript
export interface DirectoryEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
}

// In apiClient:
listArtifactFiles: (instanceId: string, relativePath?: string) =>
  makeRequest(`/api/machines/instances/${instanceId}/files${relativePath ? `?path=${encodeURIComponent(relativePath)}` : ''}`),

downloadArtifactFile: (instanceId: string, relativePath: string) =>
  makeBinaryRequest(`/api/machines/instances/${instanceId}/files/download?path=${encodeURIComponent(relativePath)}`),
```

### 4. Create new `ArtifactsBrowser` component

Replace `ArtifactViewer` with a new component:

```typescript
// client/src/components/machines/ArtifactsBrowser.tsx

interface ArtifactsBrowserProps {
  readonly instanceId: string;
  readonly artifactsPath: string;
}
```

Features:

- **Directory tree**: Fetch the top-level directory listing on mount
- **Expand/collapse**: Clicking a directory fetches its contents lazily
- **File download**: Clicking a file triggers a download
- **File size display**: Show human-readable file sizes
- **Empty state**: Show a message when no files exist
- **Loading state**: Show a spinner while fetching directory contents
- **Error state**: Handle cases where `artifactsPath` doesn't exist yet

### 5. Update component exports

Replace the `ArtifactViewer` export with `ArtifactsBrowser`:

```typescript
// Delete or rename:
// client/src/components/machines/ArtifactViewer.tsx

// Create:
// client/src/components/machines/ArtifactsBrowser.tsx
```

### 6. Add `DirectoryEntry` type to client types

Add to `client/src/types/machines.ts`:

```typescript
export interface DirectoryEntry {
  readonly name: string;
  readonly type: 'file' | 'directory';
  readonly size?: number;
}
```

---

## Behavior Spec Coverage

- **§19.5** — Artifacts panel shows a file-explorer-style tree
- **§19.5** — Tree displays files from the family artifacts root directory
- **§19.5** — Clicking an artifact triggers a download
- **§19.5** — Tree can be expanded/collapsed per subdirectory level
- **§19.5** — `children/<childInstanceId>/` convention rendered as hierarchical tree

---

## Validation Checklist

- [ ] `GET /instances/:id/files` endpoint returns directory listings
- [ ] `GET /instances/:id/files/download` endpoint serves files
- [ ] `ArtifactsBrowser` component renders directory tree
- [ ] Directories can be expanded/collapsed
- [ ] Files can be downloaded
- [ ] Empty state handled
- [ ] Old `ArtifactViewer` removed or replaced
- [ ] `pnpm --filter @aiflow/client exec tsc --noEmit` passes
