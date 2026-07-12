# Follow-ups

Non-blocking production-hardening + polish backlog. Originally deferred during
the slices 8–13 initiative; the bulk of it shipped in the **2026-07-10/11
follow-ups batch** (see `docs/superpowers/plans/2026-07-10-follow-ups-batch.md`
and `HANDOFF.md`). This file now tracks only what is still open, with a ledger
of what closed and where.

---

## Still open — ops (user-side, no code needed)

### Push + deploy the batch
Everything below in "Completed" is on local `main`, unpushed. Deploying the API
applies migrations `0051`–`0053` (numbering counters, pay-run void CHECK, bank
import batches) via `npm run migrate:prod`.

### File storage in prod: Railway volume OR R2 env vars
Uploads still land in ephemeral container storage until one of:
1. Railway dashboard → API service → Volumes → mount `/data` (500 MB cap on
   current plan) and set `FILE_STORAGE_DIR=/data/files`; or
2. Create a Cloudflare R2 bucket + token and set `S3_BUCKET`, `S3_ENDPOINT`,
   `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — the `S3Storage` adapter is
   already in `apps/api/src/lib/fileStorage.ts` and activates on `S3_BUCKET`.
   Preferred long-term (10 GB free, no egress fees, no size cap).

### Delete the prod test vendor
"QBO Style Test Co" was created accidentally in production while testing the
vendor form (no bills attached). Needs a deliberate delete against prod.

---

## Still open — feature/polish backlog

### Setup and admin settings
Setup has the foundation; a real accounting workspace needs more company-level
controls:
- Numbering prefixes/settings UI for invoices, bills, POs, SOs (the race-safe
  `numbering_counters` backend from migration `0051` is the substrate).
- Defaults for terms, payment methods, invoice/bill settings.
- Tax defaults and sales tax settings.
- Fiscal close locks / period locks.
- Audit log viewer.
- Permission templates or role presets.
- Company file storage settings (surface the S3/R2 adapter config).

**Priority:** medium.

### Banking: stronger match suggestions
Import history, undo, rule dry-run, and empty states shipped; what remains is
suggesting likely JE matches for unreviewed transactions (amount/date/payee
similarity scoring) in the inbox.

**Priority:** medium.

### Forms: remaining polish
Field-level errors now surface app-wide via `lib/apiErrors.pickErr`; remaining
nice-to-haves:
- Sticky save bars on long forms.
- Inline next-to-input message placement on the densest forms (use the
  exported `pickFieldErrors`).

**Priority:** low-medium.

### Accessibility: finish the sweep
First pass done (label/id pairs on recurring form, rule drawer, dialogs,
import page; Escape + dialog semantics on side drawers; shared Radix Dialog
for center modals). Remaining:
- Devtools-driven audit of the other create/edit panels.
- Add a11y checks to the manual smoke checklist.

**Priority:** medium.

### Performance Center: optional YoY overlay
Charts, ranges, deltas and drilldowns shipped. A year-over-year comparison
overlay (current 12mo vs prior 12mo) needs the report service to return 24
months.

**Priority:** low.

### Third-party integrations (out of scope until a client needs them)
- **Payroll tax engine** (Symmetry, ADP API, …) — slice 13 ships manual
  tax-table entry per pay run line; integrate at the point of needing filings.
- **Live bank feeds** (Plaid/Finicity) — banking imports CSVs only, per the
  original slice 3 spec; a slice 3.5 would add a Plaid adapter.
- **OCR for receipts** (Textract / Document AI / Claude vision) — receipts
  upload but don't extract amount/date/vendor.

---

## Completed — 2026-07-10/11 batch ledger

All on local `main`; full integration suite green (63 files / 181 tests).

| Item | What shipped | Where |
|---|---|---|
| Per-business numbering | `numbering_counters` + atomic upsert `nextNumber()` replaced the four `count(*)+1` helpers (race fix) | migration `0051`, `services/core/numberingService.ts` |
| Recurring invoice + bill templates | Typed payload schemas; materialize as posted invoices/bills via the real AR/AP services | `recurringTemplateService.ts`, `schemas/recurringTemplate.ts` |
| Recurring controls | Pause/resume, next-run preview, audit-backed run history, type-aware create form, real amount/party columns | PATCH + `/runs` routes, `RecurringTransactionsPage.tsx` |
| Recurring scheduler | In-process hourly tick materializes due templates (per-template transactions, creator-attributed); manual run-due now isolates failures per template | `jobs/recurringScheduler.ts`, `index.ts` |
| Pay-run void | Void keeps `journal_entry_id`/`finalized_at` (one-way CHECK implications) | migration `0052`, `payRunService.ts` |
| Banking workflow | Import batches + history endpoint, undo (still-unreviewed rows only), rule dry-run with shared predicate, apply-rules bar restored, inbox EmptyState | migration `0053`, `bankTransactionService.ts`, `ruleApplyService.ts` |
| Performance Center | Recharts (axes/tooltips/gradients), 3M/6M/12M ranges, prior-period deltas, P&L drilldowns, KPI hints | `PerformanceCenterPage.tsx` (+`recharts` dep, prescribed here) |
| Performance report zero-bug | Trends were identically zero: account-type lived in a LEFT JOIN condition, so sums spanned both sides of balanced JEs. Filter moved into the SUM; regression test added | `performanceReportService.ts` |
| Shared Dialog | Radix wrapper; converted Receipts link, Payroll-tax pay, Recurring filter, Journal import, CoA import modals (the other originally-listed pages' modals no longer existed post-restyle); Escape + `role="dialog"` on Rules/CoA drawers | `components/ui/dialog.tsx` |
| Validation surfacing | zod 400 `field_errors` rendered app-wide (27 local `pickErr` copies → shared helper); compliance autosave shows Saving…/Saved ✓ | `lib/apiErrors.ts` |
| Custom report tests | Lifecycle (create/run/update/delete), account filters (all/one/type-group), month grouping | `customReportService.test.ts` |
| S3/R2 adapter | `S3Storage` implementing `FileStorage`, env-gated on `S3_BUCKET`; dormant until env vars set | `lib/fileStorage.ts` |
| Data/date fixes | Recurring page local-date rendering; seeded recurring templates repaired to materializable payloads; stale-dist lint/type breakage cleaned | seeds `0008`, misc |

---

## Process notes (for future Claude sessions)

- Sub-agent commit attribution is unreliable when 3+ agents run in parallel and edit the same hot-spot files. Several slices ended up with files committed under a sibling agent's commit message due to `git add -A` races. Content is always intact; just the SHA-to-feature mapping gets fuzzy. Acceptable tradeoff for the parallelism speedup.
- The default `vitest run tests/integration` script in `apps/api/package.json` uses default pool sizing that spawned 16+ Postgres testcontainers in parallel and timed out hooks. Always run with `--pool=forks --poolOptions.forks.singleFork=true` for reliability.
- Plan-impl drift is real and constant — every slice surfaced 3-5 incorrect assumptions in my plan (column names, function signatures, response shapes). The drift logs at the top of each slice plan are the durable record.
- After editing anything in `packages/shared`, run `npm -w @accounting/shared run build` — api/web resolve the compiled `dist/`, and a stale dist produces confusing typecheck failures.
- A `LEFT JOIN ... AND <filter>` never filters rows — twice now a report summed both sides of balanced JEs to zero because the account-type restriction sat in the join condition instead of the aggregate/WHERE.
- Local dev environment specifics (fixture login recipe, proxy flip, Docker/test flags) live in `HANDOFF.md`.
