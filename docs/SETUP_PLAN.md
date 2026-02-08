# AIFlow Monorepo Setup Plan

Based on [docs/PROJECT_BASE.md](PROJECT_BASE.md).

---

## Decisions (Finalised)

| # | Topic | Decision | Rationale |
|---|-------|----------|-----------|
| 1 | **Schema validation** | **`@effect/schema`** — no Zod | Single schema library shared by client + server; stays within the Effect ecosystem. PROJECT_BASE updated. |
| 2 | **Vite React plugin** | **`@vitejs/plugin-react-swc`** only | SWC is faster than Babel for transforms. Drop `@vitejs/plugin-react`. |
| 3 | **ESLint TS packages** | **`typescript-eslint`** (unified flat-config) | `@typescript-eslint/eslint-plugin` + `parser` are legacy ESLint 8 packages. The unified package covers both. |
| 4 | **Tailwind v4 dark mode** | **`@custom-variant dark (&:where([data-theme="dark"] *))`** in CSS | Tailwind v4 removed the `darkMode` config key. This custom variant ties `dark:` utilities to the `data-theme` attribute set by the ThemeProvider. |
| 5 | **Prettier config location** | **Root-level `.prettierrc`** (single file) | Identical formatting rules for both workspaces; no duplication. |
| 6 | **husky / lint-staged location** | **Root-level** devDependencies | They operate on the Git repo, not individual workspaces. |
| 7 | **Concurrent dev runner** | **`pnpm --parallel -r run dev`** | Built-in pnpm feature; no extra tool (Turborepo, concurrently, etc.) needed. |

---

## Phase 0 — Monorepo Scaffolding

- [ ] Create root `package.json` with `"private": true` and pnpm workspaces (`client`, `server`)
- [ ] Create `pnpm-workspace.yaml` listing `client` and `server` packages
- [ ] Create root `.gitignore` (node_modules, dist, coverage, .env, editor files, OS files, Playwright results, Vite temp, `*.tsbuildinfo`)
- [ ] Create root `.nvmrc` or `.node-version` (pin Node ≥ 22)
- [ ] Create root `.prettierrc` — single shared config (`singleQuote`, `trailingComma: all`, `semi`, `printWidth: 100`)
- [ ] Create root `turbo.json` or keep it simple with pnpm scripts only (decide: no Turborepo for now — keep lightweight)
- [ ] Install **root-level** devDependencies: `husky`, `lint-staged`, `prettier`, `typescript`
- [ ] Add root-level convenience scripts in `package.json`:
  - `dev` — `pnpm --parallel -r run dev` (runs client + server concurrently)
  - `build` — `pnpm -r run build`
  - `lint` / `format` / `format:check` — run across workspaces via `pnpm -r run ...`
  - `test` — `pnpm -r run test`

---

## Phase 1 — Shared TypeScript Configuration

- [ ] Create `tsconfig.base.json` at repo root with shared compiler options:
  - `strict: true`, `target: ES2022`, `noUnusedLocals`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`, `isolatedModules: true`, `skipLibCheck: true`, `esModuleInterop: true`, `resolveJsonModule: true`
  - **Do NOT** set `moduleResolution` or `module` in base — these differ between client (bundler) and server (NodeNext)
- [ ] Client and server tsconfigs extend `tsconfig.base.json` and set their own module strategy

---

## Phase 2 — Client Setup (React + Vite + TypeScript)

### 2a — Initialise Vite project

- [ ] Scaffold `client/` with Vite (React + TypeScript SWC template)
- [ ] Create `client/package.json` with `name: "@aiflow/client"`
- [ ] Install production dependencies:
  - react, react-dom, react-router-dom
  - zustand, i18next, react-i18next, i18next-browser-languagedetector
  - effect, @effect/platform, @effect/schema
  - @headlessui/react, recharts, react-hot-toast
  - date-fns, mathjs, papaparse, idb, immer
- [ ] Install dev dependencies:
  - @vitejs/plugin-react-swc, vite, typescript
  - tailwindcss, @tailwindcss/postcss, autoprefixer, postcss
  - vitest, @vitest/coverage-v8, @vitest/ui, jsdom, vitest-canvas-mock
  - @testing-library/react, @testing-library/jest-dom, @testing-library/user-event
  - @playwright/test, @playwright/experimental-ct-react, @axe-core/playwright
  - eslint, typescript-eslint, eslint-config-prettier, eslint-plugin-import, eslint-import-resolver-typescript, eslint-plugin-jsx-a11y, eslint-plugin-react-hooks, eslint-plugin-react-refresh, @eslint/js
  - globals, fake-indexeddb
  - @types/react, @types/react-dom, @types/node, @types/papaparse
  - (**NOT** `@vitejs/plugin-react` — using SWC variant only)
  - (**NOT** `@typescript-eslint/eslint-plugin` / `@typescript-eslint/parser` — using unified `typescript-eslint`)
  - (**NOT** `husky` / `lint-staged` / `prettier` — these are root-level devDeps)

### 2b — TypeScript config (multi-tsconfig)

- [ ] `client/tsconfig.json` — project references to app + node configs
- [ ] `client/tsconfig.app.json` — browser code (`lib: [ES2022, DOM, DOM.Iterable]`, `jsx: react-jsx`, path alias `@/* → src/*`)
- [ ] `client/tsconfig.node.json` — Vite config / build scripts (`lib: [ES2023]`, `types: ["node"]`)

### 2c — Vite config & entrypoint

- [ ] `client/index.html` — minimal HTML shell with `<div id="root">` and `<script type="module" src="/src/main.tsx">`
- [ ] `client/src/vite-env.d.ts` — `/// <reference types="vite/client" />` for Vite type definitions
- [ ] `client/vite.config.ts` — React SWC plugin, `@` alias → `src/`, dev server proxy `/api` → `http://localhost:3001`

### 2d — Tailwind v4 + PostCSS

- [ ] `client/postcss.config.js` — `@tailwindcss/postcss` + autoprefixer
- [ ] `client/src/index.css`:
  - `@import "tailwindcss";` (v4 entrypoint)
  - `@custom-variant dark (&:where([data-theme="dark"] *));` — ties dark variant to `data-theme` attribute (replaces v3's `darkMode: 'class'`)
  - CSS variables for theming on `:root` and `[data-theme="dark"]` (surfaces, text, accent colors)
  - Global resets

### 2e — ESLint + Prettier

- [ ] `client/eslint.config.ts` — type-aware config per §5 of blueprint:
  - typescript-eslint strict + stylistic rules
  - import ordering (grouped, alphabetised)
  - react-hooks (exhaustive deps)
  - react-refresh (safe exports)
  - jsx-a11y (accessibility)
  - eslint-config-prettier (disable conflicting rules)
  - `eslint-import-resolver-typescript` configured to resolve `@/*` alias
  - ignore `dist/`, `coverage/`, `node_modules/`
- [ ] Prettier uses root `.prettierrc` (no per-workspace config needed)

### 2f — Folder structure

```
client/src/
  app/
    layout/            # AppLayout shell, navigation
    providers/         # ThemeProvider, I18nProvider
    router/            # ROUTES constant, route tree
  components/
    common/            # Shared primitives (Button, etc.)
  hooks/               # Shared hooks
  pages/               # Route-level screens (HomePage, etc.)
  locales/
    en/
      common.json      # English translations
  test-utils/          # renderWithProviders helper
  utils/               # Shared utilities
  main.tsx             # Entrypoint
  App.tsx              # Root component
```

### 2g — App bootstrap (`main.tsx`) & i18n config

- [ ] `client/src/app/providers/i18n.ts` — configure i18next:
  - `use(LanguageDetector)` with detection order: `localStorage` → `navigator` → `htmlTag`
  - `fallbackLng: 'en'`
  - Namespaced resources (`common`)
  - `react.useSuspense = true`
- [ ] `client/src/locales/en/common.json` — baseline English translations (at minimum: app title, hello button label)
- [ ] `main.tsx`: StrictMode → I18nextProvider → ThemeProvider → Suspense (with loading fallback) → App

### 2h — Routing

- [ ] HashRouter with `ROUTES` constant map
- [ ] `<AppLayout>` with `<Outlet>` and nested routes
- [ ] Fallback/redirect route to default page

### 2i — Theming

- [ ] Zustand store for theme preference (`light | dark | system`), persisted
- [ ] `ThemeProvider` resolves effective theme via `prefers-color-scheme` media query
- [ ] Sets `document.documentElement.dataset.theme`

### 2j — Testing setup

- [ ] `client/vitest.config.ts` — `environment: 'jsdom'`, `globals: true`, setup file, coverage config
- [ ] `client/src/test-utils/vitest.setup.ts` — jest-dom matchers, canvas mock, i18n mock (identity keys)
- [ ] `client/src/test-utils/renderWithProviders.tsx` — wraps component in all providers
- [ ] `client/playwright.config.ts`:
  - Chromium only, `reporter: 'list'`
  - `webServer` config to start both client (`pnpm dev`) and server before tests
  - `baseURL: 'http://localhost:5173'`
- [ ] Run `npx playwright install chromium` (add to CI setup step too)

### 2k — Scripts (`client/package.json`)

- [ ] `dev` — `vite`
- [ ] `build` — `tsc -b && vite build`
- [ ] `preview` — `vite preview`
- [ ] `lint` / `lint:fix` — eslint
- [ ] `format` / `format:check` — prettier
- [ ] `test` / `test:watch` — vitest
- [ ] `test:e2e` — playwright test

---

## Phase 3 — Server Setup (Effect-TS HTTP Server)

### 3a — Initialise package

- [ ] Create `server/package.json` with `name: "@aiflow/server"`, `type: "module"`
- [ ] Install production dependencies:
  - effect, @effect/platform, @effect/platform-node
- [ ] Install dev dependencies:
  - typescript, @types/node, tsx (for dev runner)
  - vitest, @vitest/coverage-v8
  - eslint, typescript-eslint, @eslint/js, eslint-config-prettier, globals

### 3b — TypeScript config

- [ ] `server/tsconfig.json` — extends root `tsconfig.base.json`, then sets:
  - `module: NodeNext`, `moduleResolution: NodeNext` (server-specific)
  - `lib: [ES2023]`
  - `outDir: dist`, `rootDir: src`
  - path alias `@/* → src/*`
  - `include: ["src"]`

### 3b′ — Vitest config

- [ ] `server/vitest.config.ts` — `globals: true`, coverage config, path alias

### 3c — Folder structure

```
server/src/
  index.ts             # Entrypoint — start HTTP server
  routes/
    hello.ts           # GET /api/hello → { message: "hello world" }
  lib/
    HttpServer.ts      # Effect-TS HTTP server setup (Layer)
    Logger.ts          # Wide logging setup (Effect LogLevel, structured JSON)
```

### 3d — Hello World route

- [ ] Create Effect-TS `HttpRouter` with `GET /api/hello` returning `{ message: "hello world" }`
- [ ] Compose into `HttpServer` layer, listen on configurable port (default 3001)
- [ ] Wire up structured wide logging via Effect's built-in logger (JSON format, spans, annotations)

### 3e — Wide Logging

- [ ] Configure Effect's `Logger.json` (or structured logger) as the default layer for the server
- [ ] Log requests with method, path, duration, status
- [ ] Export a shared logging configuration pattern that the client can mirror (client-side: console structured logger)

### 3f — Scripts (`server/package.json`)

- [ ] `dev` — `tsx watch src/index.ts`
- [ ] `build` — `tsc`
- [ ] `start` — `node dist/index.js`
- [ ] `lint` / `lint:fix` — eslint
- [ ] `test` / `test:watch` — vitest

### 3g — ESLint + Prettier

- [ ] `server/eslint.config.ts` — type-aware strict config (same base as client, minus react-hooks, react-refresh, jsx-a11y)
  - ignore `dist/`, `coverage/`, `node_modules/`
- [ ] Prettier uses root `.prettierrc` (no per-workspace config needed)

---

## Phase 4 — Initial Integration (Client ↔ Server)

- [ ] Client: Vite dev server proxies `/api/*` → `http://localhost:3001` (already configured in 2c)
- [ ] Client: Add a button on the home page that calls `GET /api/hello`
- [ ] Client: Display the `"hello world"` response on screen
- [ ] Client: Use Effect-TS `HttpClient` (from `@effect/platform`) for the fetch call with wide logging on the client side
- [ ] **Baseline unit test (client)**: test that the home page renders and the button exists (uses `renderWithProviders`)
- [ ] **Baseline unit test (server)**: test the hello route returns `{ message: "hello world" }` using Effect's test utilities
- [ ] **Baseline E2E test (Playwright)**: navigate to home page, click button, assert "hello world" appears
- [ ] Verify end-to-end: `pnpm dev` starts both, click button, see response

---

## Phase 5 — Wide Logging (Client + Server)

- [ ] **Server**: Effect `Logger.json` layer — all Effect log calls produce structured JSON with timestamp, level, message, spans, annotations
- [ ] **Client**: Effect `Logger.json` or custom structured console logger — log API calls, errors, timings with context
- [ ] Both: use Effect's `LogLevel` and `Logger.withMinimumLogLevel` for environment-based verbosity
- [ ] Pattern: wrap operations in `Effect.logSpan("spanName")` for automatic duration tracking

---

## Phase 6 — Quality Gates & CI

### 6a — Pre-commit hooks

- [ ] `husky` + `lint-staged` at repo root
- [ ] On commit: `lint`, `format:check`, `test` (unit only)

### 6b — GitHub Actions workflow

- [ ] Install pnpm (via `pnpm/action-setup`) + Node (via `actions/setup-node` with pnpm cache)
- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm run lint` (all workspaces)
- [ ] `pnpm run format:check` (all workspaces)
- [ ] `pnpm run test` (all workspaces)
- [ ] `pnpm run build` (all workspaces)
- [ ] `npx playwright install --with-deps chromium`
- [ ] `pnpm --filter @aiflow/client run test:e2e`

---

## Phase 7 — Verification Checklist

- [ ] `pnpm install` succeeds cleanly from fresh clone
- [ ] `npx playwright install chromium` succeeds
- [ ] `pnpm dev` starts client (Vite) + server (Effect-TS) concurrently
- [ ] Client renders at `http://localhost:5173`
- [ ] Server responds at `http://localhost:3001/api/hello`
- [ ] Button click fetches and displays "hello world"
- [ ] Server logs show structured JSON for the request
- [ ] Client logs show structured output for the API call
- [ ] `pnpm lint` passes (both workspaces)
- [ ] `pnpm format:check` passes
- [ ] `pnpm test` passes (unit tests in both workspaces)
- [ ] `pnpm build` succeeds for both packages
- [ ] `pnpm --filter @aiflow/client run test:e2e` passes (Playwright, Chromium, list reporter)
- [ ] `.gitignore` covers node_modules, dist, coverage, .env, editor, OS, Playwright artifacts, `*.tsbuildinfo`
- [ ] No duplicate configs (single `.prettierrc` at root, `husky`/`lint-staged` at root)
- [ ] `@` path alias resolves correctly in IDE, builds, ESLint, and Vitest for both workspaces
- [ ] Dark mode toggle works (sets `data-theme`, CSS variables respond, Tailwind `dark:` utilities apply)
