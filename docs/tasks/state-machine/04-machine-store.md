# Task 04 — MachineStore Service & In-Memory Implementation

> **Phase**: 1 (Core Engine)
> **Depends on**: Task 01 (types)
> **Blocks**: Task 09 (runner core), Task 18 (API definitions)

---

## Objective

Create the `MachineStore` Effect Service (Tag + interface) and an `InMemoryMachineStore` Layer implementation. The store provides persistence for both `StateMachineDefinition` and `MachineInstance` records. The interface is designed so that a durable store (SQLite/Postgres) can be swapped in later without changing consumers.

---

## Steps

### 1. Create `server/src/machines/store/MachineStore.ts`

Define the `MachineStore` as an Effect Service Tag with the following contract:

```typescript
import { Context, Effect } from 'effect';

interface MachineStore {
  // Definitions
  saveDefinition(def: StateMachineDefinition): Effect.Effect<StateMachineDefinition, StoreError>;
  getDefinition(id: string): Effect.Effect<StateMachineDefinition, NotFoundError>;
  listDefinitions(): Effect.Effect<StateMachineDefinition[], StoreError>;
  updateDefinition(
    id: string,
    def: Partial<StateMachineDefinition>,
  ): Effect.Effect<StateMachineDefinition, NotFoundError>;
  deleteDefinition(id: string): Effect.Effect<void, NotFoundError>;

  // Instances
  saveInstance(instance: MachineInstance): Effect.Effect<MachineInstance, StoreError>;
  getInstance(id: string): Effect.Effect<MachineInstance, NotFoundError>;
  listInstances(filter?: InstanceFilter): Effect.Effect<MachineInstance[], StoreError>;
  updateInstance(
    id: string,
    patch: Partial<MachineInstance>,
  ): Effect.Effect<MachineInstance, NotFoundError>;
}

const MachineStore = Context.GenericTag<MachineStore>('MachineStore');
```

Key design decisions:

- `saveDefinition` auto-generates `id` (UUID), sets `version: 1`, populates `createdAt`/`updatedAt`
- `updateDefinition` increments `version` monotonically, refreshes `updatedAt`
- `listInstances` supports filtering by `status`, `definitionId`, `parentInstanceId`, with `limit`/`offset`
- All methods return `Effect` — never raw `Promise`
- `StoreError` for operational failures, `NotFoundError` for missing entities

### 2. Create `server/src/machines/store/InMemoryMachineStore.ts`

Implement with two `Map`s:

```typescript
const definitions = new Map<string, StateMachineDefinition>();
const instances = new Map<string, MachineInstance>();
```

Implementation notes:

- Use `crypto.randomUUID()` for ID generation
- Deep-clone objects on read/write to prevent mutation bugs
- `listInstances` applies filters by iterating the map and filtering
- `updateDefinition` increments `version` and updates `metadata.updatedAt`
- `updateInstance` merges patch into existing instance and updates `updatedAt`

### 3. Create the Layer

```typescript
export const InMemoryMachineStoreLive = Layer.succeed(MachineStore, { ... });
```

### 4. Unit tests — `server/src/machines/store/InMemoryMachineStore.test.ts`

- Save and retrieve a definition
- Save definition auto-generates `id`, `version: 1`, timestamps
- Update definition increments `version`, refreshes `updatedAt`
- Get non-existent definition → `NotFoundError`
- Delete definition → no longer retrievable (404)
- Delete non-existent definition → `NotFoundError`
- List definitions returns all saved
- Creating definitions with same `name` succeeds (names not unique)
- Save and retrieve an instance
- Update instance with partial patch
- Get non-existent instance → `NotFoundError`
- List instances with `status` filter
- List instances with `definitionId` filter
- List instances with `parentInstanceId` filter
- List instances with `limit`/`offset` pagination

---

## Behavior Spec Coverage

- §1.1 — Created definition has `version: 1` and populated timestamps
- §1.1 — Same name definitions succeed (names not unique)
- §1.2 — Get definition by ID; get non-existent returns 404
- §1.2 — List all definitions
- §1.3 — Update increments version, refreshes updatedAt
- §1.3 — Update non-existent returns 404
- §1.4 — Delete removes definition; delete non-existent returns 404
- §13 — Persistence checkpoints (store interface supports the checkpoint writes)

---

## Validation Checklist

- [x] `server/src/machines/store/MachineStore.ts` defines the Effect Service Tag and interface
- [x] `server/src/machines/store/InMemoryMachineStore.ts` implements the interface
- [x] UUID generation for IDs works
- [x] Deep cloning prevents mutation bugs
- [x] Version auto-increment on update works correctly
- [x] All filter combinations on `listInstances` work
- [x] Unit tests pass
- [x] `pnpm --filter @aiflow/server run test` passes
