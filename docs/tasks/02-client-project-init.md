# Task 02 — Client Project Initialisation

> **Phase**: 2a–2e from SETUP_PLAN  
> **Depends on**: Task 01 (monorepo scaffolding)  
> **Blocks**: Task 03 (client app shell), Task 04 (client testing)

---

## Objective

Install all client dependencies, configure TypeScript (multi-tsconfig), Vite, Tailwind CSS v4 + PostCSS, ESLint (type-aware), and Prettier. After this task the client dev server should start and serve a blank page with Tailwind working.

---

## Steps

### 1. Install production dependencies

```bash
cd client
pnpm add react react-dom react-router \
  zustand i18next react-i18next i18next-browser-languagedetector \
  effect @effect/platform @effect/schema \
  @headlessui/react recharts react-hot-toast \
  date-fns mathjs papaparse idb immer
```

### 2. Install dev dependencies

```bash
pnpm add -D @vitejs/plugin-react-swc vite typescript \
  tailwindcss @tailwindcss/postcss autoprefixer postcss \
  vitest @vitest/coverage-v8 @vitest/ui jsdom vitest-canvas-mock \
  @testing-library/react @testing-library/jest-dom @testing-library/user-event \
  @playwright/test @playwright/experimental-ct-react @axe-core/playwright \
  eslint typescript-eslint eslint-config-prettier eslint-plugin-import \
  eslint-import-resolver-typescript eslint-plugin-jsx-a11y \
  eslint-plugin-react-hooks eslint-plugin-react-refresh @eslint/js \
  globals fake-indexeddb \
  @types/react @types/react-dom @types/node @types/papaparse
```

### 3. `client/package.json` scripts

Add these scripts (deps will be filled in later tasks for vitest/playwright; include them now so lint/format work):

```jsonc
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write \"src/**/*.{ts,tsx,json,css,md}\"",
    "format:check": "prettier --check \"src/**/*.{ts,tsx,json,css,md}\"",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test --reporter=list"
  }
}
```

### 4. TypeScript configuration (multi-tsconfig)

**`client/tsconfig.json`** — project references only:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

**`client/tsconfig.app.json`** — browser code:

```jsonc
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    },
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo"
  },
  "include": ["src"]
}
```

**`client/tsconfig.node.json`** — build tooling (Vite config, etc.):

```jsonc
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo"
  },
  "include": ["vite.config.ts", "postcss.config.js", "eslint.config.ts"]
}
```

### 5. Vite configuration

**`client/vite.config.ts`**:

```ts
import path from 'node:path';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
```

### 6. HTML entrypoint

**`client/index.html`**:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AIFlow</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### 7. Vite type reference

**`client/src/vite-env.d.ts`**:

```ts
/// <reference types="vite/client" />
```

### 8. Tailwind v4 + PostCSS

**`client/postcss.config.js`**:

```js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};
```

**`client/src/index.css`**:

```css
@import 'tailwindcss';

/* Tie Tailwind dark: variant to data-theme attribute */
@custom-variant dark (&:where([data-theme="dark"] *));

/* ── Theme variables ── */
:root {
  --color-bg: #ffffff;
  --color-surface: #f9fafb;
  --color-text: #111827;
  --color-text-muted: #6b7280;
  --color-accent: #3b82f6;
  --color-border: #e5e7eb;
}

[data-theme='dark'] {
  --color-bg: #0f172a;
  --color-surface: #1e293b;
  --color-text: #f1f5f9;
  --color-text-muted: #94a3b8;
  --color-accent: #60a5fa;
  --color-border: #334155;
}

/* ── Global resets ── */
*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  font-family: system-ui, -apple-system, sans-serif;
  background-color: var(--color-bg);
  color: var(--color-text);
}

body {
  margin: 0;
  min-height: 100dvh;
}
```

### 9. Minimal `main.tsx` (placeholder)

**`client/src/main.tsx`** (just enough to verify dev server works):

```tsx
import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root')!;

createRoot(root).render(
  <StrictMode>
    <div className="flex min-h-screen items-center justify-center">
      <h1 className="text-4xl font-bold text-[var(--color-accent)]">AIFlow</h1>
    </div>
  </StrictMode>,
);
```

### 10. ESLint configuration

**`client/eslint.config.ts`**:

```ts
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'playwright-report/'] },

  // Base JS recommended
  js.configs.recommended,

  // TypeScript strict + stylistic
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Parser options for type-aware linting
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // React hooks
  reactHooks.configs.flat['recommended-latest'],

  // React Refresh
  {
    plugins: { 'react-refresh': reactRefresh },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // JSX a11y
  jsxA11y.flatConfigs.recommended,

  // Import ordering
  {
    plugins: { import: importPlugin },
    settings: {
      'import/resolver': {
        typescript: { alwaysTryTypes: true },
      },
    },
    rules: {
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-default-export': 'error',
    },
  },

  // Prettier compat (must be last)
  prettier,
);
```

> **Note**: `import/no-default-export` enforced per blueprint §5. Vite config and page-level lazy imports may need per-file overrides.

---

## Validation Checklist

- [x] `cd client && pnpm install` succeeds (or `pnpm install` from root)
- [x] `client/package.json` has all listed prod and dev dependencies
- [x] `client/tsconfig.json` has project references only (no `compilerOptions`)
- [x] `client/tsconfig.app.json` extends `../tsconfig.base.json`, has `jsx: react-jsx`, `paths: @/*`
- [x] `client/tsconfig.node.json` extends `../tsconfig.base.json`, has `types: ["node"]`
- [x] `client/vite.config.ts` has SWC plugin, `@` alias, `/api` proxy to `localhost:3001`
- [x] `client/index.html` exists with `<div id="root">` and module script pointing to `main.tsx`
- [x] `client/src/vite-env.d.ts` exists
- [x] `client/postcss.config.js` configures `@tailwindcss/postcss` + `autoprefixer`
- [x] `client/src/index.css` has `@import 'tailwindcss'`, `@custom-variant dark`, CSS variables for light + dark
- [x] `client/src/main.tsx` exists and renders placeholder
- [x] `pnpm --filter @aiflow/client run dev` starts and serves page at `http://localhost:5173`
- [x] Page shows "AIFlow" heading styled with Tailwind (accent colour, centered)
- [x] `client/eslint.config.ts` exists with type-aware rules, import ordering, react-hooks, jsx-a11y, prettier compat
- [x] `pnpm --filter @aiflow/client run lint` passes (or shows only expected warnings)
- [x] `pnpm --filter @aiflow/client run format:check` passes
- [x] No TypeScript errors: `cd client && npx tsc -b --noEmit` succeeds
