# Task 08 — Quality Gates & CI

> **Phase**: 6 + 7 from SETUP_PLAN  
> **Depends on**: All previous tasks (01–07)  
> **Blocks**: nothing — this is the final task

---

## Objective

Set up pre-commit hooks (husky + lint-staged), a GitHub Actions CI workflow, and run the full verification checklist. After this task, every commit is validated locally and every push is validated in CI.

---

## Steps

### 1. Initialise husky

```bash
# From repo root
npx husky init
```

This creates `.husky/` directory and adds a `prepare` script to root `package.json`.

### 2. Configure lint-staged

Add to root **`package.json`**:

```jsonc
{
  "lint-staged": {
    "client/src/**/*.{ts,tsx}": [
      "eslint --fix",
      "prettier --write"
    ],
    "server/src/**/*.{ts}": [
      "eslint --fix",
      "prettier --write"
    ],
    "*.{json,md,css,yaml,yml}": [
      "prettier --write"
    ]
  }
}
```

### 3. Create pre-commit hook

**`.husky/pre-commit`**:

```bash
pnpm exec lint-staged
pnpm run test
pnpm run build
```

> Per blueprint §13: pre-commit runs `lint`, `format:check`, `test`, `build`. lint-staged handles lint + format on staged files. Then we run full test + build.

### 4. GitHub Actions workflow

Create **`.github/workflows/ci.yml`**:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  quality:
    name: Lint · Test · Build
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm run lint

      - name: Format check
        run: pnpm run format:check

      - name: Unit tests
        run: pnpm run test

      - name: Build
        run: pnpm run build

  e2e:
    name: E2E Tests
    runs-on: ubuntu-latest
    timeout-minutes: 15
    needs: quality

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Build server
        run: pnpm --filter @aiflow/server run build

      - name: E2E tests
        run: pnpm --filter @aiflow/client run test:e2e

      - name: Upload Playwright report
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: client/playwright-report/
          retention-days: 7
```

### 5. Add `prepare` script to root package.json

Ensure husky installs hooks on `pnpm install`:

```jsonc
{
  "scripts": {
    "prepare": "husky"
  }
}
```

(This should already be added by `npx husky init`, but verify.)

---

## Full Verification Checklist (Phase 7)

Run through every item below to confirm the template is complete:

### Monorepo structure
- [ ] `pnpm install` succeeds cleanly from a fresh clone
- [ ] `pnpm-workspace.yaml` lists `client` and `server`
- [ ] Root `package.json` has: `dev`, `build`, `lint`, `lint:fix`, `format`, `format:check`, `test`, `prepare`
- [ ] `.nvmrc` pins Node ≥ 22
- [ ] `.gitignore` covers: `node_modules`, `dist`, `coverage`, `.env`, `*.tsbuildinfo`, `playwright-report`, `test-results`, `.vite`, `.DS_Store`
- [ ] Single `.prettierrc` at root (no per-workspace duplicates)
- [ ] `tsconfig.base.json` at root (no `module`/`moduleResolution`/`lib` keys)

### Client
- [ ] `pnpm --filter @aiflow/client run dev` serves at `http://localhost:5173`
- [ ] Page renders: header with "AIFlow", theme toggle, "Welcome to AIFlow" heading
- [ ] "Say Hello" button exists and is clickable
- [ ] Theme toggle cycles `light → dark → system` — CSS variables respond, `data-theme` updates
- [ ] Theme persists across page reload (localStorage)
- [ ] Navigating to `/#/nonexistent` redirects to `/#/`
- [ ] All text uses i18n translation keys (no hardcoded strings)
- [ ] `@/*` alias resolves in IDE, build, ESLint, and Vitest
- [ ] `pnpm --filter @aiflow/client run lint` passes
- [ ] `pnpm --filter @aiflow/client run format:check` passes
- [ ] `pnpm --filter @aiflow/client run test` passes
- [ ] `npx tsc -b --noEmit` passes from `client/`

### Server
- [ ] `pnpm --filter @aiflow/server run dev` starts on port 3001
- [ ] `curl http://localhost:3001/api/hello` returns `{"message":"hello world"}`
- [ ] Server outputs structured JSON log lines (timestamp, level, message, spans)
- [ ] `pnpm --filter @aiflow/server run lint` passes
- [ ] `pnpm --filter @aiflow/server run format:check` passes
- [ ] `pnpm --filter @aiflow/server run test` passes
- [ ] `pnpm --filter @aiflow/server run build` produces `dist/`
- [ ] `cd server && node dist/index.js` starts server from compiled output
- [ ] `npx tsc --noEmit` passes from `server/`

### Integration
- [ ] `pnpm dev` starts both client + server concurrently
- [ ] Click "Say Hello" → "hello world" appears on screen
- [ ] Server logs show JSON for the request
- [ ] Browser console shows structured JSON for the API call (Effect logger)
- [ ] Vite proxy: browser network tab shows `/api/hello` proxied correctly

### E2E
- [ ] `npx playwright install chromium` completes
- [ ] `pnpm --filter @aiflow/client run test:e2e` passes (Chromium, list reporter)
- [ ] Playwright config has `webServer` entries for both client and server

### Quality gates
- [ ] `.husky/pre-commit` exists and runs lint-staged + test + build
- [ ] `lint-staged` config in root `package.json` targets `client/src/**` and `server/src/**`
- [ ] `.github/workflows/ci.yml` exists
- [ ] CI workflow runs: install → lint → format:check → test → build → e2e
- [ ] CI uploads Playwright report on failure

### Build
- [ ] `pnpm build` succeeds for both workspaces
- [ ] `pnpm lint` passes for both workspaces
- [ ] `pnpm format:check` passes for both workspaces
- [ ] `pnpm test` passes for both workspaces
