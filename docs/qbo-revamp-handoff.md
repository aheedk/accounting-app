# QBO revamp — working handoff / session context

Purpose: a self-contained snapshot so a fresh chat (after `/clear`) can pick up
without the long history. For the formal "what shipped" changelog see
[`qbo-style-revamp-changes.md`](./qbo-style-revamp-changes.md).

_Last updated: 2026-07-11. NOTE: the second wave (`accounting-qbo-revamp`) has
since been **merged to `main`** — the "Open follow-ups" merge item below is done.
The 2026-07 follow-ups batch (recurring templates completion, scheduler,
numbering counters, banking import history/dry-run/undo, Recharts, Dialogs,
validation surfacing, S3 adapter) is documented in
`docs/superpowers/plans/2026-07-10-follow-ups-batch.md` and `HANDOFF.md`._

---

## Where things stand

- **First wave** (`qbo-style-revamp`) is **merged to `main` and pushed**
  (`origin/main` @ `b39ed76`): AR, AP, financial reports, the Journal Entry
  form, and the "ink & ledger" theme. See [`qbo-style-revamp-changes.md`](./qbo-style-revamp-changes.md).
- **Second wave** is on branch **`accounting-qbo-revamp`** (cut from `main`,
  16 commits, **not yet merged**). It finishes the QBO treatment across the
  **Accounting, Reports, Payroll, Inventory, and Setup** groups, adds a
  **QBO-style company switcher**, and adds an **Add-client (create business)
  flow**. See [`accounting-qbo-revamp-changes.md`](./accounting-qbo-revamp-changes.md).
- Typecheck clean (web + api). Web lint: 0 errors, 14 pre-existing warnings
  (react-hooks/exhaustive-deps). The new `businessService` integration test is
  written but **could not be run in the working sandbox** (the suite uses
  Docker testcontainers); run it where Docker is available.

## ⚠️ Open follow-ups (do these next)

1. **Merge `accounting-qbo-revamp` into `main`** (user handles pushes), then
   **deploy the API to Railway.** The deploy is what activates:
   - The **`POST /firm/businesses`** route behind the new Add-client page —
     until deployed, clicking "Add client" against the prod proxy 404s.
   - Migration `db/migrations/0050_vendors_expanded_fields.sql` (vendor fields).
   - The **firm-admin business-list fix** (login/refresh returning all firm
     businesses). Until then a firm admin only sees businesses they have an
     explicit `user_business_access` row for, so the switcher's "Other
     companies" list looks empty in prod.
2. **Delete the test vendor "QBO Style Test Co"** from production — created
   accidentally while testing the vendor form; has no bills attached.
3. Run the API test suite (incl. the new `businessService.test.ts`) on a
   machine with Docker.

## Dev environment

- Monorepo: `apps/api` (Express + Kysely + Postgres), `apps/web` (Vite + React
  + Tailwind + shadcn/ui), `packages/shared` (Zod schemas, roles, audit actions).
- Start everything: `npm run dev` (API on **4001**, web on **5173**). If a port
  is already taken, an old server is still up — kill it and relaunch. (A second
  web server has sometimes been run on **5174** via
  `npm -w @accounting/web run dev -- --port 5174 --strictPort`.)
- **Important:** `apps/web/.env.local` sets `VITE_DEV_PROXY_TARGET` to the
  **production Railway API**. So the localhost UI talks to prod data unless you
  point it at the local API (`http://localhost:4001`, which has migration 0050).
  Local Postgres: `postgresql://accounting:accounting@localhost:5433/accounting`.
- Typecheck: `npm -w @accounting/web run typecheck` / `... @accounting/api ...`.
  Lint: `npm -w @accounting/web run lint`.
- Two demo businesses: **Green Gadgets Inc.** (mostly empty) and **Blue Widget
  Co.** (has activity). Logged in as Admin / firm_admin (`kaheed@gmail.com`).

## What's QBO-converted vs not

**Every sidebar tab now has the QBO treatment.** First wave (on `main`) +
second wave (on `accounting-qbo-revamp`) together cover the whole app.

First wave (`main`):
- **AR:** Payments, Credit Memos, Aging (lists + Receive Payment & Credit Memo
  forms). _Customers and Invoices were done by the user previously._
- **AP (whole group):** Vendors (list + form + detail), Bills, Expenses, Bill
  Payments (+ Pay Bills form), Vendor Credits.
- **Reports:** Trial Balance, P&L, Balance Sheet, Cash Flow, Aging, 1099.
- **Accounting:** Journal Entry form + inline-filter cleanup on Bank Transactions.

Second wave (`accounting-qbo-revamp`):
- **Accounting group (all 12 tabs):** Chart of Accounts, Journal Entries list,
  Fixed Assets (+MoneyBar), Bank Accounts, Client Overview (firm MoneyBar +
  DataTable), Books Review, Reconcile, Recurring Transactions, Bank
  Transactions (For review/Matched/Categorized/Excluded/All tabs), Integration
  Transactions, Receipts, Rules.
- **Reports:** Standard Reports (QBO grouped report list), Custom Reports,
  Management Reports (fixed the lone `$`-prefix), Financial Planning. Performance
  Center + Spreadsheet Sync were already on-theme, left as-is.
- **Payroll (all 5):** Overview, Employees, Contractors, Payroll Taxes, Compliance.
- **Inventory (all 6):** Overview, Items, Purchase Orders, Item Receipts, Sales
  Orders, Shipping Labels.
- **Setup:** Tax Codes, Cost Centers, Fiscal Periods, Users. Chart of Accounts
  reuses the converted Accounting page; Entity is already a clean settings form.

**Net-new in the second wave (real new route):** `/clients/new` (Add a client).
The company switcher was rebuilt from a native `<select>` into a popover. No
other new sidebar tabs — everything else was restyled in place.

## Established patterns (reuse these)

Shared building blocks under `apps/web/src/components/ui/`:
- **`MoneyBar`** — QBO stat blocks over a proportional colored segment bar.
  Totals are computed across **all** rows, unfiltered (QBO behavior).
- **`ReportCard`** — centered company name / title / as-of (or period) line +
  generated-at footer. Used by every financial report.
- **`EmptyState`** — icon + headline + hint + CTA button. `DataTable`'s
  `emptyMessage` accepts `ReactNode`, so pass `<EmptyState .../>`.
- **`DataTable`** — shared sortable table with Download Excel/PDF, `actions`
  render prop, `actionsHeader` (the `Action ⚙` cell).

Other conventions:
- Money: always `fmtMoney` from `@/lib/money` with `font-mono` (tabular nums).
- Dates: `todayLocal()` and `fmtLongDate()` from `@/lib/dates` — **never**
  `new Date().toISOString().slice(0,10)` (that's UTC and rolls to "tomorrow"
  in the evening; this bug was swept across 27 pages).
- Company name for report headers: `useAuth().businesses.find(b => b.id === bizId)?.name`.
- List page shape: `<h1>` → `MoneyBar` (if applicable) → inline labeled filter
  row (`mb-1 text-xs text-muted-foreground` labels, `h-9` controls) → `Card` >
  `DataTable`. No boxed "Filters" cards; no "Refresh" buttons on auto-loading lists.
- Transaction form shape: header with right-aligned big total (AMOUNT
  RECEIVED / BALANCE DUE / etc.), customer/vendor band (with address autofill
  where relevant), Category/line table, sticky bottom Cancel + Save bar.
- Theme tokens live in `apps/web/src/index.css` + `tailwind.config.ts`:
  ink-navy sidebar, gold accent, Fraunces (serif `h1`), Public Sans (UI), IBM
  Plex Mono (numbers), `shadow-card`, warm paper background.

## Vendor data model (migration 0050)

Mirrors the earlier customer expansion. Added nullable columns to `vendors`:
company_name, title/first/middle/last/suffix, email_cc, email_bcc, mobile,
fax, other_phone, website, name_on_checks, notes, account_number,
default_expense_account_id (FK → chart_of_accounts), opening_balance,
opening_balance_as_of. Touch points: `db/types.ts` (`VendorsTable`),
`packages/shared/src/schemas/vendor.ts`, `services/ap/vendorService.ts`,
`routes/vendors.ts`. QBO's Bill Pay ACH bank fields were intentionally
**omitted** (need their own encrypted subsystem).

## Company switcher + Add client (second wave)

- **`BusinessSwitcher`** (`apps/web/src/components/layout/BusinessSwitcher.tsx`)
  replaced the native `<select>` in `TopBar`. QBO-style popover: current company
  (check), "Other companies" switch list, and — for firm admins — **Add client**
  (→ `/clients/new`) and **Back to practice** (→ `/accounting/client-overview`).
  Closes on outside-click / Escape.
- **Add client** is a real create-business flow:
  - `POST /firm/businesses` (firm-level route in `routes/businesses.ts`, guarded
    `requireMinRole('firm_admin')`, sits outside the `/businesses/:businessId`
    tenancy mount).
  - `createBusiness` (`services/core/businessService.ts`) inserts the business
    under `ctx.firm_id`, calls the existing SQL helpers `seed_default_coa()` +
    `seed_calendar_year_periods()` (migration 0009) so the client is usable
    immediately, grants the creator a `user_business_access` row, and audits
    `business.create` + `user_business_access.grant`.
  - `businessCreateSchema` in `packages/shared/src/schemas/business.ts`.
  - `AuthContext.refresh()` re-fetches `/me`; `AddClientPage` calls it, switches
    into the new client, and lands on its dashboard.
- **Money convention:** `fmtMoney` renders numbers with **no `$` sign** — that's
  app-wide (MoneyBar, DataTable, KPIs, every report). Never prefix `$`; use
  `Number(x).toLocaleString()` for non-money counts (e.g. inventory qty).

## Browser/QBO automation rules (from the user)

- A real QuickBooks Online account is open in Chrome as the **visual
  reference only**. **Never** save/create/edit anything there — open a form to
  study layout, then **close it with the ✕** (never Record / Save / Save and
  close). If unsure about navigating somewhere in QBO, ask the user to do it.
- Doing changes/testing on **localhost is fine**.
- The claude-in-chrome MCP server may need reconnecting at session start
  (it disconnected at one point).

## Likely next tasks (not started)

- **Merge + deploy** `accounting-qbo-revamp` (see Open follow-ups), then verify
  end-to-end against prod: Add-client creates a usable company, vendor expanded
  fields persist, and the firm-admin switcher shows all clients.
- The per-tab QBO conversion is **done** for all five remaining groups. What's
  left is genuinely *new* features with no page yet (would be real new tabs):
  Estimates/Quotes, Sales/Payment links, Products & Services sales catalog
  wired into invoice lines, Recurring invoices, a Budgets UI (budgets
  tables/API exist from slice 12 but there's no page).
- Optional polish carried in [`follow-ups.md`](./follow-ups.md): real charting
  on Performance Center, shadcn `Dialog` for the ad-hoc modals, etc.

## Commit cadence

User preference: commit after each meaningful change; the user handles pushes
(though "push to main" / "push to a branch" have been requested explicitly).
