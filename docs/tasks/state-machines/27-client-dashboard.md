# Task 27 — Client Dashboard Page

> **Phase**: 4 (Client Viewer)
> **Depends on**: Task 26 (state management)
> **Blocks**: Task 32 (integration & polish)

---

## Objective

Build the machines dashboard page — the primary landing page for the state machine feature. It displays all saved definitions, recent/running/suspended instances, and provides controls for creating, editing, deleting definitions, resuming instances, and launching new instances.

---

## Implementation Notes from Completed Tasks

> These details emerged from the existing client codebase.

### Page convention

Existing pages live at `client/src/pages/` (e.g., `HomePage.tsx` with `HomePage.test.tsx`). Follow the same pattern.

### Layout & styling

- Uses **Tailwind CSS** with CSS custom properties (`var(--color-bg)`, `var(--color-text)`, `var(--color-surface)`, `var(--color-border)`).
- `AppLayout` provides a header with title ("AIFlow") and theme toggle button, and a `<main className="p-6">` wrapping `<Outlet />`.
- Pages render inside the Outlet.
- The header currently has NO navigation links — just the title and theme toggle. Task 29 adds a nav link.

### Instance statuses (6 total, confirmed from types.ts)

The `MachineInstance.status` field can be:

- `'running'` — actively executing
- `'completed'` — reached completed terminal
- `'cancelled'` — cancelled by user or parent
- `'error'` — reached error terminal
- `'waiting_for_child'` — suspended waiting for child machine(s)
- `'suspended'` — paused by graceful shutdown

All 6 statuses should have distinct badge colors in the instance list.

### i18n

- Uses `react-i18next` with `useTranslation()` hook.
- Translation file: `client/src/locales/en/common.json` (flat key format: `"machines.dashboard.title": "State Machines"`).
- Existing keys in the file: `app.title`, `nav.home`, `home.heading`, `home.hello_button`, `home.response_label`, `theme.toggle`.
- Add all machine-related translations to this file using the same flat key format.
- **Do NOT use nested JSON objects** — every key must be dot-delimited at the top level.

### Router

- Uses `HashRouter` from `react-router` — URLs are hash-based (e.g., `#/machines`).
- Routes defined in `client/src/app/router/routes.ts` (`ROUTES` const object).
- New routes added in `client/src/app/router/AppRouter.tsx`.

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
  "machines.dashboard.title": "State Machines",
  "machines.definitions.title": "Definitions",
  "machines.definitions.create": "Create New",
  "machines.instances.title": "Instances",
  "machines.instances.start": "Launch"
}
```

Note: The existing file uses flat key format (not nested JSON objects).

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
