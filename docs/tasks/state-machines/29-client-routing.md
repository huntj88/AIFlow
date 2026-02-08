# Task 29 — Client Routing & Navigation

> **Phase**: 4 (Client Viewer)
> **Depends on**: Task 27 (dashboard), Task 28 (instance viewer)
> **Blocks**: Task 30 (definition editor), Task 32 (integration)

---

## Objective

Add machine-related routes to the client router and integrate them into the app navigation. Update the existing `routes.ts`, `AppRouter.tsx`, and `AppLayout.tsx` to include machine pages.

---

## Steps

### 1. Update `client/src/app/router/routes.ts`

Add machine route constants:

```typescript
export const ROUTES = {
  HOME: '/',
  MACHINES: '/machines',
  MACHINE_DEFINITION: '/machines/definitions/:id',
  MACHINE_DEFINITION_NEW: '/machines/definitions/new',
  MACHINE_DEFINITION_EDIT: '/machines/definitions/:id/edit',
  MACHINE_INSTANCE: '/machines/instances/:id',
} as const;
```

### 2. Update `client/src/app/router/AppRouter.tsx`

Add route entries for each machine page:

```tsx
<Route path={ROUTES.MACHINES} element={<MachinesPage />} />
<Route path={ROUTES.MACHINE_DEFINITION_NEW} element={<MachineDefinitionPage />} />
<Route path={ROUTES.MACHINE_DEFINITION_EDIT} element={<MachineDefinitionPage />} />
<Route path={ROUTES.MACHINE_INSTANCE} element={<MachineInstancePage />} />
```

Use lazy loading for machine pages to keep the initial bundle small:

```tsx
const MachinesPage = lazy(() => import('@/pages/MachinesPage'));
const MachineDefinitionPage = lazy(() => import('@/pages/MachineDefinitionPage'));
const MachineInstancePage = lazy(() => import('@/pages/MachineInstancePage'));
```

### 3. Update `client/src/app/layout/AppLayout.tsx`

Add navigation link(s) for the machines feature:

- Add "Machines" or "State Machines" link in the nav/sidebar
- Use an appropriate icon
- Active state highlighting when on a machine route

### 4. URL parameter helpers

Create utility functions for generating machine URLs:

```typescript
// client/src/utils/machineRoutes.ts
export const machineRoutes = {
  dashboard: () => '/machines',
  newDefinition: () => '/machines/definitions/new',
  editDefinition: (id: string) => `/machines/definitions/${id}/edit`,
  viewDefinition: (id: string) => `/machines/definitions/${id}`,
  viewInstance: (id: string) => `/machines/instances/${id}`,
};
```

### 5. Navigation flows

Ensure these navigation flows work:

- Home → Machines dashboard
- Dashboard → Create New Definition → Editor
- Dashboard → Edit Definition → Editor (pre-populated)
- Dashboard → Launch Instance → Instance Viewer
- Dashboard → Click Instance Row → Instance Viewer
- Instance Viewer → Click Child in Tree → Child Instance Viewer
- Instance Viewer → Back to Dashboard

---

## Behavior Spec Coverage

- §17 — "Create New" navigates to editor; "Edit" navigates to editor pre-populated
- §17 — Launching redirects to instance viewer page
- §18.4 — Clicking child in tree navigates to child's instance viewer
- §20.1 — User redirected to instance viewer after launching

---

## Validation Checklist

- [ ] `client/src/app/router/routes.ts` updated with machine routes
- [ ] `client/src/app/router/AppRouter.tsx` updated with lazy-loaded routes
- [ ] Navigation link added to app layout
- [ ] URL parameter helpers created
- [ ] All navigation flows work (dashboard ↔ editor ↔ viewer)
- [ ] Child instance navigation works
- [ ] `pnpm --filter @aiflow/client run build` succeeds
