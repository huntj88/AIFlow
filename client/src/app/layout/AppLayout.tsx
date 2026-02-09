import { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';

import { ConnectionStatus } from '@/components/common/ConnectionStatus';
import { useThemeStore } from '@/hooks/useThemeStore';

export function AppLayout() {
  const { t } = useTranslation();
  const { preference, setPreference } = useThemeStore();

  const cycleTheme = () => {
    const order: ('light' | 'dark' | 'system')[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(preference) + 1) % order.length];
    setPreference(next);
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-1.5 text-sm transition-colors ${
      isActive
        ? 'bg-[var(--color-accent)] text-white'
        : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]'
    }`;

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold">{t('app.title')}</h1>
          <nav className="flex items-center gap-1" data-testid="main-nav">
            <NavLink to="/" end className={linkClass} data-testid="nav-home">
              {t('nav.home')}
            </NavLink>
            <NavLink to="/machines" className={linkClass} data-testid="nav-machines">
              {t('nav.machines')}
            </NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <ConnectionStatus />
          <button
            onClick={cycleTheme}
            className="rounded-md bg-[var(--color-surface)] px-3 py-1.5 text-sm"
          >
            {t('theme.toggle')} ({preference})
          </button>
        </div>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 5000,
          style: {
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
          },
        }}
      />
    </div>
  );
}
