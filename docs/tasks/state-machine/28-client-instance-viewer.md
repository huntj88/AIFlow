# Task 28 — Client Instance Viewer

> **Phase**: 4 (Client Viewer)
> **Depends on**: Task 26 (state management), Task 25 (WebSocket client)
> **Blocks**: Task 32 (integration & polish)

---

## Objective

Build the machine instance viewer page — the primary page for observing and interacting with a running or completed machine instance. Includes: state diagram with live highlighting, transition history, logs panel, child machine tree, and artifacts panel. All panels update in real time via WebSocket.

**New client dependencies**: `@xyflow/react` (React Flow v12), `dagre` or `elkjs` (graph layout), `@types/dagre`.

---

## Implementation Notes from Completed Tasks

> These details emerged from the existing client codebase.

- **Layout**: Uses Tailwind CSS with custom properties (`var(--color-bg)`, `var(--color-text)`, `var(--color-surface)`, `var(--color-border)`). The page renders inside `AppLayout`'s `<Outlet />` with `p-6` padding.
- **Router**: `HashRouter` from `react-router`. Instance page URL: `#/machines/instances/:id`. Use `useParams()` to extract `id`.
- **Component convention**: Machine components should go in `client/src/components/machines/`.
- **WebSocket events**: `MachineEvent` uses `type` as discriminant (not `_tag`). Route events to panels by `type`: `state_changed` → diagram, `transition_recorded` → history, `log_entry` → logs, etc.
- **i18n flat keys**: Use flat key format like `"machines.instance.title": "Instance Viewer"` in `client/src/locales/en/common.json`.
- **AppLayout header**: Currently has NO nav links — just title + theme toggle. Navigation links are added in Task 29.

### State diagram data comes from the definition

The instance viewer needs BOTH the `MachineInstance` (for current state, history, etc.) AND the `StateMachineDefinition` (for the full state graph). The `MachineInstance` has `definitionId` but does NOT embed the definition. You must:

1. Fetch the instance: `GET /instances/:id`
2. Fetch the definition: `GET /definitions/:instanceDefinitionId`
3. Render the diagram from the definition's `states` and `transitions`
4. Overlay the current state highlight from the instance's `currentState`

**Edge case**: If the definition was deleted after the instance completed, the definition fetch will 404. Handle this gracefully (show "Definition unavailable" warning but still display instance data).

### Artifact download returns binary

The `GET /instances/:id/artifacts/:name` endpoint returns raw binary content with the appropriate `Content-Type` header (from `ArtifactRecord.contentType`). The client must handle this differently from JSON endpoints — use `response.blob()` or `response.arrayBuffer()` and trigger a browser download.

---

## Steps

### 1. Install dependencies

```bash
cd client && pnpm add @xyflow/react dagre && pnpm add -D @types/dagre
```

### 2. Create `client/src/pages/MachineInstancePage.tsx`

Main instance viewer page with:

- Header: definition name, instance ID, status badge, cancel button (if running)
- Tab or panel layout for: Diagram, History, Logs, Children, Artifacts
- On mount: fetch instance data via REST, then subscribe to WebSocket for live updates

### 3. Create `client/src/components/machines/StateDiagram.tsx`

State diagram using React Flow (`@xyflow/react`):

- **Nodes**: Each state in the definition becomes a node
  - Use dagre/elkjs for automatic layout (left-to-right or top-to-bottom)
  - Terminal states (`completed`, `cancelled`, `error`) visually distinct (different shape/color)
  - Action states as rounded rectangles
  - `child_machine` and `parallel_children` states with special icons/borders
- **Edges**: Each `TransitionRule` becomes a directed edge
  - Label with `label` from the rule (if provided)
- **Current state highlighting**: The node matching `instance.currentState` has a distinct color/border (e.g., pulsing blue border)
- **Live updates**: When `state_changed` WebSocket event arrives, move the highlight to the new current state
- **Completed path**: Optionally dim states that have been visited or highlight the path taken

### 4. Create `client/src/components/machines/TransitionHistory.tsx`

Table/timeline of completed transitions:

- Columns: From → To, Action ID, Duration (ms), Timestamp
- Each row expandable to show transition `data` (stateData carried)
- Sorted chronologically (oldest first)
- **Live updates**: New transitions appear in real time via `transition_recorded` event

### 5. Create `client/src/components/machines/LogViewer.tsx`

Filterable log panel:

- Display all log entries: timestamp, state, level, message, data
- **Filter by state**: Dropdown of all states in the definition
- **Filter by level**: Checkboxes/toggles for debug, info, warn, error
- Level-based color coding (error = red, warn = yellow, info = blue, debug = gray)
- **Live updates**: New entries appear in real time via `log_entry` event
- Auto-scroll to latest entry option

### 6. Create `client/src/components/machines/ChildMachineTree.tsx`

Tree view of parent-child hierarchy:

- Show the parent instance as the root
- If the instance spawned children, show them as branches
- Parallel children grouped under their parent state
- Each tree node shows: definition name, status badge, instance ID
- **Clicking a child** navigates to that child's instance viewer page
- **Live updates**: Tree updates when `child_spawned` / `child_completed` events arrive

### 7. Create `client/src/components/machines/ArtifactViewer.tsx`

File-explorer-style artifact tree:

- Fetch artifact tree via `GET /instances/:id/artifacts?tree=true`
- Mirror the instance hierarchy: parent files, then child folders
- Each artifact row shows: name, state, size, created timestamp
- **Click to download** (or preview for text/images)
- Tree expandable/collapsible per child instance level
- **Live updates**: New artifacts appear via `artifact_created` event

### 8. Wire WebSocket subscriptions

On page mount:

```typescript
const { subscribeToInstance, handleEvent } = useMachineInstances();
useEffect(() => {
  const unsub = subscribeToInstance(instanceId);
  return unsub;
}, [instanceId]);
```

Route WebSocket events to appropriate panels:

- `state_changed` → StateDiagram highlight update
- `transition_recorded` → TransitionHistory append
- `log_entry` → LogViewer append
- `machine_completed` → Status badge update, diagram final state
- `child_spawned` / `child_completed` → ChildMachineTree update
- `children_spawned` / `children_completed` → ChildMachineTree update
- `artifact_created` → ArtifactViewer update

---

## Behavior Spec Coverage

### §18.1 — State Diagram

- [x] Instance page renders state diagram from definition
- [x] Current state node visually highlighted
- [x] Terminal states visually distinct from action states
- [x] Transitions labeled from definition
- [x] Highlighted node updates in real time via WebSocket

### §18.2 — Transition History

- [x] History panel shows all completed transitions in chronological order
- [x] Each row: from → to, action ID, duration, timestamp
- [x] Transition data expandable per row
- [x] New transitions appear in real time

### §18.3 — Logs Panel

- [x] Logs panel displays all log entries
- [x] Filterable by state name
- [x] Filterable by level (debug, info, warn, error)
- [x] New entries appear in real time via WebSocket
- [x] Entries show timestamp, state, level, message, data

### §18.4 — Child Machine Tree

- [x] Tree view shows parent → child hierarchy
- [x] Clicking child navigates to child's viewer page
- [x] Parallel children grouped under parent state
- [x] Tree updates live on child spawn/complete

### §18.5 — Artifacts Panel

- [x] File-explorer-style tree of all artifacts
- [x] Mirrors instance hierarchy (parent files, child folders)
- [x] Click to download/preview
- [x] New artifacts appear via WebSocket events
- [x] Tree expandable/collapsible per child level

---

## Validation Checklist

- [x] `@xyflow/react` and `dagre` added to client dependencies
- [x] `MachineInstancePage.tsx` renders with all panels
- [x] State diagram renders from definition with correct nodes and edges
- [x] Current state highlighted; updates on state_changed events
- [x] Transition history table with expandable data
- [x] Log viewer with state and level filtering
- [x] Child machine tree with navigation
- [x] Artifact viewer with download and tree structure
- [x] All panels update in real time via WebSocket
- [x] `pnpm --filter @aiflow/client run build` succeeds
