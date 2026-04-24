# Fill the 23 Remaining ComingSoon Tabs — Design Spec

**Date:** 2026-04-24
**Status:** approved (defaults locked in via brainstorming)
**Scope:** Slices 8–13. Bring every nav item under sidebar groups Reports, AP, Accounting, Setup, Payroll, Inventory to a real, ledger-posting feature at the same depth as previously shipped slices (1–7).

---

## 0. Context

Slices 1–7 are merged to `main` (HEAD `7dbd0fb`). The deployed app still surfaces 23 `ComingSoonPage` route stubs in `apps/web/src/App.tsx`, several with stale `eta="Slice 3"` / `Slice 4` / `Slice 5` / `Slice 8` labels that no longer match reality. The deployed Netlify site is correct — the source code itself still has these stubs.

This spec replaces all 23 stubs with real features, in 6 themed mini-slices (8–13), and removes the misleading eta labels in a step-zero cleanup commit.

---

## 1. Depth bar (matches slices 1–7)

Every new feature must include:
- DB migration with referential integrity, CHECK constraints, indexes, `set_updated_at` trigger
- DB type augmentation in `apps/api/src/db/types.ts` using the existing `Generated<>` / `ColumnType<>` patterns
- Zod schemas in `packages/shared/src/schemas/`
- Audit actions in `packages/shared/src/auditActions.ts`
- Service layer with `(trx, ctx, args)` signature; audit recorded in same transaction; ledger writes only via `core/ledgerService.postJournalEntry`
- Routes mounted under `router.use('/businesses/:businessId', requireAuth, resolveBusiness)`
- Integration tests for service layer (TDD) using `apps/api/tests/helpers/factories.ts`
- Web pages using existing shadcn/ui patterns; no `any`; concrete types
- Sidebar wiring + route registration in `App.tsx`
- Seed data updates for any new business-scoped table
- Smoke test included in deploy section

**No external integrations** (Plaid, Stripe, USPS, Google Sheets, OCR services, tax-filing services). Where a feature would naturally use one, use the documented fallback (CSV, manual entry, file upload).

---

## 2. Catalog — all 23 tabs grouped by slice

| # | Slice | Tab | Sidebar group | Real feature scope |
|--|--|--|--|--|
| 1 | 8 | AP Overview | AP | Read-only dashboard cards: outstanding bills total, overdue count, upcoming payments next 7/30 days, top-5 vendors by AP balance, last reconciled date |
| 2 | 8 | Expense Transactions | AP | Quick-capture lane: new `expense_transactions` table (date / amount / payee_text or vendor_id / expense_account_id / payment_account_id / memo / receipt_id?); on save posts JE: DR expense / CR payment account |
| 3 | 8 | Contractors (AP) | AP | Filtered Vendors view where `vendor.is_1099_contractor = true`; W-9 fields on the vendor record (`tax_id`, `tax_id_type` enum SSN/EIN); inline form to flag/unflag |
| 4 | 9 | Client Overview | Accounting | Cross-business dashboard for `firm_admin` only: lists every business with AR balance, AP balance, last bank reconciliation date, # unreviewed bank txns, # open period. Non-admin roles see a redirect to current-business `/` |
| 5 | 9 | Books Review | Accounting | Per-`fiscal_period` checklist: new `period_review_tasks` table (period_id, task_key enum, status enum todo/done, assignee_user_id, signed_off_at, notes). Default tasks seeded per period: reconcile_bank, post_adjustments, review_unreviewed_txns, close_period |
| 6 | 9 | Recurring Transactions | Accounting | New `recurring_templates` table (template_type enum: journal_entry / invoice / bill, payload jsonb, recurrence enum: weekly/monthly/quarterly/yearly, next_run_date, end_date?, last_run_at). Lazy materialization: a "Run due now" button + automatic check on page mount that materializes everything where `next_run_date <= today`. Each materialization advances `next_run_date` by the recurrence interval. **No cron infrastructure.** |
| 7 | 10 | Receipts | Accounting | New `receipts` table (file_id FK, uploaded_by_user_id, linked_entity_type enum: bank_transaction / bill / expense_transaction / invoice / journal_entry / unlinked, linked_entity_id nullable). Upload via multipart form to API, files stored on Railway volume mounted at `/data/receipts/`. Storage is wrapped behind `apps/api/src/lib/fileStorage.ts` interface so swapping to S3/R2 is a single-file change |
| 8 | 10 | Integration Transactions | Accounting | New `integration_inbox` table (source enum: stripe_csv / paypal_csv / shopify_csv / generic, raw_payload jsonb, status enum: pending / matched / categorized / excluded, matched_journal_entry_id). UI mirrors Bank Transactions Inbox pattern. CSV upload only — no live API integrations. |
| 9 | 11 | Inventory Overview | Inventory | Read-only dashboard: total items, total stock value (sum quantity × cost), low-stock list (where `quantity <= reorder_point`), recent receipts/sales |
| 10 | 11 | Purchase Orders | Inventory | New `purchase_orders` table (po_number autonum, vendor_id, status enum: draft/sent/received/closed/void, expected_delivery_date) + `purchase_order_lines` (po_id, inventory_item_id, quantity, unit_cost). No JE posted at PO creation (informational commitment) |
| 11 | 11 | Item Receipts | Inventory | New `item_receipts` table linking to a PO. On post: increments `inventory_items.quantity_on_hand`, posts a Bill (DR Inventory / CR AP) for the received quantity × unit cost. Inherits the simplified-not-three-way pattern. |
| 12 | 11 | Sales Orders | Inventory | New `sales_orders` table (so_number, customer_id, status: draft/confirmed/fulfilled/void) + `sales_order_lines` (so_id, inventory_item_id, quantity, unit_price). On Fulfill: decrements stock, creates Invoice. Stock decrement uses existing `stockMovementService` with movement_type='sale'. |
| 13 | 11 | Shipping Labels | Inventory | New `shipping_labels` table (invoice_id, carrier text, tracking_number, label_file_id?, shipped_at, cost). Manual entry; optional label PDF upload via the file-storage interface. No carrier API. |
| 14 | 12 | Custom Reports | Reports | New `custom_report_definitions` table (name, owner_user_id, definition jsonb: { account_ids, date_range, group_by, columns }). Builder UI lets user pick CoA accounts, date range, group-by (account / cost_center / customer / vendor), columns. Saved defs listed; "Run" renders a table + CSV export |
| 15 | 12 | Management Reports | Reports | Fixed KPI dashboard, no new tables: revenue by month (last 12), gross margin %, AR days outstanding, AP days outstanding, current ratio, expense breakdown pie. All computed from existing JE lines. |
| 16 | 12 | Performance Center | Reports | Trend view of the same KPIs as Management Reports but as 12-month line charts + YoY comparison. Reuses computation, swaps render. |
| 17 | 12 | Financial Planning | Reports | New `budgets` table (name, fiscal_year, status enum: draft/active/archived) + `budget_lines` (budget_id, account_id, month_offset 0-11, amount). Budget vs Actual variance report = monthly budget_lines vs JE-line sum per account. CSV import for bulk budget entry. |
| 18 | 12 | Spreadsheet Sync | Reports | CSV export hub: trial balance, JE lines, AR aging, AP aging, custom report results, budget vs actual. CSV import for budgets and bank transactions (already exists, surfaced here). No live Sheets/Excel. |
| 19 | 13 | Payroll Overview | Payroll | Read-only dashboard: next pay date, total liabilities outstanding (sum across payroll liability accounts), last pay run total, employee count |
| 20 | 13 | Employees | Payroll | New `employees` table (name, email, address fields, ssn_encrypted bytea, hire_date, termination_date?, default_pay_rate_cents, default_pay_frequency enum: weekly/biweekly/semimonthly/monthly, w4_filing_status enum, default_deductions jsonb). SSN encrypted via libsodium with `PAYROLL_FIELD_KEY` env var; only displayed last-4 except on edit by `firm_admin` |
| 21 | 13 | Payroll Contractors | Payroll | Filtered view of `vendors WHERE is_1099_contractor = true` (same flag as AP Contractors); "Create contractor pay run" shortcut creates a Bill against the vendor. De-duplicates with AP Contractors via shared underlying flag. |
| 22 | 13 | Payroll Taxes | Payroll | New `payroll_tax_liabilities` table (employee_id?, period, fed_wh, state_wh, fica_employee, fica_employer, medicare_employee, medicare_employer, status enum: accrued/paid). "Record tax payment" action posts DR Liability / CR Cash and flips status. |
| 23 | 13 | Compliance | Payroll | New `compliance_items` table (item_key enum: state_registration / new_hire_report / labor_law_poster / annual_filing, due_date?, status enum, notes, document_file_id?). Static checklist seeded per business. |

---

## 3. Cross-cutting infrastructure decisions

### 3.1 File storage
- New file `apps/api/src/lib/fileStorage.ts` defining `FileStorage` interface: `store(stream, meta) -> { storage_path }`, `read(storage_path) -> stream`, `delete(storage_path) -> void`, `getPublicUrl?(storage_path) -> string | null`.
- Default implementation `LocalVolumeStorage` writes to `/data/receipts/` (Railway volume mount) with hashed filenames to avoid collisions.
- Files referenced through a single `files` table (id, original_name, mime_type, byte_size, storage_path, uploaded_by_user_id, business_id, created_at). Receipts / Shipping Labels / Compliance documents all FK to `files.id`.
- **Deploy prereq:** add a Railway volume mount at `/data` to the API service before deploying slice 10. Local dev uses `./.local-data/`.
- Multipart parsing via `multer` (add to `apps/api/package.json`).

### 3.2 Recurring transactions runner
- **No cron.** Lazy materialization only.
- On every page load of `/accounting/recurring`: fetch all templates where `next_run_date <= today` and `(end_date IS NULL OR end_date >= today)`. Display them with a "Run all due" button.
- A separate "Run all due" endpoint (`POST /businesses/:businessId/recurring-templates/run-due`) iterates over due templates: for each, materializes one JE/invoice/bill at its `next_run_date`, advances `next_run_date` by the recurrence interval, repeats while `next_run_date <= today`. All in one transaction per template.
- Materialization fans through existing services (`postJournalEntry`, `createDraftInvoice` then `postInvoice`, `createBill` then `postBill`).

### 3.3 Payroll SSN encryption
- New env var `PAYROLL_FIELD_KEY` (32-byte hex). Add to `.env.example` with a placeholder, document in README.
- Encrypt/decrypt helpers in `apps/api/src/lib/fieldCrypto.ts` using libsodium `crypto_secretbox_easy`. Returns `bytea` for storage.
- API only ever returns `ssn_last_four` to the client; full SSN exposed only when `firm_admin` explicitly hits a `GET /employees/:id/ssn-reveal` endpoint (audit-logged).

### 3.4 Cross-business reads (Client Overview)
- `firm_admin` already has a tenancy bypass via `effective_role`. Add a service `firmDashboardService.getFirmOverview(db, ctx)` that lists every business in the firm with computed metrics. Other roles get a 403 from the route.

### 3.5 Contractors model (resolves AP/Payroll duplication)
- Add columns to `vendors`: `is_1099_contractor boolean default false`, `tax_id text` (encrypted via `fieldCrypto`), `tax_id_type enum('SSN','EIN')`.
- Both `/ap/contractors` and `/payroll/contractors` are filtered views over the same vendors table. The Payroll view adds a "Pay Contractor" button that creates a Bill.

---

## 4. Slice plans (high-level — each slice gets its own detailed plan via writing-plans)

Each slice will be developed in its own worktree (see Section 6) and merged sequentially into `main` in priority order: 8 → 9 → 10 → 11 → 12 → 13.

### Slice 8 — AP polish (3 tabs)
- Migrations: `0030_vendor_1099_fields.sql`, `0031_expense_transactions.sql`
- Services: `apService/expenseTransactionService.ts`; extend `vendorService.ts` for 1099 flag
- Routes: `expenseTransactions.ts`; extend `vendors.ts` with 1099 fields + filter
- Pages: `ApOverviewPage.tsx`, `ExpenseTransactionListPage.tsx` + new/edit, `ContractorsPage.tsx` (filter)
- Tests: ~6 new (3 expenseTransaction + 2 vendor 1099 + 1 ap overview)

### Slice 9 — Accounting hub (3 tabs)
- Migrations: `0032_period_review_tasks.sql`, `0033_recurring_templates.sql`
- Services: `accounting/periodReviewService.ts`, `accounting/recurringTemplateService.ts`, `firm/firmDashboardService.ts`
- Routes: `periodReview.ts`, `recurringTemplates.ts`, `firmOverview.ts`
- Pages: `ClientOverviewPage.tsx` (firm-level), `BooksReviewPage.tsx`, `RecurringTransactionsPage.tsx` + form
- Tests: ~8 new (3 recurring + 2 review + 1 firm overview + 2 cross-tenant guard)

### Slice 10 — Receipts + Integration inbox (2 tabs, but file storage is the heaviest infra)
- Migrations: `0034_files.sql`, `0035_receipts.sql`, `0036_integration_inbox.sql`
- New: `apps/api/src/lib/fileStorage.ts`, `LocalVolumeStorage` impl
- Services: `files/fileService.ts`, `accounting/receiptService.ts`, `accounting/integrationInboxService.ts`
- Routes: `files.ts` (upload/download), `receipts.ts`, `integrationInbox.ts`
- Pages: `ReceiptsPage.tsx` (upload + grid + link-to-entity dialog), `IntegrationInboxPage.tsx` (mirrors BankTransactionsInboxPage)
- Deploy: Railway volume at `/data`. Add `multer` dep.
- Tests: ~7 new (2 fileStorage + 3 receipt + 2 integration inbox)

### Slice 11 — Inventory workflow (5 tabs)
- Migrations: `0037_purchase_orders.sql` (with lines), `0038_item_receipts.sql`, `0039_sales_orders.sql` (with lines), `0040_shipping_labels.sql`
- Services: `inventory/purchaseOrderService.ts`, `inventory/itemReceiptService.ts` (creates Bill + stock movement), `inventory/salesOrderService.ts` (fulfill creates Invoice + stock movement), `inventory/shippingLabelService.ts`
- Routes: `purchaseOrders.ts`, `itemReceipts.ts`, `salesOrders.ts`, `shippingLabels.ts`
- Pages: `InventoryOverviewPage.tsx`, `PurchaseOrderListPage.tsx` + new + detail, `ItemReceiptListPage.tsx` + new (from PO), `SalesOrderListPage.tsx` + new + detail (with Fulfill button), `ShippingLabelListPage.tsx` + new
- Tests: ~12 new (3 PO + 3 receipt-creates-bill+movement + 3 SO-fulfill-creates-invoice+movement + 2 shipping + 1 overview)

### Slice 12 — Reports polish (5 tabs)
- Migrations: `0041_custom_report_definitions.sql`, `0042_budgets.sql`, `0043_budget_lines.sql`
- Services: `reports/customReportService.ts`, `reports/managementReportService.ts`, `reports/performanceReportService.ts` (reuses managementReport), `reports/budgetService.ts`, `reports/csvExportService.ts`
- Routes: `customReports.ts`, `managementReports.ts`, `performanceReports.ts`, `budgets.ts`, `csvExports.ts`
- Pages: `CustomReportsPage.tsx` (builder + saved defs + run), `ManagementReportsPage.tsx`, `PerformanceCenterPage.tsx`, `FinancialPlanningPage.tsx` (budget editor + variance), `SpreadsheetSyncPage.tsx` (export hub)
- Tests: ~9 new (2 custom + 2 management + 2 performance + 2 budget + 1 csv)

### Slice 13 — Payroll (5 tabs)
- Migrations: `0044_employees.sql`, `0045_pay_runs.sql` (with lines), `0046_payroll_tax_liabilities.sql`, `0047_compliance_items.sql`
- New: `apps/api/src/lib/fieldCrypto.ts`; add `PAYROLL_FIELD_KEY` env var
- Services: `payroll/employeeService.ts` (with SSN encryption), `payroll/payRunService.ts` (creates JE on finalize), `payroll/payrollTaxService.ts`, `payroll/complianceService.ts`, `payroll/payrollOverviewService.ts`
- Routes: `employees.ts` (with `/ssn-reveal` audit-logged endpoint), `payRuns.ts`, `payrollTaxes.ts`, `compliance.ts`, `payrollOverview.ts`
- Pages: `PayrollOverviewPage.tsx`, `EmployeeListPage.tsx` + new + detail (SSN masked), `PayrollContractorsPage.tsx` (vendor filter + pay action), `PayrollTaxesPage.tsx`, `CompliancePage.tsx`
- Tests: ~12 new (3 employee + 3 pay-run + 2 tax + 2 compliance + 1 overview + 1 SSN-reveal-audit)

**Estimated total new tests:** ~54 (running total ≥ 92 → ≥ 146).
**Estimated total new migrations:** 18 (`0030`–`0047`).

---

## 5. Step-zero cleanup commit

First commit on the `slice-8-ap-polish` branch (so it lands in `main` only when slice 8 merges): `chore(web): align ComingSoon eta labels with real slice plan`. Update every `eta="Slice N"` in `apps/web/src/App.tsx` to match the slice that will actually deliver it (per the catalog in Section 2). On stubs that slice 8 itself replaces, just delete the `<Route>` entry instead of relabeling.

This commit is also a forcing function: any drift from this spec means the etas need to be updated, which triggers a re-review.

---

## 6. Parallel-agent execution model

### 6.1 Worktree layout
```
.claude/worktrees/
  slice-8-ap-polish/        (branch: slice-8-ap-polish, off main)
  slice-9-accounting-hub/   (branch: slice-9-accounting-hub, off main)
  slice-10-receipts/        ...
  slice-11-inventory-flow/  ...
  slice-12-reports/         ...
  slice-13-payroll/         ...
```

(The pre-existing `slice-8-payroll` worktree directory is renamed/replaced — payroll moved to slice 13.)

### 6.2 Sequencing rules
- **Slices merge sequentially** into `main` in order 8 → 9 → 10 → 11 → 12 → 13. Each slice rebases on `main` before the final merge.
- **Within a slice**, sub-agents may parallelize across phases (DB → service → routes → web) but only after the DB migration + types are committed (so service/route agents have stable typing).
- **Hot-spot files** (any cross-slice merge target): `apps/web/src/App.tsx`, `apps/web/src/components/layout/Sidebar.tsx`, `apps/api/src/db/types.ts`, `packages/shared/src/auditActions.ts`, `packages/shared/src/schemas/index.ts`, `apps/api/src/app.ts`. Each slice owns its append region. Conflicts on these files at merge time are resolved by re-applying both slices' append blocks — never by deleting the other slice's lines.
- **Service-folder ownership** is exclusive per slice: slice N writes only into folders/files it owns (per Section 4). No slice modifies another slice's service files.

### 6.3 Sub-agent dispatch within a slice
Each slice runs as 4 sequential phases, with parallel sub-agents within phases 2/3/4 where they touch disjoint files:

- **Phase 1 (sequential):** DB migration + types + zod schemas + audit actions + factories. One agent. Commit, then unblocks the rest.
- **Phase 2 (parallel by service):** one sub-agent per new service file, each writing the service + its TDD test file. Disjoint files.
- **Phase 3 (parallel by route):** one sub-agent per new route file. Disjoint files.
- **Phase 4 (parallel by page):** one sub-agent per major page (or page-cluster — list+new+detail can share an agent). Disjoint files. The agent that wires the new pages into `App.tsx` + `Sidebar.tsx` runs LAST in this phase, alone.

### 6.4 Coordination boundaries (enforced in agent prompts)
Every sub-agent prompt must include:
- The exact list of files it owns (whitelist).
- The exact list of files it must NOT modify (blacklist of files owned by sibling agents in the same phase).
- The conventions section copied from CLAUDE.md.

---

## 7. Definition of Done (overall initiative)

- All 23 ComingSoon stubs replaced with real route components — `grep "ComingSoonPage" apps/web/src/App.tsx` returns 0 hits.
- `apps/api/src/db/types.ts` includes 18 new table interfaces and corresponding `DB` entries.
- `audit_logs` includes new actions for every new entity type and major state change.
- Test count ≥ 146 (was 92 at slice 7).
- Sidebar matches the catalog: every link goes to a real page, no "Coming soon" panel anywhere in the deployed app.
- Smoke matrix per slice (documented in each slice's plan) passes against deployed Railway+Netlify.
- README "Manual smoke test" section updated.

---

## 8. Inherited conventions (also captured in CLAUDE.md)

- TypeScript strict mode: `no-explicit-any: error`; `exactOptionalPropertyTypes: true` — use conditional patch construction.
- `catch (e: unknown)` + typed narrowing.
- Postgres: PL/pgSQL uses `COALESCE(current_setting('app.X', true), '')` for tenant filters.
- Kysely DB types: `Generated<ColumnType<>>` is a bug — use `ColumnType<string, string | number | undefined, string | number>` for numeric/date columns.
- Service signature: `(trx: Transaction<DB>, ctx: ServiceCtx, args: ...)`. Audit recorded inside the same transaction. JE writes only via `core/ledgerService.postJournalEntry`.
- Route mount: `router.use('/businesses/:businessId', requireAuth, resolveBusiness);` — `:businessId` must be in the mount path so the param is captured before middleware runs.
- Roles (RBAC): `firm_admin` (40) > `accountant` (30) > `staff` (20) > `client` (10). Use `hasMinRole` from `@accounting/shared`.
- Posted-period guard: any service that mutates JE-bearing entities must check the period is not closed before posting; rely on existing protect_posted triggers where present.
- Plan-impl sync: any deviation from this spec patches the spec markdown in the same commit.
