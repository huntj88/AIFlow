# Task 27 — Client Dashboard Page

> **Phase**: 4 (Client Viewer)
> **Depends on**: Task 26 (state management)
> **Blocks**: Task 32 (integration & polish)

---

## Objective

Build the machines dashboard page — the primary landing page for the state machine feature. It displays all saved definitions, recent/running/suspended instances, and provides controls for creating, editing, deleting definitions, resuming instances, and launching new instances.

---

## Steps

### 1. Create `client/src/pages/MachinesPage.tsx`

The main dashboard with two sections:

#### Definitions Section

- List all saved definitions in a table/card layout
- Each definition shows: **name**, **version**, **description**, **tags**
- **"Create New"** button → navigates to the definition editor with a blank definition
- **"Edit"** action per definition → navigates to the definition editor pre-populated
- **"Delete"** action per definition → confirmation dialog → calls `deleteDefinition` → refreshes list

#### Instances Section

- List recent / running / suspended instances in a table
- Each instance row shows: **definition name**, **status** (with color badges), **current state**, **created timestamp**
- Status filter tabs: All, Running, Suspended, Completed, Error, Cancelled
- **Suspended instances** display a **"Resume"** button that calls `POST /instances/:id/resume` and refreshes
- Clicking an instance row navigates to the instance viewer page

#### Quick Start Control

- Dropdown to select a definition
- JSON textarea for input (with validation feedback)
- **"Launch"** button → calls `startInstance` → redirects to the new instance's viewer page

### 2. Create supporting components

#### `client/src/components/machines/DefinitionCard.tsx` or `DefinitionRow.tsx`

- Displays definition metadata
- Edit and delete action buttons

#### `client/src/components/machines/InstanceRow.tsx`

- Displays instance status with color-coded badge:
  - Running → blue
  - Completed → green
  - Error → red
  - Cancelled → gray
  - Suspended → yellow/amber
  - Waiting for child → purple/blue
- Shows definition name, current state, created time
- Resume button for suspended instances

#### `client/src/components/machines/QuickStartPanel.tsx`

- Definition picker (dropdown populated from definitions store)
- JSON input editor (textarea with validation)
- Launch button

### 3. Data fetching

On page mount:

- Fetch definitions via `useMachineDefinitions().fetchDefinitions()`
- Fetch instances via `useMachineInstances().fetchInstances()`
- Auto-refresh instances periodically or on focus (for status updates)

### 4. Add i18n translations

Add machine-related translations to `client/src/locales/en/common.json`:

```json
{
  "machines": {
    "dashboard": { "title": "State Machines", ... },
    "definitions": { ... },
    "instances": { ... }
  }
}
```

---

## Behavior Spec Coverage

- §17 — Dashboard lists all saved definitions with name, version, description, tags
- §17 — "Create New" navigates to editor with blank definition
- §17 — "Edit" navigates to editor pre-populated
- §17 — "Delete" removes definition with confirmation and refreshes
- §17 — Dashboard lists recent/running/suspended instances
- §17 — Instance row shows: definition name, status, current state, created timestamp
- §17 — Suspended instances show "Resume" button; calls resume API and refreshes
- §17 — Quick Start: select definition, enter JSON input, launch
- §17 — Launching redirects to instance viewer page

---

## Validation Checklist

- [ ] `client/src/pages/MachinesPage.tsx` exists with definitions and instances sections
- [ ] Definition list shows name, version, description, tags
- [ ] Create, edit, delete actions work on definitions
- [ ] Instance list shows status with color badges
- [ ] Status filter tabs work
- [ ] Suspended instances show Resume button
- [ ] Quick Start panel: select definition, input JSON, launch
- [ ] Launch redirects to instance viewer
- [ ] i18n translations added
- [ ] `pnpm --filter @aiflow/client run build` succeeds
