# accounting-app

Production-grade accounting system for an accounting firm.

Documentation lives in [`docs/`](./docs/README.md): design specs, the backlog,
meeting follow-ups, QA reports and how-to guides.

## Deployed environments

- **API:** `<paste Railway URL here>`
- **Web:** `<paste Netlify URL here>`

Admin credentials are stored in 1Password. If lost, open a Railway shell and re-run `ADMIN_EMAIL=... ADMIN_PASSWORD=... npx tsx bin/create-admin.ts`.

## Quickstart

For the exact Windows startup and login troubleshooting steps used on this
project, see [`docs/guides/running-locally.md`](./docs/guides/running-locally.md).

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

Slices 1–13 complete: all 23 ComingSoon tabs replaced with real, ledger-posting features. Since then: the QuickBooks-style revamp, AI auto-coding, and QuickBooks parity work across the General Ledger, journal entries, bank deposits and expenses. Open work is in [`docs/backlog.md`](./docs/backlog.md) and [`docs/meetings/`](./docs/meetings/).

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
