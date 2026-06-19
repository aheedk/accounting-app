# Branch: `accounting-qbo-revamp` — changes vs `main`

Continues the QuickBooks-Online visual revamp into the **Accounting**, **Reports**,
**Payroll**, **Inventory**, and **Setup** sidebar groups. The earlier
`qbo-style-revamp` branch (already merged) covered AR, AP, the financial reports,
the Journal Entry form, and the "ink & ledger" theme; this branch brings every
remaining in-place tab up to the same QBO list/report conventions.

Reuses the existing design system — `MoneyBar`, `ReportCard`, `EmptyState`,
`DataTable`, `fmtMoney` (no `$` prefix, `font-mono`), `todayLocal`/local date
formatting, inline labeled filter rows (`mb-1 text-xs text-muted-foreground`
labels, `h-9` controls), status pills, and `hover:bg-muted/30` rows. No new
dependencies, design tokens, routes, or sidebar entries.

---

## Accounting group (all 12 tabs)

- **Chart of Accounts** — rebuilt as a QBO list: right-aligned **New account**,
  inline labeled filter row (account type / status / search), status badges,
  `No. / Name / Type / Status / Source` columns, EmptyState.
- **Journal Entries (list)** — status filter + search, status badges, gear
  action header, EmptyState.
- **Fixed Assets** — `MoneyBar` (total cost / accumulated depreciation / net
  book value), status badges, labeled filter row, EmptyState.
- **Bank Accounts** — labeled filter row, status badges, EmptyState.
- **Client Overview** — firm `MoneyBar` (total receivable / payable / net),
  sortable `DataTable`, local reconciliation dates, EmptyState.
- **Books Review** — task status badges + "N of M signed off" progress.
- **Reconcile** — local dates + mono money in the prior-reconciliations table.
- **Recurring Transactions** — local dates, active/paused badges, capitalized
  type/recurrence.
- **Bank Transactions** — QBO **status tabs** (For review / Matched /
  Categorized / Excluded / All), local dates, removed the Refresh button.
- **Integration Transactions** — status tabs, labeled source filter, local
  dates, retitled from "Integration Inbox".
- **Receipts** — labeled filter row, local dates, EmptyState.
- **Rules** — readable sign-filter labels, styled table header, EmptyState.

## Reports group

- **Standard Reports** — rebuilt as QBO's grouped report list (Business
  overview / For my accountant / Who owes you / Expenses and vendors) with
  report rows + chevrons.
- **Management Reports** — removed the lone `$`-prefix on `fmtMoney` (every
  other page/report renders money without a symbol), mono + hover rows.
- **Custom Reports** — local dates in the saved-reports list, styled result
  table header + hover.
- **Financial Planning** — colored budget status badges.
- **Performance Center / Spreadsheet Sync** — already on-theme; left as-is.
- (P&L, Balance Sheet, Cash Flow, Trial Balance, Aging, 1099 were converted on
  the prior branch.)

## Payroll group (all 5 tabs)

Overview (local next-pay date), Employees (EmptyState, capitalized status),
Contractors (styled table header + hover), Payroll Taxes (local dates,
capitalized period, badges, styled header), Compliance (item status badges).

## Inventory group (all 6 tabs)

Overview (local dates on recent lists), Inventory items (labeled filter,
status badges, EmptyState, qty formatted as a count not money), Purchase
Orders / Sales Orders (labeled filter rows, capitalized status, EmptyState),
Item Receipts / Shipping Labels (EmptyState).

## Setup group

Tax Codes / Cost Centers / Fiscal Periods (status badges, local dates, styled
headers, hover) and Users (styled header + hover). Chart of Accounts reuses the
converted Accounting page; Entity is already a clean settings form.

## Verification

- `npm -w @accounting/web run typecheck` clean after every commit.
- `npm -w @accounting/web run lint` — 0 errors, 14 pre-existing
  `react-hooks/exhaustive-deps` warnings (unchanged from `main`).
- Spot-checked in the browser against the running dev server (Chart of
  Accounts, Bank Transactions tabs, Client Overview MoneyBar, Standard
  Reports grouped list, Management Reports).
