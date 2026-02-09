import { HashRouter, Navigate, Route, Routes } from 'react-router';

import { AppLayout } from '@/app/layout/AppLayout';
import { HomePage } from '@/pages/HomePage';
import { MachinesPage } from '@/pages/MachinesPage';

import { ROUTES } from './routes';

export function AppRouter() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path={ROUTES.HOME} element={<HomePage />} />
          <Route path={ROUTES.MACHINES} element={<MachinesPage />} />
        </Route>
        <Route path="*" element={<Navigate to={ROUTES.HOME} replace />} />
      </Routes>
    </HashRouter>
  );
}
