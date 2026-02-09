import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router';

import { AppLayout } from '@/app/layout/AppLayout';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { HomePage } from '@/pages/HomePage';

import { ROUTES } from './routes';

// ── Lazy-loaded machine pages ────────────────────────────────────────────────

const MachinesPage = lazy(() => import('@/pages/MachinesPage'));
const MachineDefinitionPage = lazy(() => import('@/pages/MachineDefinitionPage'));
const MachineInstancePage = lazy(() => import('@/pages/MachineInstancePage'));

// ── Suspense fallback ────────────────────────────────────────────────────────

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-12 text-[var(--color-text-muted)]">
      Loading…
    </div>
  );
}

// ── Router ───────────────────────────────────────────────────────────────────

export function AppRouter() {
  return (
    <HashRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path={ROUTES.HOME} element={<HomePage />} />
            <Route
              path={ROUTES.MACHINES}
              element={
                <ErrorBoundary>
                  <MachinesPage />
                </ErrorBoundary>
              }
            />
            <Route
              path={ROUTES.MACHINE_DEFINITION_NEW}
              element={
                <ErrorBoundary>
                  <MachineDefinitionPage />
                </ErrorBoundary>
              }
            />
            <Route
              path={ROUTES.MACHINE_DEFINITION_EDIT}
              element={
                <ErrorBoundary>
                  <MachineDefinitionPage />
                </ErrorBoundary>
              }
            />
            <Route
              path={ROUTES.MACHINE_DEFINITION}
              element={
                <ErrorBoundary>
                  <MachineDefinitionPage />
                </ErrorBoundary>
              }
            />
            <Route
              path={ROUTES.MACHINE_INSTANCE}
              element={
                <ErrorBoundary>
                  <MachineInstancePage />
                </ErrorBoundary>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to={ROUTES.HOME} replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
