# Follow-ups Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the actionable backlog in `docs/follow-ups.md`: finish recurring invoice/bill templates (+controls +scheduler), harden pay_runs void, race-safe numbering, Recharts on Performance Center, banking workflow depth, shadcn Dialog swap, custom-report regression tests, form-validation feedback, a11y labels, env-gated S3 storage adapter.

**Architecture:** Each item is an independent vertical change on `main` (no worktree; dev servers run from this checkout for live browser verification). Backend items follow the repo service conventions (`(trx, ctx, args)`, audit in-txn, ledger via `postJournalEntry`). One commit per item; `docs/follow-ups.md` patched in the same commit when an item completes (plan-impl sync).

**Tech Stack:** Express + Kysely + Postgres (migrations in `db/migrations/`), Zod in `packages/shared`, Vite + React + Tailwind + shadcn/ui, vitest + testcontainers.

## Global Constraints

- `no-explicit-any: error`; `catch (e: unknown)`; `exactOptionalPropertyTypes: true` (conditional patch objects, never assign `undefined`).
- Ledger writes ONLY via `core/ledgerService.postJournalEntry`.
- Audit inside the same transaction: `auditRecord(trx, ctx, {...})`; actions appended to `packages/shared/src/auditActions.ts`, never reordered.
- Numeric/date DB columns: `ColumnType<string, string | number | undefined, string | number>`; `Generated<T>` only for defaulted columns; never `Generated<ColumnType<>>`.
- Next migration number is **0051** (note: two `0050_*.sql` files exist from a branch merge; runner sorts lexicographically, both apply).
- Integration tests: `npm -w @accounting/api run test:integration -- --pool=forks --poolOptions.forks.singleFork=true` (default pool sizing spawns 16+ containers and times out).
- New tables appended to the FRONT of the `TRUNCATE` list in `apps/api/tests/helpers/testDb.ts:60`.
- Money via `fmtMoney` (no `$`); dates via `todayLocal()`/`fmtLongDate()` in web.
- Commit after each task (user preference); user handles pushes.

---

### Task A: Per-business numbering counters (follow-ups "Per-business sequences")

**Files:**
- Create: `db/migrations/0051_numbering_counters.sql`
- Create: `apps/api/src/services/core/numberingService.ts`
- Create: `apps/api/tests/integration/numberingService.test.ts`
- Modify: `apps/api/src/db/types.ts` (add `NumberingCountersTable`, register in `DB`)
- Modify: `apps/api/src/services/inventory/salesOrderService.ts:25-43` (`nextSONumber`, `nextInvoiceNumber`)
- Modify: `apps/api/src/services/inventory/itemReceiptService.ts:18-25` (`nextBillNumber`)
- Modify: `apps/api/src/services/inventory/purchaseOrderService.ts:24-33` (`nextPONumber`)
- Modify: `apps/api/tests/helpers/testDb.ts` (truncate list)

**Interfaces:**
- Produces: `nextNumber(trx: Transaction<DB>, business_id: string, entity_type: 'invoice' | 'bill' | 'purchase_order' | 'sales_order', prefix: string): Promise<string>` → e.g. `INV-0007`. Task B consumes it for recurring invoice/bill numbers.

- [x] **Step 1: Migration** — counter table + seed from current row counts so existing businesses continue their sequences:

```sql
-- Race-safe per-business document numbering (replaces count(*)+1).
CREATE TABLE numbering_counters (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  last_value bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, entity_type)
);

INSERT INTO numbering_counters (business_id, entity_type, last_value)
SELECT business_id, 'invoice', count(*) FROM invoices GROUP BY business_id;
INSERT INTO numbering_counters (business_id, entity_type, last_value)
SELECT business_id, 'bill', count(*) FROM bills GROUP BY business_id;
INSERT INTO numbering_counters (business_id, entity_type, last_value)
SELECT business_id, 'purchase_order', count(*) FROM purchase_orders GROUP BY business_id;
INSERT INTO numbering_counters (business_id, entity_type, last_value)
SELECT business_id, 'sales_order', count(*) FROM sales_orders GROUP BY business_id;
```

- [x] **Step 2: Failing test** (`numberingService.test.ts`): sequential calls return `INV-0001`, `INV-0002`; two businesses are independent; a counter seeded at N continues at N+1. Run: expect FAIL (module missing).
- [x] **Step 3: Implement `numberingService.ts`** — atomic upsert increment (row-lock serializes concurrent callers; no SELECT FOR UPDATE needed):

```ts
export async function nextNumber(
  trx: Transaction<DB>, business_id: string,
  entity_type: 'invoice' | 'bill' | 'purchase_order' | 'sales_order', prefix: string,
): Promise<string> {
  const row = await trx.insertInto('numbering_counters')
    .values({ business_id, entity_type, last_value: 1 })
    .onConflict(oc => oc.columns(['business_id', 'entity_type'])
      .doUpdateSet({ last_value: sql`numbering_counters.last_value + 1` }))
    .returning('last_value')
    .executeTakeFirstOrThrow();
  return `${prefix}-${String(Number(row.last_value)).padStart(4, '0')}`;
}
```

- [x] **Step 4: Swap the four helpers** to one-line delegations (`nextNumber(trx, business_id, 'sales_order', 'SO')` etc.). Keep exported call sites unchanged. Add `numbering_counters` to truncate list.
- [x] **Step 5: Run** new test + the four touched suites (`salesOrderService`, `itemReceiptService`, `purchaseOrderService`, `invoiceService`) → PASS. Typecheck. Commit `feat(api): race-safe per-business numbering counters`.

Note: user-typed numbers can still collide with generated ones (pre-existing); services keep their DUPLICATE_RESOURCE guards.

---

### Task B: Recurring invoice + bill materialization (follow-ups "Invoice + bill template_types")

**Files:**
- Modify: `packages/shared/src/schemas/recurringTemplate.ts` (payload schemas)
- Modify: `apps/api/src/services/accounting/recurringTemplateService.ts` (validate payload on create; materialize invoice/bill in `runDue`)
- Test: `apps/api/tests/integration/recurringTemplateService.test.ts` (extend)

**Interfaces:**
- Consumes: Task A `nextNumber`; `invoiceService.createDraft/postInvoice`; `billService.createDraft/postBill`. Drift note: `createDraft` returns `{ invoice, lines }` / `{ bill, lines }`, not the bare row.
- Produces: `recurringInvoicePayloadSchema`, `recurringBillPayloadSchema`, `recurringJePayloadSchema` (exported via `schemas/index.ts` — already re-exports the module); exported `materializeDueTemplate(trx, ctx, template, today)` (whole catch-up loop + advance + audit for ONE template) reused by Task D with a per-template ctx built from `created_by_user_id`.

Payload schemas (dates and numbers are per-run, so payloads carry neither):

```ts
export const recurringJePayloadSchema = z.object({
  memo: z.string().max(1000).nullable().optional(),
  reference: z.string().max(200).nullable().optional(),
  lines: z.array(z.object({
    account_id: z.string().uuid(),
    debit: z.string().regex(/^\d+(\.\d{1,4})?$/),
    credit: z.string().regex(/^\d+(\.\d{1,4})?$/),
    memo: z.string().max(500).nullable().optional(),
  })).min(2),
});
export const recurringInvoicePayloadSchema = z.object({
  customer_id: z.string().uuid(),
  due_days: z.number().int().min(0).max(365).default(30),
  memo: z.string().max(1000).nullable().optional(),
  terms: z.string().max(200).nullable().optional(),
  lines: z.array(invoiceLineInputSchema).min(1),
});
export const recurringBillPayloadSchema = z.object({
  vendor_id: z.string().uuid(),
  due_days: z.number().int().min(0).max(365).default(30),
  memo: z.string().nullable().optional(),
  terms: z.string().nullable().optional(),
  lines: z.array(billLineCreateSchema).min(1),
});
```

Materialization behavior (decision): invoice/bill are created **and posted** (mirrors JE templates, which post immediately; follow-ups.md prescribes `createDraft` + `post*`). `issue_date`/`bill_date` = run date; `due_date` = run date + `due_days`; number from `nextNumber` (`INV`/`BILL`); memo defaults to `Recurring: <template name>`.

- [x] **Step 1: Failing tests**: (1) monthly invoice template → `runDue` creates 1 posted invoice w/ JE, advances date; (2) monthly bill template → 1 posted bill w/ JE; (3) `create` with invoice payload missing `customer_id` throws VALIDATION_FAILED. Factories: `makeCustomer`, `makeVendor` exist in `tests/helpers/factories.ts`.
- [x] **Step 2: Implement**: `create` validates payload per `template_type` (store the **parsed** payload so zod defaults persist); extract per-template loop into `materializeTemplate`; add invoice/bill branches + `addDays` helper; remove the PRECONDITION_FAILED throw.
- [x] **Step 3: Run recurring + invoice + bill suites** → PASS. Typecheck. Commit `feat(api): recurring invoice and bill template materialization`.

---

### Task C: Recurring pause/resume, next-run preview, last-run history

**Files:**
- Modify: `apps/api/src/services/accounting/recurringTemplateService.ts` (add `update`, `listRuns`)
- Modify: `apps/api/src/routes/recurringTemplates.ts` (PATCH `/:id`, GET `/:id/runs`)
- Modify: `apps/web/src/pages/accounting/` recurring page (recon exact filename; remove "coming soon" for invoice/bill, add pause/resume, next-run preview, last-run column, payload builders for invoice/bill)
- Test: extend `recurringTemplateService.test.ts` (update toggles `is_active` + audits; listRuns returns run history)

**Interfaces:**
- Produces: `update(trx, ctx, { template_id, patch })` honoring `recurringTemplateUpdateSchema` (already exists in shared, including `is_active`); `listRuns(db, business_id, template_id)` reading `audit_logs` (`action = 'recurring_template.run'`, `entity_id = template_id`) — no new table.
- Audit: reuse existing `RECURRING_TEMPLATE_UPDATE` (`auditActions.ts:144` — already present, no append needed).

- [x] **Step 1: Failing tests** for `update` (pause sets `is_active=false`, `runDue` then skips it) and `listRuns` (after a run, one entry with `runs_created`).
- [x] **Step 2: Implement service + routes** (`requireMinRole('accountant')` for PATCH; reads staff+). Conditional patch object per exactOptionalPropertyTypes; validate payload against type-specific schema when `payload` present in patch.
- [x] **Step 3: Web**: recurring page gets type-aware create form (JE lines / invoice lines + customer picker / bill lines + vendor picker), Pause/Resume row action, "Next runs" preview (pure client computation replicating `advanceDate`), last-run + history popover fed by `/runs`. QBO list shape (h1 → filters → Card > DataTable).
- [x] **Step 4: Verify in browser on localhost** (proxy flipped to local API). Run suites, typecheck web+api, lint. Commit `feat: recurring template controls (pause/resume, preview, history)`.

---

### Task D: Scheduled materialization (in-process scheduler)

**Files:**
- Create: `apps/api/src/jobs/recurringScheduler.ts`
- Modify: `apps/api/src/index.ts` (start scheduler after listen)
- Test: `apps/api/tests/integration/recurringScheduler.test.ts` (call `materializeAllDue(db)` directly)

**Interfaces:**
- Produces: `materializeAllDue(db: Kysely<DB>): Promise<{ processed: number; failed: number }>` — iterates active due templates across ALL businesses; each template in its own transaction; ctx built via `systemCtx({ firm_id, business_id, user_id: t.created_by_user_id })` (skip + warn when creator is null — `journal_entries.created_by_user_id` FK needs a real user; audit maps zero-UUID to null but zero-UUID would violate the JE FK). `startRecurringScheduler(db)` — `setInterval` hourly, `unref()`, errors logged never thrown; idempotent because `next_run_date` advances (an extra tick is a no-op).
- Decision (CLAUDE.md rule 3): in-process interval instead of Railway cron / self-ping — no new infra or env vars; manual "Run all due" route stays.

- [x] **Step 1: Failing test**: two businesses each with a due template → `materializeAllDue` materializes both without a request ctx; a template with a broken payload fails without blocking the other (`failed: 1, processed: 1`).
- [x] **Step 2: Implement** scheduler + wire `startRecurringScheduler(db)` in `index.ts` (not `app.ts`, so tests/supertest never start timers).
- [x] **Step 3: Run tests, typecheck. Commit `feat(api): in-process scheduler for recurring templates`.**

---

### Task E: pay_runs — keep JE link on void (follow-ups "Loosen biconditional CHECK")

**Files:**
- Create: `db/migrations/0052_pay_runs_void_keeps_je.sql`
- Modify: `apps/api/src/services/payroll/payRunService.ts:238-248` (`voidPayRun` stops nulling)
- Test: extend `apps/api/tests/integration/payRunService.test.ts`

```sql
-- Void keeps the JE back-link (mirrors slice-8 fix on expense_transactions, commit 8b747dd).
ALTER TABLE pay_runs DROP CONSTRAINT pr_finalized_has_je;
ALTER TABLE pay_runs ADD CONSTRAINT pr_finalized_has_je CHECK (
  (status <> 'draft' OR journal_entry_id IS NULL)
  AND (status <> 'finalized' OR (journal_entry_id IS NOT NULL AND finalized_at IS NOT NULL))
);
```

- [x] **Step 1: Failing test**: finalize → void → `journal_entry_id`/`finalized_at`/`finalized_by_user_id` still populated; linked JE has a reversal.
- [x] **Step 2: Migration + `voidPayRun` sets only `status: 'void'`** (update the stale comment). Run payroll suites → PASS. Commit `fix(api): pay run void keeps journal entry link`.

---

### Task F: Performance Center — Recharts

**Files:**
- Modify: `apps/web/package.json` (+`recharts` — dependency explicitly prescribed by follow-ups.md)
- Modify: `apps/web/src/pages/reports/PerformanceCenterPage.tsx`

- [x] Replace hand-rolled SVG sparklines with Recharts (`ResponsiveContainer` + `AreaChart`/`LineChart`): X/Y axes, themed tooltip using `fmtMoney`, KPI explanation line in tooltip, date-range compare consistent with existing data shape. Keep theme tokens (ink/gold, IBM Plex Mono numerals). Typecheck + lint + browser verify. Commit `feat(web): Recharts charts on Performance Center`.

---

### Task G: Banking workflow — import history, rule dry-run, undo import, empty states

**Files (recon at execution):**
- Modify: `apps/api/src/services/banking/` import + rule services (import batches: check for an existing `bank_import_batches`/`import_batch_id` concept; if absent, migration `0053_bank_import_batches.sql` linking `bank_transactions.import_batch_id`)
- Modify: `apps/api/src/routes/` banking routes (GET import history, POST rule dry-run, POST import undo)
- Modify: `apps/web/src/pages/banking/` (history list, dry-run match count in rule form, undo button, `EmptyState`s)
- Test: extend `bankTransactionService`/`bankRuleService`/`ruleApply` suites

Behaviors: dry-run = evaluate rule predicate over unreconciled transactions, return match count + sample, **no writes**; undo import = delete transactions from a batch only where status is still imported/unreviewed (mutable-until-reconciled invariant — no `protect_posted`-style trigger, per CLAUDE.md don'ts); history = batches with counts/dates/filename.

- [x] TDD service-first, then routes, then web. Audit actions appended for `bank_import.undo` (+ create if batches are new). Commit per sub-feature if sizeable, else one commit.

---

### Task H: shadcn Dialog for ad-hoc modals

**Files:**
- Create: `apps/web/src/components/ui/dialog.tsx` (shadcn wrapper over `@radix-ui/react-dialog` — already in `apps/web/package.json` per handoff)
- Modify: `apps/web/src/pages/receipts/ReceiptsPage.tsx`, `.../IntegrationInboxPage.tsx`, `.../payroll/ContractorsPage.tsx`, `.../payroll/EmployeeDetailPage.tsx`, `.../payroll/PayrollTaxesPage.tsx` (exact paths recon'd at execution)

- [x] Swap fixed-overlay `<Card>` modals for `<Dialog>` (focus trap, Escape, aria). Visual parity otherwise. Browser-verify each page. Commit `polish(web): shadcn Dialog for modal flows`.

---

### Task I: Custom Reports regression tests

**Files:**
- Modify: `apps/api/tests/integration/customReportService.test.ts`

- [x] Add lifecycle tests (create/run/delete of a saved definition) and account-filter tests (all accounts / single account / account-type group) against seeded JEs with known balances. No production code expected to change; if a bug surfaces, fix in the same commit. Commit `test(api): custom report lifecycle + account filter coverage`.

---

### Task J: Form validation + save feedback

**Files (recon at execution):**
- Modify: API error middleware (`apps/api/src/middleware/` or `app.ts`) — ensure zod 400s include per-field `issues` (path + message), not just `Input validation failed`
- Modify: web api client + dense forms (Invoice/Bill/JE/Receive Payment) to render field-level messages; settings-style pages get explicit Saving/Saved/error states

- [x] Verify current 400 shape first; extend without breaking existing consumers/tests. Sweep top dense forms only (YAGNI). Commit `feat: field-level validation feedback + save states`.

---

### Task K: Accessibility — labels/IDs on form controls

**Files:** create/edit panels across `apps/web/src/pages/` flagged by Chrome (recon with a devtools audit on localhost).

- [x] `htmlFor`/`id` pairs (stable ids), `aria-label` on icon-only buttons, focus initial field in dialogs (Task H's Dialog gives focus trap). Commit `polish(web): form control labels and ids`.

---

### Task L: S3/R2 storage adapter (env-gated)

**Files:**
- Modify: `apps/api/src/lib/fileStorage.ts` (add `S3Storage` implementing the existing `FileStorage` interface: `store`, `read`, `exists`)
- Modify: `apps/api/package.json` (+`@aws-sdk/client-s3`)

- [x] Export swap: `process.env.S3_BUCKET ? new S3Storage(...) : new LocalVolumeStorage(...)`. Env vars (`S3_BUCKET`, `S3_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) documented in follow-ups.md; adapter stays dormant until set (no new env required to run). Unit-testable via interface; integration against real R2 is out of scope. Commit `feat(api): env-gated S3/R2 file storage adapter`.

---

### Wrap-up

- [ ] Full integration suite with the forks flags; web+api typecheck; web lint.
- [x] Patch `docs/follow-ups.md` (remove/annotate completed sections — matches prior "docs: remove completed follow-ups" pattern) and refresh `docs/qbo-revamp-handoff.md` staleness (second wave is merged).
- [ ] Report deliberately-skipped items to the user: Railway volume mount (dashboard access), prod test-vendor deletion (prod destructive — needs explicit go-ahead), tax engine / Plaid / OCR (out of scope per doc).

## Self-review notes

- Coverage: every actionable follow-ups.md section maps to a task (A↔sequences, B↔recurring types, C+D↔recurring UX/cron, E↔pay_runs CHECK, F↔charts, G↔banking, H↔dialogs, I↔custom-report tests, J↔validation, K↔a11y, L↔R2). Railway volume + misc integrations intentionally excluded (user prerequisite / out of scope).
- Type consistency: `nextNumber` signature used identically in A and B; `materializeTemplate` produced in B, consumed in D; `recurring*PayloadSchema` names consistent across B and C.
- Web-heavy tasks (C step 3, F–K) carry recon-at-execution steps by design — this repo's plan-drift process note says exact web internals go stale; paths and behaviors are pinned, internals verified live.
