# Accounting App — Slice 1 — Plan 1.0: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo, database, multi-tenant auth (JWT access + refresh), RBAC, audit log, and an empty deployed dashboard. When this plan is done, a firm_admin can log in to the app deployed on Netlify → Railway, see a dashboard shell, and every action they took was audit-logged.

**Architecture:** Monorepo (npm workspaces) with `apps/api` (Express + Kysely), `apps/web` (Vite + React + shadcn/ui), `packages/shared` (zod schemas, typed constants, decimal helpers). Services accept an injected Kysely transaction and a `ServiceCtx`; route handlers own the transaction boundary via `db.transaction().execute(...)`, so any service call's audit log is atomic with the mutation. Defense-in-depth: DB triggers (audit_logs append-only) back up service-layer rules.

**Tech Stack:** Node 20, TypeScript 5, Express 4, Kysely, `pg` driver, `bcrypt`, `jsonwebtoken`, Vite, React 18, shadcn/ui, Tailwind, Vitest, Testcontainers, Playwright (deferred — Slice 1 scope but not this plan), Docker Compose.

**Spec:** `docs/superpowers/specs/2026-04-20-accounting-app-slice-1-ledger-and-ar-design.md`

---

## File structure after this plan completes

```
accounting-app/
├── package.json                        # workspaces root
├── .nvmrc                              # 20.11.1
├── .gitignore
├── tsconfig.base.json
├── docker-compose.yml                  # local Postgres
├── .env.example
├── .github/workflows/ci.yml
├── apps/
│   ├── api/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts                # bootstrap
│   │   │   ├── config.ts               # env via zod
│   │   │   ├── db/
│   │   │   │   ├── types.ts            # Kysely DB interface (hand-written)
│   │   │   │   └── index.ts            # Kysely instance factory
│   │   │   ├── lib/
│   │   │   │   ├── errors.ts           # BusinessRuleError + toHttpStatus
│   │   │   │   ├── ctx.ts              # ServiceCtx type
│   │   │   │   └── json.ts             # reviver/replacer for numeric strings
│   │   │   ├── middleware/
│   │   │   │   ├── requestId.ts
│   │   │   │   ├── auth.ts
│   │   │   │   ├── tenancy.ts
│   │   │   │   ├── rbac.ts
│   │   │   │   └── error.ts
│   │   │   ├── services/
│   │   │   │   ├── auth/
│   │   │   │   │   ├── passwordHasher.ts
│   │   │   │   │   ├── tokenService.ts
│   │   │   │   │   └── authService.ts
│   │   │   │   └── audit/
│   │   │   │       └── auditService.ts
│   │   │   └── routes/
│   │   │       ├── auth.ts
│   │   │       ├── me.ts
│   │   │       └── health.ts
│   │   ├── tests/
│   │   │   ├── helpers/
│   │   │   │   ├── testDb.ts           # Testcontainers Postgres
│   │   │   │   └── factories.ts        # makeFirm/makeUser/makeBusiness
│   │   │   ├── unit/                   # pure fn tests
│   │   │   └── integration/            # service + route tests
│   │   └── vitest.config.ts
│   └── web/
│       ├── package.json
│       ├── tsconfig.json
│       ├── tsconfig.node.json
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       ├── postcss.config.js
│       ├── components.json             # shadcn
│       ├── index.html
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── index.css
│       │   ├── lib/
│       │   │   ├── apiClient.ts
│       │   │   └── utils.ts            # shadcn cn helper
│       │   ├── auth/
│       │   │   ├── AuthContext.tsx
│       │   │   ├── useAuth.ts
│       │   │   └── ProtectedRoute.tsx
│       │   ├── components/
│       │   │   ├── ui/                 # shadcn-installed
│       │   │   └── layout/
│       │   │       ├── AppShell.tsx
│       │   │       ├── Sidebar.tsx
│       │   │       └── TopBar.tsx
│       │   └── pages/
│       │       ├── LoginPage.tsx
│       │       └── DashboardPage.tsx
│       └── public/
├── packages/
│   └── shared/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── decimal.ts              # decimal.js wrappers
│           ├── auditActions.ts
│           ├── errorCodes.ts
│           ├── roles.ts
│           └── schemas/
│               └── auth.ts             # zod: loginRequest, loginResponse
├── db/
│   ├── migrations/
│   │   ├── 0001_extensions.sql
│   │   ├── 0002_updated_at_function.sql
│   │   ├── 0003_core_tables.sql
│   │   └── 0004_audit_logs.sql
│   └── seeds/
│       └── 0001_foundation.sql
└── bin/
    ├── migrate.ts
    ├── seed.ts
    └── create-admin.ts
```

## Conventions locked by this plan (used by 1.1 and 1.2)

- **DB type:** `DB` interface in `apps/api/src/db/types.ts` — a Kysely `Database` type with a field per table. Every service imports this.
- **Service signatures:** every service method takes `(trx: Transaction<DB>, ctx: ServiceCtx, args: X)` and returns a plain object. Route handlers own `db.transaction().execute(async (trx) => ...)`.
- **ServiceCtx** (locked here, consumed by 1.1 and 1.2):
  ```ts
  type ServiceCtx = {
    user_id: string;
    firm_id: string;
    business_id: string | null;
    effective_role: 'firm_admin' | 'accountant' | 'staff' | 'client';
    request_id: string;
    ip_address: string;
    user_agent: string;
  };
  ```
- **Errors:** Services throw `BusinessRuleError` (see task 14). Express error middleware translates to HTTP per the spec's status-code table.
- **Audit:** Services call `auditService.record(trx, ctx, { action, entity_type, entity_id, before, after })`. Using the same `trx` is what makes atomicity structural.
- **Money over the wire:** `numeric` columns serialize as strings (via `pg` config and a custom JSON replacer); the web client parses with `decimal.js`. This plan sets up the infrastructure; 1.1 and 1.2 use it.
- **Migrations:** plain `.sql` files, ordered by filename. `bin/migrate.ts` applies in order, tracks state in a `_migrations` table.
- **Commits:** after every passing test group. Commit messages: `feat(scope): summary` or `chore(scope): summary`. Conventional-ish but not rigid.

---

## Phase A — Repo + tooling skeleton (Tasks 1–5)

### Task 1: Root monorepo scaffold

**Files:**
- Create: `package.json`, `.nvmrc`, `.gitignore`, `tsconfig.base.json`, `.env.example`, `README.md`

- [ ] **Step 1: Write `.nvmrc`**

```
20.11.1
```

- [ ] **Step 2: Write root `package.json`**

```json
{
  "name": "accounting-app",
  "private": true,
  "version": "0.0.0",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "concurrently -n api,web -c blue,green \"npm -w @accounting/api run dev\" \"npm -w @accounting/web run dev\"",
    "build": "npm -w @accounting/shared run build && npm -w @accounting/api run build && npm -w @accounting/web run build",
    "lint": "npm -ws run lint --if-present",
    "typecheck": "npm -ws run typecheck --if-present",
    "test": "npm -ws run test --if-present",
    "test:integration": "npm -w @accounting/api run test:integration",
    "db:migrate": "tsx bin/migrate.ts",
    "db:seed": "tsx bin/seed.ts",
    "db:reset": "tsx bin/migrate.ts --reset && tsx bin/seed.ts"
  },
  "devDependencies": {
    "concurrently": "^8.2.2",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3"
  },
  "engines": {
    "node": ">=20.11.0"
  }
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
dist/
.env
.env.local
*.log
.DS_Store
coverage/
.vite/
.turbo/
apps/web/dist/
apps/api/dist/
packages/shared/dist/
```

- [ ] **Step 4: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 5: Write `.env.example`**

```
# Postgres (local via docker-compose)
DATABASE_URL=postgresql://accounting:accounting@localhost:5432/accounting

# API
API_PORT=4000
JWT_ACCESS_SECRET=dev-access-secret-change-me
JWT_REFRESH_SECRET=dev-refresh-secret-change-me
JWT_ACCESS_TTL_MINUTES=15
JWT_REFRESH_TTL_DAYS=180
CORS_ALLOWED_ORIGINS=http://localhost:5173

# Web (Vite)
VITE_API_URL=http://localhost:4000
```

- [ ] **Step 6: Write minimal `README.md`**

```markdown
# accounting-app

Production-grade accounting system for an accounting firm. See `docs/superpowers/specs/` for the design spec.

## Quickstart

```bash
nvm use
npm install
docker compose up -d postgres
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

Then visit http://localhost:5173.
```

- [ ] **Step 7: Install dev deps and commit**

```bash
npm install
git add package.json package-lock.json .nvmrc .gitignore tsconfig.base.json .env.example README.md
git commit -m "chore: initialize monorepo scaffold"
```

### Task 2: Docker Compose Postgres

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: accounting
      POSTGRES_PASSWORD: accounting
      POSTGRES_DB: accounting
    ports:
      - "5432:5432"
    volumes:
      - accounting_pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U accounting -d accounting"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  accounting_pg_data:
```

- [ ] **Step 2: Verify it boots**

Run: `docker compose up -d postgres && docker compose ps`
Expected: `postgres` service shown as `healthy` within 30s.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add docker-compose for local postgres"
```

### Task 3: Shared package skeleton

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`

- [ ] **Step 1: Write `packages/shared/package.json`**

```json
{
  "name": "@accounting/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "decimal.js": "^10.4.3",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "vitest": "^1.2.2"
  }
}
```

- [ ] **Step 2: Write `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  },
  "include": ["src"],
  "exclude": ["dist", "node_modules", "**/*.test.ts"]
}
```

- [ ] **Step 3: Write `packages/shared/src/index.ts`**

```ts
export * from './decimal.js';
export * from './auditActions.js';
export * from './errorCodes.js';
export * from './roles.js';
export * as schemas from './schemas/index.js';
```

- [ ] **Step 4: Install and commit**

```bash
npm install
git add packages/shared
git commit -m "chore(shared): scaffold shared package"
```

### Task 4: API package skeleton

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/index.ts`, `apps/api/vitest.config.ts`, `apps/api/.eslintrc.cjs`

- [ ] **Step 1: Write `apps/api/package.json`**

```json
{
  "name": "@accounting/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint 'src/**/*.ts' 'tests/**/*.ts'",
    "test": "vitest run tests/unit",
    "test:watch": "vitest tests/unit",
    "test:integration": "vitest run tests/integration"
  },
  "dependencies": {
    "@accounting/shared": "*",
    "bcrypt": "^5.1.1",
    "cookie-parser": "^1.4.6",
    "cors": "^2.8.5",
    "decimal.js": "^10.4.3",
    "dotenv": "^16.4.1",
    "express": "^4.18.2",
    "jsonwebtoken": "^9.0.2",
    "kysely": "^0.27.2",
    "pg": "^8.11.3",
    "uuid": "^9.0.1",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "^10.7.0",
    "@types/bcrypt": "^5.0.2",
    "@types/cookie-parser": "^1.4.6",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.5",
    "@types/node": "^20.11.10",
    "@types/pg": "^8.11.0",
    "@types/uuid": "^9.0.8",
    "@typescript-eslint/eslint-plugin": "^6.20.0",
    "@typescript-eslint/parser": "^6.20.0",
    "eslint": "^8.56.0",
    "testcontainers": "^10.7.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3",
    "vitest": "^1.2.2"
  }
}
```

- [ ] **Step 2: Write `apps/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["node"]
  },
  "references": [{ "path": "../../packages/shared" }],
  "include": ["src"],
  "exclude": ["dist", "node_modules", "tests"]
}
```

- [ ] **Step 3: Write placeholder `apps/api/src/index.ts`**

```ts
console.log('accounting api boot placeholder');
```

- [ ] **Step 4: Write `apps/api/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: Write `apps/api/.eslintrc.cjs`**

```js
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'error',
  },
  ignorePatterns: ['dist/', 'node_modules/'],
};
```

- [ ] **Step 6: Install and verify build**

```bash
npm install
npm -w @accounting/api run typecheck
```
Expected: exit 0, no output.

- [ ] **Step 7: Commit**

```bash
git add apps/api package.json package-lock.json
git commit -m "chore(api): scaffold express + kysely package"
```

### Task 5: Web package skeleton with Vite + Tailwind + shadcn

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/tsconfig.node.json`, `apps/web/vite.config.ts`, `apps/web/tailwind.config.ts`, `apps/web/postcss.config.js`, `apps/web/components.json`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/index.css`, `apps/web/src/lib/utils.ts`

- [ ] **Step 1: Write `apps/web/package.json`**

```json
{
  "name": "@accounting/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b --noEmit",
    "lint": "eslint 'src/**/*.{ts,tsx}'",
    "test": "vitest run"
  },
  "dependencies": {
    "@accounting/shared": "*",
    "@radix-ui/react-dialog": "^1.0.5",
    "@radix-ui/react-dropdown-menu": "^2.0.6",
    "@radix-ui/react-label": "^2.0.2",
    "@radix-ui/react-slot": "^1.0.2",
    "axios": "^1.6.7",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "decimal.js": "^10.4.3",
    "lucide-react": "^0.320.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.21.3",
    "tailwind-merge": "^2.2.1",
    "tailwindcss-animate": "^1.0.7"
  },
  "devDependencies": {
    "@types/node": "^20.11.10",
    "@types/react": "^18.2.48",
    "@types/react-dom": "^18.2.18",
    "@typescript-eslint/eslint-plugin": "^6.20.0",
    "@typescript-eslint/parser": "^6.20.0",
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.17",
    "eslint": "^8.56.0",
    "eslint-plugin-react-hooks": "^4.6.0",
    "eslint-plugin-react-refresh": "^0.4.5",
    "postcss": "^8.4.33",
    "tailwindcss": "^3.4.1",
    "typescript": "^5.3.3",
    "vite": "^5.0.12",
    "vitest": "^1.2.2"
  }
}
```

- [ ] **Step 2: Write `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "baseUrl": "./src",
    "paths": { "@/*": ["./*"] }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: Write `apps/web/tsconfig.node.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowSyntheticDefaultImports": true,
    "noEmit": true
  },
  "include": ["vite.config.ts", "tailwind.config.ts"]
}
```

- [ ] **Step 4: Write `apps/web/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: { port: 5173 },
});
```

- [ ] **Step 5: Write `apps/web/tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '2rem', screens: { '2xl': '1400px' } },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
```

- [ ] **Step 6: Write `apps/web/postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 7: Write `apps/web/components.json` (shadcn config)**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

- [ ] **Step 8: Write `apps/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Accounting App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 9: Write `apps/web/src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
  }
  * { @apply border-border; }
  body { @apply bg-background text-foreground; }
}
```

- [ ] **Step 10: Write `apps/web/src/lib/utils.ts`**

```ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 11: Write `apps/web/src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
```

- [ ] **Step 12: Write `apps/web/src/App.tsx`**

```tsx
export default function App() {
  return (
    <div className="min-h-screen grid place-items-center bg-background text-foreground">
      <h1 className="text-2xl font-semibold">Accounting App — Slice 1 scaffold</h1>
    </div>
  );
}
```

- [ ] **Step 13: Install and boot**

```bash
npm install
npm -w @accounting/web run dev
```
Expected: Vite starts on :5173, visiting it shows the placeholder heading.

- [ ] **Step 14: Commit**

```bash
git add apps/web package.json package-lock.json
git commit -m "chore(web): scaffold vite + react + tailwind + shadcn baseline"
```

---

## Phase B — DB infrastructure (Tasks 6–9)

### Task 6: Migration runner

**Files:**
- Create: `bin/migrate.ts`, `db/migrations/0001_extensions.sql`

- [ ] **Step 1: Write `db/migrations/0001_extensions.sql`**

```sql
-- gen_random_uuid() lives in pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- btree_gist is required by the EXCLUDE constraint used on fiscal_periods (plan 1.1)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- citext used for case-insensitive emails
CREATE EXTENSION IF NOT EXISTS citext;
```

- [ ] **Step 2: Write `bin/migrate.ts`**

```ts
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.resolve(__dirname, '../db/migrations');

async function main() {
  const reset = process.argv.includes('--reset');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  if (reset) {
    console.log('Resetting database (DROP SCHEMA public CASCADE)…');
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const files = (await fs.readdir(MIG_DIR))
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const applied = await pool.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
    if ((applied.rowCount ?? 0) > 0) {
      console.log(`SKIP  ${file}`);
      continue;
    }
    console.log(`APPLY ${file}`);
    const sql = await fs.readFile(path.join(MIG_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`FAIL  ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }

  await pool.end();
  console.log('Migrations complete.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Run migrations against local Postgres**

```bash
cp .env.example .env
docker compose up -d postgres
npm run db:migrate
```
Expected: output `APPLY 0001_extensions.sql` then `Migrations complete.`

- [ ] **Step 4: Commit**

```bash
git add bin/migrate.ts db/migrations/0001_extensions.sql
git commit -m "feat(db): add migration runner and extensions migration"
```

### Task 7: Generic updated_at trigger

**Files:**
- Create: `db/migrations/0002_updated_at_function.sql`

- [ ] **Step 1: Write `db/migrations/0002_updated_at_function.sql`**

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 2: Apply and commit**

```bash
npm run db:migrate
git add db/migrations/0002_updated_at_function.sql
git commit -m "feat(db): add generic updated_at trigger function"
```

### Task 8: Core tenancy tables migration

**Files:**
- Create: `db/migrations/0003_core_tables.sql`

- [ ] **Step 1: Write `db/migrations/0003_core_tables.sql`**

```sql
-- Enums
CREATE TYPE user_role AS ENUM ('firm_admin', 'accountant', 'staff', 'client');

-- firms: for Slice 1 there will be exactly one row, but the column is here
-- so multi-firm SaaS is a future migration, not a schema rewrite.
CREATE TABLE firms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_firms_updated_at
  BEFORE UPDATE ON firms FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id),
  name text NOT NULL,
  legal_name text,
  fiscal_year_start_month int NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_businesses_firm ON businesses (firm_id) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_businesses_updated_at
  BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id),
  email citext NOT NULL,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  role user_role NOT NULL,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_users_firm_email ON users (firm_id, email) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_business_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  role_override user_role,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, business_id)
);
CREATE INDEX idx_uba_user ON user_business_access (user_id);
CREATE INDEX idx_uba_business ON user_business_access (business_id);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id) WHERE revoked_at IS NULL;
```

- [ ] **Step 2: Apply and verify**

```bash
npm run db:migrate
psql "$DATABASE_URL" -c "\dt"
```
Expected: shows `_migrations`, `businesses`, `firms`, `refresh_tokens`, `user_business_access`, `users`.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/0003_core_tables.sql
git commit -m "feat(db): add core tenancy tables (firms, businesses, users, access, refresh_tokens)"
```

### Task 9: Audit logs table + append-only trigger

**Files:**
- Create: `db/migrations/0004_audit_logs.sql`

- [ ] **Step 1: Write `db/migrations/0004_audit_logs.sql`**

```sql
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id),
  business_id uuid REFERENCES businesses(id),
  user_id uuid REFERENCES users(id),
  request_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_entity ON audit_logs (business_id, entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_request ON audit_logs (request_id);
CREATE INDEX idx_audit_created ON audit_logs (created_at DESC);

-- Append-only enforcement: no UPDATE, no DELETE, ever.
CREATE OR REPLACE FUNCTION audit_logs_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();

CREATE TRIGGER trg_audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
```

- [ ] **Step 2: Apply and verify triggers exist**

```bash
npm run db:migrate
psql "$DATABASE_URL" -c "SELECT tgname FROM pg_trigger WHERE tgrelid = 'audit_logs'::regclass AND NOT tgisinternal;"
```
Expected: lists `trg_audit_logs_no_update`, `trg_audit_logs_no_delete`.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/0004_audit_logs.sql
git commit -m "feat(db): add audit_logs table with append-only trigger"
```

---

## Phase C — Shared package content (Tasks 10–13)

### Task 10: Roles constants

**Files:**
- Create: `packages/shared/src/roles.ts`, `packages/shared/src/roles.test.ts`

- [ ] **Step 1: Write the failing test `packages/shared/src/roles.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { ROLES, ROLE_RANK, hasMinRole } from './roles.js';

describe('roles', () => {
  it('ranks firm_admin highest, client lowest', () => {
    expect(ROLE_RANK[ROLES.FIRM_ADMIN]).toBeGreaterThan(ROLE_RANK[ROLES.ACCOUNTANT]);
    expect(ROLE_RANK[ROLES.ACCOUNTANT]).toBeGreaterThan(ROLE_RANK[ROLES.STAFF]);
    expect(ROLE_RANK[ROLES.STAFF]).toBeGreaterThan(ROLE_RANK[ROLES.CLIENT]);
  });

  it('hasMinRole: accountant meets accountant', () => {
    expect(hasMinRole('accountant', 'accountant')).toBe(true);
  });

  it('hasMinRole: staff does not meet accountant', () => {
    expect(hasMinRole('staff', 'accountant')).toBe(false);
  });

  it('hasMinRole: firm_admin meets everything', () => {
    expect(hasMinRole('firm_admin', 'client')).toBe(true);
    expect(hasMinRole('firm_admin', 'firm_admin')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect fail**

```bash
npm -w @accounting/shared test
```
Expected: FAIL "Cannot find module './roles.js'".

- [ ] **Step 3: Implement `packages/shared/src/roles.ts`**

```ts
export const ROLES = {
  FIRM_ADMIN: 'firm_admin',
  ACCOUNTANT: 'accountant',
  STAFF: 'staff',
  CLIENT: 'client',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_RANK: Record<Role, number> = {
  firm_admin: 40,
  accountant: 30,
  staff: 20,
  client: 10,
};

export function hasMinRole(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
npm -w @accounting/shared test
```
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/roles.ts packages/shared/src/roles.test.ts
git commit -m "feat(shared): roles constants + hasMinRole helper"
```

### Task 11: Error codes registry

**Files:**
- Create: `packages/shared/src/errorCodes.ts`

- [ ] **Step 1: Write `packages/shared/src/errorCodes.ts`**

```ts
export const ERR = {
  // Input
  VALIDATION_FAILED: 'VALIDATION_FAILED',

  // Auth
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',

  // Resource
  NOT_FOUND: 'NOT_FOUND',

  // Business rules (used by 1.1 and 1.2 as well)
  CLOSED_PERIOD: 'CLOSED_PERIOD',
  UNBALANCED_ENTRY: 'UNBALANCED_ENTRY',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  IMMUTABLE_RECORD: 'IMMUTABLE_RECORD',
  OVERAPPLICATION: 'OVERAPPLICATION',
  DUPLICATE_RESOURCE: 'DUPLICATE_RESOURCE',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',

  // Fallback
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ERR)[keyof typeof ERR];
```

- [ ] **Step 2: Commit (no test — this is a constants file, consumed by later typed code)**

```bash
git add packages/shared/src/errorCodes.ts
git commit -m "feat(shared): error codes registry"
```

### Task 12: Audit actions registry

**Files:**
- Create: `packages/shared/src/auditActions.ts`

- [ ] **Step 1: Write `packages/shared/src/auditActions.ts`**

```ts
// Action names are dotted strings namespaced by entity. Plans 1.1 and 1.2
// will append their own constants here via subsequent commits — do not split
// this file.
export const AUDIT = {
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGIN_FAILED: 'auth.login_failed',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_REFRESH: 'auth.refresh',

  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_DELETE: 'user.delete',

  BUSINESS_CREATE: 'business.create',
  BUSINESS_UPDATE: 'business.update',

  USER_BUSINESS_ACCESS_GRANT: 'user_business_access.grant',
  USER_BUSINESS_ACCESS_REVOKE: 'user_business_access.revoke',
} as const;

export type AuditAction = (typeof AUDIT)[keyof typeof AUDIT];
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/src/auditActions.ts
git commit -m "feat(shared): audit actions registry"
```

### Task 13: Auth zod schemas + decimal helpers

**Files:**
- Create: `packages/shared/src/decimal.ts`, `packages/shared/src/decimal.test.ts`, `packages/shared/src/schemas/index.ts`, `packages/shared/src/schemas/auth.ts`

- [ ] **Step 1: Write decimal test `packages/shared/src/decimal.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { D, toMoneyString, parseMoney, addMoney, subMoney, mulMoney, roundMoney } from './decimal.js';

describe('decimal helpers', () => {
  it('toMoneyString always returns 4 decimals', () => {
    expect(toMoneyString(D(5))).toBe('5.0000');
    expect(toMoneyString(D('3.1'))).toBe('3.1000');
  });

  it('addMoney sums without float drift', () => {
    expect(toMoneyString(addMoney('0.1', '0.2'))).toBe('0.3000');
  });

  it('subMoney subtracts', () => {
    expect(toMoneyString(subMoney('10.00', '3.3333'))).toBe('6.6667');
  });

  it('mulMoney multiplies', () => {
    expect(toMoneyString(mulMoney('100.00', '0.0875'))).toBe('8.7500');
  });

  it('roundMoney rounds half-even to 4dp', () => {
    expect(toMoneyString(roundMoney('1.12345'))).toBe('1.1234');
    expect(toMoneyString(roundMoney('1.12355'))).toBe('1.1236');
  });

  it('parseMoney throws on non-numeric', () => {
    expect(() => parseMoney('abc')).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module not found)**

```bash
npm -w @accounting/shared test
```

- [ ] **Step 3: Implement `packages/shared/src/decimal.ts`**

```ts
import Decimal from 'decimal.js';

// 4dp money, half-even rounding (banker's rounding) — the standard for accounting.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export type MoneyInput = Decimal | string | number;

export function D(v: MoneyInput): Decimal {
  if (v instanceof Decimal) return v;
  return new Decimal(v);
}

export function parseMoney(v: MoneyInput): Decimal {
  const d = D(v);
  if (d.isNaN()) throw new Error(`Invalid money value: ${String(v)}`);
  return d;
}

export function addMoney(a: MoneyInput, b: MoneyInput): Decimal {
  return D(a).plus(D(b));
}

export function subMoney(a: MoneyInput, b: MoneyInput): Decimal {
  return D(a).minus(D(b));
}

export function mulMoney(a: MoneyInput, b: MoneyInput): Decimal {
  return D(a).times(D(b));
}

export function roundMoney(v: MoneyInput): Decimal {
  return D(v).toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN);
}

export function toMoneyString(v: MoneyInput): string {
  return roundMoney(v).toFixed(4);
}

export function equalMoney(a: MoneyInput, b: MoneyInput): boolean {
  return roundMoney(a).equals(roundMoney(b));
}

export function isZero(v: MoneyInput): boolean {
  return roundMoney(v).isZero();
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm -w @accounting/shared test
```

- [ ] **Step 5: Write `packages/shared/src/schemas/index.ts`**

```ts
export * from './auth.js';
```

- [ ] **Step 6: Write `packages/shared/src/schemas/auth.ts`**

```ts
import { z } from 'zod';

export const loginRequestSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const loginResponseSchema = z.object({
  access_token: z.string(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    full_name: z.string(),
    role: z.enum(['firm_admin', 'accountant', 'staff', 'client']),
    firm_id: z.string().uuid(),
  }),
  businesses: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    role_override: z.enum(['firm_admin', 'accountant', 'staff', 'client']).nullable(),
  })),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;
```

- [ ] **Step 7: Build shared to ensure downstream apps can import**

```bash
npm -w @accounting/shared run build
```
Expected: `dist/` populated.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/decimal.ts packages/shared/src/decimal.test.ts packages/shared/src/schemas/
git commit -m "feat(shared): decimal helpers + auth zod schemas"
```

---

## Phase D — API auth + audit (Tasks 14–22)

### Task 14: API config + BusinessRuleError + ServiceCtx

**Files:**
- Create: `apps/api/src/config.ts`, `apps/api/src/lib/errors.ts`, `apps/api/src/lib/ctx.ts`

- [ ] **Step 1: Write `apps/api/src/config.ts`**

```ts
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(4000),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(180),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export const config = schema.parse(process.env);
export const corsOrigins = config.CORS_ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
```

- [ ] **Step 2: Write `apps/api/src/lib/errors.ts`**

```ts
import { ERR, type ErrorCode } from '@accounting/shared';

export class BusinessRuleError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BusinessRuleError';
  }
}

export class AuthError extends BusinessRuleError {
  constructor(code: typeof ERR.UNAUTHORIZED | typeof ERR.INVALID_CREDENTIALS | typeof ERR.TOKEN_EXPIRED | typeof ERR.FORBIDDEN, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = 'AuthError';
  }
}

export class NotFoundError extends BusinessRuleError {
  constructor(entity: string, id?: string) {
    super(ERR.NOT_FOUND, `${entity} not found${id ? `: ${id}` : ''}`, { entity, id });
    this.name = 'NotFoundError';
  }
}

export function codeToHttpStatus(code: ErrorCode): number {
  switch (code) {
    case ERR.VALIDATION_FAILED: return 400;
    case ERR.UNAUTHORIZED:
    case ERR.TOKEN_EXPIRED:
    case ERR.INVALID_CREDENTIALS: return 401;
    case ERR.FORBIDDEN: return 403;
    case ERR.NOT_FOUND: return 404;
    case ERR.CLOSED_PERIOD:
    case ERR.UNBALANCED_ENTRY:
    case ERR.INVALID_STATE_TRANSITION:
    case ERR.IMMUTABLE_RECORD:
    case ERR.OVERAPPLICATION:
    case ERR.DUPLICATE_RESOURCE:
    case ERR.PRECONDITION_FAILED: return 409;
    case ERR.INTERNAL:
    default: return 500;
  }
}
```

- [ ] **Step 3: Write `apps/api/src/lib/ctx.ts`**

```ts
import type { Role } from '@accounting/shared';

export type ServiceCtx = {
  user_id: string;
  firm_id: string;
  business_id: string | null;
  effective_role: Role;
  request_id: string;
  ip_address: string;
  user_agent: string;
};

// Convenience for tests and system-initiated code paths (seed, admin scripts).
export function systemCtx(overrides: Partial<ServiceCtx> & Pick<ServiceCtx, 'firm_id'>): ServiceCtx {
  return {
    user_id: '00000000-0000-0000-0000-000000000000',
    business_id: null,
    effective_role: 'firm_admin',
    request_id: '00000000-0000-0000-0000-000000000000',
    ip_address: '127.0.0.1',
    user_agent: 'system',
    ...overrides,
  };
}
```

- [ ] **Step 4: Typecheck and commit**

```bash
npm -w @accounting/api run typecheck
git add apps/api/src/config.ts apps/api/src/lib/
git commit -m "feat(api): config, BusinessRuleError, ServiceCtx"
```

### Task 15: Kysely DB types + connection

**Files:**
- Create: `apps/api/src/db/types.ts`, `apps/api/src/db/index.ts`

- [ ] **Step 1: Write `apps/api/src/db/types.ts`**

```ts
import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, string | Date, string | Date>;

export type UserRole = 'firm_admin' | 'accountant' | 'staff' | 'client';

export interface FirmsTable {
  id: Generated<string>;
  name: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface BusinessesTable {
  id: Generated<string>;
  firm_id: string;
  name: string;
  legal_name: string | null;
  fiscal_year_start_month: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface UsersTable {
  id: Generated<string>;
  firm_id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: UserRole;
  last_login_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface UserBusinessAccessTable {
  id: Generated<string>;
  user_id: string;
  business_id: string;
  role_override: UserRole | null;
  created_at: Generated<Timestamp>;
}

export interface RefreshTokensTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  last_used_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export interface AuditLogsTable {
  id: Generated<string>;
  firm_id: string;
  business_id: string | null;
  user_id: string | null;
  request_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_state: unknown | null;
  after_state: unknown | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Generated<Timestamp>;
}

export interface DB {
  firms: FirmsTable;
  businesses: BusinessesTable;
  users: UsersTable;
  user_business_access: UserBusinessAccessTable;
  refresh_tokens: RefreshTokensTable;
  audit_logs: AuditLogsTable;
  // 1.1 and 1.2 will extend DB in later tasks by augmenting this interface
  // via module augmentation. Keep this interface open to extension.
}
```

- [ ] **Step 2: Write `apps/api/src/db/index.ts`**

```ts
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { config } from '../config.js';
import type { DB } from './types.js';

// Parse numeric (OID 1700) as a STRING, not JS number — preserves precision.
// Uses pg.types.setTypeParser; safe to run at module load.
pg.types.setTypeParser(1700, (val) => val);

export function makeDb(connectionString = config.DATABASE_URL): Kysely<DB> {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

// A long-lived instance used by routes. Tests create their own via makeDb().
export const db: Kysely<DB> = makeDb();

export type { DB };
```

- [ ] **Step 3: Typecheck**

```bash
npm -w @accounting/api run typecheck
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/
git commit -m "feat(api): kysely DB types + numeric-as-string parser"
```

### Task 16: Password hasher (TDD)

**Files:**
- Create: `apps/api/src/services/auth/passwordHasher.ts`, `apps/api/tests/unit/passwordHasher.test.ts`

- [ ] **Step 1: Write failing test `apps/api/tests/unit/passwordHasher.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/services/auth/passwordHasher.js';

describe('passwordHasher', () => {
  it('produces a hash that verifies', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(hash).not.toBe('correct-horse-battery-staple');
    expect(await verifyPassword('correct-horse-battery-staple', hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('secret123');
    expect(await verifyPassword('not-it', hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm -w @accounting/api test
```

- [ ] **Step 3: Implement `apps/api/src/services/auth/passwordHasher.ts`**

```ts
import bcrypt from 'bcrypt';

const ROUNDS = 12;

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, ROUNDS);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm -w @accounting/api test
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/auth/passwordHasher.ts apps/api/tests/unit/passwordHasher.test.ts
git commit -m "feat(api): bcrypt password hasher with tests"
```

### Task 17: Token service (TDD)

**Files:**
- Create: `apps/api/src/services/auth/tokenService.ts`, `apps/api/tests/unit/tokenService.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/api/tests/unit/tokenService.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
} from '../../src/services/auth/tokenService.js';

describe('tokenService', () => {
  const sample = {
    user_id: '11111111-1111-1111-1111-111111111111',
    firm_id: '22222222-2222-2222-2222-222222222222',
    role: 'accountant' as const,
  };

  it('signs and verifies access token', () => {
    const tok = signAccessToken(sample);
    const claims = verifyAccessToken(tok);
    expect(claims.user_id).toBe(sample.user_id);
    expect(claims.firm_id).toBe(sample.firm_id);
    expect(claims.role).toBe('accountant');
  });

  it('rejects tampered access token', () => {
    const tok = signAccessToken(sample);
    const tampered = tok.slice(0, -2) + 'XX';
    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it('generates refresh token of sufficient entropy', () => {
    const t1 = generateRefreshToken();
    const t2 = generateRefreshToken();
    expect(t1).not.toBe(t2);
    expect(t1.length).toBeGreaterThanOrEqual(43); // base64 of 32 bytes
  });

  it('hashes refresh token deterministically for lookup', async () => {
    const raw = generateRefreshToken();
    const h1 = await hashRefreshToken(raw);
    const h2 = await hashRefreshToken(raw);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(raw);
  });
});
```

- [ ] **Step 2: Implement `apps/api/src/services/auth/tokenService.ts`**

```ts
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import type { UserRole } from '../../db/types.js';

type AccessClaims = {
  user_id: string;
  firm_id: string;
  role: UserRole;
};

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, config.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: `${config.JWT_ACCESS_TTL_MINUTES}m`,
  });
}

export function verifyAccessToken(token: string): AccessClaims & { iat: number; exp: number } {
  const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  if (typeof decoded === 'string') throw new Error('unexpected string JWT');
  return decoded as AccessClaims & { iat: number; exp: number };
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

// Deterministic so we can look up rows by hash. HMAC with refresh secret.
export async function hashRefreshToken(raw: string): Promise<string> {
  return crypto.createHmac('sha256', config.JWT_REFRESH_SECRET).update(raw).digest('hex');
}
```

- [ ] **Step 3: Run tests — ensure unit tests pass (this test requires env vars; set them in a test bootstrap)**

Create `apps/api/tests/setup.ts`:
```ts
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://accounting:accounting@localhost:5432/accounting';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-access-secret-at-least-16-chars';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-at-least-16';
```

Update `apps/api/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
});
```

- [ ] **Step 4: Run and commit**

```bash
npm -w @accounting/api test
git add apps/api/src/services/auth/tokenService.ts apps/api/tests/unit/tokenService.test.ts apps/api/tests/setup.ts apps/api/vitest.config.ts
git commit -m "feat(api): JWT token service with tests"
```

### Task 18: Testcontainers helper

**Files:**
- Create: `apps/api/tests/helpers/testDb.ts`

- [ ] **Step 1: Write the helper**

```ts
// apps/api/tests/helpers/testDb.ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { DB } from '../../src/db/types.js';

pg.types.setTypeParser(1700, (val) => val);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.resolve(__dirname, '../../../../db/migrations');

export type TestDb = {
  container: StartedPostgreSqlContainer;
  pool: pg.Pool;
  db: Kysely<DB>;
  url: string;
};

let shared: TestDb | null = null;

export async function startTestDb(): Promise<TestDb> {
  if (shared) return shared;
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('accounting')
    .withUsername('accounting')
    .withPassword('accounting')
    .start();
  const url = container.getConnectionUri();
  const pool = new pg.Pool({ connectionString: url });
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  await runMigrations(pool);
  shared = { container, pool, db, url };
  return shared;
}

export async function stopTestDb(): Promise<void> {
  if (!shared) return;
  await shared.db.destroy();
  await shared.pool.end();
  await shared.container.stop();
  shared = null;
}

async function runMigrations(pool: pg.Pool) {
  const files = (await fs.readdir(MIG_DIR)).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const text = await fs.readFile(path.join(MIG_DIR, file), 'utf8');
    await pool.query(text);
  }
}

// Wipe row data between tests but keep schema. Faster than recreating container.
export async function truncateAll(db: Kysely<DB>) {
  await sql`
    TRUNCATE
      audit_logs,
      refresh_tokens,
      user_business_access,
      users,
      businesses,
      firms
    RESTART IDENTITY CASCADE;
  `.execute(db);
}
```

- [ ] **Step 2: Commit (no test — tested transitively by first integration test)**

```bash
git add apps/api/tests/helpers/testDb.ts
git commit -m "test(api): testcontainers postgres helper"
```

### Task 19: Factories for integration tests

**Files:**
- Create: `apps/api/tests/helpers/factories.ts`

- [ ] **Step 1: Write**

```ts
// apps/api/tests/helpers/factories.ts
import { Kysely } from 'kysely';
import type { DB, UserRole } from '../../src/db/types.js';
import { hashPassword } from '../../src/services/auth/passwordHasher.js';

export async function makeFirm(db: Kysely<DB>, name = 'Test Firm'): Promise<{ id: string; name: string }> {
  const row = await db.insertInto('firms').values({ name }).returningAll().executeTakeFirstOrThrow();
  return { id: row.id, name: row.name };
}

export async function makeBusiness(db: Kysely<DB>, firm_id: string, name = 'Test Business') {
  const row = await db.insertInto('businesses').values({ firm_id, name }).returningAll().executeTakeFirstOrThrow();
  return row;
}

export async function makeUser(
  db: Kysely<DB>,
  firm_id: string,
  opts: { email?: string; password?: string; role?: UserRole; full_name?: string } = {},
) {
  const {
    email = `user-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password = 'test-password-123',
    role = 'accountant',
    full_name = 'Test User',
  } = opts;
  const password_hash = await hashPassword(password);
  const row = await db.insertInto('users')
    .values({ firm_id, email, password_hash, full_name, role })
    .returningAll()
    .executeTakeFirstOrThrow();
  return { ...row, plaintext_password: password };
}

export async function grantAccess(db: Kysely<DB>, user_id: string, business_id: string, role_override: UserRole | null = null) {
  return db.insertInto('user_business_access')
    .values({ user_id, business_id, role_override })
    .returningAll()
    .executeTakeFirstOrThrow();
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/tests/helpers/factories.ts
git commit -m "test(api): factories for firm/business/user"
```

### Task 20: Audit service (TDD, integration test)

**Files:**
- Create: `apps/api/src/services/audit/auditService.ts`, `apps/api/tests/integration/auditService.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/api/tests/integration/auditService.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeUser } from '../helpers/factories.js';
import { record } from '../../src/services/audit/auditService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

describe('auditService', () => {
  let t: TestDb;

  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('writes a row in the same transaction', async () => {
    const firm = await makeFirm(t.db);
    const user = await makeUser(t.db, firm.id);
    const ctx: ServiceCtx = {
      user_id: user.id, firm_id: firm.id, business_id: null,
      effective_role: 'accountant', request_id: '00000000-0000-0000-0000-000000000001',
      ip_address: '127.0.0.1', user_agent: 'vitest',
    };
    await t.db.transaction().execute(async (trx) => {
      await record(trx, ctx, {
        action: 'auth.login',
        entity_type: 'user',
        entity_id: user.id,
        before: null,
        after: { email: user.email },
      });
    });
    const rows = await t.db.selectFrom('audit_logs').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('auth.login');
    expect(rows[0]!.entity_id).toBe(user.id);
  });

  it('rolls back audit row if caller transaction rolls back', async () => {
    const firm = await makeFirm(t.db);
    const user = await makeUser(t.db, firm.id);
    const ctx: ServiceCtx = {
      user_id: user.id, firm_id: firm.id, business_id: null,
      effective_role: 'accountant', request_id: '00000000-0000-0000-0000-000000000002',
      ip_address: '127.0.0.1', user_agent: 'vitest',
    };
    await expect(t.db.transaction().execute(async (trx) => {
      await record(trx, ctx, {
        action: 'auth.login', entity_type: 'user', entity_id: user.id,
        before: null, after: { email: user.email },
      });
      throw new Error('boom');
    })).rejects.toThrow('boom');
    const rows = await t.db.selectFrom('audit_logs').selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it('audit_logs is append-only (UPDATE raises)', async () => {
    const firm = await makeFirm(t.db);
    const user = await makeUser(t.db, firm.id);
    const ctx: ServiceCtx = {
      user_id: user.id, firm_id: firm.id, business_id: null,
      effective_role: 'accountant', request_id: '00000000-0000-0000-0000-000000000003',
      ip_address: '127.0.0.1', user_agent: 'vitest',
    };
    await t.db.transaction().execute(async (trx) => {
      await record(trx, ctx, { action: 'auth.login', entity_type: 'user', entity_id: user.id, before: null, after: null });
    });
    await expect(
      t.db.updateTable('audit_logs').set({ action: 'auth.logout' }).execute()
    ).rejects.toThrow(/append-only/i);
  });
});
```

- [ ] **Step 2: Implement `apps/api/src/services/audit/auditService.ts`**

```ts
import type { Transaction } from 'kysely';
import type { DB } from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type AuditInput = {
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: unknown | null;
  after: unknown | null;
};

export async function record(
  trx: Transaction<DB>,
  ctx: ServiceCtx,
  input: AuditInput,
): Promise<void> {
  await trx.insertInto('audit_logs').values({
    firm_id: ctx.firm_id,
    business_id: ctx.business_id,
    user_id: ctx.user_id === '00000000-0000-0000-0000-000000000000' ? null : ctx.user_id,
    request_id: ctx.request_id,
    action: input.action,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    before_state: input.before === null ? null : JSON.stringify(input.before),
    after_state: input.after === null ? null : JSON.stringify(input.after),
    ip_address: ctx.ip_address,
    user_agent: ctx.user_agent,
  }).execute();
}
```

- [ ] **Step 3: Run integration tests**

```bash
npm -w @accounting/api run test:integration
```
Expected: 3 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/audit/auditService.ts apps/api/tests/integration/auditService.test.ts
git commit -m "feat(api): audit service with atomic + append-only tests"
```

### Task 21: Auth service (TDD, integration)

**Files:**
- Create: `apps/api/src/services/auth/authService.ts`, `apps/api/tests/integration/authService.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/api/tests/integration/authService.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess } from '../helpers/factories.js';
import { login, refresh, logout } from '../../src/services/auth/authService.js';
import { AuthError } from '../../src/lib/errors.js';

const reqMeta = { request_id: '00000000-0000-0000-0000-0000000000aa', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('authService.login', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('issues access + refresh on valid creds, writes audit row', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id, 'Biz 1');
    const user = await makeUser(t.db, firm.id, { email: 'a@x.com', password: 'pw12345678' });
    await grantAccess(t.db, user.id, biz.id);
    const out = await login(t.db, { email: 'a@x.com', password: 'pw12345678' }, reqMeta);
    expect(out.access_token).toBeTruthy();
    expect(out.refresh_token).toBeTruthy();
    expect(out.user.id).toBe(user.id);
    expect(out.businesses).toHaveLength(1);
    const audits = await t.db.selectFrom('audit_logs').selectAll().execute();
    expect(audits.map(a => a.action)).toContain('auth.login');
  });

  it('rejects wrong password, writes auth.login_failed audit', async () => {
    const firm = await makeFirm(t.db);
    const user = await makeUser(t.db, firm.id, { email: 'a@x.com', password: 'pw12345678' });
    await expect(login(t.db, { email: 'a@x.com', password: 'wrongpass' }, reqMeta)).rejects.toBeInstanceOf(AuthError);
    const audits = await t.db.selectFrom('audit_logs').selectAll().execute();
    expect(audits.map(a => a.action)).toContain('auth.login_failed');
    void user;
  });

  it('rejects unknown email with same AuthError (no user enumeration)', async () => {
    const firm = await makeFirm(t.db);
    await makeUser(t.db, firm.id, { email: 'a@x.com', password: 'pw12345678' });
    await expect(login(t.db, { email: 'b@x.com', password: 'pw12345678' }, reqMeta)).rejects.toBeInstanceOf(AuthError);
  });

  it('refresh rotates the refresh token and revokes the old one', async () => {
    const firm = await makeFirm(t.db);
    const user = await makeUser(t.db, firm.id, { email: 'a@x.com', password: 'pw12345678' });
    void user;
    const first = await login(t.db, { email: 'a@x.com', password: 'pw12345678' }, reqMeta);
    const second = await refresh(t.db, first.refresh_token, reqMeta);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    // Old token is now rejected
    await expect(refresh(t.db, first.refresh_token, reqMeta)).rejects.toBeInstanceOf(AuthError);
  });

  it('logout revokes the refresh token', async () => {
    const firm = await makeFirm(t.db);
    await makeUser(t.db, firm.id, { email: 'a@x.com', password: 'pw12345678' });
    const first = await login(t.db, { email: 'a@x.com', password: 'pw12345678' }, reqMeta);
    await logout(t.db, first.refresh_token, reqMeta);
    await expect(refresh(t.db, first.refresh_token, reqMeta)).rejects.toBeInstanceOf(AuthError);
  });
});
```

- [ ] **Step 2: Implement `apps/api/src/services/auth/authService.ts`**

```ts
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB, UserRole } from '../../db/types.js';
import { AuthError } from '../../lib/errors.js';
import { config } from '../../config.js';
import { verifyPassword } from './passwordHasher.js';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from './tokenService.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type LoginInput = { email: string; password: string };
export type ReqMeta = { request_id: string; ip_address: string; user_agent: string };

export type LoginResult = {
  access_token: string;
  refresh_token: string; // raw; API caller is responsible for cookie-setting
  user: { id: string; email: string; full_name: string; role: UserRole; firm_id: string };
  businesses: Array<{ id: string; name: string; role_override: UserRole | null }>;
};

function ctxFromLogin(user: { id: string; firm_id: string; role: UserRole }, meta: ReqMeta): ServiceCtx {
  return {
    user_id: user.id,
    firm_id: user.firm_id,
    business_id: null,
    effective_role: user.role,
    ...meta,
  };
}

export async function login(db: Kysely<DB>, input: LoginInput, meta: ReqMeta): Promise<LoginResult> {
  return db.transaction().execute(async (trx) => {
    const user = await trx
      .selectFrom('users')
      .selectAll()
      .where('email', '=', input.email)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    if (!user || !(await verifyPassword(input.password, user.password_hash))) {
      // Log attempt with whatever ctx we can reconstruct. If user unknown, firm_id is null —
      // store under a sentinel firm? The spec says audit_logs.firm_id NOT NULL. For
      // login_failed on unknown users, skip the audit write (can't attribute to a firm).
      if (user) {
        await auditRecord(trx, ctxFromLogin(user, meta), {
          action: AUDIT.AUTH_LOGIN_FAILED,
          entity_type: 'user',
          entity_id: user.id,
          before: null,
          after: { email: input.email },
        });
      }
      throw new AuthError(ERR.INVALID_CREDENTIALS, 'Invalid email or password');
    }

    const raw = generateRefreshToken();
    const token_hash = await hashRefreshToken(raw);
    const expires_at = new Date(Date.now() + config.JWT_REFRESH_TTL_DAYS * 24 * 3600 * 1000);
    await trx.insertInto('refresh_tokens').values({
      user_id: user.id, token_hash, expires_at: expires_at.toISOString() as unknown as string,
    }).execute();

    await trx.updateTable('users').set({ last_login_at: sql`now()` }).where('id', '=', user.id).execute();

    const businesses = await trx
      .selectFrom('user_business_access as uba')
      .innerJoin('businesses as b', 'b.id', 'uba.business_id')
      .select(['b.id', 'b.name', 'uba.role_override'])
      .where('uba.user_id', '=', user.id)
      .where('b.deleted_at', 'is', null)
      .execute();

    await auditRecord(trx, ctxFromLogin(user, meta), {
      action: AUDIT.AUTH_LOGIN,
      entity_type: 'user',
      entity_id: user.id,
      before: null,
      after: { email: user.email },
    });

    return {
      access_token: signAccessToken({ user_id: user.id, firm_id: user.firm_id, role: user.role }),
      refresh_token: raw,
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, firm_id: user.firm_id },
      businesses,
    };
  });
}

export async function refresh(db: Kysely<DB>, rawRefreshToken: string, meta: ReqMeta): Promise<LoginResult> {
  return db.transaction().execute(async (trx) => {
    const token_hash = await hashRefreshToken(rawRefreshToken);
    const row = await trx
      .selectFrom('refresh_tokens')
      .selectAll()
      .where('token_hash', '=', token_hash)
      .executeTakeFirst();
    if (!row || row.revoked_at !== null || new Date(row.expires_at).getTime() < Date.now()) {
      throw new AuthError(ERR.TOKEN_EXPIRED, 'Refresh token invalid or expired');
    }
    const user = await trx.selectFrom('users').selectAll().where('id', '=', row.user_id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!user) throw new AuthError(ERR.UNAUTHORIZED, 'User no longer exists');

    // rotate
    await trx.updateTable('refresh_tokens').set({ revoked_at: sql`now()` }).where('id', '=', row.id).execute();
    const newRaw = generateRefreshToken();
    const newHash = await hashRefreshToken(newRaw);
    const expires_at = new Date(Date.now() + config.JWT_REFRESH_TTL_DAYS * 24 * 3600 * 1000);
    await trx.insertInto('refresh_tokens').values({
      user_id: user.id, token_hash: newHash, expires_at: expires_at.toISOString() as unknown as string,
    }).execute();

    const businesses = await trx
      .selectFrom('user_business_access as uba')
      .innerJoin('businesses as b', 'b.id', 'uba.business_id')
      .select(['b.id', 'b.name', 'uba.role_override'])
      .where('uba.user_id', '=', user.id)
      .where('b.deleted_at', 'is', null)
      .execute();

    await auditRecord(trx, ctxFromLogin(user, meta), {
      action: AUDIT.AUTH_REFRESH,
      entity_type: 'user',
      entity_id: user.id,
      before: null,
      after: null,
    });

    return {
      access_token: signAccessToken({ user_id: user.id, firm_id: user.firm_id, role: user.role }),
      refresh_token: newRaw,
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, firm_id: user.firm_id },
      businesses,
    };
  });
}

export async function logout(db: Kysely<DB>, rawRefreshToken: string, meta: ReqMeta): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const token_hash = await hashRefreshToken(rawRefreshToken);
    const row = await trx.selectFrom('refresh_tokens').selectAll().where('token_hash', '=', token_hash).executeTakeFirst();
    if (!row || row.revoked_at !== null) return; // idempotent
    await trx.updateTable('refresh_tokens').set({ revoked_at: sql`now()` }).where('id', '=', row.id).execute();
    const user = await trx.selectFrom('users').selectAll().where('id', '=', row.user_id).executeTakeFirst();
    if (user) {
      await auditRecord(trx, ctxFromLogin(user, meta), {
        action: AUDIT.AUTH_LOGOUT,
        entity_type: 'user',
        entity_id: user.id,
        before: null,
        after: null,
      });
    }
  });
}
```

- [ ] **Step 3: Run tests — expect PASS**

```bash
npm -w @accounting/api run test:integration
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/auth/authService.ts apps/api/tests/integration/authService.test.ts
git commit -m "feat(api): auth service (login/refresh/logout) with audit"
```

### Task 22: /auth/login, /auth/refresh, /auth/logout, /me routes

**Files:**
- Create: `apps/api/src/routes/auth.ts`, `apps/api/src/routes/me.ts`, `apps/api/src/routes/health.ts`

- [ ] **Step 1: Write `apps/api/src/routes/health.ts`**

```ts
import { Router } from 'express';
const router = Router();
router.get('/health', (_req, res) => res.json({ status: 'ok' }));
export default router;
```

- [ ] **Step 2: Write `apps/api/src/routes/auth.ts`**

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { login, refresh, logout } from '../services/auth/authService.js';
import { config } from '../config.js';

const router = Router();

function reqMeta(req: Request) {
  return {
    request_id: req.headers['x-request-id'] as string ?? crypto.randomUUID(),
    ip_address: req.ip ?? '0.0.0.0',
    user_agent: req.headers['user-agent'] ?? '',
  };
}

const REFRESH_COOKIE = 'acct_rt';

function setRefreshCookie(res: Response, raw: string) {
  const maxAge = config.JWT_REFRESH_TTL_DAYS * 24 * 3600 * 1000;
  res.cookie(REFRESH_COOKIE, raw, {
    httpOnly: true,
    secure: config.NODE_ENV !== 'development',
    sameSite: config.NODE_ENV === 'development' ? 'lax' : 'none',
    maxAge,
    path: '/auth',
  });
}

router.post('/auth/login', async (req, res, next) => {
  try {
    const body = schemas.loginRequestSchema.parse(req.body);
    const out = await login(db, body, reqMeta(req));
    setRefreshCookie(res, out.refresh_token);
    const { refresh_token: _rt, ...publicOut } = out;
    void _rt;
    res.json(publicOut);
  } catch (e) { next(e); }
});

router.post('/auth/refresh', async (req, res, next) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!raw) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No refresh cookie' } });
    const out = await refresh(db, raw, reqMeta(req));
    setRefreshCookie(res, out.refresh_token);
    const { refresh_token: _rt, ...publicOut } = out;
    void _rt;
    res.json(publicOut);
  } catch (e) { next(e); }
});

router.post('/auth/logout', async (req, res, next) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (raw) await logout(db, raw, reqMeta(req));
    res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
```

- [ ] **Step 3: Write `apps/api/src/routes/me.ts`**

```ts
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';

const router = Router();

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { user_id } = req.auth!;
    const user = await db.selectFrom('users')
      .select(['id', 'email', 'full_name', 'role', 'firm_id'])
      .where('id', '=', user_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    const businesses = await db.selectFrom('user_business_access as uba')
      .innerJoin('businesses as b', 'b.id', 'uba.business_id')
      .select(['b.id', 'b.name', 'uba.role_override'])
      .where('uba.user_id', '=', user_id)
      .where('b.deleted_at', 'is', null)
      .execute();
    res.json({ user, businesses });
  } catch (e) { next(e); }
});

export default router;
```

- [ ] **Step 4: Commit (bootstrap happens in next task; auth middleware in task 23)**

```bash
git add apps/api/src/routes/
git commit -m "feat(api): auth and /me routes"
```

---

## Phase E — API middleware + bootstrap (Tasks 23–27)

### Task 23: Auth middleware

**Files:**
- Create: `apps/api/src/middleware/auth.ts`, `apps/api/src/middleware/requestId.ts`

- [ ] **Step 1: Write `apps/api/src/middleware/requestId.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      request_id: string;
      auth?: { user_id: string; firm_id: string; role: import('../db/types.js').UserRole };
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  req.request_id = incoming && /^[0-9a-f-]{36}$/i.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.request_id);
  next();
}
```

- [ ] **Step 2: Write `apps/api/src/middleware/auth.ts`**

```ts
import type { Request, Response, NextFunction } from 'express';
import { AuthError } from '../lib/errors.js';
import { ERR } from '@accounting/shared';
import { verifyAccessToken } from '../services/auth/tokenService.js';

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const auth = req.header('authorization');
    if (!auth?.startsWith('Bearer ')) throw new AuthError(ERR.UNAUTHORIZED, 'Missing Bearer token');
    const claims = verifyAccessToken(auth.slice('Bearer '.length));
    req.auth = { user_id: claims.user_id, firm_id: claims.firm_id, role: claims.role };
    next();
  } catch (err) {
    if (err instanceof AuthError) next(err);
    else next(new AuthError(ERR.TOKEN_EXPIRED, 'Invalid or expired token'));
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/middleware/requestId.ts apps/api/src/middleware/auth.ts
git commit -m "feat(api): requestId + requireAuth middleware"
```

### Task 24: Tenancy + RBAC middleware

**Files:**
- Create: `apps/api/src/middleware/tenancy.ts`, `apps/api/src/middleware/rbac.ts`

- [ ] **Step 1: Write `apps/api/src/middleware/tenancy.ts`**

```ts
import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { AuthError, NotFoundError } from '../lib/errors.js';
import { ERR, type Role } from '@accounting/shared';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenancy?: { business_id: string; effective_role: Role };
    }
  }
}

// Mount on routes that take `:businessId` path param.
export async function resolveBusiness(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new AuthError(ERR.UNAUTHORIZED, 'Not authenticated');
    const business_id = req.params['businessId'];
    if (!business_id) throw new NotFoundError('business');

    const business = await db.selectFrom('businesses')
      .select(['id', 'firm_id'])
      .where('id', '=', business_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!business || business.firm_id !== req.auth.firm_id) throw new NotFoundError('business', business_id);

    const uba = await db.selectFrom('user_business_access')
      .select(['role_override'])
      .where('user_id', '=', req.auth.user_id)
      .where('business_id', '=', business_id)
      .executeTakeFirst();
    if (!uba && req.auth.role !== 'firm_admin') throw new AuthError(ERR.FORBIDDEN, 'No access to this business');

    const effective_role = (uba?.role_override ?? req.auth.role) as Role;
    req.tenancy = { business_id, effective_role };
    next();
  } catch (err) { next(err); }
}
```

- [ ] **Step 2: Write `apps/api/src/middleware/rbac.ts`**

```ts
import type { Request, Response, NextFunction } from 'express';
import { AuthError } from '../lib/errors.js';
import { ERR, hasMinRole, type Role } from '@accounting/shared';

export function requireMinRole(min: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const actual = req.tenancy?.effective_role ?? req.auth?.role;
    if (!actual || !hasMinRole(actual, min)) return next(new AuthError(ERR.FORBIDDEN, `Requires ${min}`));
    next();
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/middleware/tenancy.ts apps/api/src/middleware/rbac.ts
git commit -m "feat(api): tenancy + RBAC middleware"
```

### Task 25: Error middleware

**Files:**
- Create: `apps/api/src/middleware/error.ts`

- [ ] **Step 1: Write `apps/api/src/middleware/error.ts`**

```ts
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { BusinessRuleError, codeToHttpStatus } from '../lib/errors.js';
import { ERR } from '@accounting/shared';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const request_id = req.request_id ?? 'unknown';

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: ERR.VALIDATION_FAILED,
        message: 'Input validation failed',
        details: null,
        field_errors: err.flatten().fieldErrors,
      },
      request_id,
    });
  }

  if (err instanceof BusinessRuleError) {
    return res.status(codeToHttpStatus(err.code)).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? null,
        field_errors: null,
      },
      request_id,
    });
  }

  // Unknown — log, return INTERNAL
  console.error(`[${request_id}]`, err);
  res.status(500).json({
    error: {
      code: ERR.INTERNAL,
      message: 'Internal server error',
      details: null,
      field_errors: null,
    },
    request_id,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/middleware/error.ts
git commit -m "feat(api): error middleware translates BusinessRuleError + ZodError"
```

### Task 26: API bootstrap (`index.ts`)

**Files:**
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Replace `apps/api/src/index.ts`**

```ts
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config, corsOrigins } from './config.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import healthRoutes from './routes/health.js';

const app = express();

app.use(requestId);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl, health checks
    if (corsOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

app.use(healthRoutes);
app.use(authRoutes);
app.use(meRoutes);

app.use(errorHandler);

app.listen(config.API_PORT, () => {
  console.log(`api listening on :${config.API_PORT}`);
});
```

- [ ] **Step 2: Boot locally**

```bash
npm -w @accounting/api run dev
```
In another shell:
```bash
curl http://localhost:4000/health
# {"status":"ok"}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): express bootstrap with health/auth/me + error handler"
```

### Task 27: Integration test for login through the HTTP layer

**Files:**
- Create: `apps/api/tests/integration/authRoute.test.ts`

- [ ] **Step 1: Install supertest**

```bash
npm -w @accounting/api install --save-dev supertest @types/supertest
```

- [ ] **Step 2: Extract a testable app factory**

Refactor: create `apps/api/src/app.ts` that exports `makeApp()`, and have `apps/api/src/index.ts` call it. The factory accepts an optional Kysely instance.

```ts
// apps/api/src/app.ts
import express, { type Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { corsOrigins } from './config.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import healthRoutes from './routes/health.js';

export function makeApp(): Express {
  const app = express();
  app.use(requestId);
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (corsOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(healthRoutes);
  app.use(authRoutes);
  app.use(meRoutes);
  app.use(errorHandler);
  return app;
}
```

Update `apps/api/src/index.ts`:
```ts
import { makeApp } from './app.js';
import { config } from './config.js';

makeApp().listen(config.API_PORT, () => {
  console.log(`api listening on :${config.API_PORT}`);
});
```

- [ ] **Step 3: Write integration test**

```ts
// apps/api/tests/integration/authRoute.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess } from '../helpers/factories.js';
import { makeApp } from '../../src/app.js';

// NOTE: routes import `db` from '../db/index.js' — we rebind it for tests by
// setting DATABASE_URL to the container's URL before app instantiation.

describe('auth routes', () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await startTestDb();
    process.env.DATABASE_URL = t.url;
  });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('POST /auth/login returns access + sets refresh cookie', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id, 'Biz');
    const user = await makeUser(t.db, firm.id, { email: 'a@x.com', password: 'pw12345678' });
    await grantAccess(t.db, user.id, biz.id);

    const app = makeApp();
    const res = await request(app).post('/auth/login').send({ email: 'a@x.com', password: 'pw12345678' });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.user.id).toBe(user.id);
    expect(res.headers['set-cookie']?.join(';') ?? '').toMatch(/acct_rt=/);
  });

  it('POST /auth/login wrong password returns 401', async () => {
    const firm = await makeFirm(t.db);
    await makeUser(t.db, firm.id, { email: 'a@x.com', password: 'pw12345678' });
    const app = makeApp();
    const res = await request(app).post('/auth/login').send({ email: 'a@x.com', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});
```

- [ ] **Step 4: Run and commit**

```bash
npm -w @accounting/api run test:integration
git add apps/api/src/app.ts apps/api/src/index.ts apps/api/tests/integration/authRoute.test.ts apps/api/package.json package-lock.json
git commit -m "test(api): integration tests for auth HTTP routes"
```

---

## Phase F — Web shell + auth (Tasks 28–34)

### Task 28: API client with refresh-on-401 interceptor

**Files:**
- Create: `apps/web/src/lib/apiClient.ts`

- [ ] **Step 1: Write `apps/web/src/lib/apiClient.ts`**

```ts
import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

const API_URL = import.meta.env.VITE_API_URL as string;

const ACCESS_TOKEN_KEY = 'acct_access';

export function setAccessToken(token: string | null) {
  if (token === null) localStorage.removeItem(ACCESS_TOKEN_KEY);
  else localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function makeClient(): AxiosInstance {
  const client = axios.create({ baseURL: API_URL, withCredentials: true });

  client.interceptors.request.use((cfg: InternalAxiosRequestConfig) => {
    const t = getAccessToken();
    if (t) cfg.headers.Authorization = `Bearer ${t}`;
    return cfg;
  });

  let refreshing: Promise<string | null> | null = null;

  client.interceptors.response.use(
    (r) => r,
    async (error: AxiosError) => {
      const status = error.response?.status;
      const url = error.config?.url ?? '';
      if (status !== 401 || url.includes('/auth/refresh') || url.includes('/auth/login')) throw error;

      if (!refreshing) {
        refreshing = (async () => {
          try {
            const r = await axios.post(`${API_URL}/auth/refresh`, {}, { withCredentials: true });
            setAccessToken(r.data.access_token);
            return r.data.access_token as string;
          } catch { setAccessToken(null); return null; }
          finally { setTimeout(() => { refreshing = null; }, 0); }
        })();
      }
      const newToken = await refreshing;
      if (!newToken || !error.config) throw error;
      error.config.headers = error.config.headers ?? {};
      error.config.headers.Authorization = `Bearer ${newToken}`;
      return client.request(error.config);
    },
  );

  return client;
}

export const api = makeClient();
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/apiClient.ts
git commit -m "feat(web): axios client with silent refresh-on-401"
```

### Task 29: Auth context + useAuth + ProtectedRoute

**Files:**
- Create: `apps/web/src/auth/AuthContext.tsx`, `apps/web/src/auth/useAuth.ts`, `apps/web/src/auth/ProtectedRoute.tsx`

- [ ] **Step 1: Write `apps/web/src/auth/AuthContext.tsx`**

```tsx
import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setAccessToken } from '@/lib/apiClient';

export type Role = 'firm_admin' | 'accountant' | 'staff' | 'client';

export type AuthUser = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  firm_id: string;
};
export type AuthBusiness = { id: string; name: string; role_override: Role | null };

type AuthState = {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: AuthUser | null;
  businesses: AuthBusiness[];
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

export const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [businesses, setBusinesses] = useState<AuthBusiness[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.get('/me');
        setUser(me.data.user);
        setBusinesses(me.data.businesses);
        setStatus('authenticated');
      } catch { setStatus('anonymous'); }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post('/auth/login', { email, password });
    setAccessToken(r.data.access_token);
    setUser(r.data.user);
    setBusinesses(r.data.businesses);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } finally {
      setAccessToken(null);
      setUser(null);
      setBusinesses([]);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo<AuthState>(() => ({ status, user, businesses, login, logout }), [status, user, businesses, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
```

- [ ] **Step 2: Write `apps/web/src/auth/useAuth.ts`**

```ts
import { useContext } from 'react';
import { AuthContext } from './AuthContext';

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

- [ ] **Step 3: Write `apps/web/src/auth/ProtectedRoute.tsx`**

```tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './useAuth';

export function ProtectedRoute() {
  const { status } = useAuth();
  if (status === 'loading') return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return <Outlet />;
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/auth/
git commit -m "feat(web): auth context + protected route"
```

### Task 30: shadcn primitives needed (Button, Input, Label, Card)

**Files:**
- Create: `apps/web/src/components/ui/button.tsx`, `input.tsx`, `label.tsx`, `card.tsx`

- [ ] **Step 1: Write `apps/web/src/components/ui/button.tsx`**

(Copy of the shadcn default Button, inlined so the plan is self-contained.)

```tsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';
```

- [ ] **Step 2: Write `apps/web/src/components/ui/input.tsx`**

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
```

- [ ] **Step 3: Write `apps/web/src/components/ui/label.tsx`**

```tsx
import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const labelVariants = cva('text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70');

export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), className)} {...props} />
));
Label.displayName = LabelPrimitive.Root.displayName;
```

- [ ] **Step 4: Write `apps/web/src/components/ui/card.tsx`**

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)} {...props} />
  ),
);
Card.displayName = 'Card';

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('text-2xl font-semibold leading-none tracking-tight', className)} {...props} />
  ),
);
CardTitle.displayName = 'CardTitle';

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/
git commit -m "feat(web): shadcn primitives (button, input, label, card)"
```

### Task 31: Login page

**Files:**
- Create: `apps/web/src/pages/LoginPage.tsx`

- [ ] **Step 1: Write**

```tsx
// apps/web/src/pages/LoginPage.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/auth/useAuth';

export default function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      await login(email, password);
      nav('/', { replace: true });
    } catch (e: any) {
      setErr(e?.response?.data?.error?.message ?? 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader><CardTitle>Sign in</CardTitle></CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/LoginPage.tsx
git commit -m "feat(web): login page"
```

### Task 32: Layout shell (Sidebar + TopBar + AppShell)

**Files:**
- Create: `apps/web/src/components/layout/Sidebar.tsx`, `TopBar.tsx`, `AppShell.tsx`

- [ ] **Step 1: Write `apps/web/src/components/layout/Sidebar.tsx`**

```tsx
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

const items = [
  { to: '/', label: 'Dashboard' },
  // Plan 1.1 adds: Journal, COA, Periods
  // Plan 1.2 adds: Customers, Invoices, Payments, Credit Memos, Aging
];

export function Sidebar() {
  return (
    <aside className="w-56 shrink-0 border-r bg-card p-4">
      <div className="font-semibold mb-4">Accounting</div>
      <nav className="flex flex-col gap-1">
        {items.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => cn(
              'rounded px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground',
              isActive && 'bg-accent text-accent-foreground'
            )}
            end
          >{item.label}</NavLink>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Write `apps/web/src/components/layout/TopBar.tsx`**

```tsx
import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/useAuth';

export function TopBar() {
  const { user, businesses, logout } = useAuth();
  return (
    <header className="h-14 shrink-0 border-b bg-card flex items-center justify-between px-4">
      <div className="text-sm text-muted-foreground">
        {businesses.length > 0 ? `${businesses.length} business${businesses.length === 1 ? '' : 'es'}` : 'No business access'}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm">{user?.full_name ?? ''}</span>
        <Button variant="outline" size="sm" onClick={logout}>Sign out</Button>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Write `apps/web/src/components/layout/AppShell.tsx`**

```tsx
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function AppShell() {
  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <TopBar />
        <main className="flex-1 p-6 overflow-auto"><Outlet /></main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/layout/
git commit -m "feat(web): app shell (sidebar + topbar)"
```

### Task 33: Dashboard page + App routing

**Files:**
- Create: `apps/web/src/pages/DashboardPage.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/main.tsx`

- [ ] **Step 1: Write `apps/web/src/pages/DashboardPage.tsx`**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/auth/useAuth';

export default function DashboardPage() {
  const { user, businesses } = useAuth();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <Card>
        <CardHeader><CardTitle>Welcome</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Signed in as {user?.email}. Role: {user?.role}. You have access to {businesses.length} business(es).
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            This is Slice 1 Foundation — Ledger and AR features land in subsequent plans.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Replace `apps/web/src/App.tsx`**

```tsx
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@/auth/AuthContext';
import { ProtectedRoute } from '@/auth/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
```

- [ ] **Step 3: Manual smoke test**

Start stack:
```bash
docker compose up -d postgres
npm run db:migrate
# create a user via psql (before seed script in task 35 lands)
psql "$DATABASE_URL" -c "INSERT INTO firms (name) VALUES ('Test') RETURNING id;"
# grab firm id, insert user with a bcrypt hash generated via `node -e "console.log(require('bcrypt').hashSync('pw12345678', 12))"`
npm run dev
```
Visit http://localhost:5173 → login page. Log in with the user → dashboard shows.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/pages/DashboardPage.tsx
git commit -m "feat(web): dashboard shell + protected routing"
```

### Task 34: Logout redirects to login + auth persistence across refreshes

- [ ] **Step 1: Sanity check logout flow**

In the running app: click "Sign out" → redirected to /login → reload browser → still on /login.

This works because: `/me` returns 401 after logout (no refresh cookie), AuthContext's initial fetch fails, `status='anonymous'`, ProtectedRoute navigates to `/login`.

- [ ] **Step 2: Sanity check access token refresh**

Set `JWT_ACCESS_TTL_MINUTES=0.05` (3 seconds) in `.env`, restart api. Log in. Wait 5 seconds. Click around the dashboard — no 401 should reach the UI (the refresh interceptor renews silently).

Revert `.env` to `JWT_ACCESS_TTL_MINUTES=15`.

- [ ] **Step 3: Commit (no code, but document the smoke test in README)**

Add to `README.md`:
```markdown
## Manual smoke test (Slice 1 Foundation)
1. `docker compose up -d postgres && npm run db:migrate && npm run db:seed`
2. `npm run dev`
3. Open http://localhost:5173, log in with the seeded admin account.
4. Verify: dashboard loads, "Sign out" returns to login, reload keeps the anonymous state.
```

```bash
git add README.md
git commit -m "docs: add Slice 1 Foundation smoke test instructions"
```

---

## Phase G — Seed, CI, Deploy (Tasks 35–38)

### Task 35: Seed script

**Files:**
- Create: `bin/seed.ts`, `bin/create-admin.ts`, `db/seeds/0001_foundation.sql`

- [ ] **Step 1: Write `db/seeds/0001_foundation.sql`**

```sql
-- Idempotent-ish: run inside a transaction, skip if Acme firm exists.
DO $$
DECLARE
  v_firm_id uuid;
  v_biz_blue uuid;
  v_biz_green uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM firms WHERE name = 'Acme Accounting LLC') THEN
    RAISE NOTICE 'Seed already applied, skipping.';
    RETURN;
  END IF;

  INSERT INTO firms (name) VALUES ('Acme Accounting LLC') RETURNING id INTO v_firm_id;
  INSERT INTO businesses (firm_id, name, legal_name) VALUES
    (v_firm_id, 'Blue Widget Co.',  'Blue Widget Co., LLC')  RETURNING id INTO v_biz_blue;
  INSERT INTO businesses (firm_id, name, legal_name) VALUES
    (v_firm_id, 'Green Gadgets Inc.', 'Green Gadgets, Inc.') RETURNING id INTO v_biz_green;
END $$;
```

- [ ] **Step 2: Write `bin/seed.ts`**

```ts
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.resolve(__dirname, '../db/seeds');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Run SQL seed files in order
  const files = (await fs.readdir(SEED_DIR)).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = await fs.readFile(path.join(SEED_DIR, f), 'utf8');
    console.log(`APPLY ${f}`);
    await pool.query(sql);
  }

  // Ensure a firm_admin user exists
  const firmRow = await pool.query(`SELECT id FROM firms WHERE name = 'Acme Accounting LLC'`);
  if (firmRow.rowCount === 0) throw new Error('Seed firm missing');
  const firm_id = firmRow.rows[0].id;

  const existing = await pool.query(`SELECT id FROM users WHERE email = 'admin@example.com' AND firm_id = $1`, [firm_id]);
  if ((existing.rowCount ?? 0) === 0) {
    const password = crypto.randomBytes(12).toString('base64url');
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users (firm_id, email, password_hash, full_name, role)
       VALUES ($1, 'admin@example.com', $2, 'Acme Admin', 'firm_admin')`,
      [firm_id, hash],
    );
    console.log('');
    console.log('=== SEED ADMIN CREDENTIALS (store these now — not printed again) ===');
    console.log('  email:    admin@example.com');
    console.log(`  password: ${password}`);
    console.log('===================================================================');

    // Grant admin access to all businesses
    const bizs = await pool.query(`SELECT id FROM businesses WHERE firm_id = $1`, [firm_id]);
    const userRow = await pool.query(`SELECT id FROM users WHERE email = 'admin@example.com' AND firm_id = $1`, [firm_id]);
    for (const b of bizs.rows) {
      await pool.query(
        `INSERT INTO user_business_access (user_id, business_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userRow.rows[0].id, b.id],
      );
    }
  } else {
    console.log('Admin user already exists, skipping password generation.');
  }

  await pool.end();
  console.log('Seed complete.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Write `bin/create-admin.ts` (prod-safe, non-interactive)**

```ts
import 'dotenv/config';
import { Pool } from 'pg';
import bcrypt from 'bcrypt';

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const firm_name = process.env.ADMIN_FIRM_NAME ?? 'Acme Accounting LLC';
  const full_name = process.env.ADMIN_FULL_NAME ?? 'Admin';

  if (!email || !password) {
    console.error('ADMIN_EMAIL and ADMIN_PASSWORD env vars are required');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('ADMIN_PASSWORD must be at least 12 chars');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const firm = await pool.query(`SELECT id FROM firms WHERE name = $1`, [firm_name]);
  let firm_id: string;
  if (firm.rowCount === 0) {
    const r = await pool.query(`INSERT INTO firms (name) VALUES ($1) RETURNING id`, [firm_name]);
    firm_id = r.rows[0].id;
  } else firm_id = firm.rows[0].id;

  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (firm_id, email, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4, 'firm_admin')
     ON CONFLICT (firm_id, email) WHERE deleted_at IS NULL
     DO UPDATE SET password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name`,
    [firm_id, email, hash, full_name],
  );
  await pool.end();
  console.log(`Admin ${email} ensured on firm ${firm_name}`);
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 4: Run and commit**

```bash
npm run db:reset
# verify printed credentials; log in at http://localhost:5173
git add bin/seed.ts bin/create-admin.ts db/seeds/0001_foundation.sql
git commit -m "feat(db): seed script with firm_admin generation"
```

### Task 36: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  typecheck-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm -w @accounting/shared run build
      - run: npm run typecheck
      - run: npm -w @accounting/shared test
      - run: npm -w @accounting/api test

  integration:
    runs-on: ubuntu-latest
    needs: typecheck-unit
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm -w @accounting/shared run build
      - run: npm -w @accounting/api run test:integration
```

Testcontainers handles Postgres via Docker-in-Docker on the runner.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: typecheck + unit + integration on PR and main"
```

### Task 37: Deploy API to Railway + frontend to Netlify

**Files:**
- Create: `apps/api/Procfile` (optional; Railway respects start script)
- Modify: `apps/web/netlify.toml` (create in repo root or apps/web)

- [ ] **Step 1: Add Railway start scripts to root `package.json`**

Ensure root `package.json` scripts contain:

```json
"scripts": {
  "build": "npm -w @accounting/shared run build && npm -w @accounting/api run build && npm -w @accounting/web run build",
  "start:api": "node apps/api/dist/index.js",
  "migrate:prod": "tsx bin/migrate.ts"
}
```

- [ ] **Step 2: Write `apps/web/netlify.toml`**

```toml
[build]
  base = "apps/web"
  command = "npm --prefix=../.. ci && npm --prefix=../.. -w @accounting/shared run build && npm --prefix=../.. -w @accounting/web run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

- [ ] **Step 3: Configure Railway**

Via Railway dashboard (manual, one-time):
- Link GitHub repo (aheedk/accounting-app)
- Create two services:
  - **postgres**: Railway's managed Postgres plugin
  - **api**: Node service, root dir `.` (monorepo), build cmd `npm run build`, start cmd `npm run start:api`
- Set env vars on `api` service:
  - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
  - `JWT_ACCESS_SECRET` = 32-byte random hex
  - `JWT_REFRESH_SECRET` = 32-byte random hex
  - `CORS_ALLOWED_ORIGINS` = `https://<your-netlify-url>`
  - `NODE_ENV` = `production`
- On first deploy: open a one-off shell, run `npm run migrate:prod`, then `ADMIN_EMAIL=... ADMIN_PASSWORD=... npx tsx bin/create-admin.ts`.

- [ ] **Step 4: Configure Netlify**

Via Netlify dashboard (manual, one-time):
- Connect GitHub repo
- Build settings auto-detected from `netlify.toml`
- Env var: `VITE_API_URL` = `https://<railway-api-url>`
- Deploy → note assigned Netlify URL → update Railway `CORS_ALLOWED_ORIGINS` with that URL.

- [ ] **Step 5: Commit**

```bash
git add apps/web/netlify.toml package.json
git commit -m "chore(deploy): netlify toml + railway build scripts"
```

### Task 38: End-to-end deploy smoke test

- [ ] **Step 1: Push and wait for CI green**

```bash
git push origin main
```
Wait for CI to pass.

- [ ] **Step 2: Wait for Railway deploy**

Railway redeploys on each push. Watch logs; verify `api listening on :...`.

- [ ] **Step 3: Wait for Netlify deploy**

Watch logs; verify build succeeds and the site loads at the Netlify URL.

- [ ] **Step 4: Smoke test the deployed stack**

- Visit Netlify URL → redirected to `/login`.
- Log in with the admin email + the password printed by `create-admin.ts`.
- Dashboard loads, shows email and role.
- Sign out → back to `/login`.
- Reload → still anonymous.

- [ ] **Step 5: Confirm audit trail in prod DB**

Connect to Railway Postgres (`psql $DATABASE_URL` from a Railway shell):
```sql
SELECT action, entity_type, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 10;
```
Expected: rows for `auth.login`, `auth.logout`, etc.

- [ ] **Step 6: Commit a deploy-success marker**

No code changes — add a line to `README.md`:

```markdown
## Deployed environments

- API: https://<railway-url>
- Web: https://<netlify-url>

Admin credentials are stored in 1Password (or wherever you put them). If lost, rerun `bin/create-admin.ts` via Railway shell.
```

```bash
git add README.md
git commit -m "docs: record deployed URLs for Slice 1 Foundation"
git push
```

---

## Plan 1.0 Definition of Done

- [ ] Repo boots: `npm install && docker compose up -d postgres && npm run db:migrate && npm run db:seed && npm run dev` produces a working login flow on http://localhost:5173
- [ ] Unit tests pass: `npm -ws run test --if-present`
- [ ] Integration tests pass: `npm -w @accounting/api run test:integration`
- [ ] CI is green on `main`
- [ ] Deployed API + Web reachable; real admin can log in; audit_logs has rows for that login
- [ ] Every service method has ≥1 happy and ≥1 failure integration test (verified: authService has 5, auditService has 3)
- [ ] `audit_logs` append-only trigger confirmed by test
- [ ] Refresh rotation confirmed by test
- [ ] `packages/shared` published via workspaces, importable by both api and web

When all 8 are checked, move to Plan 1.1 (Ledger engine).
