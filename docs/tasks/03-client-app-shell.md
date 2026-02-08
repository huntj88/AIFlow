# Task 03 — Client App Shell

> **Phase**: 2f–2i from SETUP_PLAN  
> **Depends on**: Task 02 (client project init)  
> **Blocks**: Task 04 (client testing), Task 06 (integration)

---

## Objective

Build out the client folder structure, app bootstrap with providers (i18n, theme), HashRouter with a layout shell, and theming store. After this task the client renders a navigable app shell with working dark/light mode toggle and i18n-ready text.

---

## Steps

### 1. Create folder structure

Create the following directories and files:

```
client/src/
  app/
    layout/
      AppLayout.tsx
    providers/
      i18n.ts
      ThemeProvider.tsx
    router/
      routes.ts
      AppRouter.tsx
  components/
    common/
      .gitkeep
  hooks/
    useThemeStore.ts
  pages/
    HomePage.tsx
  locales/
    en/
      common.json
  utils/
    .gitkeep
  App.tsx
  main.tsx             # (replace placeholder from Task 02)
```

### 2. i18n configuration

**`client/src/app/providers/i18n.ts`**:

```ts
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import commonEn from '@/locales/en/common.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: commonEn },
    },
    defaultNS: 'common',
    fallbackLng: 'en',
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
    },
    react: {
      useSuspense: true,
    },
    interpolation: {
      escapeValue: false, // React already escapes
    },
  });

export { i18n };
```

### 3. Translation file

**`client/src/locales/en/common.json`**:

```json
{
  "app.title": "AIFlow",
  "nav.home": "Home",
  "home.heading": "Welcome to AIFlow",
  "home.hello_button": "Say Hello",
  "home.response_label": "Server says:",
  "theme.toggle": "Toggle theme"
}
```

### 4. Theme store (Zustand)

**`client/src/hooks/useThemeStore.ts`**:

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeState {
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: 'system',
      setPreference: (preference) => set({ preference }),
    }),
    { name: 'aiflow-theme' },
  ),
);
```

### 5. Theme provider

**`client/src/app/providers/ThemeProvider.tsx`**:

```tsx
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
      return () => mq.removeEventListener('change', apply);
    }
  }, [preference]);

  return <>{children}</>;
}
```

### 6. Route constants

**`client/src/app/router/routes.ts`**:

```ts
export const ROUTES = {
  HOME: '/',
} as const;
```

### 7. App router

**`client/src/app/router/AppRouter.tsx`**:

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

### 8. App layout shell

**`client/src/app/layout/AppLayout.tsx`**:

```tsx
import { Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';

import { useThemeStore } from '@/hooks/useThemeStore';

export function AppLayout() {
  const { t } = useTranslation();
  const { preference, setPreference } = useThemeStore();

  const cycleTheme = () => {
    const order: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system'];
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

### 9. Home page

**`client/src/pages/HomePage.tsx`**:

```tsx
import { useTranslation } from 'react-i18next';

export function HomePage() {
  const { t } = useTranslation();

  return (
    <div>
      <h2 className="mb-4 text-2xl font-semibold">{t('home.heading')}</h2>
      {/* Hello button will be wired up in Task 06 (Integration) */}
    </div>
  );
}
```

### 10. Root App component

**`client/src/App.tsx`**:

```tsx
import { AppRouter } from '@/app/router/AppRouter';

export function App() {
  return <AppRouter />;
}
```

### 11. Updated `main.tsx`

Replace the placeholder from Task 02:

**`client/src/main.tsx`**:

```tsx
import './index.css';
import '@/app/providers/i18n';

import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';

import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { i18n } from '@/app/providers/i18n';
import { App } from '@/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Loading…</div>}>
          <App />
        </Suspense>
      </ThemeProvider>
    </I18nextProvider>
  </StrictMode>,
);
```

---

## Validation Checklist

- [x] All directories created per folder structure above
- [x] `pnpm --filter @aiflow/client run dev` starts and serves at `http://localhost:5173`
- [x] Page shows header with "AIFlow" title and theme toggle button
- [x] Page shows "Welcome to AIFlow" heading on home route
- [x] Theme toggle cycles through `light → dark → system`
- [x] Dark mode: background goes dark, text goes light, `data-theme="dark"` appears on `<html>`
- [x] Light mode: background is white, `data-theme="light"` on `<html>`
- [x] System mode: follows OS preference
- [x] Theme preference persists across page reloads (localStorage key `aiflow-theme`)
- [x] Navigating to `/#/nonexistent` redirects to `/#/`
- [x] All text comes from translation keys (no hardcoded user-facing strings in components)
- [x] `npx tsc -b --noEmit` passes from `client/`
- [x] `pnpm --filter @aiflow/client run lint` passes
- [x] `@/*` imports resolve correctly in IDE and build
