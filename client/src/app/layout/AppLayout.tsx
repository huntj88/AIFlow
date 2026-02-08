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
