# Task 01 — Data Types & Error Definitions

> **Phase**: 1 (Core Engine)
> **Depends on**: nothing
> **Blocks**: all other state-machine tasks

---

## Objective

Create the foundational TypeScript type definitions used across both server and client for the state machine feature. This is the single source of truth for all interfaces — definition, runtime, action, middleware, artifact, event, and error types. All types use the `_tag` discriminant pattern for idiomatic Effect `catchTag` / `Match.tag` usage.

---

## Steps

### 1. Create `server/src/machines/types.ts`

Define all interfaces and type aliases organized into logical sections:

#### Definition Types

- `StateMachineDefinition` — Full definition with `id`, `name`, `version`, `inputSchema`, `outputSchema`, `states`, `initialState`, `transitions`, `metadata`
- `StateDefinition` — Per-state config: `name`, `type` (`'action' | 'child_machine' | 'parallel_children' | 'terminal'`), `actionId?`, `childMachineDefId?`, `childInputMapping?`, `children?`, `description?`, `dataSchema?`, `timeoutMs?`, `parallelMode?`
- `ChildSpawnDefinition` — `key`, `machineDefId`, `inputMapping`
- `TransitionRule` — `from`, `to`, `label?`, `description?`
- `JsonSchema` — `Record<string, unknown>` (validated at runtime via `ajv`)

#### Runtime Types

- `MachineInstance` — Full instance state: `id`, `definitionId`, `definitionVersion`, `status` (`'running' | 'completed' | 'cancelled' | 'error' | 'waiting_for_child' | 'suspended'`), `currentState`, `stateData`, `input`, `output?`, `error?`, `parentInstanceId?`, `childInstanceId?`, `childInstanceIds?`, `history`, `logs`, `artifacts`, `createdAt`, `updatedAt`
- `TransitionRecord` — `id`, `fromState`, `toState`, `data?`, `timestamp`, `durationMs`, `actionId?`, `childInstanceId?`, `childDefinitionId?`, `childInstanceIds?`, `middlewareResults?`
- `LogEntry` — `id`, `instanceId`, `stateName`, `level` (`'debug' | 'info' | 'warn' | 'error'`), `message`, `data?`, `timestamp`
- `MachineResult<T>` — Tagged union: `completed` (with `output`), `cancelled`, `error` (with `error` string); all carry `instanceId`
- `ParallelChildrenResult` — `results: Record<string, MachineResult>`, `childInstanceIds: Record<string, string>`
- `InstanceFilter` — `status?`, `definitionId?`, `parentInstanceId?`, `limit?`, `offset?`

#### Action Types

- `ActionFunction` — `(ctx: ActionContext) => Effect.Effect<TransitionResult, ActionError>`
- `ActionContext` — `machineInstanceId`, `machineDefId`, `stateName`, `stateData`, `machineInput`, `parentContext?`, `logger: StateLogger`, `artifacts: ArtifactStore`
- `TransitionResult` — `nextState: string`, `data?: unknown`
- `StateLogger` — `debug`, `info`, `warn`, `error` methods returning `Effect.Effect<void, never>`
- `ActionMetadata` — `id: string`, `description?: string`, `inputSchema?: JsonSchema`, `outputSchema?: JsonSchema`

#### Middleware Types

- `TransitionMiddleware` — `name`, `beforeTransition?`, `afterTransition?`, `onError?`
- `MiddlewareContext` — `instance`, `stateName`, `stateData`, `definition`

#### Artifact Types

- `ArtifactStore` — `write`, `read`, `list`, `readChild`, `listChild`, `resolvePath` methods
- `ArtifactRecord` — `name`, `instanceId`, `stateName`, `size`, `mimeType?`, `metadata?`, `createdAt`
- `ArtifactMetadata` — `description?`, `tags?`, `[key: string]: unknown`
- `ArtifactTree` — `instanceId`, `definitionName`, `artifacts`, `children: ArtifactTree[]`

#### Event Types

- `MachineEvent` — Tagged union: `state_changed`, `transition_recorded`, `log_entry`, `machine_completed`, `machine_resumed`, `child_spawned`, `child_completed`, `children_spawned`, `children_completed`, `artifact_created`

#### Error Types

All with `readonly _tag` discriminant:

- `MachineError` — Union of all error types
- `ActionError` — `actionId`, `stateName`, `cause`
- `ValidationError` — `message`, `path?`
- `StoreError` — `operation`, `cause`
- `NotFoundError` — `entityType` (`'definition' | 'instance' | 'action'`), `id`
- `DefinitionError` — `message`, `details?: string[]`

### 2. Create error constructor helpers

Add convenience functions at the bottom of the types file (or a separate `errors.ts`):

```typescript
export const ActionError = (props: Omit<ActionError, '_tag'>): ActionError => ({
  _tag: 'ActionError',
  ...props,
});

export const ValidationError = (props: Omit<ValidationError, '_tag'>): ValidationError => ({
  _tag: 'ValidationError',
  ...props,
});

// ... etc for all error types
```

These enable clean construction: `ActionError({ actionId: 'foo', stateName: 'bar', cause: err })`.

---

## Behavior Spec Coverage

This task provides the type foundation for all behavior spec sections. No behaviors are directly testable from this task alone — they are exercised through subsequent tasks.

---

## Validation Checklist

- [x] `server/src/machines/types.ts` exists and compiles with zero errors
- [x] All interfaces from the feature spec §1, §2, §3, §4, §9 are defined
- [x] `MachineError` is a union of 5 tagged error types
- [x] `MachineEvent` is a union of 10 event types
- [x] `MachineInstance.status` has all 6 possible values
- [x] `StateDefinition.type` has all 4 possible values
- [x] `MachineResult` has all 3 variants (completed, cancelled, error)
- [x] Error constructor helpers work and produce correctly tagged objects
- [x] `pnpm --filter @aiflow/server run build` succeeds (or `tsc --noEmit`)
