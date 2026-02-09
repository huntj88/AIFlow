# Task 32 — Integration Wiring & Polish

> **Phase**: 6 (Polish & Integration)
> **Depends on**: All Phase 1–5 tasks (01–30)
> **Blocks**: Task 33 (E2E tests)

---

## Objective

Wire together all client and server components into a cohesive, polished experience. This task covers the end-to-end user flows, error boundaries, loading states, toast notifications, and final navigation glue that connects the dashboard, editor, and viewer.

---

## Implementation Notes from Completed Tasks

> These details emerged from Tasks 01–05 and from the existing client scaffold.

1. **HashRouter** — Client uses `HashRouter`. All URLs are hash-based: `/#/machines`, `/#/machines/instances/:id`, etc. Navigation helpers should generate paths without the `#` prefix (react-router handles it).
2. **AppLayout.tsx** — Current layout has a `<header>` with app title + theme toggle, then `<Outlet />`. Nav links (Step 3 child machine navigation, Step 1 redirect) should integrate with this layout.
3. **i18n flat key format** — Keys like `"machines.toast.definitionSaved": "Definition saved successfully"`. The nested JSON examples in Step 12 below need to be converted to flat keys.
4. **Zustand pattern** — `useThemeStore.ts` uses `create<T>()(...)` with optional `persist`. The toast store (Step 7) should follow the same pattern.
5. **Tailwind + CSS custom properties** — Use `var(--color-bg)`, `var(--color-text)`, etc. for theming. Skeleton elements use `animate-pulse`.
6. **Error constructors in server** — API error responses from server use `_tag` discriminant: `ActionError`, `ValidationError`, `StoreError`, `NotFoundError`, `DefinitionError`. Error boundaries and toast messages should handle these tags.
7. **Server API patterns** — API routes return JSON with appropriate HTTP status codes. Instance creation returns 201 with the full instance object (including `id`). Not-found returns 404 with `_tag: 'NotFoundError'`.

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

- [ ] Launch instance from dashboard → redirects to viewer
- [ ] Save new definition → redirects to edit URL with ID
- [ ] Delete definition → redirects to dashboard
- [ ] Child machine links navigate correctly
- [ ] Parent breadcrumb works in child instance viewer
- [ ] Error boundaries catch and display errors gracefully
- [ ] Loading skeletons shown during data fetching
- [ ] Empty states shown when no data exists
- [ ] Toast notifications appear for all actions
- [ ] WebSocket status indicator reflects connection state
- [ ] Keyboard shortcuts work in editor
- [ ] Confirm dialogs shown for destructive actions
- [ ] All UI text uses i18n keys
- [ ] `pnpm --filter @aiflow/client run build` succeeds
- [ ] `pnpm --filter @aiflow/client run test` passes
