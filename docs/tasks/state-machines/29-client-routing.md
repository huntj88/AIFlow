# Task 29 — Client Routing & Navigation

> **Phase**: 4 (Client Viewer)
> **Depends on**: Task 27 (dashboard), Task 28 (instance viewer)
> **Blocks**: Task 30 (definition editor), Task 32 (integration)

---

## Objective

Add machine-related routes to the client router and integrate them into the app navigation. Update the existing `routes.ts`, `AppRouter.tsx`, and `AppLayout.tsx` to include machine pages.

---

## Implementation Notes from Completed Tasks

> These details emerged from the existing client codebase.

### Current router structure

**`client/src/app/router/routes.ts`** (entire file):

```typescript
export const ROUTES = { HOME: '/' } as const;
```

**`client/src/app/router/AppRouter.tsx`** (entire file):

```tsx
import { HashRouter, Navigate, Route, Routes } from 'react-router';
import { AppLayout } from '@/app/layout/AppLayout';
import { HomePage } from '@/pages/HomePage';
import { ROUTES } from './routes';

export function AppRouter() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path={ROUTES.HOME} element={<HomePage />} />
        </Route>
        <Route path="*" element={<Navigate to={ROUTES.HOME} replace />} />
      </Routes>
    </HashRouter>
  );
}
```

**Key**: Uses `HashRouter` (not `BrowserRouter`) — all URLs are hash-based (`#/machines`, `#/machines/instances/:id`). Uses `react-router` (v7), not `react-router-dom`.

### Current layout

**`client/src/app/layout/AppLayout.tsx`** (entire file):

```tsx
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { useThemeStore } from '@/hooks/useThemeStore';

export function AppLayout() {
  const { t } = useTranslation();
  const { preference, setPreference } = useThemeStore();
  const cycleTheme = () => {
    const order: ('light' | 'dark' | 'system')[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(preference) + 1) % order.length];
    setPreference(next);
  };
  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
        <h1 className="text-xl font-bold">{t('app.title')}</h1>
        <button
          onClick={cycleTheme}
          className="rounded-md bg-[var(--color-surface)] px-3 py-1.5 text-sm"
        >
          {t('theme.toggle')} ({preference})
        </button>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
```

**Changes needed**: Add a navigation section (e.g., between the `<h1>` and theme button, or as a nav bar below the header) with a link to "/machines". Use `Link` from `react-router` or `NavLink` for active state highlighting.

### Lazy loading

Use React `lazy()` + `<Suspense>` for machine pages to avoid increasing the initial bundle.

---

## Steps

### 1. Update `client/src/app/router/routes.ts`

Extend the existing `ROUTES` constant (currently only has `HOME: '/'`):

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

Add route entries inside the existing `<Route element={<AppLayout />}>` wrapper. Use lazy loading:

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

- [x] `client/src/app/router/routes.ts` updated with machine routes
- [x] `client/src/app/router/AppRouter.tsx` updated with lazy-loaded routes
- [x] Navigation link added to app layout
- [x] URL parameter helpers created
- [x] All navigation flows work (dashboard ↔ editor ↔ viewer)
- [x] Child instance navigation works
- [x] `pnpm --filter @aiflow/client run build` succeeds
