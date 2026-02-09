# Task 26 — Client State Management (Zustand Stores)

> **Phase**: 4 (Client Viewer)
> **Depends on**: Task 24 (API client), Task 25 (WebSocket client)
> **Blocks**: Task 27 (dashboard), Task 28 (instance viewer)

---

## Objective

Create Zustand stores for machine definitions, instances, and logs. The stores provide the reactive data layer for all machine UI components, combining REST API data fetching with WebSocket live updates.

---

## Implementation Notes from Completed Tasks

> These details emerged from the existing client codebase.

### Zustand pattern

Existing stores follow `create<T>()(...)` with optional `persist` middleware:

```typescript
import { create } from 'zustand';
export const useThemeStore = create<ThemeState>()(persist((set) => ({ ... }), { name: 'key' }));
```

Machine stores probably don't need `persist` (data is fetched from the server).

### Effect execution in the client

The client uses `runWithLogging` from `client/src/utils/logger.ts` to run Effects:

```typescript
import { runWithLogging } from '@/utils/logger';
// runWithLogging(apiClient.getDefinitions()).then(setDefinitions).catch(setError);
```

Each `apiClient.*` method returns an `Effect.Effect<T, Error>`. Run them through `runWithLogging` in store actions.

### Client-side types

Mirror types should be defined in `client/src/types/machines.ts` (Task 24). Stores import types from there.

### Hook file convention

Existing hooks are at `client/src/hooks/useXxx.ts`. Follow the same convention: `useMachineDefinitions.ts`, `useMachineInstances.ts`, `useMachineLogs.ts`, `useMachineArtifacts.ts`.

---

## Steps

### 1. Create `client/src/hooks/useMachineDefinitions.ts`

Zustand store for definitions:

```typescript
interface MachineDefinitionsStore {
  definitions: StateMachineDefinition[];
  isLoading: boolean;
  error: string | null;

  fetchDefinitions(): Promise<void>;
  createDefinition(body: CreateDefinitionRequest): Promise<StateMachineDefinition>;
  updateDefinition(id: string, body: UpdateDefinitionRequest): Promise<StateMachineDefinition>;
  deleteDefinition(id: string): Promise<void>;
}
```

- Calls `apiClient` functions for CRUD
- Manages loading/error state
- Refreshes list after create/update/delete

### 2. Create `client/src/hooks/useMachineInstances.ts`

Zustand store for instances with WebSocket integration:

```typescript
interface MachineInstancesStore {
  instances: MachineInstance[];
  currentInstance: MachineInstance | null;
  isLoading: boolean;
  error: string | null;

  fetchInstances(filter?: InstanceFilter): Promise<void>;
  fetchInstance(id: string): Promise<void>;
  startInstance(definitionId: string, input: unknown): Promise<MachineInstance>;
  cancelInstance(id: string): Promise<void>;
  resumeInstance(id: string): Promise<void>;

  // WebSocket integration
  subscribeToInstance(id: string): () => void;
  handleEvent(event: MachineEvent): void;
}
```

- `subscribeToInstance` calls `machineSocket.subscribe` and updates store on events
- `handleEvent` processes each event type:
  - `state_changed` → update `currentState`, `stateData` on the instance
  - `transition_recorded` → append to `history`
  - `log_entry` → append to `logs`
  - `machine_completed` → update `status`, `output`/`error`
  - `child_spawned` / `child_completed` → update child info
  - `children_spawned` / `children_completed` → update parallel children info
  - `artifact_created` → append to `artifacts`
  - `machine_resumed` → update `status` to `running`

### 3. Create `client/src/hooks/useMachineLogs.ts`

Zustand store for log viewing:

```typescript
interface MachineLogsStore {
  logs: LogEntry[];
  isLoading: boolean;
  filters: { state?: string; level?: string };

  fetchLogs(instanceId: string, state?: string): Promise<void>;
  setFilter(filters: Partial<{ state: string; level: string }>): void;
  addLogEntry(entry: LogEntry): void; // Called from WS events

  // Computed
  filteredLogs(): LogEntry[];
}
```

- Supports filtering by state name and log level
- `addLogEntry` integrates with WebSocket for real-time log streaming

### 4. Create `client/src/hooks/useMachineArtifacts.ts`

Zustand store for artifact viewing:

```typescript
interface MachineArtifactsStore {
  artifacts: ArtifactRecord[];
  artifactTree: ArtifactTree | null;
  isLoading: boolean;

  fetchArtifacts(instanceId: string): Promise<void>;
  fetchArtifactTree(instanceId: string): Promise<void>;
  addArtifact(record: ArtifactRecord): void; // Called from WS events
  downloadArtifact(instanceId: string, name: string): Promise<Blob>;
}
```

---

## Behavior Spec Coverage

The stores enable all client-side behaviors in §17 and §18. Specific behaviors tested via the UI components that consume these stores.

---

## Validation Checklist

- [ ] `useMachineDefinitions` store with full CRUD operations
- [ ] `useMachineInstances` store with start, cancel, resume, and WebSocket integration
- [ ] `useMachineLogs` store with filtering and live updates
- [ ] `useMachineArtifacts` store with tree and download support
- [ ] All stores handle loading/error states
- [ ] WebSocket events correctly update store state
- [ ] `pnpm --filter @aiflow/client run build` succeeds
