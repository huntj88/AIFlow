# Task 32 — Integration Wiring & Polish

> **Phase**: 6 (Polish & Integration)
> **Depends on**: All Phase 1–5 tasks (01–30)
> **Blocks**: Task 33 (E2E tests)

---

## Objective

Wire together all client and server components into a cohesive, polished experience. This task covers the end-to-end user flows, error boundaries, loading states, toast notifications, and final navigation glue that connects the dashboard, editor, and viewer.

---

## Implementation Notes from Completed Tasks

> These details emerged from Tasks 01–22.1 and from the existing client scaffold.

1. **HashRouter** — Client uses `HashRouter`. All URLs are hash-based: `/#/machines`, `/#/machines/instances/:id`, etc. Navigation helpers should generate paths without the `#` prefix (react-router handles it).
2. **AppLayout.tsx** — Current layout has a `<header>` with app title ("AIFlow") + theme toggle button, then `<main className="p-6"><Outlet /></main>`. **No navigation links exist yet** — Task 29 adds them. Integration polish may need to refine nav styling.
3. **i18n flat key format** — Keys like `"machines.toast.definitionSaved": "Definition saved successfully"`. Existing keys: `app.title`, `nav.home`, `home.heading`, `home.hello_button`, `home.response_label`, `theme.toggle`. **Do NOT use nested JSON objects.**
4. **Zustand pattern** — `useThemeStore.ts` uses `create<T>()(...)` with optional `persist`. The toast store (Step 7) should follow the same pattern.
5. **Tailwind + CSS custom properties** — Use `var(--color-bg)`, `var(--color-text)`, `var(--color-surface)`, `var(--color-border)` for theming. Skeleton elements use `animate-pulse`.
6. **Server API error responses** — API error responses do NOT include `_tag` in the JSON body. They use:
   - 400: `{ message, details[] }` (validation) or `{ message, path? }` (schema)
   - 404: `{ message: "<Entity> not found", id }` (e.g., "Definition not found")
   - 409: `{ message, details[] }` (conflict — cancel/resume)
   - 500: `{ message }` or `{ message, cause? }`
     Error boundaries and toast messages should handle these shapes directly.
7. **Server API patterns** — Instance creation returns 201 with the **full `MachineInstance` object** (not just an ID). Cancel returns `{ message: 'Instance cancelled' }`. Resume returns `{ message: 'Instance resuming' }`.
8. **Vite proxy** — `/api` is proxied to `http://localhost:3001`. WebSocket proxy may need to be added in Task 25 for `/api/machines/live`.

---

## Steps

### 1. Launch instance → redirect to viewer

Wire the "Launch" / "Start" button on the dashboard:

1. Dashboard "Start" button calls `POST /api/machines/instances` via `machineApi.startInstance()`
2. On `201` response, extract the instance ID from the response body
3. Navigate to `/machines/instances/:id` using `machineRoutes.viewInstance(id)`
4. Instance viewer page begins polling/subscribing to updates for that instance

### 2. Definition editor → dashboard flow

- After saving a **new** definition: redirect to edit URL with the returned definition ID
- After saving an **existing** definition: stay on page, show success toast
- "Back to Dashboard" button/breadcrumb on editor page
- "Delete" button on editor: confirm dialog → delete via API → redirect to dashboard

### 3. Child machine navigation

In the Instance Viewer's ChildMachineTree component (Task 28):

- Each child entry is a clickable link
- Clicking navigates to `/machines/instances/:childId`
- The child instance viewer shows a "Parent" breadcrumb linking back to the parent instance
- For deeply nested children, show breadcrumb trail: `Parent > Child > Grandchild`

### 4. Error boundaries

Add React error boundaries around key sections:

```tsx
// client/src/components/common/ErrorBoundary.tsx
// - Catches rendering errors
// - Displays a friendly error message with "Retry" button
// - Logs error to console (and optionally to a logging service)

// Usage:
<ErrorBoundary fallback={<ErrorPanel />}>
  <MachineInstancePage />
</ErrorBoundary>
```

Wrap each machine page in an error boundary:

- `MachinesPage` (dashboard)
- `MachineDefinitionPage` (editor)
- `MachineInstancePage` (viewer)

### 5. Loading states & skeletons

Add loading skeletons for:

- Dashboard definition list (skeleton cards/rows)
- Dashboard instance list (skeleton table rows)
- Instance viewer header (skeleton text blocks)
- Instance viewer state diagram (spinner or skeleton canvas)
- Definition editor while fetching existing definition

Use Tailwind's `animate-pulse` for skeleton elements.

### 6. Empty states

Add empty state illustrations/messages for:

- No definitions exist yet → "Create your first state machine" with CTA button
- No instances exist yet → "Start an instance from the dashboard"
- No logs for selected state → "No log entries"
- No artifacts → "No artifacts produced"
- No children → "This instance has no child machines"

### 7. Toast notification system

Create or integrate a toast system:

```typescript
// client/src/hooks/useToast.ts
// Zustand store for toast notifications
interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  duration?: number; // auto-dismiss ms, default 5000
}
```

Show toasts for:

- Definition saved successfully
- Definition deleted
- Instance started
- Instance cancelled
- Instance resumed
- API errors (generic error toast with message)
- WebSocket connection lost / reconnected

Render toasts in a fixed position (e.g., bottom-right) in `AppLayout.tsx`.

### 8. WebSocket connection status indicator

Add a small indicator in the app header/footer showing WebSocket status:

- 🟢 Connected
- 🟡 Reconnecting...
- 🔴 Disconnected

Use the `useMachineSocket` hook's connection state.

### 9. Responsive layout adjustments

Ensure machine pages work at reasonable viewport widths:

- Dashboard: table switches to card layout on narrow screens
- Instance viewer: panels stack vertically on narrow screens
- Editor: config panel becomes a bottom sheet or overlay on narrow screens

### 10. Keyboard shortcuts

Add keyboard shortcuts for the definition editor:

- `Ctrl+S` / `Cmd+S` — Save
- `Ctrl+Z` / `Cmd+Z` — Undo
- `Ctrl+Shift+Z` / `Cmd+Shift+Z` — Redo
- `Delete` / `Backspace` — Delete selected node/edge
- `Escape` — Deselect

Register shortcuts via `useEffect` with `keydown` listeners; clean up on unmount.

### 11. Confirm dialogs

Add confirmation dialogs for destructive actions:

- Delete a definition
- Cancel a running instance
- Navigate away from editor with unsaved changes
- Delete a state node in the editor (if it has transitions)

### 12. i18n additions

Ensure all new UI text uses i18n keys. Add any missing keys:

```json
{
  "machines.toast.definitionSaved": "Definition saved successfully",
  "machines.toast.definitionDeleted": "Definition deleted",
  "machines.toast.instanceStarted": "Instance started",
  "machines.toast.instanceCancelled": "Instance cancelled",
  "machines.toast.instanceResumed": "Instance resumed",
  "machines.toast.error": "An error occurred: {{message}}",
  "machines.confirm.deleteDefinition": "Are you sure you want to delete this definition?",
  "machines.confirm.cancelInstance": "Are you sure you want to cancel this instance?",
  "machines.confirm.unsavedChanges": "You have unsaved changes. Discard?",
  "machines.empty.noDefinitions": "No definitions yet",
  "machines.empty.noInstances": "No instances yet",
  "machines.empty.noLogs": "No log entries",
  "machines.empty.noArtifacts": "No artifacts",
  "machines.empty.noChildren": "No child machines",
  "machines.websocket.connected": "Live updates active",
  "machines.websocket.reconnecting": "Reconnecting...",
  "machines.websocket.disconnected": "Live updates disconnected"
}
```

> **Note:** Flat key format per project convention — see Implementation Notes above.

---

## Behavior Spec Coverage

- **§17.1** — Click "Create New" → navigates to editor
- **§17.2** — Click "Edit" → opens editor pre-populated
- **§17.3** — "Start" launches and redirects to instance viewer
- **§17.4** — Instance list rows clickable → navigate to viewer
- **§18.4** — Child machine tree: click navigates to child instance
- **§20.1** — Create → Run → View → Complete (full flow)
- **§20.2** — Create → Run → Cancel (cancel flow)
- **§20.3** — Parent-child composition flow (navigation between parent/child)
- **§20.5** — Suspend → Resume (resume button flow)
- **§20.6** — Artifacts workflow (view artifacts in viewer)
- **§20.7** — Definition editing round-trip

---

## Validation Checklist

- [x] Launch instance from dashboard → redirects to viewer
- [x] Save new definition → redirects to edit URL with ID
- [x] Delete definition → redirects to dashboard
- [x] Child machine links navigate correctly
- [x] Parent breadcrumb works in child instance viewer
- [x] Error boundaries catch and display errors gracefully
- [x] Loading skeletons shown during data fetching
- [x] Empty states shown when no data exists
- [x] Toast notifications appear for all actions
- [x] WebSocket status indicator reflects connection state
- [x] Keyboard shortcuts work in editor
- [x] Confirm dialogs shown for destructive actions
- [x] All UI text uses i18n keys
- [x] `pnpm --filter @aiflow/client run build` succeeds
- [x] `pnpm --filter @aiflow/client run test` passes
