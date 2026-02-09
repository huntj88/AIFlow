# Task 30 — Client Definition Editor

> **Phase**: 5 (Client Editor)
> **Depends on**: Task 24 (client API), Task 26 (client state), Task 29 (routing)
> **Blocks**: Task 32 (integration & polish)

---

## Objective

Build a visual state-machine definition editor using React Flow (`@xyflow/react`). Users can create and edit definitions by dragging states (nodes), connecting transitions (edges), and configuring each state's properties. The editor must support validation, import/export, undo/redo, and dirty tracking.

---

## Implementation Notes from Completed Tasks

> These details emerged from Tasks 01–17 and from the existing client scaffold.

1. **i18n flat key format** — `client/src/locales/en/common.json` uses **flat keys** (e.g. `"machines.editor.title": "Definition Editor"`), NOT nested JSON objects. The i18n examples below (Step 12) show nested JSON; convert to flat keys when implementing.
2. **HashRouter** — Client uses `HashRouter`, so all machine URLs are hash-based (e.g. `http://localhost:5173/#/machines/definitions/new`). Route params work the same way with `useParams()`.
3. **Zustand pattern** — Existing stores (`useThemeStore.ts`) use the `create<T>()(...)` double-invocation pattern. Follow this for `useDefinitionEditor`.
4. **Tailwind + CSS custom properties** — UI uses `var(--color-bg)`, `var(--color-text)`, etc. via Tailwind utility classes. Use these for editor panel theming.
5. **Server types reference** — `StateMachineDefinition`, `StateDefinition`, etc. are defined in `server/src/machines/types.ts`. The client-side validation subset (Step 8) should replicate the relevant logic, not import server code directly.
6. **Server validation rules** — The server's `DefinitionValidator.ts` (669 lines) implements 14 rules with `validateDefinition(def, mode, actionRegistry?)`. The `ValidationViolation` interface has `{ rule: string; message: string; path?: string }`. Mirror this shape for client-side errors.
7. **Error constructors use `mk` prefix** — Server errors use `mkValidationError(...)`, `mkDefinitionError(...)`, etc. API error responses from the server will have `_tag` discriminant fields.

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

Client-side subset of the server's 14 validation rules for immediate feedback. The server's `DefinitionValidator.ts` returns `ValidationViolation` objects with `{ rule: string; message: string; path?: string }`. Mirror this shape on the client.

**Rules to implement** (matching server rule numbering):

- Rule 1: `initialState` must reference an existing key in `states`
- Rule 2: All three required terminal states (`completed`, `cancelled`, `error`) must exist with `type: 'terminal'`
- Rule 3: No transitions may originate FROM a terminal state
- Rule 4: Every `from` and `to` in `transitions[]` must reference an existing state
- Rule 5: Every non-terminal state must have at least one outgoing transition
- Rule 6: No orphan non-terminal states (every non-terminal reachable from `initialState`)
- Rule 7: `StateDefinition.name` must match its key in the `states` record
- Rule 8: `action` states must have an `actionId` (can optionally check against fetched registry — advisory only since registry may change)
- Rule 9: `child_machine` states must have `actionId`, `childMachineDefId`, and `childInputMapping`
- Rule 10: `parallel_children` states must have `actionId` and a non-empty `children[]`
- Rule 11: `terminal` states must NOT have `actionId`, `childMachineDefId`, or `children`
- Rule 14: All `key` values within a `parallel_children` state's `children[]` must be unique

**Rules NOT to implement on the client** (require server-side data):

- Rule 12: Cycle detection through `childMachineDefId` references (requires loading other definitions)
- Rule 13: JSON Schema structural validation (requires `ajv`)

Return structured errors with `{ rule: string; stateName?: string; message: string; severity: 'error' | 'warning' }`.

**Note**: The server validates in `'save'` mode when POST/PUT — it constructs a temporary full `StateMachineDefinition` (with placeholder `id`/`version`/`metadata`) and runs `validateDefinition()`. The server returns 400 with `{ message, details[] }` where `details` is an array of violation message strings. Surface these in the editor when the server rejects a save.

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
  "machines.editor.title": "Definition Editor",
  "machines.editor.newTitle": "New Definition",
  "machines.editor.save": "Save",
  "machines.editor.validate": "Validate",
  "machines.editor.import": "Import JSON",
  "machines.editor.export": "Export JSON",
  "machines.editor.undo": "Undo",
  "machines.editor.redo": "Redo",
  "machines.editor.addState": "Add State",
  "machines.editor.deleteState": "Delete State",
  "machines.editor.stateConfig": "State Configuration",
  "machines.editor.metaConfig": "Definition Settings",
  "machines.editor.unsavedChanges": "You have unsaved changes. Are you sure you want to leave?",
  "machines.editor.validationPassed": "Definition is valid",
  "machines.editor.validationFailed": "{{count}} validation error(s) found"
}
```

> **Note:** Flat key format per project convention — see Implementation Notes above.

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
