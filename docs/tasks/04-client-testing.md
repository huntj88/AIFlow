# Task 04 — Client Testing Setup

> **Phase**: 2j–2k from SETUP_PLAN  
> **Depends on**: Task 03 (client app shell)  
> **Blocks**: Task 06 (integration — for baseline tests)

---

## Objective

Configure Vitest (unit/component testing) and Playwright (E2E) for the client. Create the test utility helpers (i18n mock, `renderWithProviders`). Write a smoke test to prove the setup works. After this task, `pnpm test` and `pnpm test:e2e` both pass on the client.

---

## Steps

### 1. Vitest configuration

**`client/vitest.config.ts`**:

```ts
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-utils/vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test-utils/**', 'src/vite-env.d.ts', 'src/**/*.d.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
```

### 2. Vitest setup file

**`client/src/test-utils/vitest.setup.ts`**:

```ts
import '@testing-library/jest-dom/vitest';
import 'vitest-canvas-mock';
import { vi } from 'vitest';

// Mock react-i18next — return translation keys as-is
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      changeLanguage: () => new Promise(() => {}),
    },
  }),
  initReactI18next: {
    type: '3rdParty',
    init: () => {},
  },
  I18nextProvider: ({ children }: { children: React.ReactNode }) => children,
  Trans: ({ children }: { children: React.ReactNode }) => children,
}));
```

### 3. `renderWithProviders` helper

**`client/src/test-utils/renderWithProviders.tsx`**:

```tsx
import { render, type RenderOptions } from '@testing-library/react';
import { type ReactElement } from 'react';
import { MemoryRouter } from 'react-router';

import { ThemeProvider } from '@/app/providers/ThemeProvider';

interface ProviderOptions {
  initialRoute?: string;
}

export function renderWithProviders(
  ui: ReactElement,
  options?: ProviderOptions & Omit<RenderOptions, 'wrapper'>,
) {
  const { initialRoute = '/', ...renderOptions } = options ?? {};

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialRoute]}>
        <ThemeProvider>{children}</ThemeProvider>
      </MemoryRouter>
    );
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}
```

### 4. Smoke unit test

**`client/src/pages/HomePage.test.tsx`**:

```tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test-utils/renderWithProviders';

import { HomePage } from './HomePage';

describe('HomePage', () => {
  it('renders the heading with translation key', () => {
    renderWithProviders(<HomePage />);
    // i18n is mocked — returns the key itself
    expect(screen.getByText('home.heading')).toBeInTheDocument();
  });
});
```

### 5. Playwright configuration

**`client/playwright.config.ts`**:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: './playwright-report',
  reporter: 'list',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @aiflow/server run dev',
      port: 3001,
      reuseExistingServer: !process.env.CI,
      cwd: '..',
    },
    {
      command: 'pnpm --filter @aiflow/client run dev',
      port: 5173,
      reuseExistingServer: !process.env.CI,
      cwd: '..',
    },
  ],
});
```

### 6. Playwright smoke test

**`client/e2e/home.spec.ts`**:

```ts
import { expect, test } from '@playwright/test';

test.describe('Home page', () => {
  test('renders the app shell', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
  });
});
```

### 7. Install Playwright browsers

```bash
cd client
npx playwright install chromium
```

---

## Validation Checklist

- [ ] `client/vitest.config.ts` exists with `jsdom`, `globals: true`, setup file path, coverage config
- [ ] `client/src/test-utils/vitest.setup.ts` exists with jest-dom, canvas mock, i18n mock
- [ ] `client/src/test-utils/renderWithProviders.tsx` exists and wraps in `MemoryRouter` + `ThemeProvider`
- [ ] `pnpm --filter @aiflow/client run test` passes — smoke test for `HomePage` succeeds
- [ ] i18n mock returns identity keys (test asserts against `'home.heading'`, not the English string)
- [ ] `client/playwright.config.ts` exists with Chromium only, `reporter: 'list'`, `webServer` for both client + server
- [ ] `client/e2e/home.spec.ts` exists
- [ ] `npx playwright install chromium` completed successfully
- [ ] `pnpm --filter @aiflow/client run test:e2e` passes (requires server to be set up — can defer final E2E pass to Task 06)
- [ ] Coverage report generates in `client/coverage/` when running `pnpm --filter @aiflow/client run test -- --coverage`
- [ ] No TypeScript errors: `cd client && npx tsc -b --noEmit`
