# Branch: `qbo-style-revamp` — changes vs `main`

19 commits · 64 files changed · +2,981 / −1,084

This branch restyles the app to match QuickBooks Online page formats (using a
live QBO account as the visual reference, read-only), adds an "ink & ledger"
visual theme, expands the vendor data model, and fixes a set of issues found
in a full-site audit.

---

## 1. QBO-style list pages

Every list page below was rebuilt to mirror its QuickBooks counterpart:
colored **money bar** with summary stats, inline labeled **filter row**
(method / date / search / status), expanded table columns, and QBO-style
row actions (`View/Edit ▾`, `Create bill ▾`, …).

| Page | QBO reference | Notable additions |
|---|---|---|
| Payments | Sales transactions | Money bar (received this year / unapplied / drafts / recent), No. + Customer + Memo columns |
| Credit Memos | Sales transactions | Money bar, Customer + Memo columns |
| Vendors | Expenses → Vendors | "Unpaid last 365 days" bar, Phone / Email / 1099 tracking / Open balance columns, Pay vendors button |
| Bills | Expenses → Bills | **Status tabs** (For review / Unpaid / Paid / All), vendor + bill-date filters with removable chip, overdue shown in red |
| Expenses | Expense transactions | Type/date filters with "Dates" chip, Payee + Category columns resolved from vendors / chart of accounts |
| Bill Payments | Bill payments | Money bar, vendor + memo columns |
| Vendor Credits | (sales-list pattern) | Money bar, vendor + memo columns |

New shared component: **`MoneyBar`** (`components/ui/MoneyBar.tsx`) — QBO's
stat blocks over a proportional colored segment bar.

## 2. QBO-style create forms

Each "New …" form was rebuilt to match the QBO transaction screen it
corresponds to (forms were inspected in QBO and closed with ✕, never saved):

- **New Vendor** — full QBO field set in collapsible sections (Name and
  contact with 15 fields, Address, Notes, Additional info: tax ID + type,
  1099 tracking, terms, account no., default expense category, opening
  balance). Backed by a real schema expansion (see §4). QBO's Bill Pay ACH
  bank fields were intentionally omitted (needs its own encrypted subsystem).
- **Receive Payment** — big AMOUNT RECEIVED header, Record payment / Amount
  cards, **Outstanding transactions** table that pre-applies the invoice from
  `?invoice_id=` and submits `initial_applications`.
- **Pay Bills** — same pattern on the AP side with an outstanding-bills table.
- **Bill** — vendor → mailing address autofill, **terms-driven due date**,
  Category details line table with computed amounts, BALANCE DUE header.
- **Expense** — payee combo (exact vendor-name match links the vendor,
  otherwise free text), payment account/date header, category line.
- **Credit Memo / Vendor Credit** — AMOUNT TO CREDIT header, customer/vendor
  + address band, single category line honest to the one-amount backend.
- **Journal Entry** — QBO table layout (# / Account / Debits / Credits /
  Description), Total row with Balanced/Unbalanced indicator, Add lines /
  Clear all lines.

## 3. QBO-style reports

New shared component: **`ReportCard`** (`components/ui/ReportCard.tsx`) —
centered company name / report title / as-of line plus a generated-at footer.

- **A/R Aging Summary** — first ReportCard conversion; uppercase bucket
  columns (Current / 1–30 / 31–60 / 61 and over), zero cells left blank,
  bold TOTAL row.
- **Trial Balance** — ReportCard + QBO header styling, mono amounts.
- **Profit & Loss** — single-column QBO statement (Income → Total Income →
  Expenses → Total Expenses → Gross profit → Operating income → NET INCOME),
  KPI strip kept above; inline period controls replace the filter card.
- **Balance Sheet** — single-column statement (Assets → Liabilities → Equity
  incl. Net Income YTD → TOTAL LIABILITIES AND EQUITY); in-balance pill kept.
- **Cash Flow** — ReportCard activity statement with NET CHANGE IN CASH
  closing row; inline filters.
- **1099 Report** — ReportCard, fixed header alignment, compact year input.

## 4. Vendor data-model expansion (API + DB)

Mirrors the earlier customer expansion (`0049`) on the AP side:

- **Migration `db/migrations/0050_vendors_expanded_fields.sql`** — adds
  `company_name`, name parts (title/first/middle/last/suffix), `email_cc`,
  `email_bcc`, `mobile`, `fax`, `other_phone`, `website`, `name_on_checks`,
  `notes`, `account_number`, `default_expense_account_id` (FK to chart of
  accounts), `opening_balance`, `opening_balance_as_of`. All nullable.
- `apps/api/src/db/types.ts` — `VendorsTable` augmented to match.
- `packages/shared/src/schemas/vendor.ts` — create/update schemas accept the
  new fields (tax-ID refinements preserved).
- `apps/api/src/services/ap/vendorService.ts` + `routes/vendors.ts` — fields
  pass through create and patch.

> ⚠️ Deploy note: until the API is deployed, the production API silently
> strips these fields (old Zod schema), so the New Vendor form saves but the
> extra fields don't persist.

## 5. Visual theme — "ink & ledger"

- **Sidebar**: deep ink-navy with gold logo mark, muted slate nav text, gold
  left rail + brightened text for the active item.
- **Typography**: Fraunces (editorial serif) for all page titles via a base
  `h1` rule; Public Sans for UI; IBM Plex Mono with tabular numerals for all
  money figures (`font-mono`).
- **Workspace**: warm paper-toned background; white cards with `rounded-xl`
  and a finer two-layer shadow (`shadow-card`).
- **Details**: deeper primary blue, button shadows + 1px press-down on
  click, frosted top bar, themed scrollbars and text selection.
- Files: `index.html` (Google Fonts), `src/index.css` (tokens, base rules),
  `tailwind.config.ts` (font families, sidebar/gold colors, card shadow),
  `Sidebar.tsx`, `TopBar.tsx`, `ui/card.tsx`, `ui/button.tsx`.

## 6. Site-audit fixes

- **Money formatting**: Client Overview displayed raw values
  (`$3527.5000`); AP / Payroll / Inventory overview KPIs showed bare `$0`.
  All now use `fmtMoney` with mono numerals.
- **"Tomorrow" date bug**: default dates were computed with
  `new Date().toISOString()` (UTC), so evenings produced tomorrow's date.
  New `lib/dates.ts` → `todayLocal()` swept across **27 pages**
  (+ shared `fmtLongDate`).
- **Stale dashboard copy**: "Slice 1 is live…" card replaced with an
  accurate feature summary.
- **Firm-admin business list**: login/refresh now return every business in
  the firm for `firm_admin` users (matching the existing `resolveBusiness`
  authorization), so the business switcher can open any client shown in
  Client Overview. Auth integration tests pass (7/7).
- Removed two unused imports that failed `eslint`.

## 7. UX additions

- **`EmptyState`** component (`components/ui/EmptyState.tsx`) — icon,
  headline, hint, CTA button; `DataTable.emptyMessage` widened to
  `ReactNode`. Wired into the nine main list pages (e.g. "No customers yet →
  New customer").
- **Vendor detail page** rebuilt QBO-style: VENDOR eyebrow + serif name,
  open-balance header with **Pay bills** / **Create bill**, vendor-scoped
  money bar (overdue / open / paid), and **Transaction list | Vendor
  details** tabs surfacing the full expanded field set (contact, address,
  notes, terms, account no., default expense category, masked tax ID,
  1099 badge, opening balance).
- Bank Transactions: boxed filter card replaced with the inline labeled
  filter row.

## Commits (oldest → newest)

```
eb67fc0 feat(web): QBO-style Payments list with money bar and filter row
ebe9055 feat(web): QBO-style Credit Memos list with money bar and filter row
d9f2552 feat(web): QBO-style AR Aging summary report with ReportCard frame
71d4a6c feat(web): QBO-style Vendors list with unpaid-365 money bar and open balances
eadab63 feat(web): QBO-style Bills list with status tabs and date filter chip
684fe56 feat(web): QBO-style Expenses list with type/date filters and category column
7e9f0c3 feat(web): QBO-style Bill Payments and Vendor Credits lists
b384a90 feat: expand vendors with QBO-style field set and rebuild New Vendor form
0766694 feat(web): rebuild Receive Payment in QBO style with outstanding transactions
39d5f97 feat(web): rebuild Credit Memo form in QBO style
56b9ac6 feat(web): rebuild Bill form in QBO style with terms-driven due date
cf1823e feat(web): rebuild Expense form in QBO style with payee combo
ae93702 feat(web): rebuild Vendor Credit form in QBO style
bd04c7d feat(web): rebuild Pay Bills form in QBO style with outstanding bills table
b45a787 feat(web): rebuild Journal Entry form in QBO table style
8aeabb4 feat(web): ink-and-ledger visual theme
d3ad799 chore: refresh package-lock dev flags
6ee8915 fix(web,api): site audit fixes — money formatting, local dates, firm admin business list
f8b22ec feat(web): report unification, inline filters, empty states, QBO vendor detail
```

## Deploy checklist

1. Merge branch → deploy API to Railway (runs migration `0050`).
2. After deploy: New Vendor expanded fields persist, and firm admins see all
   firm businesses in the switcher.
3. Cleanup: delete the test vendor "QBO Style Test Co" from production
   (created accidentally during testing; has no bills attached).
