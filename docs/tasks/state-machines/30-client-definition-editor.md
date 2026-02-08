# Task 30 — Client Definition Editor

> **Phase**: 5 (Client Editor)
> **Depends on**: Task 24 (client API), Task 26 (client state), Task 29 (routing)
> **Blocks**: Task 32 (integration & polish)

---

## Objective

Build a visual state-machine definition editor using React Flow (`@xyflow/react`). Users can create and edit definitions by dragging states (nodes), connecting transitions (edges), and configuring each state's properties. The editor must support validation, import/export, undo/redo, and dirty tracking.

---

## New Dependencies

```bash
# @xyflow/react already added in Task 28 (instance viewer)
# dagre already added in Task 28
# No additional deps needed beyond what Task 28 introduced
```

---

## Steps

### 1. Editor page wrapper

Create `client/src/pages/MachineDefinitionPage.tsx`:

- Read route param `:id` — if `"new"`, start blank; otherwise fetch existing definition
- Render the `DefinitionEditor` component
- Show loading state while fetching

### 2. Editor state hook — `useDefinitionEditor.ts`

Create `client/src/hooks/useDefinitionEditor.ts` (Zustand store or useReducer):

```typescript
interface DefinitionEditorState {
  // Current state
  definition: Partial<StateMachineDefinition>;
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  isDirty: boolean;
  validationErrors: ValidationError[];

  // Undo/Redo
  undoStack: EditorSnapshot[];
  redoStack: EditorSnapshot[];

  // Actions
  addState: (state: Partial<StateDefinition>) => void;
  removeState: (stateName: string) => void;
  updateState: (stateName: string, patch: Partial<StateDefinition>) => void;
  addTransition: (from: string, to: string, condition?: string) => void;
  removeTransition: (edgeId: string) => void;
  setInitialState: (stateName: string) => void;

  // Definition-level
  setName: (name: string) => void;
  setDescription: (description: string) => void;
  setInputSchema: (schema: object) => void;
  setMaxDepth: (depth: number) => void;
  setTimeout: (ms: number) => void;
  setMiddleware: (middleware: string[]) => void;

  // Undo/Redo
  undo: () => void;
  redo: () => void;
  pushSnapshot: () => void;

  // I/O
  loadDefinition: (def: StateMachineDefinition) => void;
  toDefinition: () => StateMachineDefinition;
  validate: () => ValidationError[];
  reset: () => void;
}
```

**Undo/redo** — snapshot the `{ definition, nodes, edges }` tuple before each mutation. Cap at ~50 entries. Clear redo stack on new mutation.

### 3. Main editor component — `DefinitionEditor.tsx`

Create `client/src/components/machines/editor/DefinitionEditor.tsx`:

```tsx
// Layout:
// ┌──────────────────────────────────────────────┬──────────────┐
// │                                              │              │
// │          React Flow Canvas                   │  Config      │
// │          (states as nodes,                   │  Panel       │
// │           transitions as edges)              │  (right)     │
// │                                              │              │
// ├──────────────────────────────────────────────┴──────────────┤
// │  Toolbar: Save | Validate | Import | Export | Undo | Redo   │
// │  Validation Errors (if any)                                 │
// └─────────────────────────────────────────────────────────────┘
```

- Use `@xyflow/react` `<ReactFlow>` with custom node & edge types
- Toolbar with: Save, Validate, Import JSON, Export JSON, Undo, Redo
- Validation error banner at bottom (dismissible)

### 4. Custom node — `StateNode.tsx`

Create `client/src/components/machines/editor/StateNode.tsx`:

Custom node types for each state type:

- **`action`** — colored header, show action name, badge for timeout
- **`child_machine`** — distinct color, show linked definition name
- **`parallel_children`** — show parallel child count, mode badge
- **Initial state** — bold border or marker dot
- **Terminal states** — double border (success/error colors differ)

Each node shows:

- State name (editable inline via double-click)
- State type icon/badge
- Connection handles for transitions (source at bottom/right, target at top/left)

### 5. Custom edge — `TransitionEdge.tsx`

Create `client/src/components/machines/editor/TransitionEdge.tsx`:

- Default transitions: solid line
- Conditional transitions: dashed line with condition label
- Edge labels show the transition trigger (action result key → target)
- Deletable via edge click + Delete key or context menu

### 6. State configuration panel — `StateConfigPanel.tsx`

Create `client/src/components/machines/editor/StateConfigPanel.tsx`:

Right-side panel that appears when a state node is selected:

- **Name** — text input (validates uniqueness)
- **Type** — dropdown: `action`, `child_machine`, `parallel_children`
- **Action** — dropdown populated from Action Registry API (for `action` type)
- **Timeout** — optional number input (ms)
- **Transitions** — list of outgoing transitions, each with:
  - Target state (dropdown of existing state names)
  - Condition key (text, optional)
- **Child Machine Config** — shown when type is `child_machine`:
  - Definition ID dropdown (fetched from API)
  - Input mapping (JSONPath expression input)
  - Output result key
- **Parallel Children Config** — shown when type is `parallel_children`:
  - Children array (add/remove child entries)
  - Parallel mode: `all_or_interrupt` | `all_settled`
- **Is Initial State** — toggle/checkbox

### 7. Definition metadata panel — `DefinitionMetaPanel.tsx`

Create `client/src/components/machines/editor/DefinitionMetaPanel.tsx`:

Shown when no node is selected, or as a collapsible top section:

- Name (required text input)
- Description (textarea)
- Input Schema (JSON editor/textarea with validation)
- Timeout (ms, optional)
- Max Depth (number, optional)
- Middleware (multi-select from available middleware list)

### 8. Client-side validation — `definitionValidator.ts`

Create `client/src/utils/definitionValidator.ts`:

Client-side subset of the server's 14 validation rules for immediate feedback:

- Rule 1: Unique state names
- Rule 2: Initial state exists
- Rule 3: At least one terminal state
- Rule 4: All transition targets reference existing states
- Rule 5: No orphan states (unreachable from initial)
- Rule 6: Terminal states have no outgoing transitions
- Rule 9: `action` states reference a known action (check against fetched registry)
- Rule 12: No cycles through only `child_machine` states (advisory warning)

Return structured errors with `{ rule, stateName?, message, severity: 'error' | 'warning' }`.

### 9. Import / Export

**Export:**

- Serialize current editor state → `StateMachineDefinition` JSON
- Trigger browser download as `.json` file
- Strip internal editor metadata (node positions, etc.)

**Import:**

- Accept `.json` file upload
- Parse and validate basic structure
- Convert to nodes/edges using dagre auto-layout
- Prompt user if current editor has unsaved changes

### 10. Dirty tracking & unsaved changes

- Track `isDirty` flag — set on any mutation, clear on save/load
- Browser `beforeunload` event handler when dirty
- Route navigation guard (prompt "Unsaved changes, are you sure?")

### 11. Save flow

- **Create** (new definition): POST to definitions API → on success, redirect to edit URL with returned ID
- **Update** (existing): PUT to definitions API → on success, clear dirty flag, show success toast
- Surface server-side validation errors in the validation panel

### 12. i18n translations

Add to `client/src/locales/en/common.json`:

```json
{
  "machines": {
    "editor": {
      "title": "Definition Editor",
      "newTitle": "New Definition",
      "save": "Save",
      "validate": "Validate",
      "import": "Import JSON",
      "export": "Export JSON",
      "undo": "Undo",
      "redo": "Redo",
      "addState": "Add State",
      "deleteState": "Delete State",
      "stateConfig": "State Configuration",
      "metaConfig": "Definition Settings",
      "unsavedChanges": "You have unsaved changes. Are you sure you want to leave?",
      "validationPassed": "Definition is valid",
      "validationFailed": "{{count}} validation error(s) found"
    }
  }
}
```

---

## File Summary

| File                                                 | Purpose                        |
| ---------------------------------------------------- | ------------------------------ |
| `pages/MachineDefinitionPage.tsx`                    | Page wrapper with route params |
| `hooks/useDefinitionEditor.ts`                       | Editor state with undo/redo    |
| `components/machines/editor/DefinitionEditor.tsx`    | Main editor layout             |
| `components/machines/editor/StateNode.tsx`           | Custom React Flow node         |
| `components/machines/editor/TransitionEdge.tsx`      | Custom React Flow edge         |
| `components/machines/editor/StateConfigPanel.tsx`    | State config sidebar           |
| `components/machines/editor/DefinitionMetaPanel.tsx` | Definition-level settings      |
| `utils/definitionValidator.ts`                       | Client-side validation         |

---

## Behavior Spec Coverage

- **§19.1** — Add/remove/rename state nodes on a visual canvas
- **§19.2** — Configure action, type, timeout, transitions per state
- **§19.3** — Client validates definition (subset of 14 rules) before save
- **§19.4** — Import/export JSON
- **§19.5** — Undo/redo with full state snapshots
- **§19.6** — Dirty flag, beforeunload prompt, navigation guard
- **§2** — Server-side validation errors surfaced in editor

---

## Validation Checklist

- [ ] New definition can be created from blank canvas
- [ ] Existing definition loads into editor with correct node positions
- [ ] States can be added, removed, renamed
- [ ] Transitions can be drawn between states
- [ ] State config panel shows correct fields per state type
- [ ] Client-side validation runs and shows errors/warnings
- [ ] Import/export JSON works round-trip
- [ ] Undo/redo works across all mutations
- [ ] Dirty tracking prevents accidental navigation
- [ ] Save creates or updates via API
- [ ] Server validation errors are displayed
- [ ] i18n keys used for all UI text
- [ ] `pnpm --filter @aiflow/client run build` succeeds
- [ ] `pnpm --filter @aiflow/client run test` passes
