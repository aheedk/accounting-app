# Follow-ups

Non-blocking items deferred during the slices 8–13 initiative. None of these prevent day-to-day use of the app; they're production-hardening + polish.

---

## Deploy / infra

### Railway volume mount at `/data`

**Why:** File uploads (`receipts`, `shipping_labels`, `compliance_items`) write to `process.env.FILE_STORAGE_DIR` (default `/data/files` in prod). Without a Railway volume attached to the API service, files land in ephemeral container storage and disappear on every redeploy. The DB rows in `files` survive but point at storage paths with no bytes — download endpoints will 500.

**Status:** deferred. Current Railway plan caps volume size at 500 MB; sufficient for demo/light use, fills fast under real client load.

**To do:**
1. Railway dashboard → API service → Settings → Volumes → Add → mount path `/data`, size 500 MB.
2. Settings → Variables → set `FILE_STORAGE_DIR=/data/files`.
3. Trigger a redeploy.
4. Smoke: upload a receipt, push a no-op commit, redeploy, verify the receipt still downloads.

### Cloudflare R2 (or S3) adapter

**Why:** Long-term replacement for the Railway volume. R2 has 10 GB free tier, no egress fees, S3-compatible API. Costs ~$0.015/GB/month after that vs. Railway's ~$0.25/GB/month. Removes the 500 MB cap entirely.

**To do:**
- New `S3Storage` class in `apps/api/src/lib/fileStorage.ts` implementing the existing `FileStorage` interface (`store`, `read`, `exists`).
- Add `@aws-sdk/client-s3` dependency.
- Env vars: `S3_BUCKET`, `S3_ENDPOINT` (R2 endpoint), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
- Swap the exported `fileStorage` instance based on env (`if (process.env.S3_BUCKET) ... else new LocalVolumeStorage()`).

**Effort:** ~30 min. Interface was designed for this swap to be a single-file change.

---

## Data model hardening

### Loosen biconditional CHECK on `pay_runs.pr_finalized_has_je`

**Why:** Same shape of issue slice 8 fixed on `expense_transactions.et_posted_has_je` (commit `8b747dd`). The current biconditional CHECK forces `journal_entry_id` and `finalized_at` to NULL when status flips to `void`, dropping the audit back-link to the (now-voided) JE. Reversal JE is still findable via `journal_entries.reversed_entry_id`, but the pay-run row no longer points at the original.

**To do:**
- New migration that drops the biconditional and replaces with two one-way implications: `(status = 'draft') → (journal_entry_id IS NULL)` AND `(status = 'finalized') → (journal_entry_id IS NOT NULL AND finalized_at IS NOT NULL)`. Void allows either.
- Update `payRunService.voidPayRun` to stop nulling `journal_entry_id` / `finalized_at` / `finalized_by_user_id`.
- Add a test asserting the JE link survives void (mirrors the slice 8 fix).

**Effort:** ~20 min including migration + service edit + test.

### Per-business sequences for invoice / bill / PO / SO numbering

**Why:** All numbering services use `count(*) + 1` to assign the next number. Races between concurrent fulfillments / receipts (or between manual creation and automated fulfillment) can produce collision attempts that throw `DUPLICATE_RESOURCE`. Documented in `salesOrderService` agent report.

**To do:**
- Postgres sequence per business per entity, OR a `business_id, entity_type` row in a new `numbering_counters` table with `SELECT ... FOR UPDATE`.
- Refactor `nextInvoiceNumber`, `nextBillNumber`, `nextPONumber`, `nextSONumber` (all in different service files) to use the new helper.
- Existing tests should pass unchanged.

**Effort:** ~1 hour. Touches multiple service files; worth coordinating into one focused commit.

---

## UI polish

### Localhost UX audit backlog - 2026-06-22

**Context:** Manual audit on the signed-in local web app at `http://127.0.0.1:5175/`. Routes and nested tabs were clicked across Dashboard, AR, AP, Accounting, Reports, Payroll, Inventory, Setup, integrations, banking, and representative detail pages. Disposable create/edit/delete checks were also run for cost centers, bank rules, budgets, and custom reports; the test records were cleaned up afterward.

**Overall result:** No route-level crashes were found. The app is stable enough for continued feature work, but several screens still need QBO-style depth, stronger workflow controls, better mobile behavior, and a few data/formatting fixes.

#### Mobile app shell

**Why:** The app shell is effectively desktop-only on phone widths. On a 390px viewport, the fixed sidebar consumes about 256px and leaves only about 134px for main content.

**To do:**
- Add a mobile drawer or collapsible sidebar for `AppShell` / `Sidebar`.
- Add a compact mobile top bar with menu access and current company context.
- Ensure tables and dense report screens have horizontal overflow handling.
- Verify core routes at phone, tablet, and desktop widths.

**Priority:** high.

#### QBO-style detail pages

**Why:** Several detail pages still feel like legacy admin pages compared with the newer QBO-style list/form screens.

**Pages to review:**
- Customer detail.
- Invoice detail.
- Bill detail.
- Payment detail.
- Expense transaction detail.
- Journal entry detail.
- Inventory item detail.

**To do:**
- Add stronger detail headers with status badges, totals, primary actions, and secondary action menus.
- Add related activity/transaction sections where useful.
- Add audit/history panels for posted/voided/edited records.
- Replace raw date rendering with the shared local date helpers.
- Prefer names and human-readable references over raw IDs where possible.
- Add print/share/copy/edit/void actions where they match the transaction lifecycle.

**Priority:** high.

#### Custom Reports regression coverage

**Why:** The saved custom report flow and account picker UX work, but the create/run/delete lifecycle and account filter behavior should be covered by regression tests.

**To do:**
- Add tests for saved report create, run, and delete.
- Add tests for account filtering with all accounts, one account, and account-type group selection.

**Priority:** medium.

#### Performance Center charts

**Why:** Performance Center still uses hand-rolled inline SVG sparklines. They are functional but too limited for a reporting surface.

**To do:**
- `npm install -w apps/web recharts` (or victory, or chart.js).
- Replace the local sparkline with a real charting library such as Recharts.
- Add axes, tooltips, date range controls, and comparison periods.
- Add drilldowns from KPIs into the underlying report where practical.
- Include short KPI explanations in tooltips or compact help affordances.
- Optional: add YoY comparison overlay (current 12mo vs prior 12mo).

**Priority:** medium-high.

**Effort:** ~30 min for a basic Recharts swap.

#### Banking, imports, and rules workflow

**Why:** Banking pages work, but the workflow can become much more useful before production use.

**To do:**
- Add import history.
- Add rule dry-run with match counts before save.
- Add stronger match suggestions.
- Add undo behavior for recent imports or rule applications where feasible.
- Improve empty states for accounts with no transactions or no imported items.

**Priority:** medium-high.

#### Recurring transactions

**Why:** The recurring template UI still exposes invoice and bill template types as "coming soon"; only journal entry materialization is complete.

**To do:**
- Finish invoice recurring templates.
- Finish bill recurring templates.
- Add pause/resume controls.
- Add next-run preview and last-run history.
- Add scheduled materialization instead of requiring the user to manually click "Run all due".

**Priority:** high.

#### Setup and admin settings

**Why:** Setup has the foundation, but a real accounting workspace needs more company-level controls.

**To do:**
- Add numbering prefixes/counters for invoices, bills, POs, SOs, and other documents.
- Add defaults for terms, payment methods, invoice settings, and bill settings.
- Add tax defaults and sales tax settings.
- Add fiscal close locks / period locks.
- Add an audit log viewer.
- Add permission templates or role presets.
- Add company file storage settings once the S3/R2 adapter exists.

**Priority:** medium.

#### Form validation and save feedback

**Why:** Invalid submits can surface generic `Input validation failed` feedback instead of field-level guidance. Some settings-style changes save without a clear saving/saved state.

**To do:**
- Add field-level validation messages to dense create/edit forms.
- Add sticky save bars where forms are long.
- Add explicit `Saving`, `Saved`, and failure states for settings/status updates.
- Review compliance status changes for clear autosave feedback.

**Priority:** medium-high.

#### Accessibility pass for form controls

**Why:** Chrome reported multiple form controls without associated labels, IDs, or names while create/edit panels were open.

**To do:**
- Add explicit labels and stable IDs to inputs, selects, checkboxes, and custom controls.
- Ensure dialog/panel flows have focus management and escape-to-close behavior.
- Prefer the shared dialog component for modal flows.
- Add accessibility checks to the manual smoke checklist.

**Priority:** medium.

### shadcn `Dialog` for modal flows

**Why:** Slice 10's `ReceiptsPage` and slice 11's various dialogs use plain fixed-overlay `<Card>` instead of `@radix-ui/react-dialog` (already in `package.json`). No focus trap, no escape-to-close, no aria attributes.

**To do:**
- Replace ad-hoc modal overlays with `<Dialog>` from `@/components/ui/dialog` (create the wrapper if it doesn't exist following shadcn convention).
- Pages affected: `ReceiptsPage`, `IntegrationInboxPage`, `ContractorsPage`, `EmployeeDetailPage`, `PayrollTaxesPage`.

**Effort:** ~1 hour across all pages.

---

## Recurring transactions

### Invoice + bill template_types

**Why:** Slice 9's `recurringTemplateService.runDue` ships **journal_entry materialization only**. Invoice + bill template_types pass the create schema but throw `PRECONDITION_FAILED` at materialization time. Documented inline.

**To do:**
- Extend `runDue` to handle `template_type === 'invoice'` (call `invoiceService.createDraft` + `postInvoice`) and `'bill'` (call `billService.createDraft` + `postBill`).
- Each template's `payload` jsonb must validate against the appropriate zod schema before invoking the service.
- Add 2 tests: monthly invoice template + monthly bill template materialize correctly.

**Effort:** ~1.5 hours including tests.

---

## Cron / scheduling

### True scheduler for recurring transactions

**Why:** Current implementation is lazy-materialization only — the user must visit `/accounting/recurring` and click "Run all due" for any due templates to materialize. Works, but the user has to remember.

**To do:** Either
- Railway cron service running `POST /businesses/:bizId/recurring-templates/run-due` daily for each active business.
- A self-pinging endpoint + Railway-cron one-shot.

**Effort:** ~1 hour including testing.

---

## Misc

### Tax engine integration

Real payroll tax calc requires a third-party service (Symmetry, ADP API, etc.). Slice 13 ships manual tax-table entry per pay run line. Out of scope for foreseeable polish; a real client would integrate at the point of needing actual filings.

### Live bank feeds (Plaid/Finicity)

Same shape — banking inbox imports CSVs only. Live feed integration was explicitly deferred in the original slice 3 spec. If a client demands it, slice 3.5 would add a Plaid adapter.

### OCR for receipts

Slice 10's Receipts page accepts file uploads but doesn't extract any data. A future polish could OCR-extract amount / date / vendor and pre-populate the linked entity form. Likely needs a third-party (AWS Textract, Google Document AI, or Anthropic Claude with vision).

---

## Process notes (for future Claude sessions)

- Sub-agent commit attribution is unreliable when 3+ agents run in parallel and edit the same hot-spot files. Several slices ended up with files committed under a sibling agent's commit message due to `git add -A` races. Content is always intact; just the SHA-to-feature mapping gets fuzzy. Acceptable tradeoff for the parallelism speedup.
- The default `vitest run tests/integration` script in `apps/api/package.json` uses default pool sizing that spawned 16+ Postgres testcontainers in parallel and timed out hooks. Always run with `--pool=forks --poolOptions.forks.singleFork=true` for reliability.
- Plan-impl drift is real and constant — every slice surfaced 3-5 incorrect assumptions in my plan (column names, function signatures, response shapes). The drift logs at the top of each slice plan are the durable record.
