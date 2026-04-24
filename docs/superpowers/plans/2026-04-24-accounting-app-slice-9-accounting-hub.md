# Slice 9 — Accounting Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 3 Accounting ComingSoon tabs (Client Overview, Books Review, Recurring Transactions) with real features.

**Architecture:**
- **Client Overview:** firm-level cross-business dashboard (only visible to `firm_admin`). Aggregates AR/AP balances, last reconciliation date, unreviewed bank txns count, open period count per business in the firm. No new tables.
- **Books Review:** per-`fiscal_period` checklist. New `period_review_tasks` table (period_id, task_key enum, status enum, assignee_user_id, signed_off_at, notes). Default tasks seeded for each fiscal period: `reconcile_bank`, `post_adjustments`, `review_unreviewed_txns`, `close_period`.
- **Recurring Transactions:** new `recurring_templates` table (template_type enum: journal_entry / invoice / bill, payload jsonb, recurrence enum: weekly/monthly/quarterly/yearly, next_run_date, end_date?, last_run_at?). Lazy materialization — no cron infra. A "Run all due" endpoint iterates templates where `next_run_date <= today` and creates the appropriate JE / invoice / bill, advancing `next_run_date` by the recurrence interval.

**Tech Stack:** No new deps. Reuses existing services: `postJournalEntry`, `createDraftInvoice`+`postInvoice`, `createBill`+`postBill`.

---

## Locked decisions

1. **Lazy materialization, no cron.** "Run all due" is user-triggered (button in UI + API endpoint). Each materialization advances `next_run_date` by the recurrence interval; loops until `next_run_date > today`. All in one transaction per template.
2. **Default review tasks** are seeded automatically when a fiscal_period is created (via DB function or service hook). For existing periods, a one-shot seed function backfills.
3. **Cross-business reads:** `firm_admin` already bypasses the tenancy check via `effective_role`. The `firmDashboardService` selects across all businesses in the firm. Other roles get a 403 from the route.
4. **Recurring template payload** is JSON validated at run-time against the appropriate zod schema (`journalEntryCreateSchema` / `invoiceCreateSchema` / `billCreateSchema`) before passing to the service.
5. **Recurrence advance:** monthly = +1 month using Postgres `interval`. Quarterly = +3 months. Weekly = +7 days. Yearly = +1 year.
6. **No protect_posted-style triggers** on these tables — recurring_templates and period_review_tasks are mutable throughout.
7. **Plan-impl sync:** any deviation patches this plan markdown in the same commit.

---

## Pacing + gotchas (inherited)

- Same conventions as slice 8 (CLAUDE.md). `(trx, ctx, args)` signature; audit in same trx; ledger writes only via `core/ledgerService.postJournalEntry`.
- `app.ts` mounts routers WITHOUT `/api/v1` prefix — route paths start with `/businesses/:businessId/...`.
- Web hooks: `useActiveBusinessId` from `@/lib/business`, `useAuth()` from `@/auth/useAuth`.
- CoA endpoint is `/businesses/:bizId/coa` returning `{ accounts: [...] }`.
- shadcn imports: use `Card, CardHeader, CardTitle, CardContent`.
- Test runs need `--pool=forks --poolOptions.forks.singleFork=true` to avoid testcontainer exhaustion.

---

## Phase A — Infra + DB

### Task 1: Migration `0032_period_review_tasks.sql`

**Files:** Create `db/migrations/0032_period_review_tasks.sql`

```sql
CREATE TYPE period_review_task_key AS ENUM (
  'reconcile_bank',
  'post_adjustments',
  'review_unreviewed_txns',
  'close_period'
);

CREATE TYPE period_review_task_status AS ENUM ('todo', 'in_progress', 'done');

CREATE TABLE period_review_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  period_id uuid NOT NULL REFERENCES fiscal_periods(id),
  task_key period_review_task_key NOT NULL,
  status period_review_task_status NOT NULL DEFAULT 'todo',
  assignee_user_id uuid REFERENCES users(id),
  notes text,
  signed_off_at timestamptz,
  signed_off_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prt_unique_period_task UNIQUE (period_id, task_key),
  CONSTRAINT prt_signed_off_done CHECK (
    (status = 'done') = (signed_off_at IS NOT NULL)
  )
);

CREATE INDEX idx_prt_business ON period_review_tasks(business_id);
CREATE INDEX idx_prt_period ON period_review_tasks(period_id);

CREATE TRIGGER period_review_tasks_updated_at
  BEFORE UPDATE ON period_review_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed default tasks for any new fiscal_period
CREATE OR REPLACE FUNCTION seed_period_review_tasks() RETURNS trigger AS $$
BEGIN
  INSERT INTO period_review_tasks (business_id, period_id, task_key)
  VALUES
    (NEW.business_id, NEW.id, 'reconcile_bank'),
    (NEW.business_id, NEW.id, 'post_adjustments'),
    (NEW.business_id, NEW.id, 'review_unreviewed_txns'),
    (NEW.business_id, NEW.id, 'close_period');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fiscal_periods_seed_review_tasks
  AFTER INSERT ON fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION seed_period_review_tasks();

-- Backfill for existing periods (idempotent due to UNIQUE constraint + ON CONFLICT)
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT id, business_id FROM fiscal_periods LOOP
    INSERT INTO period_review_tasks (business_id, period_id, task_key) VALUES
      (p.business_id, p.id, 'reconcile_bank'),
      (p.business_id, p.id, 'post_adjustments'),
      (p.business_id, p.id, 'review_unreviewed_txns'),
      (p.business_id, p.id, 'close_period')
    ON CONFLICT (period_id, task_key) DO NOTHING;
  END LOOP;
END $$;
```

- [ ] **Step 1:** Write migration as above.
- [ ] **Step 2:** `npm --workspace apps/api run test:integration -- --pool=forks --poolOptions.forks.singleFork=true tests/integration/periodClose.test.ts` — verify existing tests still pass against the augmented schema.
- [ ] **Step 3:** Commit `feat(db): period_review_tasks table + auto-seed trigger`.

---

### Task 2: Migration `0033_recurring_templates.sql`

**Files:** Create `db/migrations/0033_recurring_templates.sql`

```sql
CREATE TYPE recurring_template_type AS ENUM ('journal_entry', 'invoice', 'bill');
CREATE TYPE recurring_template_recurrence AS ENUM ('weekly', 'monthly', 'quarterly', 'yearly');

CREATE TABLE recurring_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  template_type recurring_template_type NOT NULL,
  payload jsonb NOT NULL,
  recurrence recurring_template_recurrence NOT NULL,
  next_run_date date NOT NULL,
  end_date date,
  last_run_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  CONSTRAINT rt_end_after_next CHECK (end_date IS NULL OR end_date >= next_run_date)
);

CREATE INDEX idx_rt_business ON recurring_templates(business_id);
CREATE INDEX idx_rt_due ON recurring_templates(business_id, next_run_date) WHERE is_active = true;

CREATE TRIGGER recurring_templates_updated_at
  BEFORE UPDATE ON recurring_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

- [ ] **Step 1:** Write migration.
- [ ] **Step 2:** Re-run `periodClose.test.ts` to confirm it still passes.
- [ ] **Step 3:** Commit `feat(db): recurring_templates table`.

---

### Task 3: Augment `apps/api/src/db/types.ts`

**Files:** Modify `apps/api/src/db/types.ts`.

Append these interfaces (anywhere before the `DB` interface):

```ts
export type PeriodReviewTaskKey = 'reconcile_bank' | 'post_adjustments' | 'review_unreviewed_txns' | 'close_period';
export type PeriodReviewTaskStatus = 'todo' | 'in_progress' | 'done';

export interface PeriodReviewTasksTable {
  id: Generated<string>;
  business_id: string;
  period_id: string;
  task_key: PeriodReviewTaskKey;
  status: Generated<PeriodReviewTaskStatus>;
  assignee_user_id: string | null;
  notes: string | null;
  signed_off_at: Timestamp | null;
  signed_off_by_user_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export type RecurringTemplateType = 'journal_entry' | 'invoice' | 'bill';
export type RecurringTemplateRecurrence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurringTemplatesTable {
  id: Generated<string>;
  business_id: string;
  name: string;
  template_type: RecurringTemplateType;
  payload: ColumnType<unknown, unknown, unknown>;
  recurrence: RecurringTemplateRecurrence;
  next_run_date: ColumnType<string, string, string>;
  end_date: ColumnType<string, string, string> | null;
  last_run_at: Timestamp | null;
  is_active: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  created_by_user_id: string | null;
}
```

Add to `DB` interface:

```ts
  period_review_tasks: PeriodReviewTasksTable;
  recurring_templates: RecurringTemplatesTable;
```

- [ ] **Step 1:** Apply edits.
- [ ] **Step 2:** `npm --workspace apps/api run typecheck` — expect 0 errors.
- [ ] **Step 3:** Commit `feat(api): augment DB type with period_review_tasks + recurring_templates`.

---

### Task 4: Audit actions + zod schemas + factories + truncateAll

**Files:**
- Modify: `packages/shared/src/auditActions.ts`
- Create: `packages/shared/src/schemas/periodReview.ts`, `recurringTemplate.ts`
- Modify: `packages/shared/src/schemas/index.ts`
- Modify: `apps/api/tests/helpers/factories.ts`
- Modify: `apps/api/tests/helpers/testDb.ts`

**Audit actions** (append to AUDIT object before the closing `} as const`):

```ts
  // Slice 9 — Accounting hub
  PERIOD_REVIEW_TASK_UPDATE: 'period_review_task.update',
  PERIOD_REVIEW_TASK_SIGN_OFF: 'period_review_task.sign_off',
  RECURRING_TEMPLATE_CREATE: 'recurring_template.create',
  RECURRING_TEMPLATE_UPDATE: 'recurring_template.update',
  RECURRING_TEMPLATE_DELETE: 'recurring_template.delete',
  RECURRING_TEMPLATE_RUN: 'recurring_template.run',
```

**`packages/shared/src/schemas/periodReview.ts`:**

```ts
import { z } from 'zod';

export const periodReviewTaskUpdateSchema = z.object({
  status: z.enum(['todo', 'in_progress', 'done']).optional(),
  assignee_user_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type PeriodReviewTaskUpdate = z.infer<typeof periodReviewTaskUpdateSchema>;
```

**`packages/shared/src/schemas/recurringTemplate.ts`:**

```ts
import { z } from 'zod';

export const recurringTemplateCreateSchema = z.object({
  name: z.string().min(1).max(200),
  template_type: z.enum(['journal_entry', 'invoice', 'bill']),
  payload: z.record(z.unknown()),
  recurrence: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
  next_run_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export type RecurringTemplateCreate = z.infer<typeof recurringTemplateCreateSchema>;

export const recurringTemplateUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  payload: z.record(z.unknown()).optional(),
  recurrence: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).optional(),
  next_run_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  is_active: z.boolean().optional(),
});
export type RecurringTemplateUpdate = z.infer<typeof recurringTemplateUpdateSchema>;
```

**`packages/shared/src/schemas/index.ts`:** append:
```ts
export * from './periodReview.js';
export * from './recurringTemplate.js';
```

**`apps/api/tests/helpers/factories.ts`:** append:

```ts
export async function makeRecurringTemplate(
  db: Kysely<DB>,
  business_id: string,
  opts: Partial<{ name: string; template_type: 'journal_entry'|'invoice'|'bill'; payload: unknown; recurrence: 'weekly'|'monthly'|'quarterly'|'yearly'; next_run_date: string }> = {},
) {
  return db.insertInto('recurring_templates').values({
    business_id,
    name: opts.name ?? 'Template',
    template_type: opts.template_type ?? 'journal_entry',
    payload: (opts.payload ?? {}) as object,
    recurrence: opts.recurrence ?? 'monthly',
    next_run_date: opts.next_run_date ?? '2026-04-01',
  }).returningAll().executeTakeFirstOrThrow();
}
```

**`apps/api/tests/helpers/testDb.ts`:** add `recurring_templates` and `period_review_tasks` at the front of the `TRUNCATE` list (both depend on `businesses` + `fiscal_periods` + `users`):

```sql
TRUNCATE
  recurring_templates,
  period_review_tasks,
  expense_transactions,
  ...
```

- [ ] **Step 1:** Apply all edits.
- [ ] **Step 2:** `npm --workspace packages/shared run build && npm --workspace apps/api run typecheck` — expect clean.
- [ ] **Step 3:** Commit `feat(shared,api): slice 9 audit actions, schemas, factories, truncateAll`.

---

## Phase B — Services (parallel after Phase A)

### Task 5: `firmDashboardService.ts` (TDD, 1 test + 1 cross-tenant guard test)

**Files:**
- Create: `apps/api/src/services/firm/firmDashboardService.ts`
- Create: `apps/api/tests/integration/firmDashboardService.test.ts`

**Owns:** the two files above.

**Tests:**
1. `getFirmOverview returns one row per business in the firm with AR/AP balances and unreviewed-bank-txn counts`
2. `getFirmOverview throws if effective_role is not firm_admin`

**Service shape:**

```ts
export type FirmOverviewRow = {
  business_id: string;
  business_name: string;
  ar_balance: string;            // sum of unpaid invoices
  ap_balance: string;            // sum of unpaid bills
  unreviewed_bank_txn_count: number;
  open_period_count: number;
  last_reconciliation_date: string | null;
};

export async function getFirmOverview(db: Kysely<DB>, ctx: ServiceCtx): Promise<FirmOverviewRow[]> {
  if (ctx.effective_role !== 'firm_admin') {
    throw new BusinessRuleError(ERR.FORBIDDEN, 'firm_admin only');
  }
  // SELECT b.id, b.name, ...subqueries... FROM businesses b WHERE b.firm_id = ctx.firm_id ORDER BY b.name
}
```

Use raw `sql` template strings for the subquery aggregates (similar pattern to `apOverviewService`).

- [ ] **Step 1:** Write failing tests.
- [ ] **Step 2:** Implement. Use AR aging-style queries: AR balance = sum of `invoices.total - SUM(payment_applications.amount_applied)` for posted invoices. AP balance same shape using bills + bill_payment_applications. Unreviewed bank txns = COUNT(bank_transactions) WHERE business_id IN (firm businesses) AND status='unreviewed'. Last recon = max(period_end) per bank_account.
- [ ] **Step 3:** `npm --workspace apps/api run test:integration -- --pool=forks --poolOptions.forks.singleFork=true tests/integration/firmDashboardService.test.ts`.
- [ ] **Step 4:** Commit `feat(api): firm dashboard service with cross-business overview`.

---

### Task 6: `periodReviewService.ts` (TDD, 2 tests)

**Files:**
- Create: `apps/api/src/services/accounting/periodReviewService.ts`
- Create: `apps/api/tests/integration/periodReviewService.test.ts`

**Tests:**
1. `listForPeriod returns the 4 default tasks seeded by the trigger`
2. `signOff sets status=done + signed_off_at + signed_off_by_user_id and audit-logs`

**Service shape:**

```ts
export async function listForPeriod(db: Kysely<DB>, business_id: string, period_id: string) {
  return db.selectFrom('period_review_tasks').selectAll()
    .where('business_id', '=', business_id).where('period_id', '=', period_id)
    .orderBy('task_key').execute();
}

export async function update(trx: Transaction<DB>, ctx: ServiceCtx, input: { task_id: string; patch: { status?: 'todo'|'in_progress'|'done'; assignee_user_id?: string | null; notes?: string | null } }) {
  // Audit-log update; if status flipping to 'done', also set signed_off_at + signed_off_by_user_id and audit as SIGN_OFF.
  // Conditional patch.
}
```

- [ ] **Step 1-4:** TDD cycle as above.
- [ ] **Step 5:** Commit `feat(api): period review service (list/update/sign-off) with TDD`.

---

### Task 7: `recurringTemplateService.ts` (TDD, 3 tests)

**Files:**
- Create: `apps/api/src/services/accounting/recurringTemplateService.ts`
- Create: `apps/api/tests/integration/recurringTemplateService.test.ts`

**Tests:**
1. `create inserts a template with status=active and next_run_date as supplied`
2. `runDue with one due monthly JE template materializes one JE and advances next_run_date by 1 month`
3. `runDue with a template whose next_run_date is 3 months in the past materializes 4 JEs (one for each cycle) and advances next_run_date past today`

**Service:**

```ts
export type CreateTemplateInput = {
  business_id: string;
  name: string;
  template_type: 'journal_entry' | 'invoice' | 'bill';
  payload: unknown;
  recurrence: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  next_run_date: string;
  end_date?: string | null;
};

export async function create(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateTemplateInput) {
  // Validate payload against the appropriate zod schema for the template_type.
  // Insert + audit.
}

export async function runDue(trx: Transaction<DB>, ctx: ServiceCtx, business_id: string): Promise<{ template_id: string; runs_created: number }[]> {
  const today = new Date().toISOString().slice(0, 10);
  const due = await trx.selectFrom('recurring_templates').selectAll()
    .where('business_id', '=', business_id)
    .where('is_active', '=', true)
    .where('next_run_date', '<=', today)
    .execute();

  const results: { template_id: string; runs_created: number }[] = [];
  for (const t of due) {
    let runs = 0;
    let nextDate = t.next_run_date;
    while (nextDate <= today && (t.end_date == null || nextDate <= t.end_date)) {
      // Materialize one occurrence based on template_type
      if (t.template_type === 'journal_entry') {
        const payload = t.payload as { lines: Array<{ account_id: string; debit: string; credit: string; memo?: string | null }>; memo?: string | null; reference?: string | null };
        await postJournalEntry(trx, ctx, {
          business_id: t.business_id,
          entry_date: nextDate,
          source_type: 'manual',
          memo: payload.memo ?? `Recurring: ${t.name}`,
          reference: payload.reference ?? null,
          lines: payload.lines.map(l => ({ account_id: l.account_id, debit: l.debit, credit: l.credit, memo: l.memo ?? null })),
        });
      }
      // (invoice + bill handled similarly — but slice 9 ships JE only; invoice/bill stubs throw `NotImplementedError` until a follow-up slice)
      else {
        throw new BusinessRuleError(ERR.PRECONDITION_FAILED, `recurring ${t.template_type} not yet implemented`);
      }
      runs++;
      nextDate = advanceDate(nextDate, t.recurrence);
    }
    await trx.updateTable('recurring_templates')
      .set({ next_run_date: nextDate, last_run_at: sql`now()` })
      .where('id', '=', t.id).execute();
    await auditRecord(trx, ctx, {
      action: AUDIT.RECURRING_TEMPLATE_RUN,
      entity_type: 'recurring_template',
      entity_id: t.id,
      before: t,
      after: { runs_created: runs, advanced_to: nextDate },
    });
    results.push({ template_id: t.id, runs_created: runs });
  }
  return results;
}

function advanceDate(date: string, recurrence: 'weekly'|'monthly'|'quarterly'|'yearly'): string {
  const d = new Date(date + 'T00:00:00Z');
  switch (recurrence) {
    case 'weekly':    d.setUTCDate(d.getUTCDate() + 7); break;
    case 'monthly':   d.setUTCMonth(d.getUTCMonth() + 1); break;
    case 'quarterly': d.setUTCMonth(d.getUTCMonth() + 3); break;
    case 'yearly':    d.setUTCFullYear(d.getUTCFullYear() + 1); break;
  }
  return d.toISOString().slice(0, 10);
}
```

NOTE: Slice 9 ships **journal_entry recurrence only.** invoice + bill template_types are accepted in the schema but throw at run-time. Documented as a one-line code comment + plan drift entry.

- [ ] **Step 1-4:** TDD.
- [ ] **Step 5:** Commit `feat(api): recurring template service (lazy materialization, JE only) with TDD`.

---

## Phase C — Routes (parallel after Phase B)

### Task 8: `firmOverview.ts` route

**Files:** Create `apps/api/src/routes/firmOverview.ts`. Modify `apps/api/src/app.ts` (add import + use).

```ts
router.get('/firm-overview', async (req, res, next) => {
  try { res.json({ businesses: await fd.getFirmOverview(db, ctxFromReq(req)) }); }
  catch (e) { next(e); }
});
```

Note this route is mounted directly (no `:businessId` prefix) — uses `requireAuth` only. The service guards on `effective_role`.

- [ ] **Step 1:** Create file.
- [ ] **Step 2:** Wire in `app.ts`.
- [ ] **Step 3:** typecheck + lint.
- [ ] **Step 4:** Commit `feat(api): firm overview route`.

---

### Task 9: `periodReview.ts` + `recurringTemplates.ts` routes

**Files:** Create `apps/api/src/routes/periodReview.ts`, `apps/api/src/routes/recurringTemplates.ts`. Modify `apps/api/src/app.ts`.

**`periodReview.ts`:**
- `GET /businesses/:businessId/fiscal-periods/:periodId/review-tasks` — list (auth)
- `PATCH /businesses/:businessId/review-tasks/:id` — update (accountant+)

**`recurringTemplates.ts`:**
- `GET /businesses/:businessId/recurring-templates` — list (auth)
- `POST /businesses/:businessId/recurring-templates` — create (accountant+)
- `PATCH /businesses/:businessId/recurring-templates/:id` — update (accountant+)
- `DELETE /businesses/:businessId/recurring-templates/:id` — delete (accountant+)
- `POST /businesses/:businessId/recurring-templates/run-due` — run due (accountant+)

- [ ] **Steps:** Implement, wire, typecheck, lint, commit `feat(api): period review + recurring template routes`.

---

## Phase D — Web

### Task 10: `ClientOverviewPage.tsx`

**Files:** Create `apps/web/src/pages/accounting/ClientOverviewPage.tsx`.

Fetch `/firm-overview`. If 403, render "Firm-admin only" message. Otherwise render a table: Business Name | AR | AP | Unreviewed Bank Txns | Open Periods | Last Recon.

Each row links to `/?business={id}` (or however the existing biz switcher works) so the user can deep-dive.

- [ ] Create + lint + commit.

---

### Task 11: `BooksReviewPage.tsx`

**Files:** Create `apps/web/src/pages/accounting/BooksReviewPage.tsx`.

Fiscal-period selector dropdown (fetched from `/businesses/:bizId/fiscal-periods`). Once a period is selected, fetch its review tasks. Render a checklist: each task as a card with name (humanized from task_key), status select (todo/in_progress/done), assignee dropdown (from users), notes textarea, "Sign off" button (visible if status≠done). PATCH on changes.

- [ ] Create + lint + commit.

---

### Task 12: `RecurringTransactionsPage.tsx`

**Files:** Create `apps/web/src/pages/accounting/RecurringTransactionsPage.tsx`.

Two sections:
1. "Due now" — fetch templates with next_run_date <= today, show list, "Run all due" button calls the run-due endpoint and displays results.
2. "All templates" — table of all templates: name, type, recurrence, next_run_date, last_run_at, is_active toggle. Edit / Delete actions.

"+ New template" inline form — for slice 9, the form only supports `template_type='journal_entry'`. Payload form: lines (account dropdown × debit/credit pair, +line button), memo, reference. Disable invoice/bill in the type dropdown with a "Slice 9.5" tooltip.

- [ ] Create + lint + commit.

---

### Task 13 (SOLO): Wire routes in App.tsx + verify build

**Files:** Modify `apps/web/src/App.tsx`.

Replace 3 ComingSoon stubs:
- `/accounting/client-overview` → `<ClientOverviewPage />`
- `/accounting/books-review` → `<BooksReviewPage />`
- `/accounting/recurring` → `<RecurringTransactionsPage />`

Add the 3 imports.

- [ ] Update + lint + build + commit `feat(web): wire client overview / books review / recurring transactions`.

---

## Phase E — Merge + deploy

### Task 14: Merge slice-9 into main

```bash
git checkout main && git pull
git merge --no-ff slice-9-accounting-hub -m "merge: slice 9 accounting hub"
git push origin main
```

**Deploy prereqs:** none new (no env vars, no infra). Migrations 0032-0033 auto-run.

**Smoke matrix:**
- `GET /firm-overview` (as firm_admin) returns one row per business.
- `GET /firm-overview` (as accountant) returns 403.
- Open `/accounting/books-review` for an existing fiscal period — 4 default tasks appear.
- Sign off a task — status flips, audit log records `period_review_task.sign_off`.
- Create a recurring JE template with `next_run_date = today`. Click "Run all due". Verify a JE was posted; `next_run_date` advanced by 1 month.

---

## Definition of Done

- Migrations 0032-0033 applied (33 total).
- ~8 new tests passing on top of slice-8 baseline (≥128 total).
- 3 ComingSoon stubs in `/accounting/*` replaced.
- `firm_admin` can see cross-business overview; other roles cannot.
- Books review default tasks auto-seed for new fiscal periods + are backfilled for existing ones.
- Recurring JE template materializes correctly on "Run due", advancing next_run_date by recurrence.
- Audit logs include all new actions: `period_review_task.{update,sign_off}`, `recurring_template.{create,update,delete,run}`.
