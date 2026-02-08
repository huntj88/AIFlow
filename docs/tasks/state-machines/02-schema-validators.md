# Task 02 — Effect Schema Validators

> **Phase**: 1 (Core Engine)
> **Depends on**: Task 01 (types)
> **Blocks**: Task 03 (definition validator), Task 18 (API routes)

---

## Objective

Create `Schema` validators (from the `effect` package — not `@effect/schema`, which was consolidated into `effect` in v3.x) for all definition and instance types. These validators are used to:

1. Validate API request bodies (POST/PUT definition, POST instance)
2. Validate store operations (ensuring data integrity)
3. Provide runtime decode/encode for definition structures

---

## Steps

### 1. Create `server/src/machines/schemas.ts`

Define `Schema` declarations for each core type. Use `Schema.Struct`, `Schema.Union`, `Schema.Literal`, etc.

#### Definition Schemas

- `JsonSchemaSchema` — `Schema.Record({ key: Schema.String, value: Schema.Unknown })`
- `ChildSpawnDefinitionSchema` — Struct with `key`, `machineDefId`, `inputMapping` (all strings)
- `StateDefinitionSchema` — Struct with `name`, `type` (literal union), optional fields
- `TransitionRuleSchema` — Struct with `from`, `to`, required strings; `label?`, `description?`
- `StateMachineDefinitionSchema` — Full definition struct; `states` as `Record<string, StateDefinitionSchema>`
- `CreateDefinitionRequestSchema` — Same as definition but without `id`, `version`, `metadata.createdAt`, `metadata.updatedAt` (server generates these)
- `UpdateDefinitionRequestSchema` — Same as create (server manages `id`, `version`, timestamps)

#### Instance Schemas

- `StartInstanceRequestSchema` — `definitionId: string`, `input: Schema.Unknown`
- `MachineInstanceSchema` — Full instance struct
- `InstanceFilterSchema` — Optional fields for query params

#### Response Schemas

- `DefinitionErrorResponseSchema` — `message`, `details[]`
- `NotFoundResponseSchema` — `message`, `id`

### 2. Export decode/encode utilities

```typescript
export const decodeCreateDefinition = Schema.decodeUnknown(CreateDefinitionRequestSchema);
export const decodeStartInstance = Schema.decodeUnknown(StartInstanceRequestSchema);
// etc.
```

### 3. Add `effect` Schema import note

The server already has `effect` as a dependency. Use:

```typescript
import { Schema } from 'effect';
```

Not `@effect/schema` — that package was consolidated into `effect` v3.x.

---

## Behavior Spec Coverage

- §2.4 — Validation error response structure (DefinitionError with `message` and `details[]`)
- §21.1 — API error responses (400 Bad Request for missing fields — validated via these schemas)

---

## Validation Checklist

- [ ] `server/src/machines/schemas.ts` exists and compiles
- [ ] `CreateDefinitionRequestSchema` rejects payloads missing required fields (name, states, initialState, transitions)
- [ ] `StartInstanceRequestSchema` requires `definitionId` and `input`
- [ ] Schema decode functions return `Effect` with typed parse errors
- [ ] All schemas align with the interfaces defined in Task 01
- [ ] `pnpm --filter @aiflow/server run build` succeeds
