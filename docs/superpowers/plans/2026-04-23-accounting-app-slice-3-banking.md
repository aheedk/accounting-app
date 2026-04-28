# Slice 3 — Banking + Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bank account management, manual bank-transaction import + inbox review (match / categorize / exclude), and statement-level reconciliation. Plugs into the existing ledger: categorize creates new JEs; match links existing JEs. No live bank feeds — CSV upload parsed client-side, rows POSTed to the API.

**Architecture:** One new CoA-linked entity (`bank_accounts` points at a chart_of_accounts row of account_type='asset' and code starting with '10'). `bank_transactions` are raw inbound rows with a status lifecycle (unreviewed → matched/categorized/excluded) plus an `is_reconciled` flag. `bank_reconciliations` records statement-level close events. Service layer follows Slice 1/2 patterns: `(trx, ctx, args)` signature, audit in same transaction, only `core/ledgerService.postJournalEntry` writes JEs.

**Tech Stack:** No new deps. CSV parsing on the client uses Papa Parse if already in `apps/web/package.json`, otherwise a 20-line split/quote parser inline.

---

## Locked decisions

1. **No live feeds.** Slice 3 is manual CSV only. Plaid/Finicity is Slice 3.5+.
2. **Match ≠ Post.** Matching a bank_transaction to an existing JE writes `matched_journal_entry_id` on the txn but does NOT generate a new JE. The cash side of that JE is assumed to already have a line that corresponds to this bank event.
3. **Categorize = Post.** Creates a new JE: `DR bank_account.cash_account_id / CR offset_account_id` (for inflows, amount > 0) or `DR offset_account_id / CR bank_account.cash_account_id` (for outflows, amount < 0). The txn's `matched_journal_entry_id` points at the new JE. Offset account is any CoA row the user picks (usually revenue or expense).
4. **Exclude** is a terminal manual override: "this feed row isn't an accounting event" (transfer between own accounts, test charge, etc.). Excluded rows don't count toward reconciliation.
5. **Rules engine is DEFERRED.** Users hand-categorize each row. Auto-match/auto-categorize by vendor/description patterns = Slice 3.5.
6. **Reconciliation** is statement-level: given a bank_account, period_end, and statement_ending_balance, verify that the SUM of reviewed-and-not-excluded `bank_transactions` with `transaction_date <= period_end` equals `(GL cash balance as of period_end) - prior_reconciliation.statement_ending_balance`, then mark those txns `is_reconciled = true` and insert a `bank_reconciliations` row. First reconciliation uses `0` as the prior balance baseline.
7. **Slice 3 does NOT touch** Rules, Receipts, Fixed Assets, Integration Transactions, Recurring Transactions — all stay as ComingSoonPage.
8. Plan-impl sync: deviations → patch the plan markdown in the same commit.

---

## Pacing + gotchas (inherits from prior slices)

- `no-explicit-any: error` — `catch (e: unknown)` + typed narrowing
- `exactOptionalPropertyTypes: true` — conditional patch construction
- PL/pgSQL: `COALESCE(current_setting('app.X', true), '')`
- No protect_posted triggers are needed for banking — bank_transactions are mutable until reconciled; once `is_reconciled = true`, only reconciliation unlock can flip them back.
- Router mount: `router.use('/businesses/:businessId', requireAuth, resolveBusiness);`
- `Generated<ColumnType<>>` double-wrap is a bug — use `ColumnType<string, string | number | undefined, string | number>`.
- JE via `core/ledgerService.postJournalEntry` only.

---

## Phase A — Data layer

### Task 1: bank_accounts table

**Files:** Create `db/migrations/0021_bank_accounts.sql`

```sql
CREATE TABLE bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  institution text,
  account_last_four text CHECK (account_last_four ~ '^\d{4}$' OR account_last_four IS NULL),
  cash_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_bank_accounts_biz_cash ON bank_accounts(business_id, cash_account_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_bank_accounts_biz ON bank_accounts(business_id) WHERE deleted_at IS NULL;
CREATE TRIGGER bank_accounts_updated_at BEFORE UPDATE ON bank_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Commit: `feat(db): bank_accounts table`

---

### Task 2: bank_transactions table

**Files:** Create `db/migrations/0022_bank_transactions.sql`

```sql
CREATE TYPE bank_transaction_status AS ENUM ('unreviewed', 'matched', 'categorized', 'excluded');

CREATE TABLE bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id),
  transaction_date date NOT NULL,
  description text NOT NULL,
  amount numeric(19,4) NOT NULL,  -- signed: positive = inflow, negative = outflow
  external_id text,  -- bank's row id from CSV if present, for dedupe
  status bank_transaction_status NOT NULL DEFAULT 'unreviewed',
  matched_journal_entry_id uuid REFERENCES journal_entries(id),
  excluded_reason text,
  is_reconciled boolean NOT NULL DEFAULT false,
  reconciliation_id uuid,  -- FK added in 0023
  imported_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid REFERENCES users(id),
  CONSTRAINT bt_terminal_has_reviewer CHECK (
    (status = 'unreviewed' AND reviewed_at IS NULL AND reviewed_by_user_id IS NULL)
    OR (status <> 'unreviewed' AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT bt_matched_has_je CHECK (
    (status IN ('matched','categorized')) = (matched_journal_entry_id IS NOT NULL)
  ),
  CONSTRAINT bt_excluded_has_reason CHECK (
    (status = 'excluded') = (excluded_reason IS NOT NULL)
  )
);
CREATE INDEX idx_bt_biz_status ON bank_transactions(business_id, status) WHERE NOT is_reconciled;
CREATE INDEX idx_bt_account ON bank_transactions(bank_account_id);
CREATE INDEX idx_bt_date ON bank_transactions(bank_account_id, transaction_date);
CREATE UNIQUE INDEX uq_bt_external_id ON bank_transactions(bank_account_id, external_id) WHERE external_id IS NOT NULL;
```

Commit: `feat(db): bank_transactions table`

---

### Task 3: bank_reconciliations + close FK loop

**Files:** Create `db/migrations/0023_bank_reconciliations.sql`

```sql
CREATE TABLE bank_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id),
  period_start date NOT NULL,
  period_end date NOT NULL CHECK (period_end >= period_start),
  statement_ending_balance numeric(19,4) NOT NULL,
  reconciled_at timestamptz NOT NULL DEFAULT now(),
  reconciled_by_user_id uuid REFERENCES users(id),
  memo text,
  CONSTRAINT br_unique_period UNIQUE (bank_account_id, period_end)
);
CREATE INDEX idx_br_account ON bank_reconciliations(bank_account_id);

ALTER TABLE bank_transactions
  ADD CONSTRAINT bt_reconciliation_fk FOREIGN KEY (reconciliation_id) REFERENCES bank_reconciliations(id);
```

Commit: `feat(db): bank_reconciliations + close bank_transactions FK loop`

---

### Task 4: Augment DB type

**Files:** Modify `apps/api/src/db/types.ts`

Append:
```ts
export type BankTransactionStatus = 'unreviewed' | 'matched' | 'categorized' | 'excluded';

export interface BankAccountsTable {
  id: Generated<string>;
  business_id: string;
  name: string;
  institution: string | null;
  account_last_four: string | null;
  cash_account_id: string;
  is_active: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface BankTransactionsTable {
  id: Generated<string>;
  business_id: string;
  bank_account_id: string;
  transaction_date: ColumnType<string, string, string>;
  description: string;
  amount: ColumnType<string, string | number, string | number>;
  external_id: string | null;
  status: Generated<BankTransactionStatus>;
  matched_journal_entry_id: string | null;
  excluded_reason: string | null;
  is_reconciled: Generated<boolean>;
  reconciliation_id: string | null;
  imported_at: Generated<Timestamp>;
  reviewed_at: Timestamp | null;
  reviewed_by_user_id: string | null;
}

export interface BankReconciliationsTable {
  id: Generated<string>;
  business_id: string;
  bank_account_id: string;
  period_start: ColumnType<string, string, string>;
  period_end: ColumnType<string, string, string>;
  statement_ending_balance: ColumnType<string, string | number, string | number>;
  reconciled_at: Generated<Timestamp>;
  reconciled_by_user_id: string | null;
  memo: string | null;
}
```

Append to `DB` interface:
```ts
  bank_accounts: BankAccountsTable;
  bank_transactions: BankTransactionsTable;
  bank_reconciliations: BankReconciliationsTable;
```

Commit: `feat(api): augment DB type with banking tables`

---

### Task 5: Audit actions + zod schemas + factory

**Files:** Modify `packages/shared/src/auditActions.ts`; create `packages/shared/src/schemas/bankAccount.ts`, `bankTransaction.ts`, `reconciliation.ts`; modify `packages/shared/src/schemas/index.ts`; modify `apps/api/tests/helpers/factories.ts` and `testDb.ts`.

Audit actions (append to `AUDIT`):
```ts
  BANK_ACCOUNT_CREATE: 'bank_account.create',
  BANK_ACCOUNT_UPDATE: 'bank_account.update',
  BANK_TRANSACTION_IMPORT: 'bank_transaction.import',
  BANK_TRANSACTION_MATCH: 'bank_transaction.match',
  BANK_TRANSACTION_CATEGORIZE: 'bank_transaction.categorize',
  BANK_TRANSACTION_EXCLUDE: 'bank_transaction.exclude',
  BANK_TRANSACTION_UNREVIEW: 'bank_transaction.unreview',
  RECONCILIATION_CREATE: 'reconciliation.create',
  RECONCILIATION_DELETE: 'reconciliation.delete',
```

**bankAccount.ts:**
```ts
import { z } from 'zod';

export const bankAccountCreateSchema = z.object({
  name: z.string().min(1).max(200),
  institution: z.string().max(200).nullable().optional(),
  account_last_four: z.string().regex(/^\d{4}$/).nullable().optional(),
  cash_account_id: z.string().uuid(),
});
export type BankAccountCreate = z.infer<typeof bankAccountCreateSchema>;

export const bankAccountUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  institution: z.string().max(200).nullable().optional(),
  account_last_four: z.string().regex(/^\d{4}$/).nullable().optional(),
  is_active: z.boolean().optional(),
});
```

**bankTransaction.ts:**
```ts
import { z } from 'zod';
const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);

export const bankTransactionImportSchema = z.object({
  bank_account_id: z.string().uuid(),
  rows: z.array(z.object({
    transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    description: z.string().min(1).max(500),
    amount: moneyStr,
    external_id: z.string().max(200).nullable().optional(),
  })).min(1).max(5000),
});

export const bankTransactionMatchSchema = z.object({
  journal_entry_id: z.string().uuid(),
});

export const bankTransactionCategorizeSchema = z.object({
  offset_account_id: z.string().uuid(),
  memo: z.string().max(500).nullable().optional(),
});

export const bankTransactionExcludeSchema = z.object({
  excluded_reason: z.string().min(1).max(500),
});
```

**reconciliation.ts:**
```ts
import { z } from 'zod';
const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);

export const reconciliationCreateSchema = z.object({
  bank_account_id: z.string().uuid(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  statement_ending_balance: moneyStr,
  memo: z.string().max(500).nullable().optional(),
});
```

**index.ts:** append `export * from './bankAccount.js'; export * from './bankTransaction.js'; export * from './reconciliation.js';`

**factories.ts:** add
```ts
export async function makeBankAccount(db: Kysely<DB>, business_id: string, cash_account_id: string, opts: Partial<{ name: string; institution: string; account_last_four: string }> = {}) {
  return db.insertInto('bank_accounts').values({
    business_id, cash_account_id,
    name: opts.name ?? 'Checking',
    institution: opts.institution ?? null,
    account_last_four: opts.account_last_four ?? null,
  }).returningAll().executeTakeFirstOrThrow();
}
```

**testDb.ts truncateAll:** prepend `'bank_transactions', 'bank_reconciliations', 'bank_accounts'` (in reverse-dep order).

Commit (combined — small per file): `feat(shared,api): banking audit actions, schemas, factories`

---

## Phase B — Services

### Task 6: bankAccountService (TDD, 3 tests)

**Files:** Create `apps/api/src/services/banking/bankAccountService.ts` and `apps/api/tests/integration/bankAccountService.test.ts`.

Tests:
1. `createBankAccount creates one linked to a CoA cash row`
2. `createBankAccount rejects non-asset CoA row`
3. `listBankAccounts returns active accounts sorted by name`

Service functions: `createBankAccount(trx, ctx, input)`, `updateBankAccount`, `listBankAccounts(db, business_id)`, `getBankAccount(db, business_id, id)`.

```ts
export type CreateBankAccountInput = {
  business_id: string;
  name: string;
  institution: string | null;
  account_last_four: string | null;
  cash_account_id: string;
};

export async function createBankAccount(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateBankAccountInput) {
  const coa = await trx.selectFrom('chart_of_accounts').selectAll()
    .where('id', '=', input.cash_account_id).where('business_id', '=', input.business_id).executeTakeFirst();
  if (!coa) throw new NotFoundError('chart_of_accounts', input.cash_account_id);
  if (coa.account_type !== 'asset') throw new PreconditionError('cash_account must be an asset account');
  const row = await trx.insertInto('bank_accounts').values({
    business_id: input.business_id, name: input.name,
    institution: input.institution, account_last_four: input.account_last_four,
    cash_account_id: input.cash_account_id,
  }).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, { action: AUDIT.BANK_ACCOUNT_CREATE, entity_type: 'bank_account', entity_id: row.id, before: null, after: row });
  return row;
}

export async function listBankAccounts(db: Kysely<DB>, business_id: string) {
  return db.selectFrom('bank_accounts as ba')
    .innerJoin('chart_of_accounts as a', 'a.id', 'ba.cash_account_id')
    .select(['ba.id', 'ba.name', 'ba.institution', 'ba.account_last_four', 'ba.cash_account_id', 'ba.is_active', 'a.code as cash_account_code', 'a.name as cash_account_name'])
    .where('ba.business_id', '=', business_id).where('ba.deleted_at', 'is', null)
    .orderBy('ba.name').execute();
}
```

Commit: `feat(api): bank account service with TDD`

---

### Task 7: bankTransactionService (TDD, 5 tests)

**Files:** Create `apps/api/src/services/banking/bankTransactionService.ts` + test file.

Tests:
1. `importTransactions inserts rows with status=unreviewed, dedupes by external_id`
2. `matchToJournalEntry flips status to matched, links the JE id`
3. `categorize creates a new JE (DR Cash / CR offset for inflow) and links it`
4. `exclude flips status to excluded with a reason`
5. `unreview from any terminal state rolls back to unreviewed and clears links`

Service functions: `importTransactions(trx, ctx, input)`, `match(trx, ctx, { bank_transaction_id, journal_entry_id })`, `categorize(trx, ctx, { bank_transaction_id, offset_account_id, memo })`, `exclude(trx, ctx, { bank_transaction_id, excluded_reason })`, `unreview(trx, ctx, { bank_transaction_id })`, `listTransactions(db, q)`.

Key logic for `categorize`:
- Fetch the bank_transaction + its bank_account + the cash_account_id.
- If `amount > 0` (inflow): DR cash / CR offset for `abs(amount)`.
- If `amount < 0` (outflow): DR offset / CR cash for `abs(amount)`.
- Call `postJournalEntry(trx, ctx, { business_id, entry_date: bt.transaction_date, source_type: 'manual', memo: input.memo ?? bt.description, reference: null, lines: [...] })`.
- Update bank_transaction: status='categorized', matched_journal_entry_id=je.id, reviewed_at=now(), reviewed_by_user_id=ctx.user_id.

Commit: `feat(api): bank transaction service (import/match/categorize/exclude/unreview)`

---

### Task 8: reconciliationService (TDD, 2 tests)

**Files:** Create `apps/api/src/services/banking/reconciliationService.ts` + test file.

Tests:
1. `createReconciliation marks all reviewed, unreconciled bank_transactions in the period as is_reconciled=true and sets their reconciliation_id`
2. `createReconciliation rejects when unreviewed rows remain in the period`

```ts
export async function createReconciliation(trx: Transaction<DB>, ctx: ServiceCtx, input: {
  business_id: string;
  bank_account_id: string;
  period_start: string;
  period_end: string;
  statement_ending_balance: string;
  memo: string | null;
}) {
  const unreviewed = await trx.selectFrom('bank_transactions').select('id')
    .where('business_id', '=', input.business_id)
    .where('bank_account_id', '=', input.bank_account_id)
    .where('transaction_date', '>=', input.period_start)
    .where('transaction_date', '<=', input.period_end)
    .where('status', '=', 'unreviewed')
    .execute();
  if (unreviewed.length > 0) throw new PreconditionError(`${unreviewed.length} unreviewed transaction(s) remain in this period`);

  const recon = await trx.insertInto('bank_reconciliations').values({
    business_id: input.business_id, bank_account_id: input.bank_account_id,
    period_start: input.period_start, period_end: input.period_end,
    statement_ending_balance: input.statement_ending_balance,
    reconciled_by_user_id: ctx.user_id, memo: input.memo,
  }).returningAll().executeTakeFirstOrThrow();

  await trx.updateTable('bank_transactions')
    .set({ is_reconciled: true, reconciliation_id: recon.id })
    .where('bank_account_id', '=', input.bank_account_id)
    .where('transaction_date', '>=', input.period_start)
    .where('transaction_date', '<=', input.period_end)
    .where('status', 'in', ['matched', 'categorized'])
    .where('is_reconciled', '=', false)
    .execute();

  await auditRecord(trx, ctx, { action: AUDIT.RECONCILIATION_CREATE, entity_type: 'reconciliation', entity_id: recon.id, before: null, after: recon });
  return recon;
}

export async function listReconciliations(db: Kysely<DB>, q: { business_id: string; bank_account_id?: string }) {
  let qb = db.selectFrom('bank_reconciliations').selectAll().where('business_id', '=', q.business_id);
  if (q.bank_account_id) qb = qb.where('bank_account_id', '=', q.bank_account_id);
  return qb.orderBy('period_end', 'desc').execute();
}
```

Commit: `feat(api): reconciliation service with TDD`

---

## Phase C — Routes

### Task 9: Bank account + transaction + reconciliation routes

**Files:** Create `apps/api/src/routes/bankAccounts.ts`, `bankTransactions.ts`, `reconciliations.ts`. Modify `apps/api/src/app.ts`.

Mirror the customers/bills route pattern. Use the `router.use('/businesses/:businessId', requireAuth, resolveBusiness)` mount.

**bankAccounts.ts:** GET list, GET detail, POST create (firm_admin), PATCH update (firm_admin).

**bankTransactions.ts:**
- GET `/businesses/:businessId/bank-transactions` (list w/ filters: bank_account_id, status)
- POST `/businesses/:businessId/bank-transactions/import` (staff+): bulk import
- POST `/businesses/:businessId/bank-transactions/:id/match` (staff+)
- POST `/businesses/:businessId/bank-transactions/:id/categorize` (staff+)
- POST `/businesses/:businessId/bank-transactions/:id/exclude` (staff+)
- POST `/businesses/:businessId/bank-transactions/:id/unreview` (accountant+)

**reconciliations.ts:**
- GET `/businesses/:businessId/reconciliations` (list)
- POST `/businesses/:businessId/reconciliations` (accountant+)

Wire all three in app.ts.

Typecheck + lint.

Commit: `feat(api): bank account, bank transaction, reconciliation routes`

---

## Phase D — Seed + Web

### Task 10: Seed demo bank account

**Files:** Create `db/seeds/0005_banking.sql`

```sql
DO $$
DECLARE
  r record;
  v_cash uuid;
BEGIN
  FOR r IN SELECT id FROM businesses WHERE deleted_at IS NULL LOOP
    IF NOT EXISTS (SELECT 1 FROM bank_accounts WHERE business_id = r.id) THEN
      SELECT id INTO v_cash FROM chart_of_accounts WHERE business_id = r.id AND code = '1020';
      IF v_cash IS NOT NULL THEN
        INSERT INTO bank_accounts (business_id, name, institution, account_last_four, cash_account_id)
        VALUES (r.id, 'Primary Checking', 'Demo Bank', '4321', v_cash);
      END IF;
    END IF;
  END LOOP;
END $$;
```

Commit: `feat(db): seed demo bank account per business`

---

### Task 11: Bank accounts page (list + new)

**Files:** Create `apps/web/src/pages/banking/BankAccountListPage.tsx`.

Features: table of all bank accounts (name, institution, last 4, linked CoA, active toggle), inline "Add bank account" form above the table (name, institution, last 4, cash account dropdown from CoA filtered to asset+active+code like '10%').

Uses the existing CoaListPage / shadcn patterns. Declare concrete types (no `any`).

Commit: `feat(web): bank accounts list + inline add form`

---

### Task 12: Bank transaction inbox + match/categorize dialogs

**Files:** Create `apps/web/src/pages/banking/BankTransactionsInboxPage.tsx`, `apps/web/src/pages/banking/BankTransactionImportPage.tsx`.

**BankTransactionsInboxPage:**
- Bank account selector (dropdown).
- Status filter (default "unreviewed").
- Table: date, description, amount (green for inflow, red for outflow), status badge, actions per row.
- Actions per unreviewed row: Match, Categorize, Exclude (each opens a small inline form).
- Match: dropdown of recent draft/posted JEs for this biz; or paste JE id.
- Categorize: offset account dropdown (any CoA row, grouped by account_type), memo text, Submit.
- Exclude: reason text, Submit.
- Reviewed rows: show the linked JE id + a small "Unreview" button for accountants.

**BankTransactionImportPage:**
- File input that accepts .csv
- Parse CSV client-side (split by newline + comma, respect quoted fields, trim). Expected headers: `date`, `description`, `amount`, optionally `id` (external_id). Let user pick which column maps to which field via dropdowns, with auto-detection by header name.
- Preview the first 10 rows.
- "Import" button POSTs to `/bank-transactions/import` with the rows.
- Show result: "Imported N new, deduped M".

Commits: `feat(web): bank transaction inbox with match/categorize/exclude` and `feat(web): bank transaction CSV import page`

---

### Task 13: Reconcile page

**Files:** Create `apps/web/src/pages/banking/ReconcilePage.tsx`.

- Bank account selector.
- Shows list of prior reconciliations (period_end, ending_balance).
- New reconciliation form: period_start, period_end, statement_ending_balance, memo.
- Before submit, show: # unreviewed txns in the period (with link to inbox), # reviewed+unreconciled in the period.
- Submit creates a reconciliation and marks those txns reconciled.

Commit: `feat(web): reconciliation page with period-level close`

---

### Task 14: Wire routes + sidebar

**Files:** Modify `apps/web/src/App.tsx` and `apps/web/src/components/layout/Sidebar.tsx`.

Routes:
- `/accounting/bank-accounts` → BankAccountListPage (new under Accounting — also show under Setup group)
- `/accounting/bank-transactions` → BankTransactionsInboxPage
- `/accounting/bank-transactions/import` → BankTransactionImportPage
- `/accounting/reconcile` → ReconcilePage

Sidebar Accounting group updates:
- Bank Transactions → real route (was ComingSoon)
- Reconcile → real route
- Add: Bank Accounts → real route

Commit: `feat(web): wire banking pages into routes + sidebar`

---

## Phase E — Deploy

### Task 15: Merge + deploy + smoke

From `/Users/aheedkamil/projects/accounting-app` (main clone):
```bash
git checkout main && git pull
git merge slice-3
git push origin main
```

Wait for Railway redeploy (migrations 0021-0023). Apply seed:
```bash
psql $DATABASE_PUBLIC_URL -f db/seeds/0005_banking.sql
```

Smoke test via HTTP:
1. List bank accounts → 1 per business
2. Import 3 CSV rows
3. Categorize one (e.g., DR cash / CR Revenue)
4. Match one to an existing JE
5. Exclude one with a reason
6. Create a reconciliation for the period → verify all 3 txns flip to is_reconciled
7. Check audit_logs has bank_account.create, bank_transaction.{import,match,categorize,exclude}, reconciliation.create rows

Browser: walk Accounting > Bank Accounts, Bank Transactions, Reconcile. Zero console errors.

---

## Definition of Done

- Migrations 0021-0023 applied (23 total).
- Integration suite: ≥88 (prior) + 10 (new: 3 bankAccount + 5 bankTransaction + 2 reconciliation) = ≥98 tests passing.
- Bank account seeded for each demo business.
- Web sidebar Accounting group links to Bank Accounts, Bank Transactions, Reconcile (real routes, not ComingSoon).
- Deployed smoke: import 3 CSV rows → categorize → reconcile → verify TB cash balance matches the reconciled statement balance.
- All new audit actions emit in smoke.
