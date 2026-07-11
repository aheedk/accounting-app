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

_Code done 2026-07-11: `S3Storage` in `apps/api/src/lib/fileStorage.ts`, env-gated on `S3_BUCKET` (+`S3_ENDPOINT` for R2; credentials via `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`). Remaining is ops-side only: create the R2 bucket + API token and set the four env vars in Railway._

---

## Data model hardening

_Done 2026-07-10 (see `docs/superpowers/plans/2026-07-10-follow-ups-batch.md`): pay_runs void keeps its JE link (migration `0052`), and `numbering_counters` (migration `0051`) replaced the `count(*)+1` helpers._

---

## UI polish

### Localhost UX audit backlog - 2026-06-22

**Context:** Manual audit on the signed-in local web app at `http://127.0.0.1:5175/`. Routes and nested tabs were clicked across Dashboard, AR, AP, Accounting, Reports, Payroll, Inventory, Setup, integrations, banking, and representative detail pages. Disposable create/edit/delete checks were also run for cost centers, bank rules, budgets, and custom reports; the test records were cleaned up afterward.

**Overall result:** No route-level crashes were found. The app is stable enough for continued feature work, but several screens still need QBO-style depth, stronger workflow controls, better mobile behavior, and a few data/formatting fixes.

_Done 2026-07-11 (see the batch plan): Custom Reports regression tests (lifecycle + account filters + month grouping); Performance Center on Recharts (axes, tooltips, 3M/6M/12M ranges, prior-period deltas, P&L drilldowns — YoY overlay still optional/future); banking import history + undo + rule dry-run with live match preview + inbox EmptyState ("stronger match suggestions" remains future work)._

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

_Mostly done 2026-07-11: API zod 400s already carried `field_errors`; the web now surfaces them everywhere via the shared `lib/apiErrors.pickErr` (27 pages swept), `pickFieldErrors` is available for inline per-input rendering, and compliance autosaves show Saving…/Saved ✓. Remaining nice-to-haves: sticky save bars on long forms, inline (next-to-input) message placement on the densest forms._

#### Accessibility pass for form controls

_First pass done 2026-07-11: label/id pairs on the recurring form, rule drawer, receipts + payroll-tax dialogs, and import page; Escape + `role="dialog"`/`aria-modal` on the Rules and CoA side drawers; center modals now use the shared Dialog (focus trap/aria built in). Remaining: a devtools-driven sweep of the rest of the create/edit panels + adding a11y checks to the manual smoke checklist._

### shadcn `Dialog` for modal flows

_Done 2026-07-11: `@/components/ui/dialog` (Radix wrapper) created; converted the center modals on Receipts, Payroll Taxes, Recurring Transactions (filter), Journal import, and CoA import. (The originally-listed ContractorsPage/EmployeeDetailPage/IntegrationInboxPage modals no longer existed after the QBO restyle.) Side drawers (Rules, CoA create) keep the drawer pattern with Escape + dialog semantics added._

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
