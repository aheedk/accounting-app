# accounting-app

Production-grade accounting system for an accounting firm. See `docs/superpowers/specs/` for the design spec.

> **Continuing an in-flight work session?** See [`HANDOFF.md`](./HANDOFF.md) — current batch state, environment notes, and the next task to pick up.

## Deployed environments

- **API:** `<paste Railway URL here>`
- **Web:** `<paste Netlify URL here>`

Admin credentials are stored in 1Password. If lost, open a Railway shell and re-run `ADMIN_EMAIL=... ADMIN_PASSWORD=... npx tsx bin/create-admin.ts`.

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

## Status

Slices 1–13 complete. All 23 ComingSoon tabs replaced with real, ledger-posting features. 47 migrations, 157 integration tests passing.

**Module coverage:** AR · AP (incl. expense transactions, 1099 contractors with encrypted W-9 tax IDs) · Banking (accounts, txn inbox, reconciliation, rules) · Inventory (items, POs, item receipts, sales orders, shipping labels) · Reports (trial balance, P&L, balance sheet, cash flow, aging, custom reports, management KPIs, performance trends, financial planning + budgets, CSV export hub) · Accounting (CoA, journal entries, fiscal periods + close, books review checklist, recurring transactions, fixed assets, depreciation, receipts, integration inbox, cross-business client overview) · Setup (entity, cost centers, users, tax codes) · Payroll (employees with encrypted SSN, pay runs that post balanced JEs, payroll taxes, compliance checklist).

## Required env vars

- `DATABASE_URL` — Postgres connection string.
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — JWT signing secrets.
- `FIELD_ENCRYPTION_KEY` — 32-byte hex for sensitive-field encryption (vendor tax IDs, employee SSNs). Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Rotating this key invalidates all encrypted fields.**
- `FILE_STORAGE_DIR` — path where uploaded files (receipts, shipping labels, compliance docs) are stored. Dev: `./.local-data/files`. Prod (Railway): `/data/files` via volume mount, OR swap to S3/R2 by replacing `LocalVolumeStorage` in `apps/api/src/lib/fileStorage.ts`.

## Manual smoke test

1. `docker compose up -d postgres && npm run db:migrate && npm run db:seed`
2. `npm run dev`
3. Open http://localhost:5173, log in with the seeded admin account.
4. Verify the sidebar shows real pages under every section (no "Coming soon" placeholders).
