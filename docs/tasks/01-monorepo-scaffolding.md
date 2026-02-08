# Task 01 — Monorepo Scaffolding

> **Phases**: 0 + 1 from SETUP_PLAN  
> **Depends on**: nothing  
> **Blocks**: all other tasks

---

## Objective

Create the root monorepo structure with pnpm workspaces, shared TypeScript base config, shared Prettier config, `.gitignore`, and root-level convenience scripts. After this task, `pnpm install` should succeed (even with empty workspace packages).

---

## Steps

### 1. Root `package.json`

Create `/package.json`:

```jsonc
{
  "name": "aiflow",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "pnpm --parallel -r run dev",
    "build": "pnpm -r run build",
    "lint": "pnpm -r run lint",
    "lint:fix": "pnpm -r run lint:fix",
    "format": "pnpm -r run format",
    "format:check": "pnpm -r run format:check",
    "test": "pnpm -r run test"
  },
  "devDependencies": {
    "husky": "^9.1.7",
    "lint-staged": "^16.2.7",
    "prettier": "^3.8.1",
    "typescript": "~5.9.3"
  }
}
```

### 2. pnpm workspace

Create `/pnpm-workspace.yaml`:

```yaml
packages:
  - client
  - server
```

### 3. Node version pin

Create `/.nvmrc`:

```
22
```

### 4. `.gitignore`

Create `/.gitignore` covering:

- `node_modules/`
- `dist/`
- `build/`
- `coverage/`
- `*.tsbuildinfo`
- `.env`, `.env.*`, `!.env.example`
- `.vite/`
- `playwright-report/`, `test-results/`
- `.DS_Store`, `Thumbs.db`
- `*.log`
- `.idea/`, `.vscode/` (except shared settings if desired)

### 5. Root `.prettierrc`

Create `/.prettierrc`:

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "semi": true,
  "printWidth": 100
}
```

### 6. Shared TypeScript base config

Create `/tsconfig.base.json`:

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

> **Note**: `module`, `moduleResolution`, `lib`, and `jsx` are intentionally omitted — each workspace sets its own.

### 7. Placeholder workspace packages

Create minimal `client/package.json` and `server/package.json` so `pnpm install` can resolve the workspace:

**`client/package.json`**:
```json
{
  "name": "@aiflow/client",
  "private": true,
  "version": "0.0.0"
}
```

**`server/package.json`**:
```json
{
  "name": "@aiflow/server",
  "private": true,
  "version": "0.0.0",
  "type": "module"
}
```

### 8. Install

```bash
pnpm install
```

---

## Validation Checklist

- [ ] `/package.json` exists with `"private": true` and all root scripts
- [ ] `/pnpm-workspace.yaml` lists `client` and `server`
- [ ] `/.nvmrc` contains `22`
- [ ] `/.gitignore` exists and covers: `node_modules`, `dist`, `coverage`, `.env`, `*.tsbuildinfo`, `playwright-report`, `.vite`
- [ ] `/.prettierrc` exists with `singleQuote: true`, `trailingComma: "all"`, `semi: true`, `printWidth: 100`
- [ ] `/tsconfig.base.json` exists with `strict: true`, `target: ES2022`, no `module`/`moduleResolution`/`lib` keys
- [ ] `/client/package.json` exists with `"name": "@aiflow/client"`
- [ ] `/server/package.json` exists with `"name": "@aiflow/server"`, `"type": "module"`
- [ ] `pnpm install` completes without errors
- [ ] `node_modules/` appears at root (hoisted)
- [ ] Root scripts are defined: `dev`, `build`, `lint`, `lint:fix`, `format`, `format:check`, `test`
- [ ] `husky`, `lint-staged`, `prettier`, `typescript` are in root `devDependencies`
