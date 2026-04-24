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

### Real charting library on Performance Center

**Why:** Slice 12 ships inline-SVG sparklines as a "no new deps" choice. Workable but ugly — no axis labels, no tooltips, no comparison overlays.

**To do:**
- `npm install -w apps/web recharts` (or victory, or chart.js).
- Replace the `<Sparkline />` component in `apps/web/src/pages/reports/PerformanceCenterPage.tsx` with a proper `<LineChart>`.
- Optional: add YoY comparison overlay (current 12mo vs prior 12mo).

**Effort:** ~30 min for a basic recharts swap.

### shadcn `Dialog` for modal flows

**Why:** Slice 10's `ReceiptsPage` and slice 11's various dialogs use plain fixed-overlay `<Card>` instead of `@radix-ui/react-dialog` (already in `package.json`). No focus trap, no escape-to-close, no aria attributes.

**To do:**
- Replace ad-hoc modal overlays with `<Dialog>` from `@/components/ui/dialog` (create the wrapper if it doesn't exist following shadcn convention).
- Pages affected: `ReceiptsPage`, `IntegrationInboxPage`, `ContractorsPage`, `EmployeeDetailPage`, `PayrollTaxesPage`.

**Effort:** ~1 hour across all pages.

### Sidebar audit

**Why:** The sidebar component (`apps/web/src/components/layout/Sidebar.tsx`) was last touched during slice 6/7 and never explicitly re-verified post-slice-13. All routes are wired in `App.tsx` and the original sidebar entries point to the right paths, but worth a manual walk-through to confirm every nav item lands on a real page (not 404).

**To do:** open the deployed app, click every sidebar item, verify no broken links.

**Effort:** ~10 min manual.

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
