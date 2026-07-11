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

_Done 2026-07-10 (see `docs/superpowers/plans/2026-07-10-follow-ups-batch.md`): pay_runs void keeps its JE link (migration `0052`), and `numbering_counters` (migration `0051`) replaced the `count(*)+1` helpers._

---

## UI polish

### Localhost UX audit backlog - 2026-06-22

**Context:** Manual audit on the signed-in local web app at `http://127.0.0.1:5175/`. Routes and nested tabs were clicked across Dashboard, AR, AP, Accounting, Reports, Payroll, Inventory, Setup, integrations, banking, and representative detail pages. Disposable create/edit/delete checks were also run for cost centers, bank rules, budgets, and custom reports; the test records were cleaned up afterward.

**Overall result:** No route-level crashes were found. The app is stable enough for continued feature work, but several screens still need QBO-style depth, stronger workflow controls, better mobile behavior, and a few data/formatting fixes.

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

_Done 2026-07-10/11: invoice + bill materialization (typed payload schemas), pause/resume, next-run preview, run history, and an in-process hourly scheduler in the API (no Railway cron needed). See `docs/superpowers/plans/2026-07-10-follow-ups-batch.md` Tasks B–D._

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
