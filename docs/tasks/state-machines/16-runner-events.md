# Task 16 — Machine Runner — Event Publishing via PubSub

> **Phase**: 1 (Core Engine)
> **Depends on**: Task 09 (runner core)
> **Blocks**: Task 17 (tests), Task 23 (WebSocket server)

---

## Objective

Integrate Effect `PubSub` into the `StateMachineRunner` for publishing `MachineEvent`s at each significant point during execution. These events are consumed by the WebSocket manager (Task 23) to provide real-time updates to connected clients.

---

## Implementation Notes from Completed Tasks

> These details emerged from Tasks 01–09 and affect this task's implementation.

- **`MachineEvent` uses `type` as discriminant** (NOT `_tag`). Example: `{ type: 'state_changed', instanceId: '...', data: { ... } }`. The `type` field is a string union; `_tag` is used only for errors.
- **`MachineResult` uses `status` as discriminant**: `{ status: 'completed', output, instanceId }`.
- **Effect Service pattern**: Use `Context.GenericTag<PubSub.PubSub<MachineEvent>>('MachineEventPubSub')` for the PubSub tag.
- **`PubSub`** is available from `effect` directly: `import { PubSub } from 'effect';`.

### Runner does NOT currently depend on PubSub (Task 09)

`StateMachineRunnerLive` currently depends on: `MachineStore`, `ActionRegistry`, `ArtifactStoreFactory`, `MiddlewareExecutor`. **PubSub must be added as a new dependency** in the Layer:

```typescript
const pubsub = yield * MachineEventPubSub;
```

### StateLogger is a per-state factory function, not a Service (Task 06)

`createStateLoggerFactory()` is a plain function — NOT an Effect Service with Tag/Layer. It creates a mutable collector that the runner reads after each action via `loggerFactory.getEntries()`.

**Impact on `log_entry` events:** Log entries are collected **after** the action completes (not during). The runner calls `loggerFactory.getEntries()` to get all entries from the action, then publishes them. For truly real-time log streaming, one option is to wrap the `StateLogger` returned by the factory to also publish events immediately:

```typescript
// In the runner, wrap the logger to intercept calls:
const rawLogger = loggerFactory.create(instanceId, currentState);
const logger: StateLogger = {
  debug: (msg, data?) =>
    rawLogger
      .debug(msg, data)
      .pipe(Effect.tap(() => pubsub.publish({ type: 'log_entry', instanceId, data: lastEntry }))),
  // ... same for info, warn, error
};
```

Or publish all collected entries in batch after the action, before `transition_recorded`.

### ArtifactStore is returned synchronously from factory (Task 08)

`ArtifactStoreFactory.makeScoped()` returns `ArtifactStore` (not an Effect). To intercept artifact writes for `artifact_created` events, wrap the store:

```typescript
const rawArtifacts = artifactFactory.makeScoped(instanceId, currentState, parentId);
const artifacts: ArtifactStore = {
  ...rawArtifacts,
  write: (name, content, meta?) =>
    rawArtifacts
      .write(name, content, meta)
      .pipe(
        Effect.tap((record) =>
          pubsub.publish({ type: 'artifact_created', instanceId, data: record }),
        ),
      ),
};
```

### Event publishing insertion points in the runner loop (Task 09)

The current loop has clear insertion points for events:

| After this line in the runner                                       | Event to publish            |
| ------------------------------------------------------------------- | --------------------------- |
| After Checkpoint 3 (`store.updateInstance` with new `currentState`) | `state_changed`             |
| After recording `transitionRecord` in history                       | `transition_recorded`       |
| After `loggerFactory.getEntries()` collection                       | `log_entry` (one per entry) |
| After terminal state resolution (Checkpoint 4)                      | `machine_completed`         |
| After artifact write (wrapped store)                                | `artifact_created`          |

---

## Steps

### 1. Create the PubSub Layer

```typescript
// server/src/machines/EventPubSub.ts
import { Context, Effect, Layer, PubSub } from 'effect';

const MachineEventPubSub = Context.GenericTag<PubSub.PubSub<MachineEvent>>('MachineEventPubSub');

export const MachineEventPubSubLive = Layer.effect(
  MachineEventPubSub,
  PubSub.unbounded<MachineEvent>(),
);
```

### 2. Add `MachineEventPubSub` as a runner dependency

The runner takes the PubSub from the Effect context and publishes events at each point.

### 3. Publish events at each stage

Integrate `PubSub.publish` calls into the state loop:

| Runner Point                        | Event Type            | Data                                                      |
| ----------------------------------- | --------------------- | --------------------------------------------------------- |
| After transitioning to a new state  | `state_changed`       | `previousState`, `currentState`, `stateData`, `timestamp` |
| After recording a transition        | `transition_recorded` | Full `TransitionRecord`                                   |
| When action writes a log entry      | `log_entry`           | `LogEntry`                                                |
| When machine reaches terminal state | `machine_completed`   | `MachineResult`                                           |
| When single child is spawned        | `child_spawned`       | `childInstanceId`, `childDefinitionId`                    |
| When single child completes         | `child_completed`     | `childInstanceId`, child `MachineResult`                  |
| When parallel children are spawned  | `children_spawned`    | `childInstanceIds` (keyed)                                |
| When all parallel children complete | `children_completed`  | `results` (keyed)                                         |
| When action writes an artifact      | `artifact_created`    | `ArtifactRecord`                                          |
| When suspended instance is resumed  | `machine_resumed`     | `previousState`, `resumedState`, `timestamp`              |

### 4. Event ordering guarantees

For a single instance:

- `state_changed` is published before `transition_recorded` for the same transition
- `log_entry` events from an action are published before the `transition_recorded` for that action's state
- `child_spawned` before `child_completed` for the same child
- `children_spawned` before `children_completed`

### 5. Hook artifact writes into event publishing

When `ArtifactStore.write()` is called within an action, the resulting `ArtifactRecord` should also be published as an `artifact_created` event. This can be done by:

- Having the runner wrap the artifact store to intercept writes
- Or passing the PubSub to the artifact store factory

### 6. Subscribe API

Expose a subscription method for consumers (WebSocket manager):

```typescript
// The WebSocket manager subscribes to the PubSub
const subscription = yield * PubSub.subscribe(machineEventPubSub);
// Then filters events by subscribed instance IDs
```

---

## Behavior Spec Coverage

- §16.2 — All 10 event types: `state_changed`, `transition_recorded`, `log_entry`, `machine_completed`, `child_spawned`, `child_completed`, `children_spawned`, `children_completed`, `artifact_created`, `machine_resumed`
- §16.3 — Event ordering: `state_changed` before `transition_recorded`; log entries before `transition_recorded`
- §6.1 — `machine_completed` event with `status: 'error'` on action failure
- §11.1 — `machine_completed` event with `status: 'cancelled'` on cancel

---

## Validation Checklist

- [ ] `server/src/machines/EventPubSub.ts` creates PubSub Layer
- [ ] Runner publishes all 10 event types at correct points
- [ ] Event ordering is correct (state_changed before transition_recorded)
- [ ] Log entries published before transition_recorded
- [ ] Artifact writes trigger `artifact_created` events
- [ ] PubSub is a runner dependency (injected via Layer)
- [ ] Subscription API works for consumers
- [ ] `pnpm --filter @aiflow/server run build` succeeds
