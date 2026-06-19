# QBO revamp — working handoff / session context

Purpose: a self-contained snapshot so a fresh chat (after `/clear`) can pick up
without the long history. For the formal "what shipped" changelog see
[`qbo-style-revamp-changes.md`](./qbo-style-revamp-changes.md).

_Last updated: 2026-06-15._

---

## Where things stand

- All QBO-style work is **merged to `main` and pushed** (`origin/main` @ `b39ed76`).
- The `qbo-style-revamp` branch is fully merged (safe to delete locally + on GitHub).
- Typecheck + lint are clean. Auth integration tests pass (7/7). Lint shows
  14 pre-existing warnings (react-refresh / exhaustive-deps), 0 errors.

## ⚠️ Open follow-ups (do these next)

1. **Deploy the API to Railway.** This runs migration
   `db/migrations/0050_vendors_expanded_fields.sql`. Until then:
   - New Vendor's expanded fields save in the UI but the **prod API silently
     strips them** (old Zod schema), so they don't persist.
   - The **firm-admin business-list fix** (login/refresh returning all firm
     businesses) only takes effect after deploy.
2. **Delete the test vendor "QBO Style Test Co"** from production — created
   accidentally while testing the vendor form; has no bills attached.

## Dev environment

- Monorepo: `apps/api` (Express + Kysely + Postgres), `apps/web` (Vite + React
  + Tailwind + shadcn/ui), `packages/shared` (Zod schemas, roles, audit actions).
- Start everything: `npm run dev` (API on **4001**, web on **5173**).
  A second web server was sometimes run on **5174** (`npm -w @accounting/web run
  dev -- --port 5174 --strictPort`). **Currently nothing is running** — restart
  if needed.
- **Important:** `apps/web/.env.local` sets `VITE_DEV_PROXY_TARGET` to the
  **production Railway API**. So the localhost UI talks to prod data unless you
  point it at the local API (`http://localhost:4001`, which has migration 0050).
  Local Postgres: `postgresql://accounting:accounting@localhost:5433/accounting`.
- Typecheck: `npm -w @accounting/web run typecheck` / `... @accounting/api ...`.
  Lint: `npm -w @accounting/web run lint`.
- Two demo businesses: **Green Gadgets Inc.** (mostly empty) and **Blue Widget
  Co.** (has activity). Logged in as Admin / firm_admin (`kaheed@gmail.com`).

## What's QBO-converted vs not

**Fully converted (mirror a specific QBO screen):**
- **AR:** Payments, Credit Memos, Aging (lists + Receive Payment & Credit Memo
  forms). _Customers and Invoices were done by the user previously._
- **AP (entire group except Overview/Contractors):** Vendors (list + form +
  detail), Bills (list + form), Expenses (list + form), Bill Payments (list +
  Pay Bills form), Vendor Credits (list + form).
- **Reports:** Trial Balance, P&L, Balance Sheet, Cash Flow, Aging, 1099.
- **Accounting:** only the **Journal Entry form** + inline-filter cleanup on
  Bank Transactions.

**Not converted yet (work but use the older plain style; they did get the
theme + audit fixes):**
- AP: Overview, Contractors.
- Accounting group: Client Overview, Books Review, Bank Accounts, Bank
  Transactions (table body), Receipts, Reconcile, Rules, Chart of Accounts,
  Recurring Transactions, Fixed Assets, Journal Entries *list*.
- Payroll (5 pages), Inventory (6 pages), Setup (6 pages).
- Report stubs: Standard, Custom, Management, Performance, Financial Planning,
  Spreadsheet Sync.

**No new sidebar tabs/routes were added** — everything was restyled in place.

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

## Browser/QBO automation rules (from the user)

- A real QuickBooks Online account is open in Chrome as the **visual
  reference only**. **Never** save/create/edit anything there — open a form to
  study layout, then **close it with the ✕** (never Record / Save / Save and
  close). If unsure about navigating somewhere in QBO, ask the user to do it.
- Doing changes/testing on **localhost is fine**.
- The claude-in-chrome MCP server may need reconnecting at session start
  (it disconnected at one point).

## Likely next tasks (not started)

- Continue QBO treatment through the **Accounting group** (Chart of Accounts,
  Bank Transactions table, Reconcile, Fixed Assets, Journal list), then
  **Payroll / Inventory / Setup**.
- Genuinely *new* features with no page yet (would be real new tabs):
  Estimates/Quotes, Sales/Payment links, Products & Services sales catalog
  wired into invoice lines, Recurring invoices, a Budgets UI (budgets
  tables/API exist from slice 12 but there's no page).
- After deploy: verify vendor expanded fields persist and the firm-admin
  switcher shows all clients.

## Commit cadence

User preference: commit after each meaningful change; the user handles pushes
(though "push to main" / "push to a branch" have been requested explicitly).
