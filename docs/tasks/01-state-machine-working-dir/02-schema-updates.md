# Task 02 — Schema Updates

> **Phase**: 1 (Data Model)
> **Depends on**: Task 01 (server type updates)
> **Blocks**: Task 09 (start-instance API), Task 10 (instance payload)

---

## Objective

Update the Effect Schema definitions in `server/src/machines/schemas.ts` to reflect
the new working directory model. Add `workspaceRoot` to the start-instance request,
update `MachineInstanceSchema` with the three new fields, remove artifact-related
schemas, and update decode utilities.

---

## Current State

### `StartInstanceRequestSchema` (current)

```typescript
// Contains: definitionId, input
// Does NOT have workspaceRoot
```

### `MachineInstanceSchema` (current)

```typescript
// Contains: artifacts (array of ArtifactRecordSchema)
// Does NOT have workspaceRoot, familyRootInstanceId, artifactsPath
```

### Artifact schemas (current — to be removed)

- `ArtifactRecordSchema`
- `ArtifactMetadataSchema` (if exists)
- `ArtifactTreeSchema` (if exists)

---

## Steps

### 1. Update `StartInstanceRequestSchema`

Add `workspaceRoot` as a required field:

```typescript
export const StartInstanceRequestSchema = Schema.Struct({
  definitionId: Schema.String,
  input: Schema.Unknown,
  workspaceRoot: Schema.String, // NEW — required absolute path
});
```

### 2. Update `MachineInstanceSchema`

Add the three new fields and remove `artifacts`:

```typescript
export const MachineInstanceSchema = Schema.Struct({
  id: Schema.String,
  definitionId: Schema.String,
  definitionVersion: Schema.Number,
  status: MachineStatusSchema,
  currentState: Schema.String,
  stateData: Schema.Unknown,
  input: Schema.Unknown,
  output: Schema.optionalWith(Schema.Unknown, { as: 'Option' }).pipe(Schema.optional),
  error: Schema.optional(Schema.String),
  parentInstanceId: Schema.optional(Schema.String),
  childInstanceId: Schema.optional(Schema.String),
  childInstanceIds: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  history: Schema.Array(TransitionRecordSchema),
  logs: Schema.Array(LogEntrySchema),
  // REMOVED: artifacts: Schema.Array(ArtifactRecordSchema),
  workspaceRoot: Schema.String, // NEW
  familyRootInstanceId: Schema.String, // NEW
  artifactsPath: Schema.String, // NEW
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
```

### 3. Remove artifact schemas

Delete the following schema definitions from `schemas.ts`:

- `ArtifactRecordSchema`
- `ArtifactMetadataSchema` (if present)
- `ArtifactTreeSchema` (if present)

Also remove any associated type aliases derived from these schemas.

### 4. Update decode utilities

Update or remove decode utilities that reference artifact schemas:

- `decodeStartInstance` should now decode `workspaceRoot` from the request body
- Remove any `decodeArtifactRecord` or similar utilities if they exist

### 5. Update response schemas (if applicable)

If there are response schemas used for serialization (e.g., `InstanceResponseSchema`),
update them to match the new `MachineInstanceSchema`.

---

## Behavior Spec Coverage

- **§4.1** — `POST /instances` accepts `workspaceRoot` in the request body
- **§4.4** — `workspaceRoot` is a required field in `StartInstanceRequestSchema`
- **§15.5** — Instance schema includes `workspaceRoot`, `familyRootInstanceId`, `artifactsPath`
- **§15.6** — No `ArtifactRecord` schema or `ArtifactTree` schema exists

---

## Validation Checklist

- [ ] `StartInstanceRequestSchema` includes `workspaceRoot: Schema.String`
- [ ] `MachineInstanceSchema` includes `workspaceRoot`, `familyRootInstanceId`, `artifactsPath`
- [ ] `MachineInstanceSchema` does NOT include `artifacts`
- [ ] `ArtifactRecordSchema` is removed
- [ ] `decodeStartInstance` decodes `workspaceRoot` from request body
- [ ] `pnpm --filter @aiflow/server exec tsc --noEmit` passes (or expected errors in downstream consumers only)
