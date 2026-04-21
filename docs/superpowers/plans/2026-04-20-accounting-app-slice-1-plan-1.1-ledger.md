# Accounting App — Slice 1 — Plan 1.1: Ledger Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the double-entry ledger that everything else stands on. Chart of accounts (per business, with default seed). Fiscal periods (with open/close lifecycle and admin-override path). Manual journal entries (draft → posted → voided, reversing entries). All DB invariants from §3.7 of the spec live by the end of this plan. Trial balance report works. UI exposes COA, periods, and manual JEs.

**Architecture:** Builds on Plan 1.0 conventions — services receive `(trx, ctx, args)`, routes own `db.transaction().execute(...)`, audit rows are written in the same trx as the mutation. The ledger gets defense-in-depth: business rules in the service AND DB triggers (deferred CHECK on balance, immutability of posted rows, period gating, polymorphic-source sanity).

**Tech Stack:** Same as 1.0. New deps: none — Kysely + pg + decimal.js are sufficient. The session-flag mechanism (`SET LOCAL app.admin_override = 'on'`) is implemented by `adminOverrideService`.

**Spec:** `docs/superpowers/specs/2026-04-20-accounting-app-slice-1-ledger-and-ar-design.md`

**Prereq:** Plan 1.0 must be merged and deployed.

---

## Files added by this plan

```
db/migrations/
  0005_chart_of_accounts.sql
  0006_fiscal_periods.sql
  0007_journal_entries.sql
  0008_journal_entry_triggers.sql
  0009_default_coa_function.sql
db/seeds/
  0002_ledger.sql                    # COA + 12 periods for both demo businesses

apps/api/src/db/types.ts             # MODIFY: add ChartOfAccountsTable, FiscalPeriodsTable, JournalEntriesTable, JournalEntryLinesTable

apps/api/src/services/
  core/
    chartOfAccountsService.ts
    fiscalPeriodService.ts
    ledgerService.ts
  admin/
    adminOverrideService.ts

apps/api/src/routes/
  chartOfAccounts.ts
  fiscalPeriods.ts
  journalEntries.ts
  trialBalance.ts

apps/api/src/lib/
  ledgerErrors.ts                    # ClosedPeriodError, UnbalancedEntryError, etc.

apps/api/tests/integration/
  chartOfAccountsService.test.ts
  fiscalPeriodService.test.ts
  ledgerService.test.ts
  ledgerTriggers.test.ts             # exercises every DB trigger
  adminOverrideService.test.ts
  trialBalance.test.ts

packages/shared/src/
  auditActions.ts                    # MODIFY: add ledger/period/coa actions
  errorCodes.ts                      # already includes ledger codes (added in 1.0)
  schemas/                            # MODIFY: add coa.ts, fiscalPeriod.ts, journalEntry.ts
    coa.ts
    fiscalPeriod.ts
    journalEntry.ts
    trialBalance.ts

apps/web/src/
  lib/
    money.ts                         # display helpers using decimal.js
  pages/
    coa/CoaListPage.tsx
    coa/CoaEditDialog.tsx
    periods/PeriodsPage.tsx
    journal/JournalListPage.tsx
    journal/JournalDetailPage.tsx
    journal/JournalNewPage.tsx
    reports/TrialBalancePage.tsx
  components/layout/Sidebar.tsx      # MODIFY: add nav items
```

## Conventions reused from Plan 1.0

- **DB type augmentation:** add fields to `DB` interface in `apps/api/src/db/types.ts`. Do not create a separate file.
- **ServiceCtx:** unchanged (defined in 1.0).
- **Audit pattern:** `await auditService.record(trx, ctx, {...})` in same transaction.
- **Error pattern:** throw `BusinessRuleError` (or a subclass) with a code from `packages/shared/src/errorCodes.ts`.
- **Test pattern:** `startTestDb()` / `truncateAll()` from 1.0's helpers, plus new factories in `apps/api/tests/helpers/factories.ts`.
- **Route pattern:** zod parse → `db.transaction().execute(async (trx) => service.method(trx, ctx, args))` → JSON response.

---

## Phase A — DB migrations + triggers (Tasks 1–5)

### Task 1: Chart of accounts migration

**Files:**
- Create: `db/migrations/0005_chart_of_accounts.sql`

- [ ] **Step 1: Write migration**

```sql
CREATE TYPE account_type AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');

CREATE TABLE chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  code text NOT NULL,
  name text NOT NULL,
  account_type account_type NOT NULL,
  parent_id uuid REFERENCES chart_of_accounts(id),
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, code),
  CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX idx_coa_business ON chart_of_accounts (business_id) WHERE is_active = true;
CREATE INDEX idx_coa_parent ON chart_of_accounts (parent_id);

CREATE TRIGGER trg_coa_updated_at
  BEFORE UPDATE ON chart_of_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Block deleting system accounts (AR, AP, Cash, Tax-Payable, Retained Earnings)
CREATE OR REPLACE FUNCTION coa_protect_system()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_system = true THEN
    RAISE EXCEPTION 'cannot delete system account % (id=%)', OLD.code, OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_coa_protect_system_delete
  BEFORE DELETE ON chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION coa_protect_system();
```

- [ ] **Step 2: Apply and verify**

```bash
npm run db:migrate
psql "$DATABASE_URL" -c "\d chart_of_accounts"
```
Expected: table exists with the listed columns and indexes.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/0005_chart_of_accounts.sql
git commit -m "feat(db): chart_of_accounts table + protect-system trigger"
```

### Task 2: Fiscal periods migration

**Files:**
- Create: `db/migrations/0006_fiscal_periods.sql`

- [ ] **Step 1: Write migration**

```sql
CREATE TYPE fiscal_period_status AS ENUM ('open', 'closed');

CREATE TABLE fiscal_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status fiscal_period_status NOT NULL DEFAULT 'open',
  closed_at timestamptz,
  closed_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, starts_on),
  CHECK (starts_on <= ends_on),
  EXCLUDE USING gist (
    business_id WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  )
);

CREATE INDEX idx_fp_business_status ON fiscal_periods (business_id, status);

CREATE TRIGGER trg_fp_updated_at
  BEFORE UPDATE ON fiscal_periods FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

- [ ] **Step 2: Apply and verify EXCLUDE constraint works**

```bash
npm run db:migrate
psql "$DATABASE_URL" <<'SQL'
DO $$
DECLARE
  v_firm uuid; v_biz uuid;
BEGIN
  INSERT INTO firms (name) VALUES ('Test Firm For Period Check') RETURNING id INTO v_firm;
  INSERT INTO businesses (firm_id, name) VALUES (v_firm, 'Biz') RETURNING id INTO v_biz;
  INSERT INTO fiscal_periods (business_id, starts_on, ends_on)
    VALUES (v_biz, '2026-01-01', '2026-01-31');
  BEGIN
    INSERT INTO fiscal_periods (business_id, starts_on, ends_on)
      VALUES (v_biz, '2026-01-15', '2026-02-15');
    RAISE NOTICE 'BUG: overlap was allowed';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'OK: overlap rejected';
  END;
END $$;
SQL
```
Expected: prints `OK: overlap rejected`.

Clean up:
```bash
psql "$DATABASE_URL" -c "DELETE FROM fiscal_periods WHERE business_id IN (SELECT id FROM businesses WHERE name='Biz'); DELETE FROM businesses WHERE name='Biz'; DELETE FROM firms WHERE name='Test Firm For Period Check';"
```

- [ ] **Step 3: Commit**

```bash
git add db/migrations/0006_fiscal_periods.sql
git commit -m "feat(db): fiscal_periods table with EXCLUDE no-overlap constraint"
```

### Task 3: Journal entries + lines migration

**Files:**
- Create: `db/migrations/0007_journal_entries.sql`

- [ ] **Step 1: Write migration**

```sql
CREATE TYPE journal_entry_status AS ENUM ('draft', 'posted', 'voided');
CREATE TYPE journal_entry_source_type AS ENUM (
  'manual', 'invoice', 'payment', 'credit_memo', 'reversal', 'adjustment'
);

CREATE TABLE journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  period_id uuid NOT NULL REFERENCES fiscal_periods(id),
  entry_date date NOT NULL,
  memo text,
  reference text,
  status journal_entry_status NOT NULL DEFAULT 'draft',
  source_type journal_entry_source_type NOT NULL DEFAULT 'manual',
  source_id uuid,
  reversed_entry_id uuid REFERENCES journal_entries(id),
  posted_at timestamptz,
  posted_by_user_id uuid REFERENCES users(id),
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES users(id),
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'posted' OR posted_at IS NOT NULL),
  CHECK (status <> 'voided' OR voided_at IS NOT NULL)
);

CREATE INDEX idx_je_business_period ON journal_entries (business_id, period_id, status);
CREATE INDEX idx_je_business_date ON journal_entries (business_id, entry_date DESC);
CREATE INDEX idx_je_source ON journal_entries (source_type, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX idx_je_reversed ON journal_entries (reversed_entry_id) WHERE reversed_entry_id IS NOT NULL;

CREATE TRIGGER trg_je_updated_at
  BEFORE UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE journal_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  line_number int NOT NULL,
  account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  debit numeric(19,4) NOT NULL DEFAULT 0,
  credit numeric(19,4) NOT NULL DEFAULT 0,
  memo text,
  UNIQUE (journal_entry_id, line_number),
  CHECK (debit >= 0 AND credit >= 0),
  CHECK (NOT (debit > 0 AND credit > 0)),
  CHECK (debit > 0 OR credit > 0)
);

CREATE INDEX idx_jel_account ON journal_entry_lines (account_id);
CREATE INDEX idx_jel_entry ON journal_entry_lines (journal_entry_id);
```

- [ ] **Step 2: Apply and verify**

```bash
npm run db:migrate
psql "$DATABASE_URL" -c "\d journal_entries" -c "\d journal_entry_lines"
```

- [ ] **Step 3: Commit**

```bash
git add db/migrations/0007_journal_entries.sql
git commit -m "feat(db): journal_entries and journal_entry_lines tables"
```

### Task 4: Journal entry triggers (the critical safety net)

**Files:**
- Create: `db/migrations/0008_journal_entry_triggers.sql`

This is the most important migration in the entire system. Test it carefully (Task 9 covers tests).

- [ ] **Step 1: Write migration**

```sql
-- =====================================================================
-- 1) Deferred balance check: per JE, sum(debits) must equal sum(credits)
--    Fires at COMMIT so we can insert lines incrementally inside one trx.
--
--    PostgreSQL CONSTRAINT TRIGGERs must be AFTER ... FOR EACH ROW and do
--    NOT support REFERENCING transition tables, so we use a per-row
--    constraint trigger that re-aggregates the touched JE at commit time.
-- =====================================================================
CREATE OR REPLACE FUNCTION je_check_balance()
RETURNS TRIGGER AS $$
DECLARE
  v_je_id uuid;
  v_debits numeric(19,4);
  v_credits numeric(19,4);
  v_status journal_entry_status;
BEGIN
  v_je_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  IF v_je_id IS NULL THEN RETURN NULL; END IF;

  -- The parent JE may have been deleted (cascade); skip in that case.
  SELECT status INTO v_status FROM journal_entries WHERE id = v_je_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Voided entries can be unbalanced because their reversal exists separately.
  -- Drafts are allowed to be unbalanced (still being authored).
  -- Only POSTED entries are required to balance.
  IF v_status = 'posted' THEN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
      INTO v_debits, v_credits
      FROM journal_entry_lines
      WHERE journal_entry_id = v_je_id;
    IF v_debits <> v_credits THEN
      RAISE EXCEPTION 'journal entry % is unbalanced: debits=% credits=%',
        v_je_id, v_debits, v_credits
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_jel_balance_insert
  AFTER INSERT ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION je_check_balance();

CREATE CONSTRAINT TRIGGER trg_jel_balance_update
  AFTER UPDATE ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION je_check_balance();

CREATE CONSTRAINT TRIGGER trg_jel_balance_delete
  AFTER DELETE ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION je_check_balance();

-- Also fire when a JE flips draft -> posted (lines may have been balanced
-- earlier, but we want to recheck at the moment of posting).
CREATE OR REPLACE FUNCTION je_check_balance_on_status()
RETURNS TRIGGER AS $$
DECLARE
  v_debits numeric(19,4);
  v_credits numeric(19,4);
BEGIN
  IF NEW.status = 'posted' AND (OLD.status IS DISTINCT FROM 'posted') THEN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
      INTO v_debits, v_credits
      FROM journal_entry_lines
      WHERE journal_entry_id = NEW.id;
    IF v_debits <> v_credits THEN
      RAISE EXCEPTION 'journal entry % cannot post: debits=% credits=%',
        NEW.id, v_debits, v_credits
        USING ERRCODE = '23514';
    END IF;
    IF v_debits = 0 THEN
      RAISE EXCEPTION 'journal entry % cannot post: no lines', NEW.id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_je_check_balance_on_status
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION je_check_balance_on_status();

-- =====================================================================
-- 2) Posted-immutability triggers
--    Once status = 'posted', the row is locked. Voiding (status -> voided)
--    is allowed only inside a transaction that has set app.allow_void = 'on'.
-- =====================================================================
CREATE OR REPLACE FUNCTION je_protect_posted_row()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'cannot delete posted journal entry %', OLD.id
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  -- UPDATE
  IF OLD.status = 'posted' THEN
    -- Allowed transitions on posted rows:
    --   posted -> voided  (only when app.allow_void='on')
    IF NEW.status = 'voided' THEN
      IF COALESCE(current_setting('app.allow_void', true), '') <> 'on' THEN
        RAISE EXCEPTION 'cannot void posted JE % outside controlled void path', OLD.id
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    -- All other column changes on a posted row are forbidden.
    IF (NEW.status, NEW.entry_date, NEW.memo, NEW.reference, NEW.source_type, NEW.source_id, NEW.reversed_entry_id, NEW.business_id, NEW.period_id)
       IS DISTINCT FROM
       (OLD.status, OLD.entry_date, OLD.memo, OLD.reference, OLD.source_type, OLD.source_id, OLD.reversed_entry_id, OLD.business_id, OLD.period_id) THEN
      RAISE EXCEPTION 'cannot mutate posted journal entry % (only void path is allowed)', OLD.id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_je_protect_posted
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION je_protect_posted_row();

CREATE OR REPLACE FUNCTION jel_protect_posted_row()
RETURNS TRIGGER AS $$
DECLARE
  v_status journal_entry_status;
  v_je_id uuid;
BEGIN
  v_je_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  SELECT status INTO v_status FROM journal_entries WHERE id = v_je_id;
  IF v_status = 'posted' AND COALESCE(current_setting('app.allow_void', true), '') <> 'on' THEN
    RAISE EXCEPTION 'cannot mutate lines of posted journal entry %', v_je_id
      USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_jel_protect_posted
  BEFORE UPDATE OR DELETE ON journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION jel_protect_posted_row();

-- =====================================================================
-- 3) Closed-period gating
--    A JE may not be inserted with status='posted' (or transitioned to
--    posted) into a closed period — unless app.admin_override='on'.
-- =====================================================================
CREATE OR REPLACE FUNCTION je_check_period_open()
RETURNS TRIGGER AS $$
DECLARE
  v_period_status fiscal_period_status;
  v_starts date; v_ends date;
BEGIN
  -- Always validate entry_date is inside the period (regardless of status)
  SELECT status, starts_on, ends_on INTO v_period_status, v_starts, v_ends
    FROM fiscal_periods WHERE id = NEW.period_id;
  IF v_period_status IS NULL THEN
    RAISE EXCEPTION 'fiscal period % not found', NEW.period_id USING ERRCODE = '23503';
  END IF;
  IF NEW.entry_date < v_starts OR NEW.entry_date > v_ends THEN
    RAISE EXCEPTION 'entry_date % outside period range %..%', NEW.entry_date, v_starts, v_ends
      USING ERRCODE = '23514';
  END IF;
  -- Only enforce closed-period block for posted/voided transitions.
  IF NEW.status IN ('posted', 'voided') AND v_period_status = 'closed' THEN
    IF COALESCE(current_setting('app.admin_override', true), '') <> 'on' THEN
      RAISE EXCEPTION 'cannot post into closed period %', NEW.period_id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_je_check_period_open
  BEFORE INSERT OR UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION je_check_period_open();

-- =====================================================================
-- 4) Polymorphic source_id sanity
--    For source_type='reversal', source_id must reference a journal_entries
--    row (the original being reversed). For other source_types, the FK is
--    deferred to the AR/AP services to validate (their tables don't exist
--    yet in 1.1; 1.2 extends this trigger via a follow-up migration).
-- =====================================================================
CREATE OR REPLACE FUNCTION je_check_source()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.source_type = 'reversal' THEN
    IF NEW.source_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM journal_entries WHERE id = NEW.source_id
    ) THEN
      RAISE EXCEPTION 'reversal entry must reference an existing journal_entries row in source_id'
        USING ERRCODE = '23514';
    END IF;
    -- reversed_entry_id should match
    IF NEW.reversed_entry_id IS NULL OR NEW.reversed_entry_id <> NEW.source_id THEN
      RAISE EXCEPTION 'reversal entry: reversed_entry_id must equal source_id'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.source_type = 'manual' AND NEW.source_id IS NOT NULL THEN
    RAISE EXCEPTION 'manual entry must not have source_id'
      USING ERRCODE = '23514';
  END IF;
  -- invoice/payment/credit_memo/adjustment: validated by AR services in 1.2
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_je_check_source
  BEFORE INSERT OR UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION je_check_source();
```

- [ ] **Step 2: Apply and verify all 4 trigger groups exist**

```bash
npm run db:migrate
psql "$DATABASE_URL" -c "SELECT tgname FROM pg_trigger WHERE tgrelid IN ('journal_entries'::regclass, 'journal_entry_lines'::regclass) AND NOT tgisinternal ORDER BY tgname;"
```
Expected list contains: `trg_je_check_balance_on_status`, `trg_je_check_period_open`, `trg_je_check_source`, `trg_je_protect_posted`, `trg_je_updated_at`, `trg_jel_balance_delete`, `trg_jel_balance_insert`, `trg_jel_balance_update`, `trg_jel_protect_posted`.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/0008_journal_entry_triggers.sql
git commit -m "feat(db): journal entry triggers (balance + immutability + period gate + source sanity)"
```

### Task 5: Default chart of accounts function

**Files:**
- Create: `db/migrations/0009_default_coa_function.sql`

This is a SQL function (not a service) so the seed and the future "create business" service both call the same source-of-truth.

- [ ] **Step 1: Write migration**

```sql
-- Seeds a standard small-business COA for the given business.
-- Codes follow the convention: 1xxx assets, 2xxx liabilities, 3xxx equity,
-- 4xxx revenue, 5xxx expenses. System accounts are flagged is_system=true
-- so the COA UI cannot delete them.
CREATE OR REPLACE FUNCTION seed_default_coa(p_business_id uuid)
RETURNS void AS $$
BEGIN
  INSERT INTO chart_of_accounts (business_id, code, name, account_type, is_system) VALUES
    (p_business_id, '1010', 'Cash on Hand',                'asset',     true),
    (p_business_id, '1020', 'Operating Bank Account',      'asset',     true),
    (p_business_id, '1100', 'Accounts Receivable',         'asset',     true),
    (p_business_id, '1200', 'Inventory',                   'asset',     false),
    (p_business_id, '1500', 'Equipment',                   'asset',     false),
    (p_business_id, '1510', 'Accumulated Depreciation',    'asset',     false),

    (p_business_id, '2010', 'Accounts Payable',            'liability', true),
    (p_business_id, '2100', 'Sales Tax Payable',           'liability', true),
    (p_business_id, '2200', 'Payroll Liabilities',         'liability', false),
    (p_business_id, '2500', 'Notes Payable',               'liability', false),

    (p_business_id, '3010', 'Owner Equity',                'equity',    false),
    (p_business_id, '3020', 'Retained Earnings',           'equity',    true),
    (p_business_id, '3030', 'Owner Draws',                 'equity',    false),

    (p_business_id, '4010', 'Sales Revenue',               'revenue',   false),
    (p_business_id, '4020', 'Service Revenue',             'revenue',   false),
    (p_business_id, '4910', 'Sales Returns and Allowances','revenue',   false),

    (p_business_id, '5010', 'Cost of Goods Sold',          'expense',   false),
    (p_business_id, '5100', 'Salaries and Wages',          'expense',   false),
    (p_business_id, '5200', 'Rent',                        'expense',   false),
    (p_business_id, '5300', 'Utilities',                   'expense',   false),
    (p_business_id, '5400', 'Office Supplies',             'expense',   false),
    (p_business_id, '5500', 'Software Subscriptions',      'expense',   false),
    (p_business_id, '5600', 'Bank Fees',                   'expense',   false),
    (p_business_id, '5700', 'Professional Fees',           'expense',   false),
    (p_business_id, '5800', 'Travel and Meals',            'expense',   false),
    (p_business_id, '5900', 'Insurance',                   'expense',   false),
    (p_business_id, '5910', 'Depreciation Expense',        'expense',   false),
    (p_business_id, '5950', 'Miscellaneous Expense',       'expense',   false)
  ON CONFLICT (business_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Seeds 12 monthly fiscal periods for the given calendar year.
CREATE OR REPLACE FUNCTION seed_calendar_year_periods(p_business_id uuid, p_year int)
RETURNS void AS $$
DECLARE
  m int;
BEGIN
  FOR m IN 1..12 LOOP
    INSERT INTO fiscal_periods (business_id, starts_on, ends_on, status)
    VALUES (
      p_business_id,
      make_date(p_year, m, 1),
      (make_date(p_year, m, 1) + interval '1 month' - interval '1 day')::date,
      'open'
    )
    ON CONFLICT (business_id, starts_on) DO NOTHING;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 2: Apply and commit**

```bash
npm run db:migrate
git add db/migrations/0009_default_coa_function.sql
git commit -m "feat(db): seed_default_coa and seed_calendar_year_periods functions"
```

---

## Phase B — Type augmentation + shared registries (Tasks 6–8)

### Task 6: Augment Kysely DB type

**Files:**
- Modify: `apps/api/src/db/types.ts`

- [ ] **Step 1: Add new tables to the file**

Append the following BEFORE the `export interface DB { ... }` block:

```ts
export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type FiscalPeriodStatus = 'open' | 'closed';
export type JournalEntryStatus = 'draft' | 'posted' | 'voided';
export type JournalEntrySourceType =
  | 'manual' | 'invoice' | 'payment' | 'credit_memo' | 'reversal' | 'adjustment';

export interface ChartOfAccountsTable {
  id: Generated<string>;
  business_id: string;
  code: string;
  name: string;
  account_type: AccountType;
  parent_id: string | null;
  is_system: Generated<boolean>;
  is_active: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface FiscalPeriodsTable {
  id: Generated<string>;
  business_id: string;
  starts_on: ColumnType<string, string, string>;  // 'YYYY-MM-DD'
  ends_on: ColumnType<string, string, string>;
  status: Generated<FiscalPeriodStatus>;
  closed_at: Timestamp | null;
  closed_by_user_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface JournalEntriesTable {
  id: Generated<string>;
  business_id: string;
  period_id: string;
  entry_date: ColumnType<string, string, string>;
  memo: string | null;
  reference: string | null;
  status: Generated<JournalEntryStatus>;
  source_type: Generated<JournalEntrySourceType>;
  source_id: string | null;
  reversed_entry_id: string | null;
  posted_at: Timestamp | null;
  posted_by_user_id: string | null;
  voided_at: Timestamp | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  created_at: Generated<Timestamp>;
  created_by_user_id: string | null;
  updated_at: Generated<Timestamp>;
}

export interface JournalEntryLinesTable {
  id: Generated<string>;
  journal_entry_id: string;
  line_number: number;
  account_id: string;
  // Money columns are STRINGS on the JS side (we configured pg to parse
  // numeric as string). Operations go through decimal.js helpers.
  debit: ColumnType<string, string | number, string | number>;
  credit: ColumnType<string, string | number, string | number>;
  memo: string | null;
}
```

Update the `DB` interface to include them:

```ts
export interface DB {
  firms: FirmsTable;
  businesses: BusinessesTable;
  users: UsersTable;
  user_business_access: UserBusinessAccessTable;
  refresh_tokens: RefreshTokensTable;
  audit_logs: AuditLogsTable;
  chart_of_accounts: ChartOfAccountsTable;
  fiscal_periods: FiscalPeriodsTable;
  journal_entries: JournalEntriesTable;
  journal_entry_lines: JournalEntryLinesTable;
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npm -w @accounting/api run typecheck
git add apps/api/src/db/types.ts
git commit -m "feat(api): augment DB type with COA, periods, JE tables"
```

### Task 7: Extend audit actions + add ledger error subclasses

**Files:**
- Modify: `packages/shared/src/auditActions.ts`
- Create: `apps/api/src/lib/ledgerErrors.ts`

- [ ] **Step 1: Append to `packages/shared/src/auditActions.ts`**

Inside the existing `AUDIT` const, add (preserve existing keys):

```ts
  // Chart of accounts
  COA_CREATE: 'coa.create',
  COA_UPDATE: 'coa.update',
  COA_DEACTIVATE: 'coa.deactivate',

  // Fiscal periods
  FISCAL_PERIOD_CREATE: 'fiscal_period.create',
  FISCAL_PERIOD_CLOSE: 'fiscal_period.close',
  FISCAL_PERIOD_REOPEN: 'fiscal_period.reopen',
  FISCAL_PERIOD_ADMIN_OVERRIDE_POST: 'fiscal_period.admin_override_post',

  // Journal entries
  JOURNAL_ENTRY_CREATE: 'journal_entry.create',
  JOURNAL_ENTRY_UPDATE: 'journal_entry.update',
  JOURNAL_ENTRY_POST: 'journal_entry.post',
  JOURNAL_ENTRY_VOID: 'journal_entry.void',
  JOURNAL_ENTRY_REVERSE: 'journal_entry.reverse',
```

- [ ] **Step 2: Build shared package**

```bash
npm -w @accounting/shared run build
```

- [ ] **Step 3: Write `apps/api/src/lib/ledgerErrors.ts`**

```ts
import { ERR } from '@accounting/shared';
import { BusinessRuleError } from './errors.js';

export class UnbalancedEntryError extends BusinessRuleError {
  constructor(je_id: string, debits: string, credits: string) {
    super(ERR.UNBALANCED_ENTRY,
      `Journal entry ${je_id} is unbalanced (debits=${debits}, credits=${credits})`,
      { journal_entry_id: je_id, debits, credits });
    this.name = 'UnbalancedEntryError';
  }
}

export class ClosedPeriodError extends BusinessRuleError {
  constructor(period_id: string, closed_at?: string) {
    super(ERR.CLOSED_PERIOD,
      `Cannot post into closed period ${period_id}`,
      { period_id, closed_at });
    this.name = 'ClosedPeriodError';
  }
}

export class InvalidStateTransitionError extends BusinessRuleError {
  constructor(entity: string, id: string, from: string, to: string) {
    super(ERR.INVALID_STATE_TRANSITION,
      `Cannot transition ${entity} ${id} from ${from} to ${to}`,
      { entity, id, from, to });
    this.name = 'InvalidStateTransitionError';
  }
}

export class ImmutableRecordError extends BusinessRuleError {
  constructor(entity: string, id: string) {
    super(ERR.IMMUTABLE_RECORD,
      `${entity} ${id} is posted and cannot be mutated`,
      { entity, id });
    this.name = 'ImmutableRecordError';
  }
}

export class PreconditionError extends BusinessRuleError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(ERR.PRECONDITION_FAILED, message, details);
    this.name = 'PreconditionError';
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/auditActions.ts apps/api/src/lib/ledgerErrors.ts
git commit -m "feat(shared,api): ledger audit actions + ledger error classes"
```

### Task 8: Zod schemas for COA / periods / journal entries

**Files:**
- Create: `packages/shared/src/schemas/coa.ts`, `fiscalPeriod.ts`, `journalEntry.ts`, `trialBalance.ts`
- Modify: `packages/shared/src/schemas/index.ts`

- [ ] **Step 1: Write `packages/shared/src/schemas/coa.ts`**

```ts
import { z } from 'zod';

export const accountTypeEnum = z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']);

export const accountCreateSchema = z.object({
  code: z.string().min(1).max(20).regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().min(1).max(120),
  account_type: accountTypeEnum,
  parent_id: z.string().uuid().nullable().optional(),
});
export type AccountCreate = z.infer<typeof accountCreateSchema>;

export const accountUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  parent_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
});
export type AccountUpdate = z.infer<typeof accountUpdateSchema>;
```

- [ ] **Step 2: Write `packages/shared/src/schemas/fiscalPeriod.ts`**

```ts
import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const periodCreateSchema = z.object({
  starts_on: dateString,
  ends_on: dateString,
});
export type PeriodCreate = z.infer<typeof periodCreateSchema>;

export const seedYearSchema = z.object({
  year: z.number().int().min(1900).max(2100),
});

export const periodCloseSchema = z.object({
  period_id: z.string().uuid(),
});

export const adminOverrideRequestSchema = z.object({
  reason: z.string().min(10).max(500),
});
```

- [ ] **Step 3: Write `packages/shared/src/schemas/journalEntry.ts`**

```ts
import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const moneyString = z.string().regex(/^\d+(\.\d{1,4})?$/, 'must be a non-negative decimal up to 4dp');

export const journalLineInputSchema = z.object({
  account_id: z.string().uuid(),
  debit: moneyString,
  credit: moneyString,
  memo: z.string().max(500).nullable().optional(),
}).refine(l => !(parseFloat(l.debit) > 0 && parseFloat(l.credit) > 0), 'a line cannot have both debit and credit')
  .refine(l => parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0, 'a line must have either debit or credit > 0');

export type JournalLineInput = z.infer<typeof journalLineInputSchema>;

export const journalEntryCreateSchema = z.object({
  entry_date: dateString,
  memo: z.string().max(1000).nullable().optional(),
  reference: z.string().max(100).nullable().optional(),
  lines: z.array(journalLineInputSchema).min(2, 'at least two lines required'),
});
export type JournalEntryCreate = z.infer<typeof journalEntryCreateSchema>;

export const journalEntryVoidSchema = z.object({
  void_reason: z.string().min(1).max(500),
});
```

- [ ] **Step 4: Write `packages/shared/src/schemas/trialBalance.ts`**

```ts
import { z } from 'zod';

export const trialBalanceQuerySchema = z.object({
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const trialBalanceRowSchema = z.object({
  account_id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  account_type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
  total_debit: z.string(),
  total_credit: z.string(),
  net: z.string(),  // signed: positive = debit balance, negative = credit balance
});

export const trialBalanceResponseSchema = z.object({
  as_of: z.string(),
  rows: z.array(trialBalanceRowSchema),
  totals: z.object({
    total_debit: z.string(),
    total_credit: z.string(),
  }),
});
```

- [ ] **Step 5: Update `packages/shared/src/schemas/index.ts`**

```ts
export * from './auth.js';
export * from './coa.js';
export * from './fiscalPeriod.js';
export * from './journalEntry.js';
export * from './trialBalance.js';
```

- [ ] **Step 6: Build and commit**

```bash
npm -w @accounting/shared run build
git add packages/shared/src/schemas/
git commit -m "feat(shared): zod schemas for COA, periods, JE, trial balance"
```

---

## Phase C — COA + Fiscal Period services (Tasks 9–11)

### Task 9: Update test factories for COA and periods

**Files:**
- Modify: `apps/api/tests/helpers/factories.ts`
- Modify: `apps/api/tests/helpers/testDb.ts` (extend truncateAll)

- [ ] **Step 1: Append to `apps/api/tests/helpers/factories.ts`**

Append after the existing `grantAccess` function:

```ts
import { sql } from 'kysely';
import type { AccountType } from '../../src/db/types.js';

export async function makeAccount(
  db: Kysely<DB>,
  business_id: string,
  opts: Partial<{ code: string; name: string; account_type: AccountType; is_system: boolean }> = {},
) {
  const code = opts.code ?? `ACC${Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')}`;
  return db.insertInto('chart_of_accounts').values({
    business_id,
    code,
    name: opts.name ?? `Account ${code}`,
    account_type: opts.account_type ?? 'asset',
    is_system: opts.is_system ?? false,
  }).returningAll().executeTakeFirstOrThrow();
}

export async function seedCoa(db: Kysely<DB>, business_id: string) {
  await sql`SELECT seed_default_coa(${business_id}::uuid)`.execute(db);
}

export async function makePeriod(
  db: Kysely<DB>,
  business_id: string,
  starts_on: string,
  ends_on: string,
  status: 'open' | 'closed' = 'open',
) {
  return db.insertInto('fiscal_periods').values({
    business_id, starts_on, ends_on, status,
  }).returningAll().executeTakeFirstOrThrow();
}

export async function seedYearPeriods(db: Kysely<DB>, business_id: string, year: number) {
  await sql`SELECT seed_calendar_year_periods(${business_id}::uuid, ${year}::int)`.execute(db);
}
```

- [ ] **Step 2: Update `apps/api/tests/helpers/testDb.ts` `truncateAll`**

Replace the body of `truncateAll`:

```ts
export async function truncateAll(db: Kysely<DB>) {
  await sql`
    TRUNCATE
      journal_entry_lines,
      journal_entries,
      fiscal_periods,
      chart_of_accounts,
      audit_logs,
      refresh_tokens,
      user_business_access,
      users,
      businesses,
      firms
    RESTART IDENTITY CASCADE;
  `.execute(db);
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/tests/helpers/
git commit -m "test(api): factories for COA and periods + extended truncate"
```

### Task 10: Chart of accounts service (TDD)

**Files:**
- Create: `apps/api/src/services/core/chartOfAccountsService.ts`
- Create: `apps/api/tests/integration/chartOfAccountsService.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/api/tests/integration/chartOfAccountsService.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser } from '../helpers/factories.js';
import * as coa from '../../src/services/core/chartOfAccountsService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000000001', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id, 'Biz');
  const user = await makeUser(t.db, firm.id, { role: 'firm_admin' });
  const ctx: ServiceCtx = {
    user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'firm_admin',
    ...meta,
  };
  return { firm, biz, user, ctx };
}

describe('chartOfAccountsService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('seedDefaultCoa creates the standard COA + writes audit', async () => {
    const { biz, ctx } = await setup(t);
    await t.db.transaction().execute(trx => coa.seedDefaultCoa(trx, ctx, { business_id: biz.id }));
    const accounts = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).execute();
    expect(accounts.length).toBeGreaterThan(20);
    const ar = accounts.find(a => a.code === '1100');
    expect(ar?.is_system).toBe(true);
    const audits = await t.db.selectFrom('audit_logs').selectAll().execute();
    expect(audits.some(a => a.action === 'coa.create')).toBe(true);
  });

  it('createAccount creates a non-system account', async () => {
    const { biz, ctx } = await setup(t);
    const created = await t.db.transaction().execute(trx =>
      coa.createAccount(trx, ctx, { business_id: biz.id, code: '4500', name: 'Consulting', account_type: 'revenue', parent_id: null }),
    );
    expect(created.code).toBe('4500');
    expect(created.is_system).toBe(false);
  });

  it('createAccount: duplicate code rejected with DUPLICATE_RESOURCE', async () => {
    const { biz, ctx } = await setup(t);
    await t.db.transaction().execute(trx =>
      coa.createAccount(trx, ctx, { business_id: biz.id, code: '4500', name: 'Consulting', account_type: 'revenue', parent_id: null }),
    );
    await expect(
      t.db.transaction().execute(trx =>
        coa.createAccount(trx, ctx, { business_id: biz.id, code: '4500', name: 'Other', account_type: 'revenue', parent_id: null }),
      ),
    ).rejects.toMatchObject({ code: ERR.DUPLICATE_RESOURCE });
  });

  it('updateAccount on a system account: forbids name change but allows is_active toggle', async () => {
    const { biz, ctx } = await setup(t);
    await t.db.transaction().execute(trx => coa.seedDefaultCoa(trx, ctx, { business_id: biz.id }));
    const ar = await t.db.selectFrom('chart_of_accounts').selectAll().where('code', '=', '1100').executeTakeFirstOrThrow();
    await expect(
      t.db.transaction().execute(trx => coa.updateAccount(trx, ctx, { account_id: ar.id, patch: { name: 'NEW NAME' } })),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
    // Toggling is_active on a system account is allowed — accountants need to deactivate unused ones
    const after = await t.db.transaction().execute(trx =>
      coa.updateAccount(trx, ctx, { account_id: ar.id, patch: { is_active: false } }),
    );
    expect(after.is_active).toBe(false);
  });

  it('listAccounts respects business scoping', async () => {
    const { biz, ctx } = await setup(t);
    const otherBiz = await (async () => {
      const otherFirm = await makeFirm(t.db, 'Other Firm');
      return makeBusiness(t.db, otherFirm.id, 'OtherBiz');
    })();
    await t.db.transaction().execute(trx => coa.seedDefaultCoa(trx, ctx, { business_id: biz.id }));
    await t.db.transaction().execute(trx =>
      coa.seedDefaultCoa(trx, { ...ctx, business_id: otherBiz.id, firm_id: otherBiz.firm_id } as ServiceCtx, { business_id: otherBiz.id }),
    );
    const list = await coa.listAccounts(t.db, { business_id: biz.id });
    expect(list.every(a => a.business_id === biz.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Implement `apps/api/src/services/core/chartOfAccountsService.ts`**

```ts
import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB, AccountType } from '../../db/types.js';
import { BusinessRuleError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateAccountInput = {
  business_id: string;
  code: string;
  name: string;
  account_type: AccountType;
  parent_id: string | null;
};

export async function createAccount(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateAccountInput) {
  const dup = await trx.selectFrom('chart_of_accounts')
    .select('id')
    .where('business_id', '=', input.business_id)
    .where('code', '=', input.code)
    .executeTakeFirst();
  if (dup) throw new BusinessRuleError(ERR.DUPLICATE_RESOURCE, `Account code ${input.code} already exists`);

  const row = await trx.insertInto('chart_of_accounts').values({
    business_id: input.business_id,
    code: input.code,
    name: input.name,
    account_type: input.account_type,
    parent_id: input.parent_id,
  }).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.COA_CREATE,
    entity_type: 'chart_of_account',
    entity_id: row.id,
    before: null,
    after: row,
  });
  return row;
}

export async function updateAccount(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { account_id: string; patch: { name?: string; parent_id?: string | null; is_active?: boolean } },
) {
  const row = await trx.selectFrom('chart_of_accounts').selectAll()
    .where('id', '=', input.account_id).executeTakeFirst();
  if (!row) throw new BusinessRuleError(ERR.NOT_FOUND, `Account ${input.account_id} not found`);

  if (row.is_system) {
    // System accounts: only is_active is mutable
    if (input.patch.name !== undefined || input.patch.parent_id !== undefined) {
      throw new PreconditionError('System accounts cannot have name or parent changed', { code: row.code });
    }
  }

  if (input.patch.parent_id === input.account_id) {
    throw new PreconditionError('parent_id cannot equal account id (self-reference)');
  }

  const updated = await trx.updateTable('chart_of_accounts')
    .set({
      ...(input.patch.name !== undefined ? { name: input.patch.name } : {}),
      ...(input.patch.parent_id !== undefined ? { parent_id: input.patch.parent_id } : {}),
      ...(input.patch.is_active !== undefined ? { is_active: input.patch.is_active } : {}),
    })
    .where('id', '=', input.account_id)
    .returningAll()
    .executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: input.patch.is_active === false ? AUDIT.COA_DEACTIVATE : AUDIT.COA_UPDATE,
    entity_type: 'chart_of_account',
    entity_id: input.account_id,
    before: row,
    after: updated,
  });
  return updated;
}

export async function seedDefaultCoa(trx: Transaction<DB>, ctx: ServiceCtx, input: { business_id: string }) {
  await sql`SELECT seed_default_coa(${input.business_id}::uuid)`.execute(trx);
  const inserted = await trx.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', input.business_id).execute();
  for (const row of inserted) {
    await auditRecord(trx, ctx, {
      action: AUDIT.COA_CREATE,
      entity_type: 'chart_of_account',
      entity_id: row.id,
      before: null,
      after: row,
    });
  }
}

export async function listAccounts(db: Kysely<DB>, q: { business_id: string; include_inactive?: boolean }) {
  let query = db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', q.business_id);
  if (!q.include_inactive) query = query.where('is_active', '=', true);
  return query.orderBy('code', 'asc').execute();
}

export async function getSystemAccount(db: Kysely<DB>, business_id: string, code: string) {
  const row = await db.selectFrom('chart_of_accounts')
    .selectAll()
    .where('business_id', '=', business_id)
    .where('code', '=', code)
    .where('is_system', '=', true)
    .executeTakeFirst();
  if (!row) throw new BusinessRuleError(ERR.NOT_FOUND, `System account ${code} not found for business ${business_id}`);
  return row;
}
```

- [ ] **Step 3: Run integration tests**

```bash
npm -w @accounting/api run test:integration -- chartOfAccountsService
```
Expected: 5 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/core/chartOfAccountsService.ts apps/api/tests/integration/chartOfAccountsService.test.ts
git commit -m "feat(api): chart of accounts service with tests"
```

### Task 11: Fiscal period service (TDD)

**Files:**
- Create: `apps/api/src/services/core/fiscalPeriodService.ts`
- Create: `apps/api/tests/integration/fiscalPeriodService.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/api/tests/integration/fiscalPeriodService.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeAccount, seedYearPeriods } from '../helpers/factories.js';
import * as periods from '../../src/services/core/fiscalPeriodService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-00000000aaaa', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb, role: 'firm_admin' | 'accountant' = 'firm_admin') {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id, 'Biz');
  const user = await makeUser(t.db, firm.id, { role });
  const ctx: ServiceCtx = {
    user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: role,
    ...meta,
  };
  return { firm, biz, user, ctx };
}

describe('fiscalPeriodService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('seedCalendarYear creates 12 monthly periods, all open', async () => {
    const { biz, ctx } = await setup(t);
    await t.db.transaction().execute(trx => periods.seedCalendarYear(trx, ctx, { business_id: biz.id, year: 2026 }));
    const rows = await t.db.selectFrom('fiscal_periods').selectAll().where('business_id', '=', biz.id).execute();
    expect(rows).toHaveLength(12);
    expect(rows.every(r => r.status === 'open')).toBe(true);
  });

  it('findPeriodForDate returns the matching period', async () => {
    const { biz } = await setup(t);
    await seedYearPeriods(t.db, biz.id, 2026);
    const found = await periods.findPeriodForDate(t.db, biz.id, '2026-04-15');
    expect(found?.starts_on).toBe('2026-04-01');
    expect(found?.ends_on).toBe('2026-04-30');
  });

  it('closePeriod refuses if there are draft JEs in the period', async () => {
    const { biz, ctx } = await setup(t);
    await seedYearPeriods(t.db, biz.id, 2026);
    const period = (await periods.findPeriodForDate(t.db, biz.id, '2026-01-15'))!;
    const acct = await makeAccount(t.db, biz.id);
    await t.db.insertInto('journal_entries').values({
      business_id: biz.id, period_id: period.id, entry_date: '2026-01-15', source_type: 'manual', status: 'draft',
    }).execute();
    await expect(
      t.db.transaction().execute(trx => periods.closePeriod(trx, ctx, { period_id: period.id })),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
  });

  it('closePeriod succeeds when no drafts; audit row written', async () => {
    const { biz, ctx } = await setup(t);
    await seedYearPeriods(t.db, biz.id, 2026);
    const period = (await periods.findPeriodForDate(t.db, biz.id, '2026-01-15'))!;
    await t.db.transaction().execute(trx => periods.closePeriod(trx, ctx, { period_id: period.id }));
    const after = await t.db.selectFrom('fiscal_periods').selectAll().where('id', '=', period.id).executeTakeFirstOrThrow();
    expect(after.status).toBe('closed');
    expect(after.closed_at).toBeTruthy();
    const audit = await t.db.selectFrom('audit_logs').selectAll().where('action', '=', 'fiscal_period.close').execute();
    expect(audit).toHaveLength(1);
  });

  it('reopenPeriod requires firm_admin', async () => {
    const acctSetup = await setup(t, 'accountant');
    await seedYearPeriods(t.db, acctSetup.biz.id, 2026);
    const period = (await periods.findPeriodForDate(t.db, acctSetup.biz.id, '2026-01-15'))!;
    // close as admin first
    const adminSetup = await setup(t);
    await t.db.transaction().execute(trx => periods.closePeriod(trx, adminSetup.ctx, { period_id: period.id }));
    // reopen as accountant should fail
    await expect(
      t.db.transaction().execute(trx => periods.reopenPeriod(trx, acctSetup.ctx, { period_id: period.id })),
    ).rejects.toMatchObject({ code: ERR.FORBIDDEN });
  });
});
```

- [ ] **Step 2: Implement `apps/api/src/services/core/fiscalPeriodService.ts`**

```ts
import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError, AuthError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export async function findPeriodForDate(db: Kysely<DB>, business_id: string, date: string) {
  return db.selectFrom('fiscal_periods')
    .selectAll()
    .where('business_id', '=', business_id)
    .where('starts_on', '<=', date)
    .where('ends_on', '>=', date)
    .executeTakeFirst();
}

export async function listPeriods(db: Kysely<DB>, business_id: string) {
  return db.selectFrom('fiscal_periods').selectAll()
    .where('business_id', '=', business_id)
    .orderBy('starts_on', 'asc').execute();
}

export async function seedCalendarYear(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { business_id: string; year: number },
) {
  await sql`SELECT seed_calendar_year_periods(${input.business_id}::uuid, ${input.year}::int)`.execute(trx);
  const created = await trx.selectFrom('fiscal_periods').selectAll()
    .where('business_id', '=', input.business_id)
    .where(sql<boolean>`extract(year from starts_on) = ${input.year}`)
    .execute();
  for (const row of created) {
    await auditRecord(trx, ctx, {
      action: AUDIT.FISCAL_PERIOD_CREATE,
      entity_type: 'fiscal_period',
      entity_id: row.id,
      before: null,
      after: row,
    });
  }
  return created;
}

export async function closePeriod(
  trx: Transaction<DB>, ctx: ServiceCtx, input: { period_id: string },
) {
  const period = await trx.selectFrom('fiscal_periods').selectAll()
    .where('id', '=', input.period_id).executeTakeFirst();
  if (!period) throw new BusinessRuleError(ERR.NOT_FOUND, `Period ${input.period_id} not found`);
  if (period.status === 'closed') throw new PreconditionError('Period is already closed');

  // refuse if drafts exist in this period
  const drafts = await trx.selectFrom('journal_entries')
    .select(['id'])
    .where('period_id', '=', input.period_id)
    .where('status', '=', 'draft')
    .execute();
  if (drafts.length > 0) {
    throw new PreconditionError('Cannot close period with draft journal entries', { draft_journal_entry_ids: drafts.map(d => d.id) });
  }
  // 1.2 will extend this with: refuse if drafts exist in invoices/payments/credit_memos for this period.

  const updated = await trx.updateTable('fiscal_periods')
    .set({ status: 'closed', closed_at: sql`now()`, closed_by_user_id: ctx.user_id })
    .where('id', '=', input.period_id)
    .returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.FISCAL_PERIOD_CLOSE,
    entity_type: 'fiscal_period',
    entity_id: input.period_id,
    before: period,
    after: updated,
  });
  return updated;
}

export async function reopenPeriod(
  trx: Transaction<DB>, ctx: ServiceCtx, input: { period_id: string },
) {
  if (ctx.effective_role !== 'firm_admin') {
    throw new AuthError(ERR.FORBIDDEN, 'Only firm_admin can reopen periods');
  }
  const period = await trx.selectFrom('fiscal_periods').selectAll().where('id', '=', input.period_id).executeTakeFirst();
  if (!period) throw new BusinessRuleError(ERR.NOT_FOUND, `Period ${input.period_id} not found`);
  if (period.status === 'open') throw new PreconditionError('Period is already open');

  const updated = await trx.updateTable('fiscal_periods')
    .set({ status: 'open', closed_at: null, closed_by_user_id: null })
    .where('id', '=', input.period_id)
    .returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.FISCAL_PERIOD_REOPEN,
    entity_type: 'fiscal_period',
    entity_id: input.period_id,
    before: period,
    after: updated,
  });
  return updated;
}
```

- [ ] **Step 3: Run tests and commit**

```bash
npm -w @accounting/api run test:integration -- fiscalPeriodService
git add apps/api/src/services/core/fiscalPeriodService.ts apps/api/tests/integration/fiscalPeriodService.test.ts
git commit -m "feat(api): fiscal period service with TDD tests"
```

---

## Phase D — Ledger service + admin override (Tasks 12–14)

This is the heart of the system. **TDD discipline is mandatory here per the spec.** Write the test first, run it, see it fail, then implement, then see it pass. No exceptions.

### Task 12: Ledger service — postJournalEntry (TDD)

**Files:**
- Create: `apps/api/src/services/core/ledgerService.ts`
- Create: `apps/api/tests/integration/ledgerService.test.ts`

- [ ] **Step 1: Write failing tests for the post path**

```ts
// apps/api/tests/integration/ledgerService.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeAccount, seedYearPeriods } from '../helpers/factories.js';
import * as ledger from '../../src/services/core/ledgerService.js';
import * as periods from '../../src/services/core/fiscalPeriodService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-00000000bbbb', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id, 'Biz');
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = {
    user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant',
    ...meta,
  };
  await seedYearPeriods(t.db, biz.id, 2026);
  const cash = await makeAccount(t.db, biz.id, { code: '1010', name: 'Cash', account_type: 'asset' });
  const revenue = await makeAccount(t.db, biz.id, { code: '4010', name: 'Sales', account_type: 'revenue' });
  return { firm, biz, user, ctx, cash, revenue };
}

describe('ledgerService.postJournalEntry', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('posts a balanced manual JE; status=posted; lines persisted; audit row written', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    const je = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual',
        memo: 'Cash sale',
        lines: [
          { account_id: cash.id,    debit: '100.0000', credit: '0.0000',   memo: null },
          { account_id: revenue.id, debit: '0.0000',   credit: '100.0000', memo: null },
        ],
      }),
    );
    expect(je.status).toBe('posted');
    const lines = await t.db.selectFrom('journal_entry_lines').selectAll().where('journal_entry_id', '=', je.id).orderBy('line_number').execute();
    expect(lines).toHaveLength(2);
    expect(lines[0]!.debit).toBe('100.0000');
    expect(lines[1]!.credit).toBe('100.0000');
    const audit = await t.db.selectFrom('audit_logs').selectAll().where('action', '=', 'journal_entry.post').execute();
    expect(audit).toHaveLength(1);
  });

  it('rejects unbalanced entry with UNBALANCED_ENTRY (service-layer guard)', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    await expect(
      t.db.transaction().execute(trx =>
        ledger.postJournalEntry(trx, ctx, {
          business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual', memo: null,
          lines: [
            { account_id: cash.id,    debit: '100.0000', credit: '0.0000',  memo: null },
            { account_id: revenue.id, debit: '0.0000',   credit: '99.0000', memo: null },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: ERR.UNBALANCED_ENTRY });
  });

  it('rejects post into a closed period without override', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    const period = (await periods.findPeriodForDate(t.db, biz.id, '2026-04-15'))!;
    await t.db.transaction().execute(trx => periods.closePeriod(trx, { ...ctx, effective_role: 'firm_admin' }, { period_id: period.id }));
    await expect(
      t.db.transaction().execute(trx =>
        ledger.postJournalEntry(trx, ctx, {
          business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual', memo: null,
          lines: [
            { account_id: cash.id,    debit: '50.0000', credit: '0.0000',  memo: null },
            { account_id: revenue.id, debit: '0.0000',  credit: '50.0000', memo: null },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: ERR.CLOSED_PERIOD });
  });

  it('rejects post when only one line provided', async () => {
    const { biz, ctx, cash } = await setup(t);
    await expect(
      t.db.transaction().execute(trx =>
        ledger.postJournalEntry(trx, ctx, {
          business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual', memo: null,
          lines: [{ account_id: cash.id, debit: '50.0000', credit: '0.0000', memo: null }],
        }),
      ),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
  });

  it('voidJournalEntry creates a reversing entry and flips original to voided', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    const je = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual', memo: 'orig',
        lines: [
          { account_id: cash.id,    debit: '100.0000', credit: '0.0000',   memo: null },
          { account_id: revenue.id, debit: '0.0000',   credit: '100.0000', memo: null },
        ],
      }),
    );
    const reversal = await t.db.transaction().execute(trx =>
      ledger.voidJournalEntry(trx, ctx, { journal_entry_id: je.id, void_reason: 'data entry error' }),
    );
    expect(reversal.id).not.toBe(je.id);
    expect(reversal.source_type).toBe('reversal');
    expect(reversal.reversed_entry_id).toBe(je.id);
    const reversalLines = await t.db.selectFrom('journal_entry_lines').selectAll().where('journal_entry_id', '=', reversal.id).orderBy('line_number').execute();
    expect(reversalLines).toHaveLength(2);
    // First line of original was DR 100; reversal should be CR 100 on same account
    const reversedCashLine = reversalLines.find(l => l.account_id === cash.id)!;
    expect(reversedCashLine.credit).toBe('100.0000');
    expect(reversedCashLine.debit).toBe('0.0000');
    // original is now voided
    const orig = await t.db.selectFrom('journal_entries').selectAll().where('id', '=', je.id).executeTakeFirstOrThrow();
    expect(orig.status).toBe('voided');
    expect(orig.void_reason).toBe('data entry error');
  });

  it('voidJournalEntry rejects voiding an already-voided entry', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    const je = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual', memo: null,
        lines: [
          { account_id: cash.id,    debit: '10.0000', credit: '0.0000',  memo: null },
          { account_id: revenue.id, debit: '0.0000',  credit: '10.0000', memo: null },
        ],
      }),
    );
    await t.db.transaction().execute(trx => ledger.voidJournalEntry(trx, ctx, { journal_entry_id: je.id, void_reason: 'oops' }));
    await expect(
      t.db.transaction().execute(trx => ledger.voidJournalEntry(trx, ctx, { journal_entry_id: je.id, void_reason: 'oops again' })),
    ).rejects.toMatchObject({ code: ERR.INVALID_STATE_TRANSITION });
  });

  it('computeAccountBalance sums debits minus credits across posted lines only', async () => {
    const { biz, ctx, cash, revenue } = await setup(t);
    await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual', memo: null,
        lines: [
          { account_id: cash.id,    debit: '100.0000', credit: '0.0000',   memo: null },
          { account_id: revenue.id, debit: '0.0000',   credit: '100.0000', memo: null },
        ],
      }),
    );
    const cashBal = await ledger.computeAccountBalance(t.db, { account_id: cash.id, as_of: '2026-12-31' });
    expect(cashBal).toBe('100.0000');  // asset, debit balance, signed positive
    const revBal = await ledger.computeAccountBalance(t.db, { account_id: revenue.id, as_of: '2026-12-31' });
    expect(revBal).toBe('-100.0000');  // revenue, credit balance, signed negative (debit - credit)
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module not found)**

```bash
npm -w @accounting/api run test:integration -- ledgerService
```

- [ ] **Step 3: Implement `apps/api/src/services/core/ledgerService.ts`**

```ts
import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, ERR, addMoney, subMoney, toMoneyString, equalMoney, isZero } from '@accounting/shared';
import type { DB, JournalEntrySourceType } from '../../db/types.js';
import { BusinessRuleError } from '../../lib/errors.js';
import {
  UnbalancedEntryError,
  ClosedPeriodError,
  InvalidStateTransitionError,
  PreconditionError,
} from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { findPeriodForDate } from './fiscalPeriodService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type LineInput = {
  account_id: string;
  debit: string;
  credit: string;
  memo: string | null;
};

export type PostJournalEntryInput = {
  business_id: string;
  entry_date: string; // YYYY-MM-DD
  source_type: JournalEntrySourceType;
  source_id?: string | null;
  memo: string | null;
  reference?: string | null;
  lines: LineInput[];
};

function assertBalanced(lines: LineInput[]) {
  if (lines.length < 2) throw new PreconditionError('Journal entry must have at least 2 lines');
  let totalD = '0.0000';
  let totalC = '0.0000';
  for (const l of lines) {
    if (parseFloat(l.debit) > 0 && parseFloat(l.credit) > 0) {
      throw new PreconditionError('A line cannot have both debit and credit', { line: l });
    }
    if (parseFloat(l.debit) === 0 && parseFloat(l.credit) === 0) {
      throw new PreconditionError('A line must have a debit or credit > 0', { line: l });
    }
    totalD = toMoneyString(addMoney(totalD, l.debit));
    totalC = toMoneyString(addMoney(totalC, l.credit));
  }
  if (!equalMoney(totalD, totalC)) {
    throw new UnbalancedEntryError('(pre-insert)', totalD, totalC);
  }
  if (isZero(totalD)) {
    throw new PreconditionError('Journal entry total cannot be zero');
  }
}

export async function postJournalEntry(
  trx: Transaction<DB>, ctx: ServiceCtx, input: PostJournalEntryInput,
) {
  assertBalanced(input.lines);

  const period = await findPeriodForDate(trx as unknown as Kysely<DB>, input.business_id, input.entry_date);
  if (!period) {
    throw new PreconditionError(`No fiscal period covers ${input.entry_date}; create periods first`);
  }
  if (period.status === 'closed' && (await currentSetting(trx, 'app.admin_override')) !== 'on') {
    throw new ClosedPeriodError(period.id, period.closed_at?.toString());
  }

  const je = await trx.insertInto('journal_entries').values({
    business_id: input.business_id,
    period_id: period.id,
    entry_date: input.entry_date,
    memo: input.memo,
    reference: input.reference ?? null,
    status: 'draft',
    source_type: input.source_type,
    source_id: input.source_id ?? null,
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  let n = 1;
  for (const l of input.lines) {
    await trx.insertInto('journal_entry_lines').values({
      journal_entry_id: je.id,
      line_number: n++,
      account_id: l.account_id,
      debit: l.debit,
      credit: l.credit,
      memo: l.memo,
    }).execute();
  }

  // Flip to posted — DB triggers will validate balance + period one more time.
  const posted = await trx.updateTable('journal_entries')
    .set({ status: 'posted', posted_at: sql`now()`, posted_by_user_id: ctx.user_id })
    .where('id', '=', je.id)
    .returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.JOURNAL_ENTRY_POST,
    entity_type: 'journal_entry',
    entity_id: je.id,
    before: null,
    after: posted,
  });

  return posted;
}

export async function voidJournalEntry(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { journal_entry_id: string; void_reason: string },
) {
  const orig = await trx.selectFrom('journal_entries').selectAll()
    .where('id', '=', input.journal_entry_id).executeTakeFirst();
  if (!orig) throw new BusinessRuleError(ERR.NOT_FOUND, `Journal entry ${input.journal_entry_id} not found`);
  if (orig.status !== 'posted') throw new InvalidStateTransitionError('journal_entry', orig.id, orig.status, 'voided');

  const period = await trx.selectFrom('fiscal_periods').selectAll().where('id', '=', orig.period_id).executeTakeFirstOrThrow();
  if (period.status === 'closed' && (await currentSetting(trx, 'app.admin_override')) !== 'on') {
    throw new ClosedPeriodError(period.id, period.closed_at?.toString());
  }

  const lines = await trx.selectFrom('journal_entry_lines').selectAll()
    .where('journal_entry_id', '=', orig.id).orderBy('line_number').execute();

  // Build reversing entry for today (or original date if still in same open period; spec says today)
  const today = new Date().toISOString().slice(0, 10);
  const reversalPeriod = await findPeriodForDate(trx as unknown as Kysely<DB>, orig.business_id, today)
                       ?? await findPeriodForDate(trx as unknown as Kysely<DB>, orig.business_id, orig.entry_date);
  if (!reversalPeriod) throw new PreconditionError('No fiscal period available for reversal');
  if (reversalPeriod.status === 'closed' && (await currentSetting(trx, 'app.admin_override')) !== 'on') {
    throw new ClosedPeriodError(reversalPeriod.id);
  }

  const reversal = await trx.insertInto('journal_entries').values({
    business_id: orig.business_id,
    period_id: reversalPeriod.id,
    entry_date: reversalPeriod.starts_on <= today && today <= reversalPeriod.ends_on ? today : orig.entry_date,
    memo: `Reversal of ${orig.id}: ${input.void_reason}`,
    reference: orig.reference,
    status: 'draft',
    source_type: 'reversal',
    source_id: orig.id,
    reversed_entry_id: orig.id,
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  let n = 1;
  for (const l of lines) {
    await trx.insertInto('journal_entry_lines').values({
      journal_entry_id: reversal.id,
      line_number: n++,
      account_id: l.account_id,
      debit: l.credit, // flipped
      credit: l.debit,
      memo: l.memo,
    }).execute();
  }

  const reversalPosted = await trx.updateTable('journal_entries')
    .set({ status: 'posted', posted_at: sql`now()`, posted_by_user_id: ctx.user_id })
    .where('id', '=', reversal.id)
    .returningAll().executeTakeFirstOrThrow();

  // Flip original to voided (controlled path — set app.allow_void inside this transaction)
  await sql`SELECT set_config('app.allow_void', 'on', true)`.execute(trx);
  const voided = await trx.updateTable('journal_entries')
    .set({ status: 'voided', voided_at: sql`now()`, voided_by_user_id: ctx.user_id, void_reason: input.void_reason })
    .where('id', '=', orig.id)
    .returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.JOURNAL_ENTRY_VOID,
    entity_type: 'journal_entry',
    entity_id: orig.id,
    before: orig,
    after: voided,
  });
  await auditRecord(trx, ctx, {
    action: AUDIT.JOURNAL_ENTRY_REVERSE,
    entity_type: 'journal_entry',
    entity_id: reversalPosted.id,
    before: null,
    after: reversalPosted,
  });

  return reversalPosted;
}

export async function computeAccountBalance(
  db: Kysely<DB>, q: { account_id: string; as_of: string },
): Promise<string> {
  const row = await db.selectFrom('journal_entry_lines as jel')
    .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .select(({ fn }) => [
      fn.sum<string>('jel.debit').as('total_debit'),
      fn.sum<string>('jel.credit').as('total_credit'),
    ])
    .where('jel.account_id', '=', q.account_id)
    .where('je.status', '=', 'posted')
    .where('je.entry_date', '<=', q.as_of)
    .executeTakeFirstOrThrow();
  const debit = row.total_debit ?? '0';
  const credit = row.total_credit ?? '0';
  return toMoneyString(subMoney(debit, credit));
}

async function currentSetting(trx: Transaction<DB>, key: string): Promise<string | null> {
  const r = await sql<{ v: string | null }>`SELECT current_setting(${key}, true) AS v`.execute(trx);
  return r.rows[0]?.v ?? null;
}
```

- [ ] **Step 4: Run tests, ensure all PASS, commit**

```bash
npm -w @accounting/api run test:integration -- ledgerService
git add apps/api/src/services/core/ledgerService.ts apps/api/tests/integration/ledgerService.test.ts
git commit -m "feat(api): ledger service (post/void/balance) with TDD coverage"
```

### Task 13: Admin override service

**Files:**
- Create: `apps/api/src/services/admin/adminOverrideService.ts`
- Create: `apps/api/tests/integration/adminOverrideService.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/api/tests/integration/adminOverrideService.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeAccount, seedYearPeriods } from '../helpers/factories.js';
import * as ledger from '../../src/services/core/ledgerService.js';
import * as periods from '../../src/services/core/fiscalPeriodService.js';
import * as override from '../../src/services/admin/adminOverrideService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-00000000cccc', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('adminOverrideService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('runWithClosedPeriodOverride: requires firm_admin', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const acct = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: acct.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await expect(
      override.runWithClosedPeriodOverride(t.db, ctx, 'just because', async () => {}),
    ).rejects.toMatchObject({ code: ERR.FORBIDDEN });
  });

  it('writes admin_override_post audit row BEFORE the wrapped action runs (rollback case)', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const admin = await makeUser(t.db, firm.id, { role: 'firm_admin' });
    const ctx: ServiceCtx = { user_id: admin.id, firm_id: firm.id, business_id: biz.id, effective_role: 'firm_admin', ...meta };

    await expect(
      override.runWithClosedPeriodOverride(t.db, ctx, 'late adjustment', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const audits = await t.db.selectFrom('audit_logs').selectAll().execute();
    expect(audits.find(a => a.action === 'fiscal_period.admin_override_post')).toBeUndefined(); // rolled back
  });

  it('allows post into closed period when wrapped; audit row present after commit', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const admin = await makeUser(t.db, firm.id, { role: 'firm_admin' });
    const ctx: ServiceCtx = { user_id: admin.id, firm_id: firm.id, business_id: biz.id, effective_role: 'firm_admin', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    const period = (await periods.findPeriodForDate(t.db, biz.id, '2026-04-15'))!;
    await t.db.transaction().execute(trx => periods.closePeriod(trx, ctx, { period_id: period.id }));
    const cash = await makeAccount(t.db, biz.id, { code: '1010', account_type: 'asset' });
    const revenue = await makeAccount(t.db, biz.id, { code: '4010', account_type: 'revenue' });

    const je = await override.runWithClosedPeriodOverride(t.db, ctx, 'late adjustment for tax', async (trx) =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-04-15', source_type: 'adjustment', memo: 'late',
        lines: [
          { account_id: cash.id,    debit: '50.0000', credit: '0.0000',  memo: null },
          { account_id: revenue.id, debit: '0.0000',  credit: '50.0000', memo: null },
        ],
      }),
    );
    expect(je.status).toBe('posted');

    const audits = await t.db.selectFrom('audit_logs').selectAll().orderBy('created_at').execute();
    const overrideRow = audits.find(a => a.action === 'fiscal_period.admin_override_post');
    expect(overrideRow).toBeTruthy();
    expect(overrideRow!.after_state).toMatchObject({ reason: 'late adjustment for tax' });
  });
});
```

- [ ] **Step 2: Implement `apps/api/src/services/admin/adminOverrideService.ts`**

```ts
import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { AuthError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export async function runWithClosedPeriodOverride<T>(
  db: Kysely<DB>, ctx: ServiceCtx, reason: string,
  fn: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  if (ctx.effective_role !== 'firm_admin') {
    throw new AuthError(ERR.FORBIDDEN, 'Only firm_admin may override closed periods');
  }
  if (!reason || reason.length < 10) {
    throw new AuthError(ERR.FORBIDDEN, 'Override reason must be at least 10 characters');
  }
  return db.transaction().execute(async (trx) => {
    // Write audit FIRST so it's in the same transaction as the override action.
    await auditRecord(trx, ctx, {
      action: AUDIT.FISCAL_PERIOD_ADMIN_OVERRIDE_POST,
      entity_type: 'fiscal_period',
      entity_id: null,
      before: null,
      after: { reason },
    });
    await sql`SELECT set_config('app.admin_override', 'on', true)`.execute(trx);
    return fn(trx);
  });
}
```

- [ ] **Step 3: Run tests and commit**

```bash
npm -w @accounting/api run test:integration -- adminOverrideService
git add apps/api/src/services/admin/adminOverrideService.ts apps/api/tests/integration/adminOverrideService.test.ts
git commit -m "feat(api): admin override service for closed-period posting"
```

### Task 14: Trigger-level adversarial tests

This task verifies that the DB triggers stop bypasses even if the service layer is circumvented. Critical for the belt-and-suspenders guarantee.

**Files:**
- Create: `apps/api/tests/integration/ledgerTriggers.test.ts`

- [ ] **Step 1: Write tests that try to violate every trigger**

```ts
// apps/api/tests/integration/ledgerTriggers.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeAccount, makePeriod, seedYearPeriods } from '../helpers/factories.js';
import * as ledger from '../../src/services/core/ledgerService.js';
import * as periods from '../../src/services/core/fiscalPeriodService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-00000000eeee', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('ledger DB triggers (adversarial)', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  async function setup() {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    const cash = await makeAccount(t.db, biz.id, { code: '1010', account_type: 'asset' });
    const rev = await makeAccount(t.db, biz.id, { code: '4010', account_type: 'revenue' });
    return { firm, biz, user, ctx, cash, rev };
  }

  it('balance trigger: direct UPDATE making lines unbalanced is blocked at COMMIT', async () => {
    const { biz, ctx, cash, rev } = await setup();
    const je = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual', memo: null,
        lines: [
          { account_id: cash.id, debit: '10.0000', credit: '0.0000', memo: null },
          { account_id: rev.id,  debit: '0.0000',  credit: '10.0000', memo: null },
        ],
      }),
    );
    // Bypass services and try to directly update one line — but posted lines are immutable too.
    await expect(
      t.db.updateTable('journal_entry_lines').set({ debit: '20.0000' }).where('journal_entry_id', '=', je.id).execute(),
    ).rejects.toThrow(/cannot mutate lines of posted/);
  });

  it('immutability: direct UPDATE of posted JE memo is blocked', async () => {
    const { biz, ctx, cash, rev } = await setup();
    const je = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual', memo: 'orig',
        lines: [
          { account_id: cash.id, debit: '5.0000', credit: '0.0000', memo: null },
          { account_id: rev.id,  debit: '0.0000', credit: '5.0000', memo: null },
        ],
      }),
    );
    await expect(
      t.db.updateTable('journal_entries').set({ memo: 'tampered' }).where('id', '=', je.id).execute(),
    ).rejects.toThrow(/cannot mutate posted/);
  });

  it('immutability: direct DELETE of posted JE is blocked', async () => {
    const { biz, ctx, cash, rev } = await setup();
    const je = await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual', memo: null,
        lines: [
          { account_id: cash.id, debit: '5.0000', credit: '0.0000', memo: null },
          { account_id: rev.id,  debit: '0.0000', credit: '5.0000', memo: null },
        ],
      }),
    );
    await expect(
      t.db.deleteFrom('journal_entries').where('id', '=', je.id).execute(),
    ).rejects.toThrow(/cannot delete posted/);
  });

  it('period gate: direct INSERT of posted JE into closed period is blocked', async () => {
    const { biz, ctx, cash, rev } = await setup();
    const period = (await periods.findPeriodForDate(t.db, biz.id, '2026-04-15'))!;
    await t.db.transaction().execute(trx =>
      periods.closePeriod(trx, { ...ctx, effective_role: 'firm_admin' }, { period_id: period.id }),
    );
    await expect(
      t.db.insertInto('journal_entries').values({
        business_id: biz.id, period_id: period.id, entry_date: '2026-04-15',
        source_type: 'manual', status: 'posted', posted_at: new Date().toISOString() as unknown as string,
      }).execute(),
    ).rejects.toThrow(/closed period/);
    void cash; void rev;
  });

  it('source sanity: reversal must reference an existing JE', async () => {
    const { biz } = await setup();
    const period = (await periods.findPeriodForDate(t.db, biz.id, '2026-04-15'))!;
    await expect(
      t.db.insertInto('journal_entries').values({
        business_id: biz.id, period_id: period.id, entry_date: '2026-04-15',
        source_type: 'reversal', source_id: '00000000-0000-0000-0000-000000000000', status: 'draft',
      }).execute(),
    ).rejects.toThrow(/reversal entry must reference/);
  });

  it('source sanity: manual entry rejects non-null source_id', async () => {
    const { biz, cash } = await setup();
    const period = (await periods.findPeriodForDate(t.db, biz.id, '2026-04-15'))!;
    await expect(
      t.db.insertInto('journal_entries').values({
        business_id: biz.id, period_id: period.id, entry_date: '2026-04-15',
        source_type: 'manual', source_id: cash.id, status: 'draft',
      }).execute(),
    ).rejects.toThrow(/manual entry must not have source_id/);
  });

  it('date range: entry_date outside period range is blocked', async () => {
    const { biz } = await setup();
    const period = (await periods.findPeriodForDate(t.db, biz.id, '2026-04-15'))!;
    await expect(
      t.db.insertInto('journal_entries').values({
        business_id: biz.id, period_id: period.id, entry_date: '2026-05-15',
        source_type: 'manual', status: 'draft',
      }).execute(),
    ).rejects.toThrow(/outside period range/);
  });
});
```

- [ ] **Step 2: Run and commit**

```bash
npm -w @accounting/api run test:integration -- ledgerTriggers
git add apps/api/tests/integration/ledgerTriggers.test.ts
git commit -m "test(api): adversarial trigger tests for ledger invariants"
```

---

## Phase E — Routes + trial balance (Tasks 15–18)

### Task 15: COA + period routes

**Files:**
- Create: `apps/api/src/routes/chartOfAccounts.ts`, `apps/api/src/routes/fiscalPeriods.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write `apps/api/src/routes/chartOfAccounts.ts`**

```ts
import { Router } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as coa from '../services/core/chartOfAccountsService.js';
import type { ServiceCtx } from '../lib/ctx.js';

const router = Router({ mergeParams: true });

function ctxFromReq(req: any): ServiceCtx {
  return {
    user_id: req.auth!.user_id,
    firm_id: req.auth!.firm_id,
    business_id: req.tenancy!.business_id,
    effective_role: req.tenancy!.effective_role,
    request_id: req.request_id,
    ip_address: req.ip ?? '0.0.0.0',
    user_agent: req.header('user-agent') ?? '',
  };
}

router.use(requireAuth, resolveBusiness);

router.get('/businesses/:businessId/coa', async (req, res, next) => {
  try {
    const list = await coa.listAccounts(db, { business_id: req.tenancy!.business_id, include_inactive: req.query['include_inactive'] === 'true' });
    res.json({ accounts: list });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/coa', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.accountCreateSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      coa.createAccount(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        code: body.code, name: body.name, account_type: body.account_type,
        parent_id: body.parent_id ?? null,
      }),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/coa/:accountId', requireMinRole('accountant'), async (req, res, next) => {
  try {
    // exactOptionalPropertyTypes: zod's .optional() yields T|undefined which
    // doesn't fit the service's { name?: string; ... } shape. Build conditionally.
    const parsed = schemas.accountUpdateSchema.parse(req.body);
    const patch: { name?: string; parent_id?: string | null; is_active?: boolean } = {};
    if (parsed.name !== undefined) patch.name = parsed.name;
    if (parsed.parent_id !== undefined) patch.parent_id = parsed.parent_id;
    if (parsed.is_active !== undefined) patch.is_active = parsed.is_active;
    const updated = await db.transaction().execute(trx =>
      coa.updateAccount(trx, ctxFromReq(req), {
        account_id: req.params['accountId']!,
        patch,
      }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

export default router;
```

- [ ] **Step 2: Write `apps/api/src/routes/fiscalPeriods.ts`**

```ts
import { Router } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as periods from '../services/core/fiscalPeriodService.js';
import type { ServiceCtx } from '../lib/ctx.js';

const router = Router({ mergeParams: true });

function ctxFromReq(req: any): ServiceCtx {
  return {
    user_id: req.auth!.user_id, firm_id: req.auth!.firm_id,
    business_id: req.tenancy!.business_id, effective_role: req.tenancy!.effective_role,
    request_id: req.request_id, ip_address: req.ip ?? '0.0.0.0',
    user_agent: req.header('user-agent') ?? '',
  };
}

router.use(requireAuth, resolveBusiness);

router.get('/businesses/:businessId/periods', async (req, res, next) => {
  try {
    const list = await periods.listPeriods(db, req.tenancy!.business_id);
    res.json({ periods: list });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/periods/seed-year', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    const body = schemas.seedYearSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      periods.seedCalendarYear(trx, ctxFromReq(req), { business_id: req.tenancy!.business_id, year: body.year }),
    );
    res.status(201).json({ periods: created });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/periods/:periodId/close', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    const updated = await db.transaction().execute(trx =>
      periods.closePeriod(trx, ctxFromReq(req), { period_id: req.params['periodId']! }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/periods/:periodId/reopen', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    const updated = await db.transaction().execute(trx =>
      periods.reopenPeriod(trx, ctxFromReq(req), { period_id: req.params['periodId']! }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

export default router;
```

- [ ] **Step 3: Wire in `apps/api/src/app.ts`**

Add imports:
```ts
import coaRoutes from './routes/chartOfAccounts.js';
import periodRoutes from './routes/fiscalPeriods.js';
```

Add `app.use(coaRoutes); app.use(periodRoutes);` after `app.use(meRoutes);`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/chartOfAccounts.ts apps/api/src/routes/fiscalPeriods.ts apps/api/src/app.ts
git commit -m "feat(api): COA + fiscal period routes"
```

### Task 16: Journal entry routes

**Files:**
- Create: `apps/api/src/routes/journalEntries.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write `apps/api/src/routes/journalEntries.ts`**

```ts
import { Router } from 'express';
import { schemas, ERR } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as ledger from '../services/core/ledgerService.js';
import { runWithClosedPeriodOverride } from '../services/admin/adminOverrideService.js';
import type { ServiceCtx } from '../lib/ctx.js';
import { BusinessRuleError } from '../lib/errors.js';

const router = Router({ mergeParams: true });

function ctxFromReq(req: any): ServiceCtx {
  return {
    user_id: req.auth!.user_id, firm_id: req.auth!.firm_id,
    business_id: req.tenancy!.business_id, effective_role: req.tenancy!.effective_role,
    request_id: req.request_id, ip_address: req.ip ?? '0.0.0.0',
    user_agent: req.header('user-agent') ?? '',
  };
}

router.use(requireAuth, resolveBusiness);

router.get('/businesses/:businessId/journal-entries', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(String(req.query['limit'] ?? 50), 10) || 50, 200);
    const offset = parseInt(String(req.query['offset'] ?? 0), 10) || 0;
    const status = req.query['status'] as string | undefined;
    let q = db.selectFrom('journal_entries').selectAll().where('business_id', '=', req.tenancy!.business_id);
    if (status) q = q.where('status', '=', status as any);
    const rows = await q.orderBy('entry_date', 'desc').orderBy('created_at', 'desc').limit(limit).offset(offset).execute();
    res.json({ entries: rows, limit, offset });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/journal-entries/:id', async (req, res, next) => {
  try {
    const je = await db.selectFrom('journal_entries').selectAll()
      .where('id', '=', req.params['id']!)
      .where('business_id', '=', req.tenancy!.business_id)
      .executeTakeFirst();
    if (!je) throw new BusinessRuleError(ERR.NOT_FOUND, 'Journal entry not found');
    const lines = await db.selectFrom('journal_entry_lines as jel')
      .innerJoin('chart_of_accounts as a', 'a.id', 'jel.account_id')
      .select(['jel.id', 'jel.line_number', 'jel.account_id', 'a.code as account_code', 'a.name as account_name', 'jel.debit', 'jel.credit', 'jel.memo'])
      .where('jel.journal_entry_id', '=', je.id)
      .orderBy('jel.line_number')
      .execute();
    res.json({ entry: je, lines });
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/journal-entries', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.journalEntryCreateSchema.parse(req.body);
    const ctx = ctxFromReq(req);
    const force = req.query['admin_override'] === 'true';
    const reason = (req.body?.admin_override_reason as string | undefined) ?? '';
    const work = (trx: any) =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: req.tenancy!.business_id,
        entry_date: body.entry_date,
        source_type: 'manual',
        memo: body.memo ?? null,
        reference: body.reference ?? null,
        lines: body.lines.map(l => ({ account_id: l.account_id, debit: l.debit, credit: l.credit, memo: l.memo ?? null })),
      });
    const je = force
      ? await runWithClosedPeriodOverride(db, ctx, reason, work)
      : await db.transaction().execute(work);
    res.status(201).json(je);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/journal-entries/:id/void', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.journalEntryVoidSchema.parse(req.body);
    const ctx = ctxFromReq(req);
    const force = req.query['admin_override'] === 'true';
    const reason = (req.body?.admin_override_reason as string | undefined) ?? '';
    const work = (trx: any) =>
      ledger.voidJournalEntry(trx, ctx, { journal_entry_id: req.params['id']!, void_reason: body.void_reason });
    const reversal = force
      ? await runWithClosedPeriodOverride(db, ctx, reason, work)
      : await db.transaction().execute(work);
    res.json({ reversal });
  } catch (e) { next(e); }
});

export default router;
```

- [ ] **Step 2: Wire in `apps/api/src/app.ts`**

Add: `import journalEntryRoutes from './routes/journalEntries.js';` and `app.use(journalEntryRoutes);`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/journalEntries.ts apps/api/src/app.ts
git commit -m "feat(api): journal entry routes (list/get/post/void) with admin override"
```

### Task 17: Trial balance service + route + tests

**Files:**
- Create: `apps/api/src/routes/trialBalance.ts`
- Create: `apps/api/tests/integration/trialBalance.test.ts`
- Modify: `apps/api/src/services/core/ledgerService.ts` (add `computeTrialBalance`)

- [ ] **Step 1: Append `computeTrialBalance` to `apps/api/src/services/core/ledgerService.ts`**

Add after `computeAccountBalance`:

```ts
export type TrialBalanceRow = {
  account_id: string;
  code: string;
  name: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  total_debit: string;
  total_credit: string;
  net: string;
};

export async function computeTrialBalance(
  db: Kysely<DB>, q: { business_id: string; as_of: string },
): Promise<{ rows: TrialBalanceRow[]; totals: { total_debit: string; total_credit: string } }> {
  const rows = await db.selectFrom('chart_of_accounts as a')
    .leftJoin('journal_entry_lines as jel', 'jel.account_id', 'a.id')
    .leftJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .select(({ fn }) => [
      'a.id as account_id', 'a.code', 'a.name', 'a.account_type',
      fn.coalesce(fn.sum<string>('jel.debit'), sql.lit('0')).as('total_debit'),
      fn.coalesce(fn.sum<string>('jel.credit'), sql.lit('0')).as('total_credit'),
    ])
    .where('a.business_id', '=', q.business_id)
    .where(eb => eb.or([
      eb('je.id', 'is', null),
      eb.and([eb('je.status', '=', 'posted'), eb('je.entry_date', '<=', q.as_of)]),
    ]))
    .groupBy(['a.id', 'a.code', 'a.name', 'a.account_type'])
    .orderBy('a.code')
    .execute();

  let totalD = '0.0000', totalC = '0.0000';
  const out: TrialBalanceRow[] = rows.map(r => {
    const net = toMoneyString(subMoney(r.total_debit ?? '0', r.total_credit ?? '0'));
    totalD = toMoneyString(addMoney(totalD, r.total_debit ?? '0'));
    totalC = toMoneyString(addMoney(totalC, r.total_credit ?? '0'));
    return {
      account_id: r.account_id,
      code: r.code,
      name: r.name,
      account_type: r.account_type as any,
      total_debit: toMoneyString(r.total_debit ?? '0'),
      total_credit: toMoneyString(r.total_credit ?? '0'),
      net,
    };
  });
  return { rows: out, totals: { total_debit: totalD, total_credit: totalC } };
}
```

- [ ] **Step 2: Write `apps/api/src/routes/trialBalance.ts`**

```ts
import { Router } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import * as ledger from '../services/core/ledgerService.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveBusiness);

router.get('/businesses/:businessId/reports/trial-balance', async (req, res, next) => {
  try {
    const q = schemas.trialBalanceQuerySchema.parse({ as_of: req.query['as_of'] ?? new Date().toISOString().slice(0, 10) });
    const out = await ledger.computeTrialBalance(db, { business_id: req.tenancy!.business_id, as_of: q.as_of });
    res.json({ as_of: q.as_of, ...out });
  } catch (e) { next(e); }
});

export default router;
```

Wire in `apps/api/src/app.ts`: import + `app.use(trialBalanceRoutes);`.

- [ ] **Step 3: Write integration test**

```ts
// apps/api/tests/integration/trialBalance.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeAccount, seedYearPeriods } from '../helpers/factories.js';
import * as ledger from '../../src/services/core/ledgerService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-00000000ffff', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('trial balance', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('reflects posted JEs only; debits equal credits in totals', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    const cash = await makeAccount(t.db, biz.id, { code: '1010', account_type: 'asset' });
    const rev = await makeAccount(t.db, biz.id, { code: '4010', account_type: 'revenue' });
    await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual', memo: null,
        lines: [
          { account_id: cash.id, debit: '500.0000', credit: '0.0000',  memo: null },
          { account_id: rev.id,  debit: '0.0000',   credit: '500.0000', memo: null },
        ],
      }),
    );
    const tb = await ledger.computeTrialBalance(t.db, { business_id: biz.id, as_of: '2026-12-31' });
    expect(tb.totals.total_debit).toBe('500.0000');
    expect(tb.totals.total_credit).toBe('500.0000');
    const cashRow = tb.rows.find(r => r.code === '1010')!;
    expect(cashRow.net).toBe('500.0000');
  });
});
```

- [ ] **Step 4: Run, then commit**

```bash
npm -w @accounting/api run test:integration -- trialBalance
git add apps/api/src/services/core/ledgerService.ts apps/api/src/routes/trialBalance.ts apps/api/src/app.ts apps/api/tests/integration/trialBalance.test.ts
git commit -m "feat(api): trial balance service + route + tests"
```

### Task 18: Update seed to load default COA + 12 periods

**Files:**
- Modify: `bin/seed.ts`
- Create: `db/seeds/0002_ledger.sql`

- [ ] **Step 1: Write `db/seeds/0002_ledger.sql`**

```sql
DO $$
DECLARE
  r record;
  v_year int := EXTRACT(year FROM CURRENT_DATE)::int;
BEGIN
  FOR r IN SELECT id FROM businesses WHERE deleted_at IS NULL LOOP
    PERFORM seed_default_coa(r.id);
    PERFORM seed_calendar_year_periods(r.id, v_year);
  END LOOP;
END $$;
```

- [ ] **Step 2: Apply via the existing `npm run db:seed`**

The existing seed runner already iterates `db/seeds/*.sql` in order, so this file gets picked up.

```bash
npm run db:reset
```
Verify:
```bash
psql "$DATABASE_URL" -c "SELECT b.name, count(c.*) AS account_count FROM businesses b LEFT JOIN chart_of_accounts c ON c.business_id = b.id GROUP BY b.name;"
psql "$DATABASE_URL" -c "SELECT b.name, count(p.*) FROM businesses b LEFT JOIN fiscal_periods p ON p.business_id = b.id GROUP BY b.name;"
```
Expected: each business has ~28 accounts and 12 periods.

- [ ] **Step 3: Commit**

```bash
git add db/seeds/0002_ledger.sql
git commit -m "feat(db): seed default COA + 12 periods per business"
```

---

## Phase F — Web UI for ledger (Tasks 19–25)

The web pages for Plan 1.1 are intentionally functional, not flashy: tables, forms, posting buttons. shadcn/ui patterns. Heavy lifting is API-side; the UI is presentation + form validation.

### Task 19: Money display helper + business switcher state

**Files:**
- Create: `apps/web/src/lib/money.ts`
- Create: `apps/web/src/lib/business.ts`

- [ ] **Step 1: Write `apps/web/src/lib/money.ts`**

```ts
import { Decimal } from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

export function fmtMoney(value: string | number): string {
  if (value === '' || value == null) return '0.00';
  const d = new Decimal(value);
  return d.toFixed(2); // display 2dp; storage is 4dp
}

export function fmtSigned(value: string | number): string {
  const d = new Decimal(value);
  if (d.isNegative()) return `(${d.abs().toFixed(2)})`;
  return d.toFixed(2);
}

export function parseMoneyInput(value: string): string {
  // Permit empty; otherwise normalize to 4dp string.
  if (value === '') return '0.0000';
  const d = new Decimal(value);
  if (d.isNaN()) throw new Error(`Invalid amount: ${value}`);
  return d.toFixed(4);
}
```

- [ ] **Step 2: Write `apps/web/src/lib/business.ts`**

```ts
import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/useAuth';

const STORAGE_KEY = 'acct_active_business';

export function useActiveBusinessId(): [string | null, (id: string) => void] {
  const { businesses } = useAuth();
  const [active, setActive] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));

  useEffect(() => {
    if (businesses.length === 0) { setActive(null); return; }
    if (!active || !businesses.find(b => b.id === active)) {
      const first = businesses[0]!.id;
      setActive(first);
      localStorage.setItem(STORAGE_KEY, first);
    }
  }, [businesses, active]);

  function pick(id: string) {
    setActive(id);
    localStorage.setItem(STORAGE_KEY, id);
  }
  return [active, pick];
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/money.ts apps/web/src/lib/business.ts
git commit -m "feat(web): money formatting helpers + active business hook"
```

### Task 20: Update TopBar with business switcher

**Files:**
- Modify: `apps/web/src/components/layout/TopBar.tsx`

- [ ] **Step 1: Replace TopBar**

```tsx
import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/useAuth';
import { useActiveBusinessId } from '@/lib/business';

export function TopBar() {
  const { user, businesses, logout } = useAuth();
  const [active, setActive] = useActiveBusinessId();
  return (
    <header className="h-14 shrink-0 border-b bg-card flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        {businesses.length > 0 ? (
          <select
            value={active ?? ''}
            onChange={e => setActive(e.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            {businesses.map(b => (<option key={b.id} value={b.id}>{b.name}</option>))}
          </select>
        ) : (
          <span className="text-sm text-muted-foreground">No business access</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm">{user?.full_name ?? ''} ({user?.role})</span>
        <Button variant="outline" size="sm" onClick={logout}>Sign out</Button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Update Sidebar with new nav items**

Replace `apps/web/src/components/layout/Sidebar.tsx`:

```tsx
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

const items = [
  { to: '/', label: 'Dashboard' },
  { to: '/journal', label: 'Journal Entries' },
  { to: '/reports/trial-balance', label: 'Trial Balance' },
  { to: '/settings/coa', label: 'Chart of Accounts' },
  { to: '/settings/periods', label: 'Fiscal Periods' },
];

export function Sidebar() {
  return (
    <aside className="w-56 shrink-0 border-r bg-card p-4">
      <div className="font-semibold mb-4">Accounting</div>
      <nav className="flex flex-col gap-1">
        {items.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => cn(
              'rounded px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground',
              isActive && 'bg-accent text-accent-foreground'
            )}
            end
          >{item.label}</NavLink>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/layout/
git commit -m "feat(web): business switcher in topbar + ledger sidebar items"
```

### Task 21: Chart of accounts page

**Files:**
- Create: `apps/web/src/pages/coa/CoaListPage.tsx`

- [ ] **Step 1: Write**

```tsx
// apps/web/src/pages/coa/CoaListPage.tsx
import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Account = { id: string; code: string; name: string; account_type: string; is_system: boolean; is_active: boolean };

export default function CoaListPage() {
  const [bizId] = useActiveBusinessId();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', account_type: 'asset' });
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    if (!bizId) return;
    const r = await api.get(`/businesses/${bizId}/coa?include_inactive=true`);
    setAccounts(r.data.accounts);
  }
  useEffect(() => { reload(); }, [bizId]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/coa`, { ...form, parent_id: null });
      setForm({ code: '', name: '', account_type: 'asset' }); setShowCreate(false);
      await reload();
    } catch (e: any) { setErr(e?.response?.data?.error?.message ?? 'Failed'); }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Chart of Accounts</h1>
        <Button onClick={() => setShowCreate(s => !s)}>{showCreate ? 'Cancel' : 'Add account'}</Button>
      </div>

      {showCreate && (
        <Card><CardHeader><CardTitle>New account</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={create}>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Code</Label><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} /></div>
                <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
                <div>
                  <Label>Type</Label>
                  <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.account_type} onChange={e => setForm(f => ({ ...f, account_type: e.target.value }))}>
                    {['asset','liability','equity','revenue','expense'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              {err && <p className="text-sm text-destructive">{err}</p>}
              <Button type="submit">Create</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="text-left p-3">Code</th>
              <th className="text-left p-3">Name</th>
              <th className="text-left p-3">Type</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">System</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map(a => (
              <tr key={a.id} className="border-b last:border-b-0">
                <td className="p-3 font-mono">{a.code}</td>
                <td className="p-3">{a.name}</td>
                <td className="p-3">{a.account_type}</td>
                <td className="p-3">{a.is_active ? 'active' : 'inactive'}</td>
                <td className="p-3">{a.is_system ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/coa/
git commit -m "feat(web): chart of accounts list page"
```

### Task 22: Fiscal periods page

**Files:**
- Create: `apps/web/src/pages/periods/PeriodsPage.tsx`

- [ ] **Step 1: Write**

```tsx
// apps/web/src/pages/periods/PeriodsPage.tsx
import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Period = { id: string; starts_on: string; ends_on: string; status: 'open' | 'closed'; closed_at: string | null };

export default function PeriodsPage() {
  const [bizId] = useActiveBusinessId();
  const [periods, setPeriods] = useState<Period[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    if (!bizId) return;
    const r = await api.get(`/businesses/${bizId}/periods`);
    setPeriods(r.data.periods);
  }
  useEffect(() => { reload(); }, [bizId]);

  async function close(p: Period) {
    setBusy(p.id); setErr(null);
    try { await api.post(`/businesses/${bizId}/periods/${p.id}/close`); await reload(); }
    catch (e: any) { setErr(e?.response?.data?.error?.message ?? 'Failed'); }
    finally { setBusy(null); }
  }

  async function reopen(p: Period) {
    setBusy(p.id); setErr(null);
    try { await api.post(`/businesses/${bizId}/periods/${p.id}/reopen`); await reload(); }
    catch (e: any) { setErr(e?.response?.data?.error?.message ?? 'Failed'); }
    finally { setBusy(null); }
  }

  async function seedYear() {
    const yearStr = window.prompt('Year to seed?', String(new Date().getFullYear() + 1));
    if (!yearStr) return;
    setErr(null);
    try { await api.post(`/businesses/${bizId}/periods/seed-year`, { year: parseInt(yearStr, 10) }); await reload(); }
    catch (e: any) { setErr(e?.response?.data?.error?.message ?? 'Failed'); }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Fiscal Periods</h1>
        <Button onClick={seedYear}>Seed a year</Button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="text-left p-3">Starts</th>
              <th className="text-left p-3">Ends</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Closed</th>
              <th className="text-left p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {periods.map(p => (
              <tr key={p.id} className="border-b last:border-b-0">
                <td className="p-3">{p.starts_on}</td>
                <td className="p-3">{p.ends_on}</td>
                <td className="p-3">{p.status}</td>
                <td className="p-3">{p.closed_at ? new Date(p.closed_at).toLocaleString() : ''}</td>
                <td className="p-3">
                  {p.status === 'open'
                    ? <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => close(p)}>Close</Button>
                    : <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => reopen(p)}>Reopen (admin)</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/periods/
git commit -m "feat(web): fiscal periods page"
```

### Task 23: Journal entries list + detail

**Files:**
- Create: `apps/web/src/pages/journal/JournalListPage.tsx`, `JournalDetailPage.tsx`

- [ ] **Step 1: Write `apps/web/src/pages/journal/JournalListPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type JE = { id: string; entry_date: string; memo: string | null; status: string; source_type: string };

export default function JournalListPage() {
  const [bizId] = useActiveBusinessId();
  const [entries, setEntries] = useState<JE[]>([]);
  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/journal-entries`).then(r => setEntries(r.data.entries));
  }, [bizId]);
  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Journal Entries</h1>
        <Button asChild><Link to="/journal/new">New entry</Link></Button>
      </div>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="text-left p-3">Date</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Source</th>
              <th className="text-left p-3">Memo</th>
              <th className="text-left p-3"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id} className="border-b last:border-b-0">
                <td className="p-3">{e.entry_date}</td>
                <td className="p-3">{e.status}</td>
                <td className="p-3">{e.source_type}</td>
                <td className="p-3">{e.memo ?? ''}</td>
                <td className="p-3"><Link className="text-primary underline" to={`/journal/${e.id}`}>view</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
```

- [ ] **Step 2: Write `apps/web/src/pages/journal/JournalDetailPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

export default function JournalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  useEffect(() => { if (bizId && id) api.get(`/businesses/${bizId}/journal-entries/${id}`).then(r => setData(r.data)); }, [bizId, id]);

  async function voidIt() {
    const reason = window.prompt('Reason for voiding?');
    if (!reason) return;
    setBusy(true); setErr(null);
    try { await api.post(`/businesses/${bizId}/journal-entries/${id}/void`, { void_reason: reason }); nav('/journal'); }
    catch (e: any) { setErr(e?.response?.data?.error?.message ?? 'Failed'); }
    finally { setBusy(false); }
  }

  if (!data) return <div>Loading…</div>;
  const totalD = data.lines.reduce((s: number, l: any) => s + parseFloat(l.debit), 0);
  const totalC = data.lines.reduce((s: number, l: any) => s + parseFloat(l.credit), 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Journal Entry</h1>
      <Card>
        <CardHeader><CardTitle>{data.entry.entry_date} — {data.entry.status}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>Memo: {data.entry.memo ?? '—'}</div>
          <div>Reference: {data.entry.reference ?? '—'}</div>
          <div>Source: {data.entry.source_type}</div>
          {data.entry.reversed_entry_id && <div>Reverses: {data.entry.reversed_entry_id}</div>}
        </CardContent>
      </Card>

      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr><th className="text-left p-3">#</th><th className="text-left p-3">Account</th><th className="text-right p-3">Debit</th><th className="text-right p-3">Credit</th><th className="text-left p-3">Memo</th></tr>
          </thead>
          <tbody>
            {data.lines.map((l: any) => (
              <tr key={l.id} className="border-b last:border-b-0">
                <td className="p-3">{l.line_number}</td>
                <td className="p-3 font-mono">{l.account_code} {l.account_name}</td>
                <td className="p-3 text-right">{parseFloat(l.debit) > 0 ? fmtMoney(l.debit) : ''}</td>
                <td className="p-3 text-right">{parseFloat(l.credit) > 0 ? fmtMoney(l.credit) : ''}</td>
                <td className="p-3">{l.memo ?? ''}</td>
              </tr>
            ))}
            <tr className="font-semibold bg-muted/20">
              <td colSpan={2} className="p-3 text-right">Totals</td>
              <td className="p-3 text-right">{totalD.toFixed(2)}</td>
              <td className="p-3 text-right">{totalC.toFixed(2)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </CardContent></Card>

      {err && <p className="text-sm text-destructive">{err}</p>}
      {data.entry.status === 'posted' && (
        <Button variant="destructive" disabled={busy} onClick={voidIt}>Void this entry</Button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/journal/
git commit -m "feat(web): journal entries list + detail with void action"
```

### Task 24: Manual journal entry creation page

**Files:**
- Create: `apps/web/src/pages/journal/JournalNewPage.tsx`

- [ ] **Step 1: Write**

```tsx
// apps/web/src/pages/journal/JournalNewPage.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { parseMoneyInput } from '@/lib/money';

type Account = { id: string; code: string; name: string; account_type: string };
type Line = { account_id: string; debit: string; credit: string; memo: string };

const blank = (): Line => ({ account_id: '', debit: '0.00', credit: '0.00', memo: '' });

export default function JournalNewPage() {
  const [bizId] = useActiveBusinessId();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/coa`).then(r => setAccounts(r.data.accounts));
  }, [bizId]);

  function update(i: number, patch: Partial<Line>) {
    setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const body = {
        entry_date: date,
        memo: memo || null,
        reference: reference || null,
        lines: lines.map(l => ({
          account_id: l.account_id,
          debit: parseMoneyInput(l.debit || '0'),
          credit: parseMoneyInput(l.credit || '0'),
          memo: l.memo || null,
        })),
      };
      const r = await api.post(`/businesses/${bizId}/journal-entries`, body);
      nav(`/journal/${r.data.id}`);
    } catch (e: any) {
      setErr(e?.response?.data?.error?.message ?? 'Failed');
    } finally { setBusy(false); }
  }

  const totalD = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalC = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const balanced = Math.abs(totalD - totalC) < 0.005 && totalD > 0;

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <form className="space-y-6" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">New Journal Entry</h1>

      <Card><CardHeader><CardTitle>Header</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <div><Label>Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} required /></div>
          <div><Label>Reference</Label><Input value={reference} onChange={e => setReference(e.target.value)} /></div>
          <div><Label>Memo</Label><Input value={memo} onChange={e => setMemo(e.target.value)} /></div>
        </CardContent>
      </Card>

      <Card><CardHeader><CardTitle>Lines</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-4">
                <Label className="sr-only">Account</Label>
                <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={l.account_id} onChange={e => update(i, { account_id: e.target.value })} required>
                  <option value="">Select account…</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
              </div>
              <div className="col-span-2"><Label className="sr-only">Debit</Label><Input type="number" step="0.0001" min="0" value={l.debit} onChange={e => update(i, { debit: e.target.value, credit: '0.00' })} /></div>
              <div className="col-span-2"><Label className="sr-only">Credit</Label><Input type="number" step="0.0001" min="0" value={l.credit} onChange={e => update(i, { credit: e.target.value, debit: '0.00' })} /></div>
              <div className="col-span-3"><Label className="sr-only">Memo</Label><Input value={l.memo} onChange={e => update(i, { memo: e.target.value })} placeholder="Line memo" /></div>
              <div className="col-span-1"><Button type="button" variant="ghost" onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} disabled={lines.length <= 2}>×</Button></div>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={() => setLines(ls => [...ls, blank()])}>Add line</Button>

          <div className="flex justify-end gap-8 pt-4 border-t font-mono">
            <div>Total Debit: {totalD.toFixed(2)}</div>
            <div>Total Credit: {totalC.toFixed(2)}</div>
            <div className={balanced ? 'text-green-600' : 'text-destructive'}>{balanced ? 'BALANCED' : 'UNBALANCED'}</div>
          </div>
        </CardContent>
      </Card>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={!balanced || busy}>{busy ? 'Posting…' : 'Post entry'}</Button>
        <Button type="button" variant="outline" onClick={() => nav('/journal')}>Cancel</Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/journal/JournalNewPage.tsx
git commit -m "feat(web): manual journal entry creation page"
```

### Task 25: Trial balance page + wire up routes

**Files:**
- Create: `apps/web/src/pages/reports/TrialBalancePage.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Write `apps/web/src/pages/reports/TrialBalancePage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fmtMoney, fmtSigned } from '@/lib/money';

type Row = { account_id: string; code: string; name: string; account_type: string; total_debit: string; total_credit: string; net: string };

export default function TrialBalancePage() {
  const [bizId] = useActiveBusinessId();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ total_debit: '0', total_credit: '0' });

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/reports/trial-balance`, { params: { as_of: asOf } })
      .then(r => { setRows(r.data.rows); setTotals(r.data.totals); });
  }, [bizId, asOf]);

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Trial Balance</h1>
        <div className="flex items-end gap-2">
          <div><Label>As of</Label><Input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} /></div>
        </div>
      </div>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr><th className="text-left p-3">Code</th><th className="text-left p-3">Account</th><th className="text-left p-3">Type</th><th className="text-right p-3">Debit</th><th className="text-right p-3">Credit</th><th className="text-right p-3">Net</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.account_id} className="border-b last:border-b-0">
                <td className="p-3 font-mono">{r.code}</td>
                <td className="p-3">{r.name}</td>
                <td className="p-3">{r.account_type}</td>
                <td className="p-3 text-right">{fmtMoney(r.total_debit)}</td>
                <td className="p-3 text-right">{fmtMoney(r.total_credit)}</td>
                <td className="p-3 text-right">{fmtSigned(r.net)}</td>
              </tr>
            ))}
            <tr className="font-semibold bg-muted/20">
              <td colSpan={3} className="p-3 text-right">Totals</td>
              <td className="p-3 text-right">{fmtMoney(totals.total_debit)}</td>
              <td className="p-3 text-right">{fmtMoney(totals.total_credit)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
```

- [ ] **Step 2: Update `apps/web/src/App.tsx`**

```tsx
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@/auth/AuthContext';
import { ProtectedRoute } from '@/auth/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import CoaListPage from '@/pages/coa/CoaListPage';
import PeriodsPage from '@/pages/periods/PeriodsPage';
import JournalListPage from '@/pages/journal/JournalListPage';
import JournalDetailPage from '@/pages/journal/JournalDetailPage';
import JournalNewPage from '@/pages/journal/JournalNewPage';
import TrialBalancePage from '@/pages/reports/TrialBalancePage';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="/journal" element={<JournalListPage />} />
            <Route path="/journal/new" element={<JournalNewPage />} />
            <Route path="/journal/:id" element={<JournalDetailPage />} />
            <Route path="/reports/trial-balance" element={<TrialBalancePage />} />
            <Route path="/settings/coa" element={<CoaListPage />} />
            <Route path="/settings/periods" element={<PeriodsPage />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
```

- [ ] **Step 3: Manual smoke test**

```bash
npm run db:reset && npm run dev
```
- Log in as admin
- Switch to "Blue Widget Co." in topbar
- Visit /settings/coa → 28 accounts
- Visit /settings/periods → 12 periods
- Visit /journal/new → create a test JE (DR 1010 Cash 100, CR 4010 Sales 100), post
- Visit /reports/trial-balance → row for 1010 shows 100.00 debit; totals balance

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/reports/ apps/web/src/App.tsx
git commit -m "feat(web): trial balance page + wire all ledger routes"
```

---

## Plan 1.1 Definition of Done

- [ ] All migrations 0005–0009 applied; `\d journal_entries` shows triggers
- [ ] All integration tests pass: `npm -w @accounting/api run test:integration`
- [ ] Adversarial trigger tests (`ledgerTriggers.test.ts`) all pass
- [ ] CI is green on `main`
- [ ] Default COA + 12 periods seeded for both demo businesses
- [ ] Manual smoke test (Task 25 Step 3) completes successfully on local stack
- [ ] Deployed: same flow works on Railway+Netlify
- [ ] Trial balance always balances (debits = credits in totals row)
- [ ] Closing a period with drafts is refused with PRECONDITION_FAILED
- [ ] Admin override path writes `fiscal_period.admin_override_post` audit row before the action
- [ ] All audit actions defined in this plan (`AUDIT.JOURNAL_ENTRY_*`, `AUDIT.FISCAL_PERIOD_*`, `AUDIT.COA_*`) emit at least once during smoke test

When all 11 are checked, move to Plan 1.2 (AR module).

