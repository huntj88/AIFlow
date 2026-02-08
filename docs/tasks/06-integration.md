# Task 06 — Initial Integration (Client ↔ Server)

> **Phase**: 4 from SETUP_PLAN  
> **Depends on**: Task 03 (client app shell), Task 04 (client testing), Task 05 (server setup)  
> **Blocks**: Task 07 (wide logging)

---

## Objective

Wire the client to the server. Add a "Say Hello" button on the home page that calls `GET /api/hello` using Effect-TS `HttpClient` and displays the response. Write baseline unit tests (client + server) and a Playwright E2E test. After this task, the full round-trip works: `pnpm dev` → click button → see "hello world".

---

## Steps

### 1. Create an API client utility

**`client/src/utils/apiClient.ts`**:

```ts
import {
  FetchHttpClient,
  HttpClient,
  HttpClientResponse,
} from '@effect/platform';
import { Effect } from 'effect';

const makeRequest = (path: string) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const response = yield* client.get(path);
    return yield* HttpClientResponse.json(response);
  }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer));

export const apiClient = {
  hello: () => makeRequest('/api/hello') as Effect.Effect<{ message: string }, Error>,
};
```

> **Note**: The exact `HttpClient` API may vary by `@effect/platform` version. Adapt the pipe chain as needed. The key goal: make a fetch call via Effect, return a typed JSON response, handle errors in the Effect channel.

### 2. Create a hook for the hello call

**`client/src/hooks/useHello.ts`**:

```ts
import { Effect } from 'effect';
import { useCallback, useState } from 'react';

import { apiClient } from '@/utils/apiClient';

interface HelloState {
  data: string | null;
  loading: boolean;
  error: string | null;
}

export function useHello() {
  const [state, setState] = useState<HelloState>({
    data: null,
    loading: false,
    error: null,
  });

  const fetchHello = useCallback(() => {
    setState({ data: null, loading: true, error: null });

    Effect.runPromise(apiClient.hello())
      .then((res) => setState({ data: res.message, loading: false, error: null }))
      .catch((err: unknown) =>
        setState({ data: null, loading: false, error: String(err) }),
      );
  }, []);

  return { ...state, fetchHello };
}
```

### 3. Update `HomePage` with the hello button

**`client/src/pages/HomePage.tsx`**:

```tsx
import { useTranslation } from 'react-i18next';

import { useHello } from '@/hooks/useHello';

export function HomePage() {
  const { t } = useTranslation();
  const { data, loading, error, fetchHello } = useHello();

  return (
    <div>
      <h2 className="mb-4 text-2xl font-semibold">{t('home.heading')}</h2>

      <button
        onClick={fetchHello}
        disabled={loading}
        className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-white disabled:opacity-50"
      >
        {loading ? '…' : t('home.hello_button')}
      </button>

      {data && (
        <p className="mt-4" data-testid="hello-response">
          {t('home.response_label')} {data}
        </p>
      )}

      {error && (
        <p className="mt-4 text-red-500" data-testid="hello-error">
          {error}
        </p>
      )}
    </div>
  );
}
```

### 4. Update client unit test

**`client/src/pages/HomePage.test.tsx`** (replace smoke test from Task 04):

```tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test-utils/renderWithProviders';

import { HomePage } from './HomePage';

describe('HomePage', () => {
  it('renders the heading', () => {
    renderWithProviders(<HomePage />);
    expect(screen.getByText('home.heading')).toBeInTheDocument();
  });

  it('renders the hello button', () => {
    renderWithProviders(<HomePage />);
    expect(screen.getByText('home.hello_button')).toBeInTheDocument();
  });
});
```

### 5. Update Playwright E2E test

**`client/e2e/home.spec.ts`** (replace smoke test from Task 04):

```ts
import { expect, test } from '@playwright/test';

test.describe('Home page', () => {
  test('renders the app shell', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
  });

  test('hello button fetches and displays server response', async ({ page }) => {
    await page.goto('/');

    const button = page.getByRole('button', { name: /hello/i });
    await expect(button).toBeVisible();
    await button.click();

    const response = page.getByTestId('hello-response');
    await expect(response).toBeVisible({ timeout: 5000 });
    await expect(response).toContainText('hello world');
  });
});
```

---

## Validation Checklist

- [x] `client/src/utils/apiClient.ts` exists — uses Effect `HttpClient` to call `/api/hello`
- [x] `client/src/hooks/useHello.ts` exists — manages loading/data/error state
- [x] `client/src/pages/HomePage.tsx` has a button that calls `fetchHello` and displays response
- [x] `pnpm dev` starts both client and server concurrently
- [x] Open `http://localhost:5173` — page renders with heading and "Say Hello" button
- [x] Click button → "hello world" appears on screen (text reads "Server says: hello world")
- [x] Server stdout shows structured JSON log for the incoming `GET /api/hello` request
- [x] `pnpm --filter @aiflow/client run test` passes — HomePage unit tests pass
- [x] `pnpm --filter @aiflow/server run test` passes — hello route test still passes
- [x] `pnpm --filter @aiflow/client run test:e2e` passes — Playwright clicks button, asserts "hello world"
- [x] Vite proxy works: browser network tab shows `/api/hello` proxied to `localhost:3001`
- [x] No TypeScript errors in either workspace
- [x] `pnpm lint` passes for both workspaces
