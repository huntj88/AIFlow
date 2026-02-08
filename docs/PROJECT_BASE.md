# Project Blueprint — React + Vite + TypeScript

This document captures reusable **how-it’s-built** practices for a modern React + TypeScript front-end. It is intentionally project-agnostic so it can be copied into a new repo as a baseline.

## 1) Toolchain overview

- **Build system**: Vite (ESM, fast HMR)
- **UI**: React (with Suspense-ready bootstrap)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS v4 + PostCSS (Autoprefixer)
- **Routing**: React Router (hash-based routing by default)
- **State**: Zustand for light global state (theme preference, UI settings, etc.)
- **Testing**: Vitest + Testing Library + jsdom + Playwright
- **Localization**: i18next + react-i18next + browser language detection
- **Linting/Formatting**: ESLint (type-aware) + Prettier
- **Schema Validation**: `@effect/schema` (Effect ecosystem — shared with server)
- **Package Management**: pnpm

## 2) Core scripts (package.json)

Standard scripts to include:

- **dev**: start Vite dev server
- **build**: type-check + Vite build
- **preview**: preview production build
- **lint / lint:fix**: ESLint (strict, autofix)
- **format / format:check**: Prettier apply / verify
- **test / test:watch**: Vitest run once / watch mode

## 3) TypeScript configuration patterns

Use a **multi-tsconfig** setup:

- Root tsconfig references app and node configs.
- **App config** (browser code):
  - `target: ES2022`
  - `lib: [ES2022, DOM, DOM.Iterable]`
  - `moduleResolution: bundler`
  - `jsx: react-jsx`
  - `strict: true` + lint-style checks (`noUnusedLocals`, `noUncheckedSideEffectImports`, etc.)
  - Define **path alias** (e.g., `@/* -> src/*`) for ergonomic imports.
- **Node config** (build scripts, Vite config):
  - `lib: [ES2023]`
  - `types: ["node"]`
  - `moduleResolution: bundler`

This separation keeps Node-only tooling clean and avoids leaking DOM types into build scripts.

## 4) Module aliasing

Define an alias for `src` to keep imports stable as folders grow:

- Vite: `resolve.alias['@'] = path.resolve(__dirname, 'src')`
- TypeScript: `paths['@/*'] = ['src/*']`
- ESLint: configure `import/resolver` for TypeScript

This avoids brittle relative paths and makes refactors easier.

## 5) ESLint strategy (type-aware)

Use ESLint’s TypeScript-aware config with strict & stylistic rules, then layer in:

- **Import ordering** with grouped and alphabetized imports
- **React hooks** rules (exhaustive deps)
- **React Refresh** rule to avoid unsafe exports in components
- **JSX a11y** for accessibility defaults
- **Prettier** integration to disable overlapping style rules

Recommended conventions:

- Enforce consistent import order
- Prefer named exports (disable default exports) for clearer refactors
- Keep linting strict in CI (no warnings)

## 6) Prettier formatting

Use a compact, project-agnostic Prettier config:

- `singleQuote: true`
- `trailingComma: all`
- `semi: true`
- `printWidth: 100`

Run Prettier via dedicated scripts to keep formatting uniform across the codebase.

## 7) Styling & CSS pipeline

Use Tailwind CSS v4 via PostCSS:

- PostCSS pipeline with `tailwindcss()` + `autoprefixer()`
- Tailwind `content` paths: `index.html` + `src/**/*.{ts,tsx,html}`
- `darkMode: 'class'` for explicit theme toggling

Design system guidance:

- Define colors and surfaces via CSS variables on `:root` or `html[data-theme=...]`
- Use Tailwind utility classes for layout/spacing/typography
- Keep custom CSS in `index.css` for global resets and CSS variable definitions

## 8) App bootstrap pattern

A minimal, scalable entrypoint:

- Wrap the app in **StrictMode**
- Provide i18n and theme providers
- Use **Suspense** with a minimal fallback for translation loading

Example structure (conceptual):

- `main.tsx`
  - Create root
  - `<I18nextProvider>`
  - `<ThemeProvider>`
  - `<Suspense>`
  - `<App />`

## 9) Routing pattern

Use **HashRouter** when static hosting or non-server environments are likely. Define:

- `ROUTES` constant map for route names and URLs
- Top-level `<AppLayout>` with nested routes
- Fallback route to redirect to a default page

This makes route definitions predictable and keeps navigation consistent.

## 10) Theming pattern

Use a **theme store + context** split:

- Zustand store persists `preference` (light | dark | system)
- Provider resolves effective theme using system preference
- Provider updates `document.documentElement.dataset.theme` for CSS

This lets Tailwind + CSS variables respond to theme changes without re-rendering large trees.

## 11) Localization pattern

Use i18next + browser language detection:

- Configure detection order: `localStorage` → `navigator` → `htmlTag`
- `fallbackLng: 'en'`
- Namespaced resources (e.g., `common`)
- `react.useSuspense = true` for clean async loading
- when using `useTranslation()` use the key only. The string goes in the translation files.
- If an existing translated string is very generic, and there would be duplicates, move the translation to a common namespace to consolidate.

Testing tip: mock `useTranslation()` to return identity keys in Vitest setup to avoid translation dependencies in unit tests.

## 12) Testing approach

Use Vitest + Testing Library:

- `environment: 'jsdom'`
- `globals: true`
- Setup file to extend matchers and add mocks (e.g., i18n, canvas)
- Coverage: include `src/**/*.{ts,tsx}` and use `text` + `lcov` reporters

Testing patterns to keep:

- “Render with providers” helper for consistent context setup
- Keep UI tests focused on behavior and user interactions
- Mock external APIs (Web Serial, canvas, etc.) in setup
- If testing for existence of string in UI, test for translation key instead of actual string, use vitest.setup.ts

```typescript
import '@testing-library/jest-dom/vitest';
import 'vitest-canvas-mock';
import { vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      changeLanguage: () =>
        new Promise(() => {
          /* ignore */
        }),
    },
  }),
  initReactI18next: {
    type: '3rdParty',
    init: () => {
      /* ignore */
    },
  },
  I18nextProvider: ({ children }: { children: React.ReactNode }) => children,
  Trans: ({ children }: { children: React.ReactNode }) => children,
}));
```

E2E tests with playright.
playwright should test chrome and **must** use --reporter=list

## 13) Quality gates

Include these in pre-commit:

1. `pnpm run lint`
2. `pnpm run format:check`
3. `pnpm run test`
4. `pnpm run build`

Include these in github action:
2. `pnpm run test:e2e`

This ensures consistent style, correctness, and build integrity.

## 14) Suggested baseline folder structure for client

```
src/
  app/
    layout/            # App chrome, shell, navigation
    providers/         # i18n, theme, global contexts
    router/            # Routes + constants
  components/          # Reusable UI components
    common/            # Shared primitives
  hooks/               # Shared hooks
  pages/               # Route-level screens
  locales/             # Translation resources
  test-utils/          # Testing helpers
  utils/               # Shared utilities
```

## 15) Checklist to start a new project quickly

1. Copy this blueprint into a new repo.
2. Initialize Vite + React + TypeScript.
3. Install dependencies: React Router, Tailwind, Effect-TS, Zustand, i18next, Vitest, Testing Library, Playwright.
4. Add ESLint + Prettier configs (type-aware ESLint, Prettier integration).
5. Add Tailwind + PostCSS configs and base CSS variables.
6. Set up `main.tsx` providers (i18n, theme, Suspense).
7. Add `ROUTES` and a basic `AppLayout` with nested routes.
8. Create baseline tests and CI quality gates.
---

use packages newer than these
{
  "dependencies": {
    "@effect/platform": "^0.94.2",
    "@effect/schema": "^0.75.5",
    "@headlessui/react": "^2.2.9",
    "date-fns": "^4.1.0",
    "effect": "^3.19.15",
    "i18next": "^25.8.0",
    "i18next-browser-languagedetector": "^8.2.0",
    "idb": "^8.0.3",
    "immer": "^11.1.3",
    "mathjs": "^15.1.0",
    "papaparse": "^5.5.3",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-hot-toast": "^2.6.0",
    "react-i18next": "^16.5.3",
    "react-router-dom": "^7.13.0",
    "recharts": "^3.7.0",
    "zustand": "^5.0.10"
  },
  "devDependencies": {
    "@axe-core/playwright": "^4.11.0",
    "@eslint/js": "^9.39.2",
    "@playwright/experimental-ct-react": "^1.58.0",
    "@playwright/test": "^1.58.0",
    "@tailwindcss/postcss": "^4.1.18",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.1",
    "@types/node": "^24.10.1",
    "@types/papaparse": "^5.5.2",
    "@types/react": "^19.2.5",
    "@types/react-dom": "^19.2.3",
    "@typescript-eslint/eslint-plugin": "^7.18.0",
    "@typescript-eslint/parser": "^7.18.0",
    "@vitejs/plugin-react": "^4.2.1",
    "@vitejs/plugin-react-swc": "^4.2.2",
    "@vitest/coverage-v8": "^4.0.18",
    "@vitest/ui": "^4.0.18",
    "autoprefixer": "^10.4.23",
    "eslint": "^9.39.1",
    "eslint-config-prettier": "^10.1.8",
    "eslint-import-resolver-typescript": "^4.4.4",
    "eslint-plugin-import": "^2.32.0",
    "eslint-plugin-jsx-a11y": "^6.10.2",
    "eslint-plugin-react-hooks": "^7.0.1",
    "eslint-plugin-react-refresh": "^0.4.24",
    "fake-indexeddb": "^6.2.5",
    "globals": "^16.5.0",
    "husky": "^9.1.7",
    "jsdom": "^27.4.0",
    "lint-staged": "^16.2.7",
    "postcss": "^8.5.6",
    "prettier": "^3.8.1",
    "tailwindcss": "^4.1.18",
    "typescript": "~5.9.3",
    "typescript-eslint": "^8.46.4",
    "vite": "^7.2.4",
    "vitest": "^4.0.18"
  }
}

# Wide Logging. setup logging such that server and client both have wide logs using Effect-TS


# Server setup
Setup a effect TS server with a hello world route.

# Initial integration
Display a button that calls the server and displays the response "hello world"

# Other
set up a .gitignore