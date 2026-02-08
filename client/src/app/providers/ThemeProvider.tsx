import { useEffect, type ReactNode } from 'react';

import { useThemeStore } from '@/hooks/useThemeStore';

function resolveTheme(preference: 'light' | 'dark' | 'system'): 'light' | 'dark' {
  if (preference !== 'system') return preference;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useThemeStore((s) => s.preference);

  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(preference);
    };
    apply();

    if (preference === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', apply);
      return () => {
        mq.removeEventListener('change', apply);
      };
    }
  }, [preference]);

  return <>{children}</>;
}
