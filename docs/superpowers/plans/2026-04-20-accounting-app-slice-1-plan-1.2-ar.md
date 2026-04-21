# Accounting App — Slice 1 — Plan 1.2: Accounts Receivable

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the AR module on top of the ledger engine. Customers, invoices (draft → posted → voided → auto-paid), invoice lines with tax, payments with applications, credit memos (customer-return type). Every business action produces exactly one canonical journal entry, calling through `core/ledgerService.postJournalEntry` per the spec's "Only core/ledgerService writes to journal_entries" rule. Aging report + customer balance view. After this plan, Slice 1 is complete.

**Architecture:** All AR services follow the plan 1.0/1.1 convention — services receive `(trx, ctx, args)`, routes own `db.transaction().execute(...)`, audit rows are atomic with mutations. The critical boundary: AR services never touch `journal_entries` or `journal_entry_lines` directly. They call `ledgerService.postJournalEntry({ source_type: 'invoice', source_id: invoice.id, ... })`. Same DB-trigger defense-in-depth applies: posted invoices/payments/credit_memos are immutable at the DB layer.

**Tech Stack:** Same as 1.0/1.1.

**Spec:** `docs/superpowers/specs/2026-04-20-accounting-app-slice-1-ledger-and-ar-design.md`

**Prereq:** Plans 1.0 and 1.1 must be merged and deployed; ledger engine must be operational.

---

## Files added by this plan

```
db/migrations/
  0010_customers.sql
  0011_tax_codes.sql
  0012_invoices.sql
  0013_payments_and_applications.sql
  0014_credit_memos.sql
  0015_ar_triggers.sql              # immutability + polymorphic source extension
db/seeds/
  0003_ar.sql                       # sample customers + tax codes

apps/api/src/db/types.ts            # MODIFY: add AR tables

apps/api/src/services/
  ar/
    customerService.ts
    invoiceService.ts
    paymentService.ts
    creditMemoService.ts
    reports/
      agingReportService.ts
      customerBalanceService.ts
  tax/
    taxCodeService.ts

apps/api/src/routes/
  customers.ts
  invoices.ts
  payments.ts
  creditMemos.ts
  taxCodes.ts
  agingReport.ts

apps/api/src/lib/
  arErrors.ts                       # OverApplicationError, already-paid invoice, etc.

apps/api/tests/integration/
  customerService.test.ts
  invoiceService.test.ts
  paymentService.test.ts
  creditMemoService.test.ts
  agingReport.test.ts
  arTriggers.test.ts
  arRoundtrip.test.ts               # full invoice -> payment -> apply -> TB roundtrip

packages/shared/src/
  auditActions.ts                   # MODIFY: append AR actions
  schemas/
    customer.ts
    taxCode.ts
    invoice.ts
    payment.ts
    creditMemo.ts
    aging.ts
    index.ts                        # MODIFY

apps/web/src/
  pages/
    customers/CustomerListPage.tsx
    customers/CustomerDetailPage.tsx
    customers/CustomerNewPage.tsx
    invoices/InvoiceListPage.tsx
    invoices/InvoiceDetailPage.tsx
    invoices/InvoiceNewPage.tsx
    payments/PaymentListPage.tsx
    payments/PaymentDetailPage.tsx
    payments/PaymentNewPage.tsx
    creditMemos/CreditMemoListPage.tsx
    creditMemos/CreditMemoDetailPage.tsx
    creditMemos/CreditMemoNewPage.tsx
    reports/AgingReportPage.tsx
    settings/TaxCodesPage.tsx
  components/layout/Sidebar.tsx     # MODIFY: add AR nav items
  App.tsx                           # MODIFY: register AR routes
```

---

## Phase A — DB migrations (Tasks 1–6)

### Task 1: Customers table

**Files:**
- Create: `db/migrations/0010_customers.sql`

- [ ] **Step 1: Write migration**

```sql
CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL,
  email citext,
  phone text,
  billing_address jsonb,
  default_terms_days int NOT NULL DEFAULT 30,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_customers_business_name ON customers (business_id, name) WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_business ON customers (business_id) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

- [ ] **Step 2: Apply and commit**

```bash
npm run db:migrate
git add db/migrations/0010_customers.sql
git commit -m "feat(db): customers table"
```

### Task 2: Tax codes + tax rates

**Files:**
- Create: `db/migrations/0011_tax_codes.sql`

- [ ] **Step 1: Write migration**

```sql
CREATE TABLE tax_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  code text NOT NULL,
  name text NOT NULL,
  tax_payable_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, code)
);
CREATE TRIGGER trg_tax_codes_updated_at
  BEFORE UPDATE ON tax_codes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE tax_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_code_id uuid NOT NULL REFERENCES tax_codes(id) ON DELETE CASCADE,
  rate numeric(9,6) NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (rate >= 0 AND rate <= 1),
  CHECK (effective_to IS NULL OR effective_from <= effective_to)
);
CREATE INDEX idx_tax_rates_code ON tax_rates (tax_code_id, effective_from);
```

- [ ] **Step 2: Apply and commit**

```bash
npm run db:migrate
git add db/migrations/0011_tax_codes.sql
git commit -m "feat(db): tax_codes + tax_rates tables"
```

### Task 3: Invoices + invoice lines

**Files:**
- Create: `db/migrations/0012_invoices.sql`

- [ ] **Step 1: Write migration**

```sql
CREATE TYPE invoice_status AS ENUM ('draft', 'posted', 'voided', 'paid');

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  invoice_number text NOT NULL,
  issue_date date NOT NULL,
  due_date date NOT NULL,
  status invoice_status NOT NULL DEFAULT 'draft',
  subtotal numeric(19,4) NOT NULL DEFAULT 0,
  tax_total numeric(19,4) NOT NULL DEFAULT 0,
  total numeric(19,4) NOT NULL DEFAULT 0,
  ar_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  posted_journal_entry_id uuid REFERENCES journal_entries(id),
  memo text,
  terms text,
  posted_at timestamptz,
  posted_by_user_id uuid REFERENCES users(id),
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (business_id, invoice_number),
  CHECK (status <> 'posted' OR posted_at IS NOT NULL),
  CHECK (status <> 'posted' OR posted_journal_entry_id IS NOT NULL),
  CHECK (issue_date <= due_date)
);
CREATE INDEX idx_invoices_customer ON invoices (customer_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_business_date ON invoices (business_id, issue_date DESC) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_number int NOT NULL,
  description text NOT NULL,
  quantity numeric(19,4) NOT NULL,
  unit_price numeric(19,4) NOT NULL,
  revenue_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  tax_code_id uuid REFERENCES tax_codes(id),
  line_subtotal numeric(19,4) NOT NULL,
  tax_amount numeric(19,4) NOT NULL DEFAULT 0,
  line_total numeric(19,4) NOT NULL,
  UNIQUE (invoice_id, line_number),
  CHECK (quantity > 0),
  CHECK (unit_price >= 0)
);
CREATE INDEX idx_invoice_lines_invoice ON invoice_lines (invoice_id);
```

- [ ] **Step 2: Apply and commit**

```bash
npm run db:migrate
git add db/migrations/0012_invoices.sql
git commit -m "feat(db): invoices + invoice_lines tables"
```

### Task 4: Payments + payment applications

**Files:**
- Create: `db/migrations/0013_payments_and_applications.sql`

- [ ] **Step 1: Write migration**

```sql
CREATE TYPE payment_status AS ENUM ('draft', 'posted', 'voided');
CREATE TYPE payment_method AS ENUM ('cash', 'check', 'ach', 'wire', 'card', 'other');

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  payment_date date NOT NULL,
  payment_method payment_method NOT NULL,
  reference text,
  amount numeric(19,4) NOT NULL,
  unapplied_amount numeric(19,4) NOT NULL,
  cash_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  status payment_status NOT NULL DEFAULT 'draft',
  posted_journal_entry_id uuid REFERENCES journal_entries(id),
  memo text,
  posted_at timestamptz,
  posted_by_user_id uuid REFERENCES users(id),
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount > 0),
  CHECK (unapplied_amount >= 0 AND unapplied_amount <= amount),
  CHECK (status <> 'posted' OR posted_at IS NOT NULL),
  CHECK (status <> 'posted' OR posted_journal_entry_id IS NOT NULL)
);
CREATE INDEX idx_payments_customer ON payments (customer_id, status);
CREATE INDEX idx_payments_business_date ON payments (business_id, payment_date DESC);
CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payment_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid REFERENCES payments(id),
  credit_memo_id uuid,  -- FK added in 0014 after credit_memos table exists
  invoice_id uuid REFERENCES invoices(id),
  applied_amount numeric(19,4) NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by_user_id uuid REFERENCES users(id),
  CHECK (applied_amount > 0),
  -- Exactly one of invoice_id / credit_memo_id as target (but they cannot both be null):
  CHECK (invoice_id IS NOT NULL),
  -- Exactly one source: payment_id or credit_memo_id
  CHECK ((payment_id IS NOT NULL) <> (credit_memo_id IS NOT NULL))
);
CREATE INDEX idx_pa_payment ON payment_applications (payment_id);
CREATE INDEX idx_pa_invoice ON payment_applications (invoice_id);
CREATE INDEX idx_pa_credit ON payment_applications (credit_memo_id);
```

- [ ] **Step 2: Apply and commit**

```bash
npm run db:migrate
git add db/migrations/0013_payments_and_applications.sql
git commit -m "feat(db): payments + payment_applications tables"
```

### Task 5: Credit memos + close the FK loop

**Files:**
- Create: `db/migrations/0014_credit_memos.sql`

- [ ] **Step 1: Write migration**

```sql
CREATE TYPE credit_memo_status AS ENUM ('draft', 'posted', 'voided', 'applied');

CREATE TABLE credit_memos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  memo_date date NOT NULL,
  status credit_memo_status NOT NULL DEFAULT 'draft',
  amount numeric(19,4) NOT NULL,
  remaining_amount numeric(19,4) NOT NULL,
  source_payment_id uuid REFERENCES payments(id),
  ar_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  revenue_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  posted_journal_entry_id uuid REFERENCES journal_entries(id),
  memo text,
  posted_at timestamptz,
  posted_by_user_id uuid REFERENCES users(id),
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount > 0),
  CHECK (remaining_amount >= 0 AND remaining_amount <= amount),
  CHECK (status <> 'posted' OR posted_at IS NOT NULL),
  CHECK (status <> 'posted' OR posted_journal_entry_id IS NOT NULL)
);
CREATE INDEX idx_credit_memos_customer ON credit_memos (customer_id, status);
CREATE TRIGGER trg_credit_memos_updated_at
  BEFORE UPDATE ON credit_memos FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Close the FK loop on payment_applications.credit_memo_id
ALTER TABLE payment_applications
  ADD CONSTRAINT fk_pa_credit_memo FOREIGN KEY (credit_memo_id) REFERENCES credit_memos(id);
```

- [ ] **Step 2: Apply and commit**

```bash
npm run db:migrate
git add db/migrations/0014_credit_memos.sql
git commit -m "feat(db): credit_memos table + close payment_applications FK"
```

### Task 6: AR triggers (immutability + polymorphic source extension)

**Files:**
- Create: `db/migrations/0015_ar_triggers.sql`

- [ ] **Step 1: Write migration**

```sql
-- =====================================================================
-- Immutability triggers for invoices / payments / credit_memos
-- Pattern: same as JE — once status='posted', only the void path is
-- allowed to mutate the row, gated by app.allow_void session setting.
-- =====================================================================
CREATE OR REPLACE FUNCTION ar_protect_posted()
RETURNS TRIGGER AS $$
DECLARE
  v_entity text := TG_ARGV[0];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'cannot delete posted % %', v_entity, OLD.id
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'posted' THEN
    IF NEW.status = 'voided' THEN
      IF current_setting('app.allow_void', true) <> 'on' THEN
        RAISE EXCEPTION 'cannot void posted % % outside controlled void path', v_entity, OLD.id
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    -- Allow transitioning posted -> paid (invoices) via sub-ledger update
    IF v_entity = 'invoice' AND NEW.status = 'paid' THEN
      RETURN NEW;
    END IF;
    -- Allow transitioning posted -> applied (credit_memos) via sub-ledger update
    IF v_entity = 'credit_memo' AND NEW.status = 'applied' THEN
      RETURN NEW;
    END IF;
    -- Disallow any other column change on a posted row (except the remaining_amount
    -- / unapplied_amount tracking fields which are sub-ledger, not GL)
    IF v_entity = 'invoice' THEN
      IF (NEW.status, NEW.invoice_number, NEW.customer_id, NEW.issue_date, NEW.due_date,
          NEW.subtotal, NEW.tax_total, NEW.total, NEW.ar_account_id,
          NEW.posted_journal_entry_id, NEW.business_id)
         IS DISTINCT FROM
         (OLD.status, OLD.invoice_number, OLD.customer_id, OLD.issue_date, OLD.due_date,
          OLD.subtotal, OLD.tax_total, OLD.total, OLD.ar_account_id,
          OLD.posted_journal_entry_id, OLD.business_id) THEN
        RAISE EXCEPTION 'cannot mutate posted invoice %', OLD.id USING ERRCODE = '23514';
      END IF;
    ELSIF v_entity = 'payment' THEN
      IF (NEW.status, NEW.amount, NEW.customer_id, NEW.payment_date, NEW.cash_account_id,
          NEW.posted_journal_entry_id, NEW.business_id)
         IS DISTINCT FROM
         (OLD.status, OLD.amount, OLD.customer_id, OLD.payment_date, OLD.cash_account_id,
          OLD.posted_journal_entry_id, OLD.business_id) THEN
        RAISE EXCEPTION 'cannot mutate posted payment %', OLD.id USING ERRCODE = '23514';
      END IF;
    ELSIF v_entity = 'credit_memo' THEN
      IF (NEW.status, NEW.amount, NEW.customer_id, NEW.memo_date, NEW.ar_account_id,
          NEW.revenue_account_id, NEW.posted_journal_entry_id, NEW.business_id)
         IS DISTINCT FROM
         (OLD.status, OLD.amount, OLD.customer_id, OLD.memo_date, OLD.ar_account_id,
          OLD.revenue_account_id, OLD.posted_journal_entry_id, OLD.business_id) THEN
        RAISE EXCEPTION 'cannot mutate posted credit_memo %', OLD.id USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoices_protect_posted
  BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION ar_protect_posted('invoice');

CREATE TRIGGER trg_payments_protect_posted
  BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION ar_protect_posted('payment');

CREATE TRIGGER trg_credit_memos_protect_posted
  BEFORE UPDATE OR DELETE ON credit_memos
  FOR EACH ROW EXECUTE FUNCTION ar_protect_posted('credit_memo');

-- =====================================================================
-- Extend journal_entries source sanity trigger (replaces 0008's version)
-- Now that invoice/payment/credit_memo tables exist, validate polymorphic FKs.
-- =====================================================================
CREATE OR REPLACE FUNCTION je_check_source()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.source_type = 'reversal' THEN
    IF NEW.source_id IS NULL OR NOT EXISTS (SELECT 1 FROM journal_entries WHERE id = NEW.source_id) THEN
      RAISE EXCEPTION 'reversal entry must reference an existing journal_entries row'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.reversed_entry_id IS NULL OR NEW.reversed_entry_id <> NEW.source_id THEN
      RAISE EXCEPTION 'reversal entry: reversed_entry_id must equal source_id'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.source_type = 'invoice' THEN
    IF NEW.source_id IS NULL OR NOT EXISTS (SELECT 1 FROM invoices WHERE id = NEW.source_id) THEN
      RAISE EXCEPTION 'invoice-sourced JE must reference invoices(id) in source_id'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.source_type = 'payment' THEN
    IF NEW.source_id IS NULL OR NOT EXISTS (SELECT 1 FROM payments WHERE id = NEW.source_id) THEN
      RAISE EXCEPTION 'payment-sourced JE must reference payments(id) in source_id'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.source_type = 'credit_memo' THEN
    IF NEW.source_id IS NULL OR NOT EXISTS (SELECT 1 FROM credit_memos WHERE id = NEW.source_id) THEN
      RAISE EXCEPTION 'credit_memo-sourced JE must reference credit_memos(id) in source_id'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.source_type = 'manual' AND NEW.source_id IS NOT NULL THEN
    RAISE EXCEPTION 'manual entry must not have source_id' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 2: Apply, verify triggers exist, commit**

```bash
npm run db:migrate
psql "$DATABASE_URL" -c "SELECT tgrelid::regclass, tgname FROM pg_trigger WHERE tgname LIKE '%protect_posted' ORDER BY tgname;"
git add db/migrations/0015_ar_triggers.sql
git commit -m "feat(db): AR immutability triggers + JE source sanity for AR types"
```

---

## Phase B — Type augmentation + shared registries (Tasks 7–10)

### Task 7: Augment DB type with AR tables

**Files:**
- Modify: `apps/api/src/db/types.ts`

- [ ] **Step 1: Append new table types**

Add BEFORE the `DB` interface:

```ts
export type InvoiceStatus = 'draft' | 'posted' | 'voided' | 'paid';
export type PaymentStatus = 'draft' | 'posted' | 'voided';
export type PaymentMethod = 'cash' | 'check' | 'ach' | 'wire' | 'card' | 'other';
export type CreditMemoStatus = 'draft' | 'posted' | 'voided' | 'applied';

export interface CustomersTable {
  id: Generated<string>;
  business_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  billing_address: unknown | null;
  default_terms_days: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface TaxCodesTable {
  id: Generated<string>;
  business_id: string;
  code: string;
  name: string;
  tax_payable_account_id: string;
  is_active: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface TaxRatesTable {
  id: Generated<string>;
  tax_code_id: string;
  rate: ColumnType<string, string | number, string | number>;
  effective_from: ColumnType<string, string, string>;
  effective_to: ColumnType<string, string, string> | null;
  created_at: Generated<Timestamp>;
}

export interface InvoicesTable {
  id: Generated<string>;
  business_id: string;
  customer_id: string;
  invoice_number: string;
  issue_date: ColumnType<string, string, string>;
  due_date: ColumnType<string, string, string>;
  status: Generated<InvoiceStatus>;
  subtotal: ColumnType<string, string | number | undefined, string | number>;
  tax_total: ColumnType<string, string | number | undefined, string | number>;
  total: ColumnType<string, string | number | undefined, string | number>;
  ar_account_id: string;
  posted_journal_entry_id: string | null;
  memo: string | null;
  terms: string | null;
  posted_at: Timestamp | null;
  posted_by_user_id: string | null;
  voided_at: Timestamp | null;
  voided_by_user_id: string | null;
  created_at: Generated<Timestamp>;
  created_by_user_id: string | null;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface InvoiceLinesTable {
  id: Generated<string>;
  invoice_id: string;
  line_number: number;
  description: string;
  quantity: ColumnType<string, string | number, string | number>;
  unit_price: ColumnType<string, string | number, string | number>;
  revenue_account_id: string;
  tax_code_id: string | null;
  line_subtotal: ColumnType<string, string | number, string | number>;
  tax_amount: ColumnType<string, string | number | undefined, string | number>;
  line_total: ColumnType<string, string | number, string | number>;
}

export interface PaymentsTable {
  id: Generated<string>;
  business_id: string;
  customer_id: string;
  payment_date: ColumnType<string, string, string>;
  payment_method: PaymentMethod;
  reference: string | null;
  amount: ColumnType<string, string | number, string | number>;
  unapplied_amount: ColumnType<string, string | number, string | number>;
  cash_account_id: string;
  status: Generated<PaymentStatus>;
  posted_journal_entry_id: string | null;
  memo: string | null;
  posted_at: Timestamp | null;
  posted_by_user_id: string | null;
  voided_at: Timestamp | null;
  voided_by_user_id: string | null;
  created_at: Generated<Timestamp>;
  created_by_user_id: string | null;
  updated_at: Generated<Timestamp>;
}

export interface PaymentApplicationsTable {
  id: Generated<string>;
  payment_id: string | null;
  credit_memo_id: string | null;
  invoice_id: string;
  applied_amount: ColumnType<string, string | number, string | number>;
  applied_at: Generated<Timestamp>;
  applied_by_user_id: string | null;
}

export interface CreditMemosTable {
  id: Generated<string>;
  business_id: string;
  customer_id: string;
  memo_date: ColumnType<string, string, string>;
  status: Generated<CreditMemoStatus>;
  amount: ColumnType<string, string | number, string | number>;
  remaining_amount: ColumnType<string, string | number, string | number>;
  source_payment_id: string | null;
  ar_account_id: string;
  revenue_account_id: string;
  posted_journal_entry_id: string | null;
  memo: string | null;
  posted_at: Timestamp | null;
  posted_by_user_id: string | null;
  voided_at: Timestamp | null;
  voided_by_user_id: string | null;
  created_at: Generated<Timestamp>;
  created_by_user_id: string | null;
  updated_at: Generated<Timestamp>;
}
```

Update `DB` interface:

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
  customers: CustomersTable;
  tax_codes: TaxCodesTable;
  tax_rates: TaxRatesTable;
  invoices: InvoicesTable;
  invoice_lines: InvoiceLinesTable;
  payments: PaymentsTable;
  payment_applications: PaymentApplicationsTable;
  credit_memos: CreditMemosTable;
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm -w @accounting/api run typecheck
git add apps/api/src/db/types.ts
git commit -m "feat(api): augment DB type with AR tables"
```

### Task 8: Extend audit actions + add AR error classes

**Files:**
- Modify: `packages/shared/src/auditActions.ts`
- Create: `apps/api/src/lib/arErrors.ts`

- [ ] **Step 1: Append to `AUDIT` const**

```ts
  // Customers
  CUSTOMER_CREATE: 'customer.create',
  CUSTOMER_UPDATE: 'customer.update',
  CUSTOMER_DELETE: 'customer.delete',

  // Tax codes
  TAX_CODE_CREATE: 'tax_code.create',
  TAX_CODE_UPDATE: 'tax_code.update',
  TAX_RATE_ADD: 'tax_rate.add',

  // Invoices
  INVOICE_CREATE: 'invoice.create',
  INVOICE_UPDATE: 'invoice.update',
  INVOICE_ADD_LINE: 'invoice.add_line',
  INVOICE_REMOVE_LINE: 'invoice.remove_line',
  INVOICE_POST: 'invoice.post',
  INVOICE_VOID: 'invoice.void',

  // Payments
  PAYMENT_CREATE: 'payment.create',
  PAYMENT_UPDATE: 'payment.update',
  PAYMENT_POST: 'payment.post',
  PAYMENT_VOID: 'payment.void',
  PAYMENT_APPLY: 'payment.apply',
  PAYMENT_UNAPPLY: 'payment.unapply',

  // Credit memos
  CREDIT_MEMO_CREATE: 'credit_memo.create',
  CREDIT_MEMO_UPDATE: 'credit_memo.update',
  CREDIT_MEMO_POST: 'credit_memo.post',
  CREDIT_MEMO_VOID: 'credit_memo.void',
  CREDIT_MEMO_APPLY: 'credit_memo.apply',
  CREDIT_MEMO_UNAPPLY: 'credit_memo.unapply',
```

- [ ] **Step 2: Write `apps/api/src/lib/arErrors.ts`**

```ts
import { ERR } from '@accounting/shared';
import { BusinessRuleError } from './errors.js';

export class OverApplicationError extends BusinessRuleError {
  constructor(kind: 'payment' | 'invoice' | 'credit_memo', id: string, attempted: string, available: string) {
    super(ERR.OVERAPPLICATION,
      `Cannot apply ${attempted}: ${kind} ${id} has only ${available} available`,
      { kind, id, attempted, available });
    this.name = 'OverApplicationError';
  }
}

export class InvoiceHasApplicationsError extends BusinessRuleError {
  constructor(invoice_id: string, application_count: number) {
    super(ERR.PRECONDITION_FAILED,
      `Invoice ${invoice_id} has ${application_count} applied payment(s); unapply before voiding`,
      { invoice_id, application_count });
    this.name = 'InvoiceHasApplicationsError';
  }
}

export class PaymentHasApplicationsError extends BusinessRuleError {
  constructor(payment_id: string, application_count: number) {
    super(ERR.PRECONDITION_FAILED,
      `Payment ${payment_id} has ${application_count} active application(s); unapply before voiding`,
      { payment_id, application_count });
    this.name = 'PaymentHasApplicationsError';
  }
}
```

- [ ] **Step 3: Build shared, commit**

```bash
npm -w @accounting/shared run build
git add packages/shared/src/auditActions.ts apps/api/src/lib/arErrors.ts
git commit -m "feat(shared,api): AR audit actions + AR error classes"
```

### Task 9: AR zod schemas

**Files:**
- Create: `packages/shared/src/schemas/customer.ts`, `taxCode.ts`, `invoice.ts`, `payment.ts`, `creditMemo.ts`, `aging.ts`
- Modify: `packages/shared/src/schemas/index.ts`

- [ ] **Step 1: Write `packages/shared/src/schemas/customer.ts`**

```ts
import { z } from 'zod';

export const customerCreateSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  billing_address: z.object({
    line1: z.string().max(200).optional(),
    line2: z.string().max(200).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(50).optional(),
    postal_code: z.string().max(20).optional(),
    country: z.string().max(80).optional(),
  }).nullable().optional(),
  default_terms_days: z.number().int().min(0).max(365).optional(),
});
export type CustomerCreate = z.infer<typeof customerCreateSchema>;

export const customerUpdateSchema = customerCreateSchema.partial();
export type CustomerUpdate = z.infer<typeof customerUpdateSchema>;
```

- [ ] **Step 2: Write `packages/shared/src/schemas/taxCode.ts`**

```ts
import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const taxCodeCreateSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(120),
  tax_payable_account_id: z.string().uuid(),
  initial_rate: z.object({
    rate: z.number().min(0).max(1),
    effective_from: dateString,
    effective_to: dateString.nullable().optional(),
  }),
});
export type TaxCodeCreate = z.infer<typeof taxCodeCreateSchema>;

export const taxRateAddSchema = z.object({
  rate: z.number().min(0).max(1),
  effective_from: dateString,
  effective_to: dateString.nullable().optional(),
});
```

- [ ] **Step 3: Write `packages/shared/src/schemas/invoice.ts`**

```ts
import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.string().regex(/^\d+(\.\d{1,4})?$/, 'must be non-negative decimal, up to 4dp');

export const invoiceLineInputSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: money,
  unit_price: money,
  revenue_account_id: z.string().uuid(),
  tax_code_id: z.string().uuid().nullable().optional(),
});
export type InvoiceLineInput = z.infer<typeof invoiceLineInputSchema>;

export const invoiceDraftCreateSchema = z.object({
  customer_id: z.string().uuid(),
  invoice_number: z.string().min(1).max(60),
  issue_date: dateString,
  due_date: dateString,
  memo: z.string().max(1000).nullable().optional(),
  terms: z.string().max(200).nullable().optional(),
  lines: z.array(invoiceLineInputSchema).min(1),
});
export type InvoiceDraftCreate = z.infer<typeof invoiceDraftCreateSchema>;

export const invoiceVoidSchema = z.object({
  void_reason: z.string().min(1).max(500),
});
```

- [ ] **Step 4: Write `packages/shared/src/schemas/payment.ts`**

```ts
import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.string().regex(/^\d+(\.\d{1,4})?$/);
const paymentMethodEnum = z.enum(['cash', 'check', 'ach', 'wire', 'card', 'other']);

export const paymentDraftCreateSchema = z.object({
  customer_id: z.string().uuid(),
  payment_date: dateString,
  payment_method: paymentMethodEnum,
  reference: z.string().max(200).nullable().optional(),
  amount: money,
  cash_account_id: z.string().uuid(),
  memo: z.string().max(500).nullable().optional(),
  initial_applications: z.array(z.object({
    invoice_id: z.string().uuid(),
    applied_amount: money,
  })).optional(),
});
export type PaymentDraftCreate = z.infer<typeof paymentDraftCreateSchema>;

export const paymentApplicationSchema = z.object({
  invoice_id: z.string().uuid(),
  applied_amount: money,
});

export const paymentVoidSchema = z.object({
  void_reason: z.string().min(1).max(500),
});
```

- [ ] **Step 5: Write `packages/shared/src/schemas/creditMemo.ts`**

```ts
import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.string().regex(/^\d+(\.\d{1,4})?$/);

export const creditMemoCreateSchema = z.object({
  customer_id: z.string().uuid(),
  memo_date: dateString,
  amount: money,
  revenue_account_id: z.string().uuid(),
  memo: z.string().max(1000).nullable().optional(),
});
export type CreditMemoCreate = z.infer<typeof creditMemoCreateSchema>;

export const creditMemoApplySchema = z.object({
  invoice_id: z.string().uuid(),
  applied_amount: money,
});

export const creditMemoVoidSchema = z.object({
  void_reason: z.string().min(1).max(500),
});
```

- [ ] **Step 6: Write `packages/shared/src/schemas/aging.ts`**

```ts
import { z } from 'zod';

export const agingQuerySchema = z.object({
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const agingRowSchema = z.object({
  customer_id: z.string().uuid(),
  customer_name: z.string(),
  current: z.string(),
  over_30: z.string(),
  over_60: z.string(),
  over_90: z.string(),
  total: z.string(),
});
```

- [ ] **Step 7: Update `packages/shared/src/schemas/index.ts`**

```ts
export * from './auth.js';
export * from './coa.js';
export * from './fiscalPeriod.js';
export * from './journalEntry.js';
export * from './trialBalance.js';
export * from './customer.js';
export * from './taxCode.js';
export * from './invoice.js';
export * from './payment.js';
export * from './creditMemo.js';
export * from './aging.js';
```

- [ ] **Step 8: Build and commit**

```bash
npm -w @accounting/shared run build
git add packages/shared/src/schemas/
git commit -m "feat(shared): zod schemas for customers, invoices, payments, credit memos, aging"
```

### Task 10: Extend test factories + truncateAll

**Files:**
- Modify: `apps/api/tests/helpers/factories.ts`, `apps/api/tests/helpers/testDb.ts`

- [ ] **Step 1: Append factories**

```ts
export async function makeCustomer(db: Kysely<DB>, business_id: string, opts: Partial<{ name: string; email: string | null }> = {}) {
  return db.insertInto('customers').values({
    business_id,
    name: opts.name ?? `Customer ${Math.random().toString(36).slice(2, 8)}`,
    email: opts.email ?? null,
  }).returningAll().executeTakeFirstOrThrow();
}

export async function makeTaxCode(
  db: Kysely<DB>, business_id: string, tax_payable_account_id: string,
  opts: Partial<{ code: string; name: string; rate: number }> = {},
) {
  const tc = await db.insertInto('tax_codes').values({
    business_id,
    code: opts.code ?? 'TAX',
    name: opts.name ?? 'Sales Tax',
    tax_payable_account_id,
  }).returningAll().executeTakeFirstOrThrow();
  await db.insertInto('tax_rates').values({
    tax_code_id: tc.id,
    rate: String(opts.rate ?? 0.0875),
    effective_from: '2000-01-01',
  }).execute();
  return tc;
}
```

- [ ] **Step 2: Update `truncateAll` to include AR tables**

```ts
export async function truncateAll(db: Kysely<DB>) {
  await sql`
    TRUNCATE
      payment_applications,
      credit_memos,
      payments,
      invoice_lines,
      invoices,
      tax_rates,
      tax_codes,
      customers,
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
git commit -m "test(api): factories for customers + tax codes; extended truncate"
```

---

## Phase C — Tax + customer services (Tasks 11–12)

### Task 11: Tax code service (TDD)

**Files:**
- Create: `apps/api/src/services/tax/taxCodeService.ts`
- Create: `apps/api/tests/integration/taxCodeService.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/api/tests/integration/taxCodeService.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeAccount } from '../helpers/factories.js';
import * as tax from '../../src/services/tax/taxCodeService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000ddd01', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('taxCodeService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('creates tax code with initial rate', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'firm_admin' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'firm_admin', ...meta };
    const acct = await makeAccount(t.db, biz.id, { code: '2100', name: 'Sales Tax Payable', account_type: 'liability', is_system: true });
    const tc = await t.db.transaction().execute(trx =>
      tax.createTaxCode(trx, ctx, {
        business_id: biz.id, code: 'CA', name: 'CA Sales Tax 8.75%',
        tax_payable_account_id: acct.id,
        initial_rate: { rate: 0.0875, effective_from: '2024-01-01', effective_to: null },
      }),
    );
    expect(tc.code).toBe('CA');
    const rates = await t.db.selectFrom('tax_rates').selectAll().where('tax_code_id', '=', tc.id).execute();
    expect(rates).toHaveLength(1);
    expect(rates[0]!.rate).toBe('0.087500');
  });

  it('getEffectiveRate returns the rate active on the given date', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const acct = await makeAccount(t.db, biz.id, { code: '2100', account_type: 'liability' });
    const tc = await t.db.insertInto('tax_codes').values({ business_id: biz.id, code: 'CA', name: 'CA', tax_payable_account_id: acct.id }).returningAll().executeTakeFirstOrThrow();
    await t.db.insertInto('tax_rates').values([
      { tax_code_id: tc.id, rate: '0.080000', effective_from: '2020-01-01', effective_to: '2023-12-31' },
      { tax_code_id: tc.id, rate: '0.087500', effective_from: '2024-01-01', effective_to: null },
    ]).execute();
    expect(await tax.getEffectiveRate(t.db, tc.id, '2022-06-01')).toBe('0.080000');
    expect(await tax.getEffectiveRate(t.db, tc.id, '2024-06-01')).toBe('0.087500');
  });
});
```

- [ ] **Step 2: Implement `apps/api/src/services/tax/taxCodeService.ts`**

```ts
import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateTaxCodeInput = {
  business_id: string;
  code: string;
  name: string;
  tax_payable_account_id: string;
  initial_rate: { rate: number; effective_from: string; effective_to: string | null };
};

export async function createTaxCode(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateTaxCodeInput) {
  const dup = await trx.selectFrom('tax_codes').select('id')
    .where('business_id', '=', input.business_id).where('code', '=', input.code).executeTakeFirst();
  if (dup) throw new BusinessRuleError(ERR.DUPLICATE_RESOURCE, `Tax code ${input.code} already exists`);

  const acct = await trx.selectFrom('chart_of_accounts').selectAll()
    .where('id', '=', input.tax_payable_account_id).executeTakeFirst();
  if (!acct || acct.business_id !== input.business_id || acct.account_type !== 'liability') {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED, 'tax_payable_account must be a liability account in this business');
  }

  const tc = await trx.insertInto('tax_codes').values({
    business_id: input.business_id,
    code: input.code, name: input.name,
    tax_payable_account_id: input.tax_payable_account_id,
  }).returningAll().executeTakeFirstOrThrow();

  await trx.insertInto('tax_rates').values({
    tax_code_id: tc.id,
    rate: String(input.initial_rate.rate),
    effective_from: input.initial_rate.effective_from,
    effective_to: input.initial_rate.effective_to,
  }).execute();

  await auditRecord(trx, ctx, {
    action: AUDIT.TAX_CODE_CREATE, entity_type: 'tax_code', entity_id: tc.id,
    before: null, after: tc,
  });
  return tc;
}

export async function getEffectiveRate(db: Kysely<DB>, tax_code_id: string, as_of: string): Promise<string> {
  const row = await db.selectFrom('tax_rates').selectAll()
    .where('tax_code_id', '=', tax_code_id)
    .where('effective_from', '<=', as_of)
    .where(eb => eb.or([eb('effective_to', 'is', null), eb('effective_to', '>=', as_of)]))
    .orderBy('effective_from', 'desc')
    .executeTakeFirst();
  if (!row) throw new BusinessRuleError(ERR.NOT_FOUND, `No tax rate for code ${tax_code_id} on ${as_of}`);
  return row.rate;
}

export async function listTaxCodes(db: Kysely<DB>, business_id: string) {
  const codes = await db.selectFrom('tax_codes').selectAll()
    .where('business_id', '=', business_id)
    .orderBy('code').execute();
  // Attach current rate
  const out = await Promise.all(codes.map(async c => {
    const rate = await db.selectFrom('tax_rates').select('rate')
      .where('tax_code_id', '=', c.id)
      .where('effective_from', '<=', new Date().toISOString().slice(0, 10))
      .orderBy('effective_from', 'desc').executeTakeFirst();
    return { ...c, current_rate: rate?.rate ?? null };
  }));
  return out;
}
```

- [ ] **Step 3: Run, commit**

```bash
npm -w @accounting/api run test:integration -- taxCodeService
git add apps/api/src/services/tax/ apps/api/tests/integration/taxCodeService.test.ts
git commit -m "feat(api): tax code service"
```

### Task 12: Customer service (TDD)

**Files:**
- Create: `apps/api/src/services/ar/customerService.ts`
- Create: `apps/api/tests/integration/customerService.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/api/tests/integration/customerService.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser } from '../helpers/factories.js';
import * as cust from '../../src/services/ar/customerService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000cdd02', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('customerService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  async function setup() {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    return { firm, biz, ctx };
  }

  it('creates and lists customers, scoped to business', async () => {
    const { biz, ctx } = await setup();
    const c = await t.db.transaction().execute(trx =>
      cust.createCustomer(trx, ctx, { business_id: biz.id, name: 'Acme', email: 'acme@x.com' }),
    );
    expect(c.name).toBe('Acme');
    const list = await cust.listCustomers(t.db, biz.id);
    expect(list).toHaveLength(1);
  });

  it('rejects duplicate name', async () => {
    const { biz, ctx } = await setup();
    await t.db.transaction().execute(trx => cust.createCustomer(trx, ctx, { business_id: biz.id, name: 'Acme' }));
    await expect(
      t.db.transaction().execute(trx => cust.createCustomer(trx, ctx, { business_id: biz.id, name: 'Acme' })),
    ).rejects.toMatchObject({ code: ERR.DUPLICATE_RESOURCE });
  });

  it('soft-deletes a customer; list excludes by default', async () => {
    const { biz, ctx } = await setup();
    const c = await t.db.transaction().execute(trx => cust.createCustomer(trx, ctx, { business_id: biz.id, name: 'Acme' }));
    await t.db.transaction().execute(trx => cust.deleteCustomer(trx, ctx, { customer_id: c.id }));
    const list = await cust.listCustomers(t.db, biz.id);
    expect(list).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Implement `apps/api/src/services/ar/customerService.ts`**

```ts
import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateCustomerInput = {
  business_id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  billing_address?: unknown;
  default_terms_days?: number;
};

export async function createCustomer(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateCustomerInput) {
  const dup = await trx.selectFrom('customers').select('id')
    .where('business_id', '=', input.business_id).where('name', '=', input.name).where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (dup) throw new BusinessRuleError(ERR.DUPLICATE_RESOURCE, `Customer "${input.name}" already exists`);

  const row = await trx.insertInto('customers').values({
    business_id: input.business_id,
    name: input.name,
    email: input.email ?? null,
    phone: input.phone ?? null,
    billing_address: input.billing_address === undefined ? null : (input.billing_address ?? null),
    default_terms_days: input.default_terms_days,
  }).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, { action: AUDIT.CUSTOMER_CREATE, entity_type: 'customer', entity_id: row.id, before: null, after: row });
  return row;
}

export async function updateCustomer(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { customer_id: string; patch: Partial<CreateCustomerInput> },
) {
  const before = await trx.selectFrom('customers').selectAll().where('id', '=', input.customer_id).executeTakeFirst();
  if (!before || before.deleted_at) throw new NotFoundError('customer', input.customer_id);

  const updated = await trx.updateTable('customers').set({
    ...(input.patch.name !== undefined ? { name: input.patch.name } : {}),
    ...(input.patch.email !== undefined ? { email: input.patch.email ?? null } : {}),
    ...(input.patch.phone !== undefined ? { phone: input.patch.phone ?? null } : {}),
    ...(input.patch.billing_address !== undefined ? { billing_address: input.patch.billing_address ?? null } : {}),
    ...(input.patch.default_terms_days !== undefined ? { default_terms_days: input.patch.default_terms_days } : {}),
  }).where('id', '=', input.customer_id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, { action: AUDIT.CUSTOMER_UPDATE, entity_type: 'customer', entity_id: input.customer_id, before, after: updated });
  return updated;
}

export async function deleteCustomer(trx: Transaction<DB>, ctx: ServiceCtx, input: { customer_id: string }) {
  const before = await trx.selectFrom('customers').selectAll().where('id', '=', input.customer_id).executeTakeFirst();
  if (!before || before.deleted_at) throw new NotFoundError('customer', input.customer_id);

  // refuse if there are non-voided invoices/payments/credit_memos for this customer
  const liveInvoices = await trx.selectFrom('invoices').select('id')
    .where('customer_id', '=', input.customer_id).where('status', 'in', ['draft', 'posted', 'paid'])
    .where('deleted_at', 'is', null).execute();
  if (liveInvoices.length > 0) {
    throw new BusinessRuleError(ERR.PRECONDITION_FAILED,
      `Customer has ${liveInvoices.length} active invoice(s); void or delete them first`,
      { live_invoice_ids: liveInvoices.map(i => i.id) });
  }

  await trx.updateTable('customers').set({ deleted_at: sql`now()` }).where('id', '=', input.customer_id).execute();
  await auditRecord(trx, ctx, { action: AUDIT.CUSTOMER_DELETE, entity_type: 'customer', entity_id: input.customer_id, before, after: null });
}

export async function listCustomers(db: Kysely<DB>, business_id: string) {
  return db.selectFrom('customers').selectAll()
    .where('business_id', '=', business_id).where('deleted_at', 'is', null)
    .orderBy('name').execute();
}

export async function getCustomer(db: Kysely<DB>, business_id: string, customer_id: string) {
  const c = await db.selectFrom('customers').selectAll()
    .where('id', '=', customer_id).where('business_id', '=', business_id).where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!c) throw new NotFoundError('customer', customer_id);
  return c;
}
```

- [ ] **Step 3: Run + commit**

```bash
npm -w @accounting/api run test:integration -- customerService
git add apps/api/src/services/ar/customerService.ts apps/api/tests/integration/customerService.test.ts
git commit -m "feat(api): customer service with TDD"
```

---

## Phase D — Invoice service (Tasks 13–14)

This phase implements the **Post invoice** rule from the spec verbatim:

```
DR  ar_account_id              total
CR  revenue_account_id         line_subtotal  (one CR line per distinct revenue account)
CR  tax_payable_account_id     tax_amount     (one CR line per distinct tax code)
```

### Task 13: Invoice service — createDraft / addLine / update / void (TDD)

**Files:**
- Create: `apps/api/src/services/ar/invoiceService.ts`
- Create: `apps/api/tests/integration/invoiceService.test.ts`

- [ ] **Step 1: Write failing tests for the entire invoice lifecycle**

```ts
// apps/api/tests/integration/invoiceService.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeAccount, makeCustomer, makeTaxCode, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000ddd03', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
  await seedYearPeriods(t.db, biz.id, 2026);
  await seedCoa(t.db, biz.id);
  const ar = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '1100').executeTakeFirstOrThrow();
  const taxAcct = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '2100').executeTakeFirstOrThrow();
  const revenue = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '4010').executeTakeFirstOrThrow();
  const customer = await makeCustomer(t.db, biz.id, { name: 'Acme' });
  const taxCode = await makeTaxCode(t.db, biz.id, taxAcct.id, { code: 'CA', rate: 0.0875 });
  return { firm, biz, user, ctx, ar, revenue, taxAcct, customer, taxCode };
}

describe('invoiceService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('createDraft creates an invoice with computed totals', async () => {
    const { biz, ctx, customer, revenue, taxCode } = await setup(t);
    const inv = await t.db.transaction().execute(trx =>
      invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id,
        invoice_number: 'INV-001', issue_date: '2026-04-15', due_date: '2026-05-15',
        memo: 'Test', terms: null,
        lines: [
          { description: 'Widget', quantity: '2', unit_price: '50.0000', revenue_account_id: revenue.id, tax_code_id: taxCode.id },
          { description: 'Gadget', quantity: '1', unit_price: '20.0000', revenue_account_id: revenue.id, tax_code_id: null },
        ],
      }),
    );
    expect(inv.invoice.subtotal).toBe('120.0000');
    // 100 * 0.0875 = 8.75 (only first line is taxed)
    expect(inv.invoice.tax_total).toBe('8.7500');
    expect(inv.invoice.total).toBe('128.7500');
    expect(inv.lines).toHaveLength(2);
  });

  it('postInvoice generates JE: DR AR / CR Revenue / CR Tax Payable', async () => {
    const { biz, ctx, customer, revenue, taxCode, ar, taxAcct } = await setup(t);
    const draft = await t.db.transaction().execute(trx =>
      invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id,
        invoice_number: 'INV-002', issue_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'Widget', quantity: '1', unit_price: '100.0000', revenue_account_id: revenue.id, tax_code_id: taxCode.id }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id }));
    expect(posted.status).toBe('posted');
    expect(posted.posted_journal_entry_id).toBeTruthy();

    const je = await t.db.selectFrom('journal_entries').selectAll().where('id', '=', posted.posted_journal_entry_id!).executeTakeFirstOrThrow();
    expect(je.source_type).toBe('invoice');
    expect(je.source_id).toBe(draft.invoice.id);
    expect(je.status).toBe('posted');

    const lines = await t.db.selectFrom('journal_entry_lines').selectAll()
      .where('journal_entry_id', '=', je.id).orderBy('line_number').execute();
    const arLine = lines.find(l => l.account_id === ar.id)!;
    expect(arLine.debit).toBe('108.7500');
    expect(arLine.credit).toBe('0.0000');
    const revLine = lines.find(l => l.account_id === revenue.id)!;
    expect(revLine.debit).toBe('0.0000');
    expect(revLine.credit).toBe('100.0000');
    const taxLine = lines.find(l => l.account_id === taxAcct.id)!;
    expect(taxLine.credit).toBe('8.7500');

    // audit row
    const audit = await t.db.selectFrom('audit_logs').selectAll().where('action', '=', 'invoice.post').execute();
    expect(audit).toHaveLength(1);
  });

  it('postInvoice rejects empty invoice', async () => {
    const { biz, ctx, customer, revenue } = await setup(t);
    const draft = await t.db.transaction().execute(trx =>
      invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id,
        invoice_number: 'INV-003', issue_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'X', quantity: '1', unit_price: '10', revenue_account_id: revenue.id, tax_code_id: null }],
      }),
    );
    // Remove the line
    await t.db.deleteFrom('invoice_lines').where('invoice_id', '=', draft.invoice.id).execute();
    await expect(
      t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id })),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
  });

  it('postInvoice rejects already-posted invoice', async () => {
    const { biz, ctx, customer, revenue } = await setup(t);
    const draft = await t.db.transaction().execute(trx =>
      invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id,
        invoice_number: 'INV-004', issue_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'X', quantity: '1', unit_price: '10', revenue_account_id: revenue.id, tax_code_id: null }],
      }),
    );
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id }));
    await expect(
      t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id })),
    ).rejects.toMatchObject({ code: ERR.INVALID_STATE_TRANSITION });
  });

  it('voidInvoice creates reversing JE and flips invoice to voided', async () => {
    const { biz, ctx, customer, revenue } = await setup(t);
    const draft = await t.db.transaction().execute(trx =>
      invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id,
        invoice_number: 'INV-005', issue_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'X', quantity: '1', unit_price: '50.0000', revenue_account_id: revenue.id, tax_code_id: null }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id }));
    await t.db.transaction().execute(trx => invoiceSvc.voidInvoice(trx, ctx, { invoice_id: posted.id, void_reason: 'data entry error' }));
    const after = await t.db.selectFrom('invoices').selectAll().where('id', '=', posted.id).executeTakeFirstOrThrow();
    expect(after.status).toBe('voided');
    // there should now be a reversal JE
    const jes = await t.db.selectFrom('journal_entries').selectAll()
      .where('source_id', '=', posted.posted_journal_entry_id!).execute();
    const reversal = jes.find(j => j.source_type === 'reversal');
    expect(reversal).toBeTruthy();
  });
});
```

- [ ] **Step 2: Implement `apps/api/src/services/ar/invoiceService.ts`**

```ts
import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, ERR, addMoney, mulMoney, toMoneyString } from '@accounting/shared';
import type { DB, JournalEntrySourceType } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { InvalidStateTransitionError, PreconditionError } from '../../lib/ledgerErrors.js';
import { InvoiceHasApplicationsError } from '../../lib/arErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { postJournalEntry, voidJournalEntry } from '../core/ledgerService.js';
import { getEffectiveRate } from '../tax/taxCodeService.js';
import { getSystemAccount } from '../core/chartOfAccountsService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type InvoiceLineInput = {
  description: string;
  quantity: string;
  unit_price: string;
  revenue_account_id: string;
  tax_code_id: string | null;
};

export type CreateDraftInput = {
  business_id: string;
  customer_id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  memo: string | null;
  terms: string | null;
  lines: InvoiceLineInput[];
};

async function computeLine(
  db: Kysely<DB> | Transaction<DB>, line: InvoiceLineInput, issue_date: string,
) {
  const subtotal = toMoneyString(mulMoney(line.quantity, line.unit_price));
  let taxAmount = '0.0000';
  if (line.tax_code_id) {
    const rate = await getEffectiveRate(db as Kysely<DB>, line.tax_code_id, issue_date);
    taxAmount = toMoneyString(mulMoney(subtotal, rate));
  }
  const total = toMoneyString(addMoney(subtotal, taxAmount));
  return { subtotal, taxAmount, total };
}

export async function createDraft(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateDraftInput) {
  if (input.lines.length === 0) throw new PreconditionError('Invoice must have at least one line');

  const dup = await trx.selectFrom('invoices').select('id')
    .where('business_id', '=', input.business_id).where('invoice_number', '=', input.invoice_number)
    .executeTakeFirst();
  if (dup) throw new BusinessRuleError(ERR.DUPLICATE_RESOURCE, `Invoice ${input.invoice_number} already exists`);

  const arAccount = await getSystemAccount(trx as unknown as Kysely<DB>, input.business_id, '1100');

  let subtotalSum = '0.0000';
  let taxSum = '0.0000';
  const computed: Array<{ line: InvoiceLineInput; subtotal: string; taxAmount: string; total: string }> = [];
  for (const l of input.lines) {
    const c = await computeLine(trx, l, input.issue_date);
    computed.push({ line: l, ...c });
    subtotalSum = toMoneyString(addMoney(subtotalSum, c.subtotal));
    taxSum = toMoneyString(addMoney(taxSum, c.taxAmount));
  }
  const total = toMoneyString(addMoney(subtotalSum, taxSum));

  const inv = await trx.insertInto('invoices').values({
    business_id: input.business_id,
    customer_id: input.customer_id,
    invoice_number: input.invoice_number,
    issue_date: input.issue_date,
    due_date: input.due_date,
    subtotal: subtotalSum,
    tax_total: taxSum,
    total: total,
    ar_account_id: arAccount.id,
    memo: input.memo,
    terms: input.terms,
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  let n = 1;
  const lineRows: any[] = [];
  for (const c of computed) {
    const row = await trx.insertInto('invoice_lines').values({
      invoice_id: inv.id, line_number: n++,
      description: c.line.description,
      quantity: c.line.quantity,
      unit_price: c.line.unit_price,
      revenue_account_id: c.line.revenue_account_id,
      tax_code_id: c.line.tax_code_id,
      line_subtotal: c.subtotal,
      tax_amount: c.taxAmount,
      line_total: c.total,
    }).returningAll().executeTakeFirstOrThrow();
    lineRows.push(row);
  }

  await auditRecord(trx, ctx, { action: AUDIT.INVOICE_CREATE, entity_type: 'invoice', entity_id: inv.id, before: null, after: inv });
  return { invoice: inv, lines: lineRows };
}

export async function postInvoice(trx: Transaction<DB>, ctx: ServiceCtx, input: { invoice_id: string }) {
  const inv = await trx.selectFrom('invoices').selectAll().where('id', '=', input.invoice_id).executeTakeFirst();
  if (!inv) throw new NotFoundError('invoice', input.invoice_id);
  if (inv.status !== 'draft') throw new InvalidStateTransitionError('invoice', inv.id, inv.status, 'posted');

  const lines = await trx.selectFrom('invoice_lines').selectAll().where('invoice_id', '=', inv.id).orderBy('line_number').execute();
  if (lines.length === 0) throw new PreconditionError('Cannot post invoice with no lines');

  // Build JE lines: DR AR for total, CR revenue per distinct revenue_account_id, CR tax per distinct tax payable account.
  const jeLines: { account_id: string; debit: string; credit: string; memo: string | null }[] = [];
  jeLines.push({ account_id: inv.ar_account_id, debit: inv.total, credit: '0.0000', memo: `Invoice ${inv.invoice_number}` });

  // Aggregate revenue lines by revenue_account_id (sum line_subtotal)
  const revenueByAccount = new Map<string, string>();
  for (const l of lines) {
    const cur = revenueByAccount.get(l.revenue_account_id) ?? '0.0000';
    revenueByAccount.set(l.revenue_account_id, toMoneyString(addMoney(cur, l.line_subtotal)));
  }
  for (const [account_id, amount] of revenueByAccount) {
    if (parseFloat(amount) > 0) jeLines.push({ account_id, debit: '0.0000', credit: amount, memo: null });
  }

  // Aggregate tax lines by tax_code's payable account
  const taxByPayableAccount = new Map<string, string>();
  for (const l of lines) {
    if (!l.tax_code_id || parseFloat(l.tax_amount) === 0) continue;
    const tc = await trx.selectFrom('tax_codes').select('tax_payable_account_id').where('id', '=', l.tax_code_id).executeTakeFirstOrThrow();
    const cur = taxByPayableAccount.get(tc.tax_payable_account_id) ?? '0.0000';
    taxByPayableAccount.set(tc.tax_payable_account_id, toMoneyString(addMoney(cur, l.tax_amount)));
  }
  for (const [account_id, amount] of taxByPayableAccount) {
    if (parseFloat(amount) > 0) jeLines.push({ account_id, debit: '0.0000', credit: amount, memo: null });
  }

  if (jeLines.length < 2) throw new PreconditionError('Invoice JE would be invalid (single-line)');

  const je = await postJournalEntry(trx, ctx, {
    business_id: inv.business_id,
    entry_date: inv.issue_date,
    source_type: 'invoice' as JournalEntrySourceType,
    source_id: inv.id,
    memo: `Invoice ${inv.invoice_number}`,
    reference: inv.invoice_number,
    lines: jeLines,
  });

  const updated = await trx.updateTable('invoices')
    .set({ status: 'posted', posted_journal_entry_id: je.id, posted_at: sql`now()`, posted_by_user_id: ctx.user_id })
    .where('id', '=', inv.id)
    .returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, { action: AUDIT.INVOICE_POST, entity_type: 'invoice', entity_id: inv.id, before: inv, after: updated });
  return updated;
}

export async function voidInvoice(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { invoice_id: string; void_reason: string },
) {
  const inv = await trx.selectFrom('invoices').selectAll().where('id', '=', input.invoice_id).executeTakeFirst();
  if (!inv) throw new NotFoundError('invoice', input.invoice_id);
  if (inv.status !== 'posted' && inv.status !== 'paid') throw new InvalidStateTransitionError('invoice', inv.id, inv.status, 'voided');

  // Refuse if any payment_applications target this invoice with a posted/draft (live) source
  const apps = await trx.selectFrom('payment_applications as pa')
    .leftJoin('payments as p', 'p.id', 'pa.payment_id')
    .leftJoin('credit_memos as cm', 'cm.id', 'pa.credit_memo_id')
    .select(['pa.id'])
    .where('pa.invoice_id', '=', inv.id)
    .where(eb => eb.or([
      eb('p.status', 'in', ['draft', 'posted']),
      eb('cm.status', 'in', ['draft', 'posted', 'applied']),
    ]))
    .execute();
  if (apps.length > 0) throw new InvoiceHasApplicationsError(inv.id, apps.length);

  if (!inv.posted_journal_entry_id) throw new PreconditionError('Invoice has no posted JE to reverse');
  await voidJournalEntry(trx, ctx, { journal_entry_id: inv.posted_journal_entry_id, void_reason: `Void invoice ${inv.invoice_number}: ${input.void_reason}` });

  // Now flip invoice status (allow_void was set inside voidJournalEntry's wrapper if needed; we set it explicitly here)
  await sql`SELECT set_config('app.allow_void', 'on', true)`.execute(trx);
  const updated = await trx.updateTable('invoices')
    .set({ status: 'voided', voided_at: sql`now()`, voided_by_user_id: ctx.user_id })
    .where('id', '=', inv.id)
    .returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, { action: AUDIT.INVOICE_VOID, entity_type: 'invoice', entity_id: inv.id, before: inv, after: updated });
  return updated;
}

export async function getInvoiceWithLines(db: Kysely<DB>, business_id: string, invoice_id: string) {
  const inv = await db.selectFrom('invoices').selectAll()
    .where('id', '=', invoice_id).where('business_id', '=', business_id)
    .executeTakeFirst();
  if (!inv) throw new NotFoundError('invoice', invoice_id);
  const lines = await db.selectFrom('invoice_lines').selectAll()
    .where('invoice_id', '=', invoice_id).orderBy('line_number').execute();

  // Compute amount_due
  const apps = await db.selectFrom('payment_applications as pa')
    .leftJoin('payments as p', 'p.id', 'pa.payment_id')
    .leftJoin('credit_memos as cm', 'cm.id', 'pa.credit_memo_id')
    .select(({ fn }) => fn.coalesce(fn.sum<string>('pa.applied_amount'), sql.lit('0')).as('applied'))
    .where('pa.invoice_id', '=', invoice_id)
    .where(eb => eb.or([
      eb('p.status', '=', 'posted'),
      eb('cm.status', 'in', ['posted', 'applied']),
    ]))
    .executeTakeFirst();
  const applied = apps?.applied ?? '0';
  const amount_due = toMoneyString(addMoney(inv.total, '0').minus(applied));
  return { invoice: inv, lines, amount_due };
}

export async function listInvoices(db: Kysely<DB>, q: { business_id: string; status?: string; customer_id?: string; limit?: number; offset?: number }) {
  let qb = db.selectFrom('invoices').selectAll().where('business_id', '=', q.business_id).where('deleted_at', 'is', null);
  if (q.status) qb = qb.where('status', '=', q.status as any);
  if (q.customer_id) qb = qb.where('customer_id', '=', q.customer_id);
  return qb.orderBy('issue_date', 'desc').limit(q.limit ?? 50).offset(q.offset ?? 0).execute();
}
```

- [ ] **Step 3: Run + commit**

```bash
npm -w @accounting/api run test:integration -- invoiceService
git add apps/api/src/services/ar/invoiceService.ts apps/api/tests/integration/invoiceService.test.ts
git commit -m "feat(api): invoice service with createDraft/post/void via ledger"
```

### Task 14: Invoice update + addLine/removeLine helpers (TDD)

**Files:**
- Modify: `apps/api/src/services/ar/invoiceService.ts` (add `addLine`, `removeLine`, `updateDraft`)

- [ ] **Step 1: Add tests for line manipulation while in draft**

Append to `apps/api/tests/integration/invoiceService.test.ts`:

```ts
  it('addLine and removeLine work on drafts; refused on posted', async () => {
    const { biz, ctx, customer, revenue, taxCode } = await setup(t);
    const draft = await t.db.transaction().execute(trx =>
      invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id,
        invoice_number: 'INV-006', issue_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'A', quantity: '1', unit_price: '10', revenue_account_id: revenue.id, tax_code_id: null }],
      }),
    );
    const after = await t.db.transaction().execute(trx =>
      invoiceSvc.addLine(trx, ctx, { invoice_id: draft.invoice.id,
        line: { description: 'B', quantity: '2', unit_price: '5', revenue_account_id: revenue.id, tax_code_id: taxCode.id } }),
    );
    expect(after.lines).toHaveLength(2);
    expect(after.invoice.subtotal).toBe('20.0000');
    void taxCode;

    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id }));
    await expect(
      t.db.transaction().execute(trx =>
        invoiceSvc.addLine(trx, ctx, { invoice_id: draft.invoice.id,
          line: { description: 'C', quantity: '1', unit_price: '1', revenue_account_id: revenue.id, tax_code_id: null } }),
      ),
    ).rejects.toMatchObject({ code: ERR.INVALID_STATE_TRANSITION });
  });
```

- [ ] **Step 2: Append to `apps/api/src/services/ar/invoiceService.ts`**

```ts
async function recomputeInvoiceTotals(trx: Transaction<DB>, invoice_id: string) {
  const inv = await trx.selectFrom('invoices').selectAll().where('id', '=', invoice_id).executeTakeFirstOrThrow();
  const lines = await trx.selectFrom('invoice_lines').selectAll().where('invoice_id', '=', invoice_id).execute();
  let sub = '0.0000', tax = '0.0000';
  for (const l of lines) { sub = toMoneyString(addMoney(sub, l.line_subtotal)); tax = toMoneyString(addMoney(tax, l.tax_amount)); }
  const total = toMoneyString(addMoney(sub, tax));
  await trx.updateTable('invoices').set({ subtotal: sub, tax_total: tax, total }).where('id', '=', invoice_id).execute();
  void inv;
}

export async function addLine(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { invoice_id: string; line: InvoiceLineInput },
) {
  const inv = await trx.selectFrom('invoices').selectAll().where('id', '=', input.invoice_id).executeTakeFirst();
  if (!inv) throw new NotFoundError('invoice', input.invoice_id);
  if (inv.status !== 'draft') throw new InvalidStateTransitionError('invoice', inv.id, inv.status, 'mutate');

  const c = await computeLine(trx as unknown as Kysely<DB>, input.line, inv.issue_date);
  const last = await trx.selectFrom('invoice_lines').select(({ fn }) => fn.max<number>('line_number').as('mx'))
    .where('invoice_id', '=', input.invoice_id).executeTakeFirst();
  const next = (last?.mx ?? 0) + 1;
  await trx.insertInto('invoice_lines').values({
    invoice_id: input.invoice_id, line_number: next,
    description: input.line.description, quantity: input.line.quantity, unit_price: input.line.unit_price,
    revenue_account_id: input.line.revenue_account_id, tax_code_id: input.line.tax_code_id,
    line_subtotal: c.subtotal, tax_amount: c.taxAmount, line_total: c.total,
  }).execute();
  await recomputeInvoiceTotals(trx, input.invoice_id);

  await auditRecord(trx, ctx, { action: AUDIT.INVOICE_ADD_LINE, entity_type: 'invoice', entity_id: input.invoice_id, before: null, after: input.line });
  return getInvoiceWithLines(trx as unknown as Kysely<DB>, inv.business_id, input.invoice_id);
}

export async function removeLine(
  trx: Transaction<DB>, ctx: ServiceCtx, input: { invoice_id: string; line_id: string },
) {
  const inv = await trx.selectFrom('invoices').selectAll().where('id', '=', input.invoice_id).executeTakeFirst();
  if (!inv) throw new NotFoundError('invoice', input.invoice_id);
  if (inv.status !== 'draft') throw new InvalidStateTransitionError('invoice', inv.id, inv.status, 'mutate');

  await trx.deleteFrom('invoice_lines').where('id', '=', input.line_id).where('invoice_id', '=', input.invoice_id).execute();
  await recomputeInvoiceTotals(trx, input.invoice_id);

  await auditRecord(trx, ctx, { action: AUDIT.INVOICE_REMOVE_LINE, entity_type: 'invoice', entity_id: input.invoice_id, before: { line_id: input.line_id }, after: null });
  return getInvoiceWithLines(trx as unknown as Kysely<DB>, inv.business_id, input.invoice_id);
}
```

- [ ] **Step 3: Run + commit**

```bash
npm -w @accounting/api run test:integration -- invoiceService
git add apps/api/src/services/ar/invoiceService.ts apps/api/tests/integration/invoiceService.test.ts
git commit -m "feat(api): invoice addLine/removeLine with totals recompute"
```

---

## Phase E — Payment + credit memo services (Tasks 15–17)

### Task 15: Payment service (TDD)

**Files:**
- Create: `apps/api/src/services/ar/paymentService.ts`
- Create: `apps/api/tests/integration/paymentService.test.ts`

- [ ] **Step 1: Write failing tests covering the spec's payment + applications behavior**

```ts
// apps/api/tests/integration/paymentService.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, makeTaxCode, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import * as paymentSvc from '../../src/services/ar/paymentService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000ddd04', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
  await seedYearPeriods(t.db, biz.id, 2026);
  await seedCoa(t.db, biz.id);
  const cash = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '1020').executeTakeFirstOrThrow();
  const ar = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '1100').executeTakeFirstOrThrow();
  const revenue = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '4010').executeTakeFirstOrThrow();
  const customer = await makeCustomer(t.db, biz.id, { name: 'Acme' });
  return { firm, biz, ctx, cash, ar, revenue, customer };
}

async function postSimpleInvoice(t: TestDb, ctx: ServiceCtx, biz_id: string, customer_id: string, revenue_id: string, num: string, amount: string) {
  const draft = await t.db.transaction().execute(trx =>
    invoiceSvc.createDraft(trx, ctx, {
      business_id: biz_id, customer_id,
      invoice_number: num, issue_date: '2026-04-15', due_date: '2026-05-15',
      memo: null, terms: null,
      lines: [{ description: 'Item', quantity: '1', unit_price: amount, revenue_account_id: revenue_id, tax_code_id: null }],
    }),
  );
  return t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id }));
}

describe('paymentService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('postPayment generates JE: DR Cash / CR AR', async () => {
    const { biz, ctx, customer, cash, ar, revenue } = await setup(t);
    const inv = await postSimpleInvoice(t, ctx, biz.id, customer.id, revenue.id, 'INV-100', '100.0000');
    const draftPayment = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, payment_date: '2026-04-20',
        payment_method: 'check', reference: 'check-1234', amount: '100.0000',
        cash_account_id: cash.id, memo: null,
        initial_applications: [{ invoice_id: inv.id, applied_amount: '100.0000' }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: draftPayment.payment.id }));
    expect(posted.status).toBe('posted');
    const lines = await t.db.selectFrom('journal_entry_lines').selectAll().where('journal_entry_id', '=', posted.posted_journal_entry_id!).execute();
    const cashLine = lines.find(l => l.account_id === cash.id)!;
    expect(cashLine.debit).toBe('100.0000');
    const arLine = lines.find(l => l.account_id === ar.id)!;
    expect(arLine.credit).toBe('100.0000');
    // invoice should now be 'paid'
    const invAfter = await t.db.selectFrom('invoices').selectAll().where('id', '=', inv.id).executeTakeFirstOrThrow();
    expect(invAfter.status).toBe('paid');
  });

  it('partial payment leaves invoice posted (not paid) and unapplied_amount=0', async () => {
    const { biz, ctx, customer, cash, revenue } = await setup(t);
    const inv = await postSimpleInvoice(t, ctx, biz.id, customer.id, revenue.id, 'INV-101', '100.0000');
    const dr = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, payment_date: '2026-04-20',
        payment_method: 'cash', reference: null, amount: '40.0000', cash_account_id: cash.id, memo: null,
        initial_applications: [{ invoice_id: inv.id, applied_amount: '40.0000' }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: dr.payment.id }));
    expect(posted.unapplied_amount).toBe('0.0000');
    const invAfter = await t.db.selectFrom('invoices').selectAll().where('id', '=', inv.id).executeTakeFirstOrThrow();
    expect(invAfter.status).toBe('posted');
  });

  it('overpayment leaves payment with unapplied_amount > 0', async () => {
    const { biz, ctx, customer, cash, revenue } = await setup(t);
    const inv = await postSimpleInvoice(t, ctx, biz.id, customer.id, revenue.id, 'INV-102', '100.0000');
    const dr = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, payment_date: '2026-04-20',
        payment_method: 'wire', reference: null, amount: '150.0000', cash_account_id: cash.id, memo: null,
        initial_applications: [{ invoice_id: inv.id, applied_amount: '100.0000' }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: dr.payment.id }));
    expect(posted.unapplied_amount).toBe('50.0000');
  });

  it('addApplication after posting decrements unapplied_amount and may flip invoice to paid', async () => {
    const { biz, ctx, customer, cash, revenue } = await setup(t);
    const inv = await postSimpleInvoice(t, ctx, biz.id, customer.id, revenue.id, 'INV-103', '100.0000');
    const dr = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, payment_date: '2026-04-20',
        payment_method: 'wire', reference: null, amount: '100.0000', cash_account_id: cash.id, memo: null,
      }),
    );
    const posted = await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: dr.payment.id }));
    expect(posted.unapplied_amount).toBe('100.0000');
    await t.db.transaction().execute(trx =>
      paymentSvc.addApplication(trx, ctx, { payment_id: posted.id, invoice_id: inv.id, applied_amount: '100.0000' }),
    );
    const after = await t.db.selectFrom('payments').selectAll().where('id', '=', posted.id).executeTakeFirstOrThrow();
    expect(after.unapplied_amount).toBe('0.0000');
    const invAfter = await t.db.selectFrom('invoices').selectAll().where('id', '=', inv.id).executeTakeFirstOrThrow();
    expect(invAfter.status).toBe('paid');
  });

  it('over-application is rejected with OVERAPPLICATION', async () => {
    const { biz, ctx, customer, cash, revenue } = await setup(t);
    const inv = await postSimpleInvoice(t, ctx, biz.id, customer.id, revenue.id, 'INV-104', '50.0000');
    const dr = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, payment_date: '2026-04-20',
        payment_method: 'cash', reference: null, amount: '100.0000', cash_account_id: cash.id, memo: null,
      }),
    );
    const posted = await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: dr.payment.id }));
    await expect(
      t.db.transaction().execute(trx =>
        paymentSvc.addApplication(trx, ctx, { payment_id: posted.id, invoice_id: inv.id, applied_amount: '60.0000' }),
      ),
    ).rejects.toMatchObject({ code: ERR.OVERAPPLICATION });
  });

  it('voidPayment is refused while applications exist', async () => {
    const { biz, ctx, customer, cash, revenue } = await setup(t);
    const inv = await postSimpleInvoice(t, ctx, biz.id, customer.id, revenue.id, 'INV-105', '50.0000');
    const dr = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, payment_date: '2026-04-20',
        payment_method: 'cash', reference: null, amount: '50.0000', cash_account_id: cash.id, memo: null,
        initial_applications: [{ invoice_id: inv.id, applied_amount: '50.0000' }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: dr.payment.id }));
    await expect(
      t.db.transaction().execute(trx => paymentSvc.voidPayment(trx, ctx, { payment_id: posted.id, void_reason: 'oops' })),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
  });
});
```

- [ ] **Step 2: Implement `apps/api/src/services/ar/paymentService.ts`**

```ts
import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, ERR, addMoney, subMoney, toMoneyString, equalMoney } from '@accounting/shared';
import type { DB, PaymentMethod } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { InvalidStateTransitionError, PreconditionError } from '../../lib/ledgerErrors.js';
import { OverApplicationError, PaymentHasApplicationsError } from '../../lib/arErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { postJournalEntry, voidJournalEntry } from '../core/ledgerService.js';
import { getSystemAccount } from '../core/chartOfAccountsService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateDraftPaymentInput = {
  business_id: string;
  customer_id: string;
  payment_date: string;
  payment_method: PaymentMethod;
  reference: string | null;
  amount: string;
  cash_account_id: string;
  memo: string | null;
  initial_applications?: Array<{ invoice_id: string; applied_amount: string }>;
};

export async function createDraft(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateDraftPaymentInput) {
  if (parseFloat(input.amount) <= 0) throw new PreconditionError('Payment amount must be > 0');

  const customer = await trx.selectFrom('customers').selectAll().where('id', '=', input.customer_id).where('deleted_at', 'is', null).executeTakeFirst();
  if (!customer || customer.business_id !== input.business_id) throw new NotFoundError('customer', input.customer_id);

  const cash = await trx.selectFrom('chart_of_accounts').selectAll().where('id', '=', input.cash_account_id).executeTakeFirst();
  if (!cash || cash.business_id !== input.business_id || cash.account_type !== 'asset') {
    throw new PreconditionError('cash_account must be an asset account in this business');
  }

  const initialAppliedTotal = (input.initial_applications ?? []).reduce((s, a) => addMoney(s, a.applied_amount), '0');
  if (parseFloat(toMoneyString(initialAppliedTotal)) > parseFloat(input.amount)) {
    throw new OverApplicationError('payment', '(draft)', toMoneyString(initialAppliedTotal), input.amount);
  }

  const payment = await trx.insertInto('payments').values({
    business_id: input.business_id,
    customer_id: input.customer_id,
    payment_date: input.payment_date,
    payment_method: input.payment_method,
    reference: input.reference,
    amount: input.amount,
    unapplied_amount: input.amount,
    cash_account_id: input.cash_account_id,
    memo: input.memo,
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  for (const a of input.initial_applications ?? []) {
    await applyToInvoiceInternal(trx, ctx, { payment_id: payment.id, invoice_id: a.invoice_id, applied_amount: a.applied_amount, audit: false });
  }

  await auditRecord(trx, ctx, { action: AUDIT.PAYMENT_CREATE, entity_type: 'payment', entity_id: payment.id, before: null, after: payment });
  return { payment };
}

export async function postPayment(trx: Transaction<DB>, ctx: ServiceCtx, input: { payment_id: string }) {
  const payment = await trx.selectFrom('payments').selectAll().where('id', '=', input.payment_id).executeTakeFirst();
  if (!payment) throw new NotFoundError('payment', input.payment_id);
  if (payment.status !== 'draft') throw new InvalidStateTransitionError('payment', payment.id, payment.status, 'posted');

  const arAccount = await getSystemAccount(trx as unknown as Kysely<DB>, payment.business_id, '1100');

  const je = await postJournalEntry(trx, ctx, {
    business_id: payment.business_id,
    entry_date: payment.payment_date,
    source_type: 'payment',
    source_id: payment.id,
    memo: `Payment from customer (${payment.payment_method})`,
    reference: payment.reference,
    lines: [
      { account_id: payment.cash_account_id, debit: payment.amount, credit: '0.0000', memo: null },
      { account_id: arAccount.id,            debit: '0.0000',       credit: payment.amount, memo: null },
    ],
  });

  const updated = await trx.updateTable('payments')
    .set({ status: 'posted', posted_journal_entry_id: je.id, posted_at: sql`now()`, posted_by_user_id: ctx.user_id })
    .where('id', '=', payment.id)
    .returningAll().executeTakeFirstOrThrow();

  // Re-evaluate any invoices the payment is already applied to (they may flip to 'paid' now)
  const apps = await trx.selectFrom('payment_applications').select('invoice_id').where('payment_id', '=', payment.id).execute();
  for (const a of apps) await maybeMarkInvoicePaid(trx, ctx, a.invoice_id);

  await auditRecord(trx, ctx, { action: AUDIT.PAYMENT_POST, entity_type: 'payment', entity_id: payment.id, before: payment, after: updated });
  return updated;
}

async function applyToInvoiceInternal(
  trx: Transaction<DB>, ctx: ServiceCtx,
  args: { payment_id: string; invoice_id: string; applied_amount: string; audit: boolean },
) {
  const payment = await trx.selectFrom('payments').selectAll().where('id', '=', args.payment_id).executeTakeFirst();
  if (!payment) throw new NotFoundError('payment', args.payment_id);
  if (payment.status === 'voided') throw new InvalidStateTransitionError('payment', payment.id, 'voided', 'apply');
  if (parseFloat(args.applied_amount) <= 0) throw new PreconditionError('applied_amount must be > 0');
  if (parseFloat(args.applied_amount) > parseFloat(payment.unapplied_amount)) {
    throw new OverApplicationError('payment', payment.id, args.applied_amount, payment.unapplied_amount);
  }

  const invoice = await trx.selectFrom('invoices').selectAll().where('id', '=', args.invoice_id).executeTakeFirst();
  if (!invoice) throw new NotFoundError('invoice', args.invoice_id);
  if (invoice.business_id !== payment.business_id) throw new PreconditionError('payment + invoice must be same business');
  if (invoice.customer_id !== payment.customer_id) throw new PreconditionError('payment + invoice must be same customer');
  if (invoice.status === 'voided') throw new InvalidStateTransitionError('invoice', invoice.id, 'voided', 'apply');

  // amount_due
  const appliedRow = await trx.selectFrom('payment_applications as pa')
    .leftJoin('payments as p', 'p.id', 'pa.payment_id')
    .leftJoin('credit_memos as cm', 'cm.id', 'pa.credit_memo_id')
    .select(({ fn }) => fn.coalesce(fn.sum<string>('pa.applied_amount'), sql.lit('0')).as('applied'))
    .where('pa.invoice_id', '=', args.invoice_id)
    .where(eb => eb.or([eb('p.status', 'in', ['draft','posted']), eb('cm.status', 'in', ['draft','posted','applied'])]))
    .executeTakeFirst();
  const applied = appliedRow?.applied ?? '0';
  const amount_due = toMoneyString(subMoney(invoice.total, applied));
  if (parseFloat(args.applied_amount) > parseFloat(amount_due)) {
    throw new OverApplicationError('invoice', invoice.id, args.applied_amount, amount_due);
  }

  await trx.insertInto('payment_applications').values({
    payment_id: args.payment_id, invoice_id: args.invoice_id,
    applied_amount: args.applied_amount, applied_by_user_id: ctx.user_id,
  }).execute();
  await trx.updateTable('payments')
    .set({ unapplied_amount: toMoneyString(subMoney(payment.unapplied_amount, args.applied_amount)) })
    .where('id', '=', args.payment_id).execute();

  if (payment.status === 'posted') await maybeMarkInvoicePaid(trx, ctx, args.invoice_id);

  if (args.audit) {
    await auditRecord(trx, ctx, {
      action: AUDIT.PAYMENT_APPLY, entity_type: 'payment_application', entity_id: null,
      before: null, after: { payment_id: args.payment_id, invoice_id: args.invoice_id, applied_amount: args.applied_amount },
    });
  }
}

export async function addApplication(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { payment_id: string; invoice_id: string; applied_amount: string },
) {
  await applyToInvoiceInternal(trx, ctx, { ...input, audit: true });
  return trx.selectFrom('payments').selectAll().where('id', '=', input.payment_id).executeTakeFirstOrThrow();
}

export async function removeApplication(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { payment_id: string; application_id: string },
) {
  const payment = await trx.selectFrom('payments').selectAll().where('id', '=', input.payment_id).executeTakeFirst();
  if (!payment) throw new NotFoundError('payment', input.payment_id);
  const app = await trx.selectFrom('payment_applications').selectAll().where('id', '=', input.application_id).executeTakeFirst();
  if (!app || app.payment_id !== input.payment_id) throw new NotFoundError('payment_application', input.application_id);

  await trx.deleteFrom('payment_applications').where('id', '=', app.id).execute();
  await trx.updateTable('payments')
    .set({ unapplied_amount: toMoneyString(addMoney(payment.unapplied_amount, app.applied_amount)) })
    .where('id', '=', payment.id).execute();

  // Possibly un-pay the invoice
  if (app.invoice_id) await maybeUnmarkInvoicePaid(trx, ctx, app.invoice_id);

  await auditRecord(trx, ctx, {
    action: AUDIT.PAYMENT_UNAPPLY, entity_type: 'payment_application', entity_id: app.id,
    before: app, after: null,
  });
}

export async function voidPayment(
  trx: Transaction<DB>, ctx: ServiceCtx, input: { payment_id: string; void_reason: string },
) {
  const payment = await trx.selectFrom('payments').selectAll().where('id', '=', input.payment_id).executeTakeFirst();
  if (!payment) throw new NotFoundError('payment', input.payment_id);
  if (payment.status !== 'posted') throw new InvalidStateTransitionError('payment', payment.id, payment.status, 'voided');

  const apps = await trx.selectFrom('payment_applications').select('id').where('payment_id', '=', payment.id).execute();
  if (apps.length > 0) throw new PaymentHasApplicationsError(payment.id, apps.length);

  if (!payment.posted_journal_entry_id) throw new PreconditionError('Payment has no JE to reverse');
  await voidJournalEntry(trx, ctx, { journal_entry_id: payment.posted_journal_entry_id, void_reason: `Void payment: ${input.void_reason}` });

  await sql`SELECT set_config('app.allow_void', 'on', true)`.execute(trx);
  const updated = await trx.updateTable('payments')
    .set({ status: 'voided', voided_at: sql`now()`, voided_by_user_id: ctx.user_id })
    .where('id', '=', payment.id)
    .returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, { action: AUDIT.PAYMENT_VOID, entity_type: 'payment', entity_id: payment.id, before: payment, after: updated });
  return updated;
}

async function maybeMarkInvoicePaid(trx: Transaction<DB>, _ctx: ServiceCtx, invoice_id: string) {
  const inv = await trx.selectFrom('invoices').selectAll().where('id', '=', invoice_id).executeTakeFirst();
  if (!inv || inv.status !== 'posted') return;
  const r = await trx.selectFrom('payment_applications as pa')
    .leftJoin('payments as p', 'p.id', 'pa.payment_id')
    .leftJoin('credit_memos as cm', 'cm.id', 'pa.credit_memo_id')
    .select(({ fn }) => fn.coalesce(fn.sum<string>('pa.applied_amount'), sql.lit('0')).as('applied'))
    .where('pa.invoice_id', '=', invoice_id)
    .where(eb => eb.or([eb('p.status', '=', 'posted'), eb('cm.status', 'in', ['posted', 'applied'])]))
    .executeTakeFirst();
  if (equalMoney(r?.applied ?? '0', inv.total)) {
    await trx.updateTable('invoices').set({ status: 'paid' }).where('id', '=', invoice_id).execute();
  }
}

async function maybeUnmarkInvoicePaid(trx: Transaction<DB>, _ctx: ServiceCtx, invoice_id: string) {
  const inv = await trx.selectFrom('invoices').selectAll().where('id', '=', invoice_id).executeTakeFirst();
  if (!inv || inv.status !== 'paid') return;
  const r = await trx.selectFrom('payment_applications as pa')
    .leftJoin('payments as p', 'p.id', 'pa.payment_id')
    .leftJoin('credit_memos as cm', 'cm.id', 'pa.credit_memo_id')
    .select(({ fn }) => fn.coalesce(fn.sum<string>('pa.applied_amount'), sql.lit('0')).as('applied'))
    .where('pa.invoice_id', '=', invoice_id)
    .where(eb => eb.or([eb('p.status', '=', 'posted'), eb('cm.status', 'in', ['posted', 'applied'])]))
    .executeTakeFirst();
  if (!equalMoney(r?.applied ?? '0', inv.total)) {
    await trx.updateTable('invoices').set({ status: 'posted' }).where('id', '=', invoice_id).execute();
  }
}

export async function getPaymentWithApplications(db: Kysely<DB>, business_id: string, payment_id: string) {
  const p = await db.selectFrom('payments').selectAll().where('id', '=', payment_id).where('business_id', '=', business_id).executeTakeFirst();
  if (!p) throw new NotFoundError('payment', payment_id);
  const apps = await db.selectFrom('payment_applications as pa')
    .innerJoin('invoices as i', 'i.id', 'pa.invoice_id')
    .select(['pa.id', 'pa.invoice_id', 'i.invoice_number', 'pa.applied_amount', 'pa.applied_at'])
    .where('pa.payment_id', '=', payment_id).execute();
  return { payment: p, applications: apps };
}

export async function listPayments(db: Kysely<DB>, q: { business_id: string; customer_id?: string; status?: string }) {
  let qb = db.selectFrom('payments').selectAll().where('business_id', '=', q.business_id);
  if (q.customer_id) qb = qb.where('customer_id', '=', q.customer_id);
  if (q.status) qb = qb.where('status', '=', q.status as any);
  return qb.orderBy('payment_date', 'desc').execute();
}
```

- [ ] **Step 3: Run + commit**

```bash
npm -w @accounting/api run test:integration -- paymentService
git add apps/api/src/services/ar/paymentService.ts apps/api/tests/integration/paymentService.test.ts
git commit -m "feat(api): payment service with applications + auto-paid invoice flip"
```

### Task 16: Credit memo service (TDD)

**Files:**
- Create: `apps/api/src/services/ar/creditMemoService.ts`
- Create: `apps/api/tests/integration/creditMemoService.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/api/tests/integration/creditMemoService.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import * as cm from '../../src/services/ar/creditMemoService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000ddd05', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
  await seedYearPeriods(t.db, biz.id, 2026);
  await seedCoa(t.db, biz.id);
  const ar = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '1100').executeTakeFirstOrThrow();
  const returns = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '4910').executeTakeFirstOrThrow();
  const revenue = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '4010').executeTakeFirstOrThrow();
  const customer = await makeCustomer(t.db, biz.id, { name: 'Acme' });
  return { firm, biz, ctx, ar, returns, revenue, customer };
}

describe('creditMemoService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('post creates JE: DR Sales Returns / CR AR', async () => {
    const { biz, ctx, customer, returns, ar } = await setup(t);
    const c = await t.db.transaction().execute(trx =>
      cm.createDraft(trx, ctx, { business_id: biz.id, customer_id: customer.id, memo_date: '2026-04-15', amount: '20.0000', revenue_account_id: returns.id, memo: null }),
    );
    const posted = await t.db.transaction().execute(trx => cm.postCreditMemo(trx, ctx, { credit_memo_id: c.id }));
    expect(posted.status).toBe('posted');
    const lines = await t.db.selectFrom('journal_entry_lines').selectAll().where('journal_entry_id', '=', posted.posted_journal_entry_id!).execute();
    const drLine = lines.find(l => l.account_id === returns.id)!;
    expect(drLine.debit).toBe('20.0000');
    const crLine = lines.find(l => l.account_id === ar.id)!;
    expect(crLine.credit).toBe('20.0000');
  });

  it('apply credit memo to invoice reduces remaining_amount, no JE generated', async () => {
    const { biz, ctx, customer, returns, revenue } = await setup(t);
    const draftInv = await t.db.transaction().execute(trx =>
      invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id,
        invoice_number: 'INV-200', issue_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'X', quantity: '1', unit_price: '50.0000', revenue_account_id: revenue.id, tax_code_id: null }],
      }),
    );
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draftInv.invoice.id }));

    const c = await t.db.transaction().execute(trx =>
      cm.createDraft(trx, ctx, { business_id: biz.id, customer_id: customer.id, memo_date: '2026-04-16', amount: '50.0000', revenue_account_id: returns.id, memo: null }),
    );
    const postedCm = await t.db.transaction().execute(trx => cm.postCreditMemo(trx, ctx, { credit_memo_id: c.id }));

    const jeCountBefore = await t.db.selectFrom('journal_entries').select(({ fn }) => fn.count<string>('id').as('n')).executeTakeFirst();
    await t.db.transaction().execute(trx => cm.applyToInvoice(trx, ctx, { credit_memo_id: postedCm.id, invoice_id: draftInv.invoice.id, applied_amount: '50.0000' }));
    const jeCountAfter = await t.db.selectFrom('journal_entries').select(({ fn }) => fn.count<string>('id').as('n')).executeTakeFirst();
    expect(jeCountAfter!.n).toBe(jeCountBefore!.n);  // no new JE

    const after = await t.db.selectFrom('credit_memos').selectAll().where('id', '=', postedCm.id).executeTakeFirstOrThrow();
    expect(after.remaining_amount).toBe('0.0000');
    expect(after.status).toBe('applied');
    const invAfter = await t.db.selectFrom('invoices').selectAll().where('id', '=', draftInv.invoice.id).executeTakeFirstOrThrow();
    expect(invAfter.status).toBe('paid');
  });

  it('over-application is rejected', async () => {
    const { biz, ctx, customer, returns, revenue } = await setup(t);
    const draftInv = await t.db.transaction().execute(trx =>
      invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id,
        invoice_number: 'INV-201', issue_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'X', quantity: '1', unit_price: '50.0000', revenue_account_id: revenue.id, tax_code_id: null }],
      }),
    );
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draftInv.invoice.id }));
    const c = await t.db.transaction().execute(trx =>
      cm.createDraft(trx, ctx, { business_id: biz.id, customer_id: customer.id, memo_date: '2026-04-16', amount: '100.0000', revenue_account_id: returns.id, memo: null }),
    );
    const postedCm = await t.db.transaction().execute(trx => cm.postCreditMemo(trx, ctx, { credit_memo_id: c.id }));
    await expect(
      t.db.transaction().execute(trx => cm.applyToInvoice(trx, ctx, { credit_memo_id: postedCm.id, invoice_id: draftInv.invoice.id, applied_amount: '60.0000' })),
    ).rejects.toMatchObject({ code: ERR.OVERAPPLICATION });
  });
});
```

- [ ] **Step 2: Implement `apps/api/src/services/ar/creditMemoService.ts`**

```ts
import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, addMoney, subMoney, toMoneyString, equalMoney } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { InvalidStateTransitionError, PreconditionError } from '../../lib/ledgerErrors.js';
import { OverApplicationError } from '../../lib/arErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { postJournalEntry, voidJournalEntry } from '../core/ledgerService.js';
import { getSystemAccount } from '../core/chartOfAccountsService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateDraftCreditMemoInput = {
  business_id: string;
  customer_id: string;
  memo_date: string;
  amount: string;
  revenue_account_id: string;
  memo: string | null;
};

export async function createDraft(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateDraftCreditMemoInput) {
  if (parseFloat(input.amount) <= 0) throw new PreconditionError('amount must be > 0');
  const ar = await getSystemAccount(trx as unknown as Kysely<DB>, input.business_id, '1100');
  const row = await trx.insertInto('credit_memos').values({
    business_id: input.business_id, customer_id: input.customer_id,
    memo_date: input.memo_date,
    amount: input.amount, remaining_amount: input.amount,
    revenue_account_id: input.revenue_account_id,
    ar_account_id: ar.id, memo: input.memo,
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, { action: AUDIT.CREDIT_MEMO_CREATE, entity_type: 'credit_memo', entity_id: row.id, before: null, after: row });
  return row;
}

export async function postCreditMemo(trx: Transaction<DB>, ctx: ServiceCtx, input: { credit_memo_id: string }) {
  const cm = await trx.selectFrom('credit_memos').selectAll().where('id', '=', input.credit_memo_id).executeTakeFirst();
  if (!cm) throw new NotFoundError('credit_memo', input.credit_memo_id);
  if (cm.status !== 'draft') throw new InvalidStateTransitionError('credit_memo', cm.id, cm.status, 'posted');

  const je = await postJournalEntry(trx, ctx, {
    business_id: cm.business_id, entry_date: cm.memo_date,
    source_type: 'credit_memo', source_id: cm.id,
    memo: `Credit memo for customer`, reference: null,
    lines: [
      { account_id: cm.revenue_account_id, debit: cm.amount, credit: '0.0000', memo: null },
      { account_id: cm.ar_account_id,      debit: '0.0000', credit: cm.amount, memo: null },
    ],
  });

  const updated = await trx.updateTable('credit_memos')
    .set({ status: 'posted', posted_journal_entry_id: je.id, posted_at: sql`now()`, posted_by_user_id: ctx.user_id })
    .where('id', '=', cm.id).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, { action: AUDIT.CREDIT_MEMO_POST, entity_type: 'credit_memo', entity_id: cm.id, before: cm, after: updated });
  return updated;
}

export async function applyToInvoice(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { credit_memo_id: string; invoice_id: string; applied_amount: string },
) {
  if (parseFloat(input.applied_amount) <= 0) throw new PreconditionError('applied_amount must be > 0');
  const cm = await trx.selectFrom('credit_memos').selectAll().where('id', '=', input.credit_memo_id).executeTakeFirst();
  if (!cm) throw new NotFoundError('credit_memo', input.credit_memo_id);
  if (cm.status !== 'posted' && cm.status !== 'applied') throw new InvalidStateTransitionError('credit_memo', cm.id, cm.status, 'apply');
  if (parseFloat(input.applied_amount) > parseFloat(cm.remaining_amount)) {
    throw new OverApplicationError('credit_memo', cm.id, input.applied_amount, cm.remaining_amount);
  }

  const inv = await trx.selectFrom('invoices').selectAll().where('id', '=', input.invoice_id).executeTakeFirst();
  if (!inv) throw new NotFoundError('invoice', input.invoice_id);
  if (inv.business_id !== cm.business_id) throw new PreconditionError('credit_memo + invoice must be same business');
  if (inv.customer_id !== cm.customer_id) throw new PreconditionError('credit_memo + invoice must be same customer');
  if (inv.status === 'voided') throw new InvalidStateTransitionError('invoice', inv.id, 'voided', 'apply');

  const appliedRow = await trx.selectFrom('payment_applications as pa')
    .leftJoin('payments as p', 'p.id', 'pa.payment_id')
    .leftJoin('credit_memos as c', 'c.id', 'pa.credit_memo_id')
    .select(({ fn }) => fn.coalesce(fn.sum<string>('pa.applied_amount'), sql.lit('0')).as('applied'))
    .where('pa.invoice_id', '=', inv.id)
    .where(eb => eb.or([eb('p.status', '=', 'posted'), eb('c.status', 'in', ['posted','applied'])]))
    .executeTakeFirst();
  const amount_due = toMoneyString(subMoney(inv.total, appliedRow?.applied ?? '0'));
  if (parseFloat(input.applied_amount) > parseFloat(amount_due)) {
    throw new OverApplicationError('invoice', inv.id, input.applied_amount, amount_due);
  }

  await trx.insertInto('payment_applications').values({
    credit_memo_id: cm.id, invoice_id: inv.id,
    applied_amount: input.applied_amount, applied_by_user_id: ctx.user_id,
  }).execute();

  const newRemaining = toMoneyString(subMoney(cm.remaining_amount, input.applied_amount));
  await trx.updateTable('credit_memos')
    .set({ remaining_amount: newRemaining, status: equalMoney(newRemaining, '0') ? 'applied' : cm.status })
    .where('id', '=', cm.id).execute();

  // Possibly mark invoice paid
  const r2 = await trx.selectFrom('payment_applications as pa')
    .leftJoin('payments as p', 'p.id', 'pa.payment_id')
    .leftJoin('credit_memos as c', 'c.id', 'pa.credit_memo_id')
    .select(({ fn }) => fn.coalesce(fn.sum<string>('pa.applied_amount'), sql.lit('0')).as('applied'))
    .where('pa.invoice_id', '=', inv.id)
    .where(eb => eb.or([eb('p.status', '=', 'posted'), eb('c.status', 'in', ['posted','applied'])]))
    .executeTakeFirst();
  if (equalMoney(r2?.applied ?? '0', inv.total) && inv.status === 'posted') {
    await trx.updateTable('invoices').set({ status: 'paid' }).where('id', '=', inv.id).execute();
  }

  await auditRecord(trx, ctx, {
    action: AUDIT.CREDIT_MEMO_APPLY, entity_type: 'payment_application', entity_id: null,
    before: null, after: { credit_memo_id: cm.id, invoice_id: inv.id, applied_amount: input.applied_amount },
  });
}

export async function voidCreditMemo(
  trx: Transaction<DB>, ctx: ServiceCtx, input: { credit_memo_id: string; void_reason: string },
) {
  const cm = await trx.selectFrom('credit_memos').selectAll().where('id', '=', input.credit_memo_id).executeTakeFirst();
  if (!cm) throw new NotFoundError('credit_memo', input.credit_memo_id);
  if (cm.status !== 'posted' && cm.status !== 'applied') throw new InvalidStateTransitionError('credit_memo', cm.id, cm.status, 'voided');

  // Refuse if any active applications exist
  const apps = await trx.selectFrom('payment_applications').select('id').where('credit_memo_id', '=', cm.id).execute();
  if (apps.length > 0) throw new PreconditionError(`Credit memo has ${apps.length} active application(s); unapply before voiding`, { application_ids: apps.map(a => a.id) });

  if (!cm.posted_journal_entry_id) throw new PreconditionError('credit_memo has no JE to reverse');
  await voidJournalEntry(trx, ctx, { journal_entry_id: cm.posted_journal_entry_id, void_reason: `Void credit memo: ${input.void_reason}` });

  await sql`SELECT set_config('app.allow_void', 'on', true)`.execute(trx);
  const updated = await trx.updateTable('credit_memos')
    .set({ status: 'voided', voided_at: sql`now()`, voided_by_user_id: ctx.user_id })
    .where('id', '=', cm.id).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, { action: AUDIT.CREDIT_MEMO_VOID, entity_type: 'credit_memo', entity_id: cm.id, before: cm, after: updated });
  return updated;
}

export async function listCreditMemos(db: Kysely<DB>, q: { business_id: string; customer_id?: string }) {
  let qb = db.selectFrom('credit_memos').selectAll().where('business_id', '=', q.business_id);
  if (q.customer_id) qb = qb.where('customer_id', '=', q.customer_id);
  return qb.orderBy('memo_date', 'desc').execute();
}
```

- [ ] **Step 3: Run + commit**

```bash
npm -w @accounting/api run test:integration -- creditMemoService
git add apps/api/src/services/ar/creditMemoService.ts apps/api/tests/integration/creditMemoService.test.ts
git commit -m "feat(api): credit memo service with post/apply/void"
```

### Task 17: AR adversarial trigger tests + AR roundtrip integration test

**Files:**
- Create: `apps/api/tests/integration/arTriggers.test.ts`
- Create: `apps/api/tests/integration/arRoundtrip.test.ts`

- [ ] **Step 1: Write `apps/api/tests/integration/arTriggers.test.ts`**

```ts
// Adversarial: try direct UPDATE/DELETE on posted invoices/payments/credit_memos
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import * as paymentSvc from '../../src/services/ar/paymentService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000aaa17', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('AR DB triggers (adversarial)', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('cannot UPDATE memo on a posted invoice', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const customer = await makeCustomer(t.db, biz.id);
    const revenue = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '4010').executeTakeFirstOrThrow();
    const draft = await t.db.transaction().execute(trx =>
      invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id,
        invoice_number: 'INV-T1', issue_date: '2026-04-15', due_date: '2026-05-15',
        memo: 'orig', terms: null,
        lines: [{ description: 'X', quantity: '1', unit_price: '10', revenue_account_id: revenue.id, tax_code_id: null }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id }));
    await expect(
      t.db.updateTable('invoices').set({ subtotal: '999.0000' }).where('id', '=', posted.id).execute(),
    ).rejects.toThrow(/cannot mutate posted invoice/);
  });

  it('cannot DELETE a posted payment', async () => {
    // Create a real posted payment via the service so the CHECK constraint
    // (status='posted' requires posted_journal_entry_id) is satisfied.
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const customer = await makeCustomer(t.db, biz.id);
    const cash = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '1020').executeTakeFirstOrThrow();
    const draft = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, payment_date: '2026-04-15',
        payment_method: 'cash', reference: null, amount: '10.0000',
        cash_account_id: cash.id, memo: null,
      }),
    );
    const posted = await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: draft.payment.id }));
    await expect(
      t.db.deleteFrom('payments').where('id', '=', posted.id).execute(),
    ).rejects.toThrow(/cannot delete posted payment/);
  });
});
```

- [ ] **Step 2: Write `apps/api/tests/integration/arRoundtrip.test.ts`**

```ts
// Full AR roundtrip: invoice -> payment -> apply -> verify trial balance balances and customer balance is zero
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import * as paymentSvc from '../../src/services/ar/paymentService.js';
import * as ledger from '../../src/services/core/ledgerService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000000017', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('AR roundtrip', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('invoice + payment + apply produces balanced trial balance and zero customer balance', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const cash = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '1020').executeTakeFirstOrThrow();
    const revenue = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '4010').executeTakeFirstOrThrow();
    const customer = await makeCustomer(t.db, biz.id);

    const draft = await t.db.transaction().execute(trx =>
      invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id,
        invoice_number: 'RT-1', issue_date: '2026-06-01', due_date: '2026-06-30',
        memo: null, terms: null,
        lines: [{ description: 'Service', quantity: '1', unit_price: '500.0000', revenue_account_id: revenue.id, tax_code_id: null }],
      }),
    );
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id }));

    const dr = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, payment_date: '2026-06-15',
        payment_method: 'check', reference: 'check-9000', amount: '500.0000',
        cash_account_id: cash.id, memo: null,
        initial_applications: [{ invoice_id: draft.invoice.id, applied_amount: '500.0000' }],
      }),
    );
    await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: dr.payment.id }));

    const tb = await ledger.computeTrialBalance(t.db, { business_id: biz.id, as_of: '2026-12-31' });
    expect(tb.totals.total_debit).toBe(tb.totals.total_credit);

    // AR account net should be zero
    const arRow = tb.rows.find(r => r.code === '1100')!;
    expect(parseFloat(arRow.net)).toBe(0);

    // Cash should be 500 debit, Revenue 500 credit
    const cashRow = tb.rows.find(r => r.code === '1020')!;
    expect(cashRow.net).toBe('500.0000');
    const revRow = tb.rows.find(r => r.code === '4010')!;
    expect(revRow.net).toBe('-500.0000');
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
npm -w @accounting/api run test:integration -- arTriggers
npm -w @accounting/api run test:integration -- arRoundtrip
git add apps/api/tests/integration/arTriggers.test.ts apps/api/tests/integration/arRoundtrip.test.ts
git commit -m "test(api): AR adversarial triggers + full roundtrip integration"
```

---

## Phase F — Aging report + all AR routes (Tasks 18–22)

### Task 18: Aging report service (TDD)

**Files:**
- Create: `apps/api/src/services/ar/reports/agingReportService.ts`
- Create: `apps/api/tests/integration/agingReport.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/api/tests/integration/agingReport.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import * as aging from '../../src/services/ar/reports/agingReportService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000000a18', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('aging report', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('buckets invoices by days overdue from due_date', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const revenue = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '4010').executeTakeFirstOrThrow();
    const customer = await makeCustomer(t.db, biz.id, { name: 'AcmeAged' });

    // current (due in future)
    const i1 = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, invoice_number: 'A-1',
      issue_date: '2026-04-01', due_date: '2026-05-01', memo: null, terms: null,
      lines: [{ description: 'X', quantity: '1', unit_price: '100', revenue_account_id: revenue.id, tax_code_id: null }],
    }));
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: i1.invoice.id }));

    // 30-bucket: due 20 days before as_of
    const i2 = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, invoice_number: 'A-2',
      issue_date: '2026-03-01', due_date: '2026-04-01', memo: null, terms: null,
      lines: [{ description: 'X', quantity: '1', unit_price: '50', revenue_account_id: revenue.id, tax_code_id: null }],
    }));
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: i2.invoice.id }));

    // 60-bucket: due 45 days before as_of (as_of=2026-04-20, due=2026-03-06 -> 45 days)
    const i3 = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, invoice_number: 'A-3',
      issue_date: '2026-02-01', due_date: '2026-03-06', memo: null, terms: null,
      lines: [{ description: 'X', quantity: '1', unit_price: '20', revenue_account_id: revenue.id, tax_code_id: null }],
    }));
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: i3.invoice.id }));

    const r = await aging.customerAging(t.db, { business_id: biz.id, as_of: '2026-04-20' });
    const row = r.find(x => x.customer_name === 'AcmeAged')!;
    expect(row.current).toBe('100.0000');
    expect(row.over_30).toBe('50.0000');
    expect(row.over_60).toBe('20.0000');
    expect(row.total).toBe('170.0000');
  });
});
```

- [ ] **Step 2: Implement `apps/api/src/services/ar/reports/agingReportService.ts`**

```ts
import { Kysely, sql } from 'kysely';
import { addMoney, subMoney, toMoneyString } from '@accounting/shared';
import type { DB } from '../../../db/types.js';

export type AgingRow = {
  customer_id: string;
  customer_name: string;
  current: string;
  over_30: string;
  over_60: string;
  over_90: string;
  total: string;
};

// Reads open invoices (status posted, not paid) and applications, returns per-customer buckets.
export async function customerAging(db: Kysely<DB>, q: { business_id: string; as_of: string }): Promise<AgingRow[]> {
  const invoices = await db.selectFrom('invoices as i')
    .innerJoin('customers as c', 'c.id', 'i.customer_id')
    .select(['i.id', 'i.customer_id', 'c.name as customer_name', 'i.due_date', 'i.total'])
    .where('i.business_id', '=', q.business_id)
    .where('i.status', 'in', ['posted', 'paid'])
    .where('i.deleted_at', 'is', null)
    .execute();

  // Build applied lookup
  const appliedMap = new Map<string, string>();
  const apps = await db.selectFrom('payment_applications as pa')
    .leftJoin('payments as p', 'p.id', 'pa.payment_id')
    .leftJoin('credit_memos as cm', 'cm.id', 'pa.credit_memo_id')
    .select(['pa.invoice_id', 'pa.applied_amount'])
    .where('pa.invoice_id', 'in', invoices.map(i => i.id).length > 0 ? invoices.map(i => i.id) : ['00000000-0000-0000-0000-000000000000'])
    .where(eb => eb.or([eb('p.status', '=', 'posted'), eb('cm.status', 'in', ['posted','applied'])]))
    .execute();
  for (const a of apps) {
    const cur = appliedMap.get(a.invoice_id) ?? '0';
    appliedMap.set(a.invoice_id, toMoneyString(addMoney(cur, a.applied_amount)));
  }

  const asOf = new Date(q.as_of + 'T00:00:00Z').getTime();
  const oneDay = 24 * 3600 * 1000;
  const buckets = new Map<string, AgingRow>();

  for (const inv of invoices) {
    const due = new Date(inv.due_date + 'T00:00:00Z').getTime();
    const daysOverdue = Math.floor((asOf - due) / oneDay);
    const open = toMoneyString(subMoney(inv.total, appliedMap.get(inv.id) ?? '0'));
    if (parseFloat(open) <= 0) continue;
    let row = buckets.get(inv.customer_id);
    if (!row) {
      row = { customer_id: inv.customer_id, customer_name: inv.customer_name, current: '0.0000', over_30: '0.0000', over_60: '0.0000', over_90: '0.0000', total: '0.0000' };
      buckets.set(inv.customer_id, row);
    }
    if (daysOverdue <= 0) row.current = toMoneyString(addMoney(row.current, open));
    else if (daysOverdue <= 30) row.over_30 = toMoneyString(addMoney(row.over_30, open));
    else if (daysOverdue <= 60) row.over_60 = toMoneyString(addMoney(row.over_60, open));
    else row.over_90 = toMoneyString(addMoney(row.over_90, open));
    row.total = toMoneyString(addMoney(row.total, open));
  }

  return [...buckets.values()].sort((a, b) => a.customer_name.localeCompare(b.customer_name));
}
```

- [ ] **Step 3: Run + commit**

```bash
npm -w @accounting/api run test:integration -- agingReport
git add apps/api/src/services/ar/reports/ apps/api/tests/integration/agingReport.test.ts
git commit -m "feat(api): AR aging report service with bucket math tests"
```

### Task 19: Customer + tax code routes

**Files:**
- Create: `apps/api/src/routes/customers.ts`, `apps/api/src/routes/taxCodes.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write `apps/api/src/routes/customers.ts`**

```ts
import { Router } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as cust from '../services/ar/customerService.js';
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

router.get('/businesses/:businessId/customers', async (req, res, next) => {
  try { res.json({ customers: await cust.listCustomers(db, req.tenancy!.business_id) }); }
  catch (e) { next(e); }
});

router.get('/businesses/:businessId/customers/:id', async (req, res, next) => {
  try { res.json(await cust.getCustomer(db, req.tenancy!.business_id, req.params['id']!)); }
  catch (e) { next(e); }
});

router.post('/businesses/:businessId/customers', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.customerCreateSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      cust.createCustomer(trx, ctxFromReq(req), { business_id: req.tenancy!.business_id, ...body }),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/customers/:id', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const patch = schemas.customerUpdateSchema.parse(req.body);
    const updated = await db.transaction().execute(trx =>
      cust.updateCustomer(trx, ctxFromReq(req), { customer_id: req.params['id']!, patch }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete('/businesses/:businessId/customers/:id', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    await db.transaction().execute(trx => cust.deleteCustomer(trx, ctxFromReq(req), { customer_id: req.params['id']! }));
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
```

- [ ] **Step 2: Write `apps/api/src/routes/taxCodes.ts`**

```ts
import { Router } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as tax from '../services/tax/taxCodeService.js';
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

router.get('/businesses/:businessId/tax-codes', async (req, res, next) => {
  try { res.json({ tax_codes: await tax.listTaxCodes(db, req.tenancy!.business_id) }); }
  catch (e) { next(e); }
});

router.post('/businesses/:businessId/tax-codes', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    const body = schemas.taxCodeCreateSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      tax.createTaxCode(trx, ctxFromReq(req), { business_id: req.tenancy!.business_id, ...body }),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

export default router;
```

- [ ] **Step 3: Wire in `apps/api/src/app.ts`**

Add: `import customerRoutes from './routes/customers.js';`, `import taxCodeRoutes from './routes/taxCodes.js';`, `app.use(customerRoutes); app.use(taxCodeRoutes);`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/customers.ts apps/api/src/routes/taxCodes.ts apps/api/src/app.ts
git commit -m "feat(api): customer + tax code routes"
```

### Task 20: Invoice + payment + credit memo routes

**Files:**
- Create: `apps/api/src/routes/invoices.ts`, `payments.ts`, `creditMemos.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write `apps/api/src/routes/invoices.ts`**

```ts
import { Router } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as inv from '../services/ar/invoiceService.js';
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

router.get('/businesses/:businessId/invoices', async (req, res, next) => {
  try {
    const list = await inv.listInvoices(db, {
      business_id: req.tenancy!.business_id,
      status: req.query['status'] as string | undefined,
      customer_id: req.query['customer_id'] as string | undefined,
    });
    res.json({ invoices: list });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/invoices/:id', async (req, res, next) => {
  try { res.json(await inv.getInvoiceWithLines(db, req.tenancy!.business_id, req.params['id']!)); }
  catch (e) { next(e); }
});

router.post('/businesses/:businessId/invoices', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.invoiceDraftCreateSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      inv.createDraft(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        customer_id: body.customer_id,
        invoice_number: body.invoice_number,
        issue_date: body.issue_date,
        due_date: body.due_date,
        memo: body.memo ?? null,
        terms: body.terms ?? null,
        lines: body.lines.map(l => ({ ...l, tax_code_id: l.tax_code_id ?? null })),
      }),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/invoices/:id/post', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const posted = await db.transaction().execute(trx => inv.postInvoice(trx, ctxFromReq(req), { invoice_id: req.params['id']! }));
    res.json(posted);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/invoices/:id/void', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.invoiceVoidSchema.parse(req.body);
    const voided = await db.transaction().execute(trx => inv.voidInvoice(trx, ctxFromReq(req), { invoice_id: req.params['id']!, void_reason: body.void_reason }));
    res.json(voided);
  } catch (e) { next(e); }
});

export default router;
```

- [ ] **Step 2: Write `apps/api/src/routes/payments.ts`**

```ts
import { Router } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as pay from '../services/ar/paymentService.js';
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

router.get('/businesses/:businessId/payments', async (req, res, next) => {
  try { res.json({ payments: await pay.listPayments(db, { business_id: req.tenancy!.business_id, customer_id: req.query['customer_id'] as string | undefined, status: req.query['status'] as string | undefined }) }); }
  catch (e) { next(e); }
});

router.get('/businesses/:businessId/payments/:id', async (req, res, next) => {
  try { res.json(await pay.getPaymentWithApplications(db, req.tenancy!.business_id, req.params['id']!)); }
  catch (e) { next(e); }
});

router.post('/businesses/:businessId/payments', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.paymentDraftCreateSchema.parse(req.body);
    const created = await db.transaction().execute(trx => pay.createDraft(trx, ctxFromReq(req), { business_id: req.tenancy!.business_id, ...body, memo: body.memo ?? null, reference: body.reference ?? null }));
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/payments/:id/post', requireMinRole('accountant'), async (req, res, next) => {
  try { res.json(await db.transaction().execute(trx => pay.postPayment(trx, ctxFromReq(req), { payment_id: req.params['id']! }))); }
  catch (e) { next(e); }
});

router.post('/businesses/:businessId/payments/:id/void', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.paymentVoidSchema.parse(req.body);
    res.json(await db.transaction().execute(trx => pay.voidPayment(trx, ctxFromReq(req), { payment_id: req.params['id']!, void_reason: body.void_reason })));
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/payments/:id/applications', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.paymentApplicationSchema.parse(req.body);
    res.json(await db.transaction().execute(trx => pay.addApplication(trx, ctxFromReq(req), { payment_id: req.params['id']!, invoice_id: body.invoice_id, applied_amount: body.applied_amount })));
  } catch (e) { next(e); }
});

router.delete('/businesses/:businessId/payments/:id/applications/:appId', requireMinRole('accountant'), async (req, res, next) => {
  try {
    await db.transaction().execute(trx => pay.removeApplication(trx, ctxFromReq(req), { payment_id: req.params['id']!, application_id: req.params['appId']! }));
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
```

- [ ] **Step 3: Write `apps/api/src/routes/creditMemos.ts`**

```ts
import { Router } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as cm from '../services/ar/creditMemoService.js';
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

router.get('/businesses/:businessId/credit-memos', async (req, res, next) => {
  try { res.json({ credit_memos: await cm.listCreditMemos(db, { business_id: req.tenancy!.business_id, customer_id: req.query['customer_id'] as string | undefined }) }); }
  catch (e) { next(e); }
});

router.post('/businesses/:businessId/credit-memos', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.creditMemoCreateSchema.parse(req.body);
    const created = await db.transaction().execute(trx => cm.createDraft(trx, ctxFromReq(req), { business_id: req.tenancy!.business_id, ...body, memo: body.memo ?? null }));
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/credit-memos/:id/post', requireMinRole('accountant'), async (req, res, next) => {
  try { res.json(await db.transaction().execute(trx => cm.postCreditMemo(trx, ctxFromReq(req), { credit_memo_id: req.params['id']! }))); }
  catch (e) { next(e); }
});

router.post('/businesses/:businessId/credit-memos/:id/apply', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.creditMemoApplySchema.parse(req.body);
    await db.transaction().execute(trx => cm.applyToInvoice(trx, ctxFromReq(req), { credit_memo_id: req.params['id']!, invoice_id: body.invoice_id, applied_amount: body.applied_amount }));
    res.status(204).end();
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/credit-memos/:id/void', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.creditMemoVoidSchema.parse(req.body);
    res.json(await db.transaction().execute(trx => cm.voidCreditMemo(trx, ctxFromReq(req), { credit_memo_id: req.params['id']!, void_reason: body.void_reason })));
  } catch (e) { next(e); }
});

export default router;
```

- [ ] **Step 4: Wire all 3 routers in `apps/api/src/app.ts`**

Add imports for `invoices.ts`, `payments.ts`, `creditMemos.ts`, then `app.use(...)` for each.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/invoices.ts apps/api/src/routes/payments.ts apps/api/src/routes/creditMemos.ts apps/api/src/app.ts
git commit -m "feat(api): invoice + payment + credit memo routes"
```

### Task 21: Aging report route

**Files:**
- Create: `apps/api/src/routes/agingReport.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write**

```ts
// apps/api/src/routes/agingReport.ts
import { Router } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import * as aging from '../services/ar/reports/agingReportService.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolveBusiness);

router.get('/businesses/:businessId/reports/aging', async (req, res, next) => {
  try {
    const q = schemas.agingQuerySchema.parse({ as_of: req.query['as_of'] ?? new Date().toISOString().slice(0, 10) });
    const rows = await aging.customerAging(db, { business_id: req.tenancy!.business_id, as_of: q.as_of });
    res.json({ as_of: q.as_of, rows });
  } catch (e) { next(e); }
});

export default router;
```

- [ ] **Step 2: Wire in `apps/api/src/app.ts`** (`import agingRoutes from './routes/agingReport.js'; app.use(agingRoutes);`).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/agingReport.ts apps/api/src/app.ts
git commit -m "feat(api): aging report route"
```

### Task 22: Updated seed: sample customers + tax codes

**Files:**
- Create: `db/seeds/0003_ar.sql`

- [ ] **Step 1: Write**

```sql
DO $$
DECLARE
  r record;
  v_tax_acct uuid;
  v_tax_code_id uuid;
BEGIN
  FOR r IN SELECT id FROM businesses WHERE deleted_at IS NULL LOOP
    -- Sample customers (idempotent: skip if any exist)
    IF NOT EXISTS (SELECT 1 FROM customers WHERE business_id = r.id) THEN
      INSERT INTO customers (business_id, name, email, default_terms_days) VALUES
        (r.id, 'Demo Customer A', 'a@demo.example.com', 30),
        (r.id, 'Demo Customer B', 'b@demo.example.com', 15);
    END IF;
    -- Sample tax code (CA Sales Tax 8.75%) tied to system Sales Tax Payable
    SELECT id INTO v_tax_acct FROM chart_of_accounts WHERE business_id = r.id AND code = '2100';
    IF v_tax_acct IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tax_codes WHERE business_id = r.id) THEN
      INSERT INTO tax_codes (business_id, code, name, tax_payable_account_id)
        VALUES (r.id, 'CA', 'CA Sales Tax 8.75%', v_tax_acct)
        RETURNING id INTO v_tax_code_id;
      INSERT INTO tax_rates (tax_code_id, rate, effective_from)
        VALUES (v_tax_code_id, 0.0875, '2000-01-01');
    END IF;
  END LOOP;
END $$;
```

- [ ] **Step 2: Apply + commit**

```bash
npm run db:reset
git add db/seeds/0003_ar.sql
git commit -m "feat(db): seed sample customers + tax code per business"
```

---

## Phase G — AR web UI (Tasks 23–30)

### Task 23: Customers pages

**Files:**
- Create: `apps/web/src/pages/customers/CustomerListPage.tsx`, `CustomerNewPage.tsx`, `CustomerDetailPage.tsx`

- [ ] **Step 1: Write `CustomerListPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type C = { id: string; name: string; email: string | null; default_terms_days: number };

export default function CustomerListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<C[]>([]);
  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/customers`).then(r => setItems(r.data.customers)); }, [bizId]);
  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Customers</h1>
        <Button asChild><Link to="/customers/new">New customer</Link></Button>
      </div>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">Name</th><th className="text-left p-3">Email</th><th className="text-left p-3">Terms</th><th></th></tr></thead>
          <tbody>{items.map(c => (
            <tr key={c.id} className="border-b last:border-b-0">
              <td className="p-3">{c.name}</td>
              <td className="p-3">{c.email ?? ''}</td>
              <td className="p-3">{c.default_terms_days}d</td>
              <td className="p-3"><Link className="text-primary underline" to={`/customers/${c.id}`}>view</Link></td>
            </tr>
          ))}</tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
```

- [ ] **Step 2: Write `CustomerNewPage.tsx`**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function CustomerNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', phone: '', default_terms_days: 30 });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const body = { name: form.name, email: form.email || null, phone: form.phone || null, default_terms_days: form.default_terms_days };
      const r = await api.post(`/businesses/${bizId}/customers`, body);
      nav(`/customers/${r.data.id}`);
    } catch (e: any) { setErr(e?.response?.data?.error?.message ?? 'Failed'); }
    finally { setBusy(false); }
  }
  if (!bizId) return <div>Pick a business.</div>;
  return (
    <form className="space-y-6 max-w-xl" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">New Customer</h1>
      <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
          <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
          <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
          <div><Label>Default terms (days)</Label><Input type="number" value={form.default_terms_days} onChange={e => setForm(f => ({ ...f, default_terms_days: parseInt(e.target.value, 10) || 0 }))} /></div>
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</Button><Button type="button" variant="outline" onClick={() => nav('/customers')}>Cancel</Button></div>
    </form>
  );
}
```

- [ ] **Step 3: Write `CustomerDetailPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const [customer, setCustomer] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  useEffect(() => {
    if (!bizId || !id) return;
    api.get(`/businesses/${bizId}/customers/${id}`).then(r => setCustomer(r.data));
    api.get(`/businesses/${bizId}/invoices`, { params: { customer_id: id } }).then(r => setInvoices(r.data.invoices));
  }, [bizId, id]);
  if (!customer) return <div>Loading…</div>;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{customer.name}</h1>
      <Card><CardHeader><CardTitle>Contact</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1">
          <div>Email: {customer.email ?? '—'}</div><div>Phone: {customer.phone ?? '—'}</div><div>Terms: {customer.default_terms_days}d</div>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Invoices</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">#</th><th className="text-left p-3">Date</th><th className="text-left p-3">Status</th><th className="text-right p-3">Total</th><th></th></tr></thead>
            <tbody>{invoices.map((i: any) => (
              <tr key={i.id} className="border-b last:border-b-0">
                <td className="p-3 font-mono">{i.invoice_number}</td>
                <td className="p-3">{i.issue_date}</td>
                <td className="p-3">{i.status}</td>
                <td className="p-3 text-right">{fmtMoney(i.total)}</td>
                <td className="p-3"><Link className="text-primary underline" to={`/invoices/${i.id}`}>view</Link></td>
              </tr>
            ))}</tbody>
          </table>
        </CardContent></Card>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/customers/
git commit -m "feat(web): customer list/new/detail pages"
```

### Task 24: Invoice list + detail pages

**Files:**
- Create: `apps/web/src/pages/invoices/InvoiceListPage.tsx`, `InvoiceDetailPage.tsx`

- [ ] **Step 1: Write `InvoiceListPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

export default function InvoiceListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/invoices`, { params: statusFilter ? { status: statusFilter } : {} }).then(r => setItems(r.data.invoices));
  }, [bizId, statusFilter]);
  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <div className="flex items-center gap-3">
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>{['draft','posted','paid','voided'].map(s => <option key={s}>{s}</option>)}
          </select>
          <Button asChild><Link to="/invoices/new">New invoice</Link></Button>
        </div>
      </div>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">#</th><th className="text-left p-3">Issue</th><th className="text-left p-3">Due</th><th className="text-left p-3">Status</th><th className="text-right p-3">Total</th><th></th></tr></thead>
          <tbody>{items.map(i => (
            <tr key={i.id} className="border-b last:border-b-0">
              <td className="p-3 font-mono">{i.invoice_number}</td>
              <td className="p-3">{i.issue_date}</td>
              <td className="p-3">{i.due_date}</td>
              <td className="p-3">{i.status}</td>
              <td className="p-3 text-right">{fmtMoney(i.total)}</td>
              <td className="p-3"><Link className="text-primary underline" to={`/invoices/${i.id}`}>view</Link></td>
            </tr>
          ))}</tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
```

- [ ] **Step 2: Write `InvoiceDetailPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function reload() {
    if (!bizId || !id) return;
    const r = await api.get(`/businesses/${bizId}/invoices/${id}`);
    setData(r.data);
  }
  useEffect(() => { reload(); }, [bizId, id]);

  async function post() {
    setBusy(true); setErr(null);
    try { await api.post(`/businesses/${bizId}/invoices/${id}/post`); await reload(); }
    catch (e: any) { setErr(e?.response?.data?.error?.message ?? 'Failed'); }
    finally { setBusy(false); }
  }
  async function voidIt() {
    const reason = window.prompt('Reason for voiding?'); if (!reason) return;
    setBusy(true); setErr(null);
    try { await api.post(`/businesses/${bizId}/invoices/${id}/void`, { void_reason: reason }); await reload(); }
    catch (e: any) { setErr(e?.response?.data?.error?.message ?? 'Failed'); }
    finally { setBusy(false); }
  }

  if (!data) return <div>Loading…</div>;
  const inv = data.invoice;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoice {inv.invoice_number}</h1>
        <div className="flex gap-2">
          {inv.status === 'draft' && <Button disabled={busy} onClick={post}>Post invoice</Button>}
          {(inv.status === 'posted' || inv.status === 'paid') && <Button variant="destructive" disabled={busy} onClick={voidIt}>Void</Button>}
        </div>
      </div>
      <Card><CardHeader><CardTitle>Header</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-sm">
          <div>Status: {inv.status}</div>
          <div>Issue: {inv.issue_date}</div>
          <div>Due: {inv.due_date}</div>
          <div>Memo: {inv.memo ?? '—'}</div>
          <div>Subtotal: {fmtMoney(inv.subtotal)}</div>
          <div>Tax: {fmtMoney(inv.tax_total)}</div>
          <div className="font-semibold">Total: {fmtMoney(inv.total)}</div>
          <div>Amount due: {fmtMoney(data.amount_due)}</div>
        </CardContent>
      </Card>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">#</th><th className="text-left p-3">Description</th><th className="text-right p-3">Qty</th><th className="text-right p-3">Unit</th><th className="text-right p-3">Subtotal</th><th className="text-right p-3">Tax</th><th className="text-right p-3">Total</th></tr></thead>
          <tbody>{data.lines.map((l: any) => (
            <tr key={l.id} className="border-b last:border-b-0">
              <td className="p-3">{l.line_number}</td>
              <td className="p-3">{l.description}</td>
              <td className="p-3 text-right">{l.quantity}</td>
              <td className="p-3 text-right">{fmtMoney(l.unit_price)}</td>
              <td className="p-3 text-right">{fmtMoney(l.line_subtotal)}</td>
              <td className="p-3 text-right">{fmtMoney(l.tax_amount)}</td>
              <td className="p-3 text-right">{fmtMoney(l.line_total)}</td>
            </tr>
          ))}</tbody>
        </table>
      </CardContent></Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button variant="outline" onClick={() => nav('/invoices')}>Back to list</Button>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/invoices/
git commit -m "feat(web): invoice list + detail pages with post/void"
```

### Task 25: Invoice creation page

**Files:**
- Create: `apps/web/src/pages/invoices/InvoiceNewPage.tsx`

- [ ] **Step 1: Write**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { parseMoneyInput } from '@/lib/money';

type Line = { description: string; quantity: string; unit_price: string; revenue_account_id: string; tax_code_id: string | null };
const blank = (): Line => ({ description: '', quantity: '1', unit_price: '0.00', revenue_account_id: '', tax_code_id: null });

export default function InvoiceNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [customers, setCustomers] = useState<any[]>([]);
  const [revenueAccounts, setRevenueAccounts] = useState<any[]>([]);
  const [taxCodes, setTaxCodes] = useState<any[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [hdr, setHdr] = useState({ customer_id: '', invoice_number: '', issue_date: today, due_date: today, memo: '' });
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/customers`).then(r => setCustomers(r.data.customers));
    api.get(`/businesses/${bizId}/coa`).then(r => setRevenueAccounts(r.data.accounts.filter((a: any) => a.account_type === 'revenue' && a.is_active)));
    api.get(`/businesses/${bizId}/tax-codes`).then(r => setTaxCodes(r.data.tax_codes ?? []));
  }, [bizId]);

  function update(i: number, patch: Partial<Line>) { setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l)); }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const body = {
        customer_id: hdr.customer_id, invoice_number: hdr.invoice_number,
        issue_date: hdr.issue_date, due_date: hdr.due_date, memo: hdr.memo || null, terms: null,
        lines: lines.map(l => ({
          description: l.description, quantity: parseMoneyInput(l.quantity), unit_price: parseMoneyInput(l.unit_price),
          revenue_account_id: l.revenue_account_id, tax_code_id: l.tax_code_id,
        })),
      };
      const r = await api.post(`/businesses/${bizId}/invoices`, body);
      nav(`/invoices/${r.data.invoice.id}`);
    } catch (e: any) { setErr(e?.response?.data?.error?.message ?? 'Failed'); }
    finally { setBusy(false); }
  }

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <form className="space-y-6" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">New Invoice</h1>
      <Card><CardHeader><CardTitle>Header</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <div><Label>Customer</Label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={hdr.customer_id} onChange={e => setHdr(h => ({ ...h, customer_id: e.target.value }))} required>
              <option value="">Select…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><Label>Invoice #</Label><Input value={hdr.invoice_number} onChange={e => setHdr(h => ({ ...h, invoice_number: e.target.value }))} required /></div>
          <div><Label>Memo</Label><Input value={hdr.memo} onChange={e => setHdr(h => ({ ...h, memo: e.target.value }))} /></div>
          <div><Label>Issue date</Label><Input type="date" value={hdr.issue_date} onChange={e => setHdr(h => ({ ...h, issue_date: e.target.value }))} required /></div>
          <div><Label>Due date</Label><Input type="date" value={hdr.due_date} onChange={e => setHdr(h => ({ ...h, due_date: e.target.value }))} required /></div>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Lines</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-3"><Label className="sr-only">Desc</Label><Input value={l.description} onChange={e => update(i, { description: e.target.value })} placeholder="Description" required /></div>
              <div className="col-span-1"><Label className="sr-only">Qty</Label><Input type="number" step="0.01" value={l.quantity} onChange={e => update(i, { quantity: e.target.value })} /></div>
              <div className="col-span-2"><Label className="sr-only">Unit</Label><Input type="number" step="0.01" value={l.unit_price} onChange={e => update(i, { unit_price: e.target.value })} /></div>
              <div className="col-span-3"><Label className="sr-only">Revenue acct</Label>
                <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={l.revenue_account_id} onChange={e => update(i, { revenue_account_id: e.target.value })} required>
                  <option value="">Account…</option>{revenueAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
              </div>
              <div className="col-span-2"><Label className="sr-only">Tax</Label>
                <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={l.tax_code_id ?? ''} onChange={e => update(i, { tax_code_id: e.target.value || null })}>
                  <option value="">No tax</option>{taxCodes.map((tc: any) => <option key={tc.id} value={tc.id}>{tc.code}</option>)}
                </select>
              </div>
              <div className="col-span-1"><Button type="button" variant="ghost" onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} disabled={lines.length <= 1}>×</Button></div>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={() => setLines(ls => [...ls, blank()])}>Add line</Button>
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create draft'}</Button><Button type="button" variant="outline" onClick={() => nav('/invoices')}>Cancel</Button></div>
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/invoices/InvoiceNewPage.tsx
git commit -m "feat(web): invoice creation page"
```

### Task 26: Payment list/detail/new pages

**Files:**
- Create: `apps/web/src/pages/payments/PaymentListPage.tsx`, `PaymentDetailPage.tsx`, `PaymentNewPage.tsx`

- [ ] **Step 1: Write `PaymentListPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

export default function PaymentListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/payments`).then(r => setItems(r.data.payments)); }, [bizId]);
  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Payments</h1>
        <Button asChild><Link to="/payments/new">Record payment</Link></Button>
      </div>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">Date</th><th className="text-left p-3">Method</th><th className="text-left p-3">Status</th><th className="text-right p-3">Amount</th><th className="text-right p-3">Unapplied</th><th></th></tr></thead>
          <tbody>{items.map(p => (
            <tr key={p.id} className="border-b last:border-b-0">
              <td className="p-3">{p.payment_date}</td>
              <td className="p-3">{p.payment_method}</td>
              <td className="p-3">{p.status}</td>
              <td className="p-3 text-right">{fmtMoney(p.amount)}</td>
              <td className="p-3 text-right">{fmtMoney(p.unapplied_amount)}</td>
              <td className="p-3"><Link className="text-primary underline" to={`/payments/${p.id}`}>view</Link></td>
            </tr>
          ))}</tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
```

- [ ] **Step 2: Write `PaymentDetailPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { fmtMoney, parseMoneyInput } from '@/lib/money';

export default function PaymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const [data, setData] = useState<any>(null);
  const [openInvoices, setOpenInvoices] = useState<any[]>([]);
  const [applyForm, setApplyForm] = useState({ invoice_id: '', applied_amount: '0.00' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!bizId || !id) return;
    const r = await api.get(`/businesses/${bizId}/payments/${id}`);
    setData(r.data);
    const inv = await api.get(`/businesses/${bizId}/invoices`, { params: { customer_id: r.data.payment.customer_id, status: 'posted' } });
    setOpenInvoices(inv.data.invoices);
  }
  useEffect(() => { reload(); }, [bizId, id]);

  async function post() { setBusy(true); setErr(null); try { await api.post(`/businesses/${bizId}/payments/${id}/post`); await reload(); } catch (e: any) { setErr(e?.response?.data?.error?.message ?? 'Failed'); } finally { setBusy(false); } }
  async function voidIt() { const reason = window.prompt('Reason?'); if (!reason) return; setBusy(true); setErr(null); try { await api.post(`/businesses/${bizId}/payments/${id}/void`, { void_reason: reason }); await reload(); } catch (e: any) { setErr(e?.response?.data?.error?.message ?? 'Failed'); } finally { setBusy(false); } }
  async function apply(e: React.FormEvent) { e.preventDefault(); setBusy(true); setErr(null); try { await api.post(`/businesses/${bizId}/payments/${id}/applications`, { invoice_id: applyForm.invoice_id, applied_amount: parseMoneyInput(applyForm.applied_amount) }); setApplyForm({ invoice_id: '', applied_amount: '0.00' }); await reload(); } catch (e: any) { setErr(e?.response?.data?.error?.message ?? 'Failed'); } finally { setBusy(false); } }
  async function unapply(appId: string) { setBusy(true); setErr(null); try { await api.delete(`/businesses/${bizId}/payments/${id}/applications/${appId}`); await reload(); } catch (e: any) { setErr(e?.response?.data?.error?.message ?? 'Failed'); } finally { setBusy(false); } }

  if (!data) return <div>Loading…</div>;
  const p = data.payment;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Payment {p.payment_date}</h1>
        <div className="flex gap-2">
          {p.status === 'draft' && <Button disabled={busy} onClick={post}>Post</Button>}
          {p.status === 'posted' && <Button variant="destructive" disabled={busy} onClick={voidIt}>Void</Button>}
        </div>
      </div>
      <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-sm">
          <div>Status: {p.status}</div><div>Method: {p.payment_method}</div>
          <div>Amount: {fmtMoney(p.amount)}</div><div>Unapplied: {fmtMoney(p.unapplied_amount)}</div>
          <div>Reference: {p.reference ?? '—'}</div><div>Memo: {p.memo ?? '—'}</div>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Applications</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">Invoice</th><th className="text-right p-3">Applied</th><th className="text-left p-3">When</th><th></th></tr></thead>
            <tbody>{data.applications.map((a: any) => (
              <tr key={a.id} className="border-b last:border-b-0">
                <td className="p-3 font-mono">{a.invoice_number}</td>
                <td className="p-3 text-right">{fmtMoney(a.applied_amount)}</td>
                <td className="p-3">{new Date(a.applied_at).toLocaleString()}</td>
                <td className="p-3"><Button size="sm" variant="ghost" onClick={() => unapply(a.id)} disabled={busy}>Unapply</Button></td>
              </tr>
            ))}</tbody>
          </table>
          {parseFloat(p.unapplied_amount) > 0 && (
            <form className="grid grid-cols-12 gap-2 items-end" onSubmit={apply}>
              <div className="col-span-7"><label className="text-sm">Invoice</label>
                <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={applyForm.invoice_id} onChange={e => setApplyForm(f => ({ ...f, invoice_id: e.target.value }))} required>
                  <option value="">Select open invoice…</option>{openInvoices.map(i => <option key={i.id} value={i.id}>{i.invoice_number} — {fmtMoney(i.total)}</option>)}
                </select>
              </div>
              <div className="col-span-3"><label className="text-sm">Apply amount</label><Input type="number" step="0.01" value={applyForm.applied_amount} onChange={e => setApplyForm(f => ({ ...f, applied_amount: e.target.value }))} /></div>
              <div className="col-span-2"><Button type="submit" disabled={busy}>Apply</Button></div>
            </form>
          )}
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Write `PaymentNewPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { parseMoneyInput } from '@/lib/money';

export default function PaymentNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [customers, setCustomers] = useState<any[]>([]);
  const [cashAccounts, setCashAccounts] = useState<any[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ customer_id: '', payment_date: today, payment_method: 'check', reference: '', amount: '0.00', cash_account_id: '', memo: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/customers`).then(r => setCustomers(r.data.customers));
    api.get(`/businesses/${bizId}/coa`).then(r => setCashAccounts(r.data.accounts.filter((a: any) => a.account_type === 'asset' && a.is_active && a.code.startsWith('10'))));
  }, [bizId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const body = { ...form, amount: parseMoneyInput(form.amount), reference: form.reference || null, memo: form.memo || null };
      const r = await api.post(`/businesses/${bizId}/payments`, body);
      nav(`/payments/${r.data.payment.id}`);
    } catch (e: any) { setErr(e?.response?.data?.error?.message ?? 'Failed'); }
    finally { setBusy(false); }
  }

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <form className="space-y-6 max-w-2xl" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">Record Payment</h1>
      <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div><Label>Customer</Label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))} required>
              <option value="">Select…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><Label>Date</Label><Input type="date" value={form.payment_date} onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))} required /></div>
          <div><Label>Method</Label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}>
              {['cash','check','ach','wire','card','other'].map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div><Label>Reference</Label><Input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} /></div>
          <div><Label>Amount</Label><Input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required /></div>
          <div><Label>Cash account</Label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.cash_account_id} onChange={e => setForm(f => ({ ...f, cash_account_id: e.target.value }))} required>
              <option value="">Select…</option>{cashAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </div>
          <div className="col-span-2"><Label>Memo</Label><Input value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} /></div>
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create draft'}</Button><Button type="button" variant="outline" onClick={() => nav('/payments')}>Cancel</Button></div>
    </form>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/payments/
git commit -m "feat(web): payment list/detail/new with applications UI"
```

### Task 27: Credit memo pages

**Files:**
- Create: `apps/web/src/pages/creditMemos/CreditMemoListPage.tsx`, `CreditMemoNewPage.tsx`, `CreditMemoDetailPage.tsx`

- [ ] **Step 1: Write the three pages (compact — pattern matches invoices/payments)**

`CreditMemoListPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

export default function CreditMemoListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/credit-memos`).then(r => setItems(r.data.credit_memos)); }, [bizId]);
  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Credit Memos</h1><Button asChild><Link to="/credit-memos/new">New credit memo</Link></Button></div>
      <Card><CardContent className="p-0"><table className="w-full text-sm">
        <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">Date</th><th className="text-left p-3">Status</th><th className="text-right p-3">Amount</th><th className="text-right p-3">Remaining</th><th></th></tr></thead>
        <tbody>{items.map(c => (<tr key={c.id} className="border-b last:border-b-0">
          <td className="p-3">{c.memo_date}</td><td className="p-3">{c.status}</td>
          <td className="p-3 text-right">{fmtMoney(c.amount)}</td><td className="p-3 text-right">{fmtMoney(c.remaining_amount)}</td>
          <td className="p-3"><Link className="text-primary underline" to={`/credit-memos/${c.id}`}>view</Link></td>
        </tr>))}</tbody>
      </table></CardContent></Card>
    </div>
  );
}
```

`CreditMemoNewPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { parseMoneyInput } from '@/lib/money';

export default function CreditMemoNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [customers, setCustomers] = useState<any[]>([]);
  const [revenueAccounts, setRevenueAccounts] = useState<any[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ customer_id: '', memo_date: today, amount: '0.00', revenue_account_id: '', memo: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/customers`).then(r => setCustomers(r.data.customers));
    // Prefer Sales Returns (4910) but list all revenue accounts so users can pick a contra-revenue if needed.
    api.get(`/businesses/${bizId}/coa`).then(r => setRevenueAccounts(r.data.accounts.filter((a: any) => a.account_type === 'revenue' && a.is_active)));
  }, [bizId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const body = { ...form, amount: parseMoneyInput(form.amount), memo: form.memo || null };
      const r = await api.post(`/businesses/${bizId}/credit-memos`, body);
      nav(`/credit-memos/${r.data.id}`);
    } catch (e: any) { setErr(e?.response?.data?.error?.message ?? 'Failed'); }
    finally { setBusy(false); }
  }

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <form className="space-y-6 max-w-xl" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">New Credit Memo</h1>
      <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div><Label>Customer</Label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))} required>
              <option value="">Select…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><Label>Date</Label><Input type="date" value={form.memo_date} onChange={e => setForm(f => ({ ...f, memo_date: e.target.value }))} required /></div>
          <div><Label>Amount</Label><Input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required /></div>
          <div><Label>Revenue/contra account</Label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.revenue_account_id} onChange={e => setForm(f => ({ ...f, revenue_account_id: e.target.value }))} required>
              <option value="">Select…</option>{revenueAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </div>
          <div className="col-span-2"><Label>Memo</Label><Input value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} /></div>
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create draft'}</Button><Button type="button" variant="outline" onClick={() => nav('/credit-memos')}>Cancel</Button></div>
    </form>
  );
}
```

`CreditMemoDetailPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney, parseMoneyInput } from '@/lib/money';

export default function CreditMemoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const [data, setData] = useState<any>(null);
  const [openInvoices, setOpenInvoices] = useState<any[]>([]);
  const [applyForm, setApplyForm] = useState({ invoice_id: '', applied_amount: '0.00' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!bizId || !id) return;
    const r = await api.get(`/businesses/${bizId}/credit-memos`);
    const cm = r.data.credit_memos.find((c: any) => c.id === id);
    setData(cm);
    if (cm) {
      const inv = await api.get(`/businesses/${bizId}/invoices`, { params: { customer_id: cm.customer_id, status: 'posted' } });
      setOpenInvoices(inv.data.invoices);
    }
  }
  useEffect(() => { reload(); }, [bizId, id]);

  async function post() { setBusy(true); setErr(null); try { await api.post(`/businesses/${bizId}/credit-memos/${id}/post`); await reload(); } catch (e: any) { setErr(e?.response?.data?.error?.message ?? 'Failed'); } finally { setBusy(false); } }
  async function voidIt() { const reason = window.prompt('Reason?'); if (!reason) return; setBusy(true); setErr(null); try { await api.post(`/businesses/${bizId}/credit-memos/${id}/void`, { void_reason: reason }); await reload(); } catch (e: any) { setErr(e?.response?.data?.error?.message ?? 'Failed'); } finally { setBusy(false); } }
  async function apply(e: React.FormEvent) { e.preventDefault(); setBusy(true); setErr(null); try { await api.post(`/businesses/${bizId}/credit-memos/${id}/apply`, { invoice_id: applyForm.invoice_id, applied_amount: parseMoneyInput(applyForm.applied_amount) }); setApplyForm({ invoice_id: '', applied_amount: '0.00' }); await reload(); } catch (e: any) { setErr(e?.response?.data?.error?.message ?? 'Failed'); } finally { setBusy(false); } }

  if (!data) return <div>Loading…</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Credit Memo</h1>
        <div className="flex gap-2">
          {data.status === 'draft' && <Button disabled={busy} onClick={post}>Post</Button>}
          {(data.status === 'posted' || data.status === 'applied') && <Button variant="destructive" disabled={busy} onClick={voidIt}>Void</Button>}
        </div>
      </div>
      <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-sm">
          <div>Status: {data.status}</div>
          <div>Date: {data.memo_date}</div>
          <div>Amount: {fmtMoney(data.amount)}</div>
          <div>Remaining: {fmtMoney(data.remaining_amount)}</div>
          <div className="col-span-2">Memo: {data.memo ?? '—'}</div>
        </CardContent>
      </Card>
      {data.status === 'posted' && parseFloat(data.remaining_amount) > 0 && (
        <Card><CardHeader><CardTitle>Apply to invoice</CardTitle></CardHeader>
          <CardContent>
            <form className="grid grid-cols-12 gap-2 items-end" onSubmit={apply}>
              <div className="col-span-7"><label className="text-sm">Invoice</label>
                <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={applyForm.invoice_id} onChange={e => setApplyForm(f => ({ ...f, invoice_id: e.target.value }))} required>
                  <option value="">Select…</option>{openInvoices.map(i => <option key={i.id} value={i.id}>{i.invoice_number} — {fmtMoney(i.total)}</option>)}
                </select>
              </div>
              <div className="col-span-3"><label className="text-sm">Apply amount</label><Input type="number" step="0.01" value={applyForm.applied_amount} onChange={e => setApplyForm(f => ({ ...f, applied_amount: e.target.value }))} /></div>
              <div className="col-span-2"><Button type="submit" disabled={busy}>Apply</Button></div>
            </form>
          </CardContent>
        </Card>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/creditMemos/
git commit -m "feat(web): credit memo list/new/detail with apply"
```

### Task 28: Aging report page + tax codes settings page

**Files:**
- Create: `apps/web/src/pages/reports/AgingReportPage.tsx`, `apps/web/src/pages/settings/TaxCodesPage.tsx`

- [ ] **Step 1: Write `AgingReportPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fmtMoney } from '@/lib/money';

type Row = { customer_id: string; customer_name: string; current: string; over_30: string; over_60: string; over_90: string; total: string };

export default function AgingReportPage() {
  const [bizId] = useActiveBusinessId();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { if (bizId) api.get(`/businesses/${bizId}/reports/aging`, { params: { as_of: asOf } }).then(r => setRows(r.data.rows)); }, [bizId, asOf]);
  if (!bizId) return <div>Pick a business.</div>;
  const totals = rows.reduce((acc, r) => ({
    current: acc.current + parseFloat(r.current),
    over_30: acc.over_30 + parseFloat(r.over_30),
    over_60: acc.over_60 + parseFloat(r.over_60),
    over_90: acc.over_90 + parseFloat(r.over_90),
    total: acc.total + parseFloat(r.total),
  }), { current: 0, over_30: 0, over_60: 0, over_90: 0, total: 0 });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">AR Aging</h1>
        <div><Label>As of</Label><Input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} /></div>
      </div>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">Customer</th><th className="text-right p-3">Current</th><th className="text-right p-3">1-30</th><th className="text-right p-3">31-60</th><th className="text-right p-3">60+</th><th className="text-right p-3">Total</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.customer_id} className="border-b last:border-b-0">
              <td className="p-3">{r.customer_name}</td>
              <td className="p-3 text-right">{fmtMoney(r.current)}</td>
              <td className="p-3 text-right">{fmtMoney(r.over_30)}</td>
              <td className="p-3 text-right">{fmtMoney(r.over_60)}</td>
              <td className="p-3 text-right">{fmtMoney(r.over_90)}</td>
              <td className="p-3 text-right">{fmtMoney(r.total)}</td>
            </tr>
          ))}
          <tr className="font-semibold bg-muted/20">
            <td className="p-3 text-right">Totals</td>
            <td className="p-3 text-right">{totals.current.toFixed(2)}</td>
            <td className="p-3 text-right">{totals.over_30.toFixed(2)}</td>
            <td className="p-3 text-right">{totals.over_60.toFixed(2)}</td>
            <td className="p-3 text-right">{totals.over_90.toFixed(2)}</td>
            <td className="p-3 text-right">{totals.total.toFixed(2)}</td>
          </tr>
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
```

- [ ] **Step 2: Write `TaxCodesPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function TaxCodesPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', tax_payable_account_id: '', rate: '0.0875', effective_from: '2026-01-01' });
  const [err, setErr] = useState<string | null>(null);

  async function reload() {
    if (!bizId) return;
    const r = await api.get(`/businesses/${bizId}/tax-codes`);
    setItems(r.data.tax_codes);
    const a = await api.get(`/businesses/${bizId}/coa`);
    setAccounts(a.data.accounts.filter((x: any) => x.account_type === 'liability' && x.is_active));
  }
  useEffect(() => { reload(); }, [bizId]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/tax-codes`, {
        code: form.code, name: form.name, tax_payable_account_id: form.tax_payable_account_id,
        initial_rate: { rate: parseFloat(form.rate), effective_from: form.effective_from, effective_to: null },
      });
      setShow(false); setForm({ code: '', name: '', tax_payable_account_id: '', rate: '0.0875', effective_from: '2026-01-01' });
      await reload();
    } catch (e: any) { setErr(e?.response?.data?.error?.message ?? 'Failed'); }
  }

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Tax Codes</h1><Button onClick={() => setShow(s => !s)}>{show ? 'Cancel' : 'New tax code'}</Button></div>
      {show && (
        <Card><CardHeader><CardTitle>Create</CardTitle></CardHeader>
          <CardContent>
            <form className="grid grid-cols-3 gap-3 items-end" onSubmit={create}>
              <div><Label>Code</Label><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} required /></div>
              <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required /></div>
              <div><Label>Payable account</Label>
                <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.tax_payable_account_id} onChange={e => setForm(f => ({ ...f, tax_payable_account_id: e.target.value }))} required>
                  <option value="">Select…</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
              </div>
              <div><Label>Rate (decimal, e.g. 0.0875)</Label><Input type="number" step="0.000001" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} required /></div>
              <div><Label>Effective from</Label><Input type="date" value={form.effective_from} onChange={e => setForm(f => ({ ...f, effective_from: e.target.value }))} required /></div>
              <Button type="submit">Create</Button>
              {err && <p className="text-sm text-destructive col-span-3">{err}</p>}
            </form>
          </CardContent>
        </Card>
      )}
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40"><tr><th className="text-left p-3">Code</th><th className="text-left p-3">Name</th><th className="text-right p-3">Current rate</th><th className="text-left p-3">Active</th></tr></thead>
          <tbody>{items.map(c => (<tr key={c.id} className="border-b last:border-b-0">
            <td className="p-3 font-mono">{c.code}</td>
            <td className="p-3">{c.name}</td>
            <td className="p-3 text-right">{c.current_rate ? `${(parseFloat(c.current_rate) * 100).toFixed(4)}%` : '—'}</td>
            <td className="p-3">{c.is_active ? 'yes' : 'no'}</td>
          </tr>))}</tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/reports/AgingReportPage.tsx apps/web/src/pages/settings/TaxCodesPage.tsx
git commit -m "feat(web): aging report + tax codes settings pages"
```

### Task 29: Wire all AR routes + extend sidebar

**Files:**
- Modify: `apps/web/src/components/layout/Sidebar.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Replace `Sidebar.tsx`**

```tsx
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

const items = [
  { to: '/', label: 'Dashboard' },
  { to: '/customers', label: 'Customers' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/payments', label: 'Payments' },
  { to: '/credit-memos', label: 'Credit Memos' },
  { to: '/journal', label: 'Journal Entries' },
  { to: '/reports/trial-balance', label: 'Trial Balance' },
  { to: '/reports/aging', label: 'AR Aging' },
  { to: '/settings/coa', label: 'Chart of Accounts' },
  { to: '/settings/tax-codes', label: 'Tax Codes' },
  { to: '/settings/periods', label: 'Fiscal Periods' },
];

export function Sidebar() {
  return (
    <aside className="w-56 shrink-0 border-r bg-card p-4">
      <div className="font-semibold mb-4">Accounting</div>
      <nav className="flex flex-col gap-1">
        {items.map(item => (
          <NavLink key={item.to} to={item.to} end className={({ isActive }) => cn(
            'rounded px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground',
            isActive && 'bg-accent text-accent-foreground',
          )}>{item.label}</NavLink>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Update `App.tsx` to register all AR pages**

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
import AgingReportPage from '@/pages/reports/AgingReportPage';
import CustomerListPage from '@/pages/customers/CustomerListPage';
import CustomerNewPage from '@/pages/customers/CustomerNewPage';
import CustomerDetailPage from '@/pages/customers/CustomerDetailPage';
import InvoiceListPage from '@/pages/invoices/InvoiceListPage';
import InvoiceNewPage from '@/pages/invoices/InvoiceNewPage';
import InvoiceDetailPage from '@/pages/invoices/InvoiceDetailPage';
import PaymentListPage from '@/pages/payments/PaymentListPage';
import PaymentNewPage from '@/pages/payments/PaymentNewPage';
import PaymentDetailPage from '@/pages/payments/PaymentDetailPage';
import CreditMemoListPage from '@/pages/creditMemos/CreditMemoListPage';
import CreditMemoNewPage from '@/pages/creditMemos/CreditMemoNewPage';
import CreditMemoDetailPage from '@/pages/creditMemos/CreditMemoDetailPage';
import TaxCodesPage from '@/pages/settings/TaxCodesPage';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="/customers" element={<CustomerListPage />} />
            <Route path="/customers/new" element={<CustomerNewPage />} />
            <Route path="/customers/:id" element={<CustomerDetailPage />} />
            <Route path="/invoices" element={<InvoiceListPage />} />
            <Route path="/invoices/new" element={<InvoiceNewPage />} />
            <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
            <Route path="/payments" element={<PaymentListPage />} />
            <Route path="/payments/new" element={<PaymentNewPage />} />
            <Route path="/payments/:id" element={<PaymentDetailPage />} />
            <Route path="/credit-memos" element={<CreditMemoListPage />} />
            <Route path="/credit-memos/new" element={<CreditMemoNewPage />} />
            <Route path="/credit-memos/:id" element={<CreditMemoDetailPage />} />
            <Route path="/journal" element={<JournalListPage />} />
            <Route path="/journal/new" element={<JournalNewPage />} />
            <Route path="/journal/:id" element={<JournalDetailPage />} />
            <Route path="/reports/trial-balance" element={<TrialBalancePage />} />
            <Route path="/reports/aging" element={<AgingReportPage />} />
            <Route path="/settings/coa" element={<CoaListPage />} />
            <Route path="/settings/tax-codes" element={<TaxCodesPage />} />
            <Route path="/settings/periods" element={<PeriodsPage />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/layout/Sidebar.tsx apps/web/src/App.tsx
git commit -m "feat(web): register all AR pages + expanded sidebar nav"
```

### Task 30: Full-stack manual smoke test

- [ ] **Step 1: Reset and run the stack**

```bash
npm run db:reset && npm run dev
```

- [ ] **Step 2: Walk through the AR roundtrip in the UI**

1. Log in, switch to "Blue Widget Co."
2. Navigate to /customers → "Demo Customer A" exists. Click view; see empty invoice list.
3. /invoices/new → pick "Demo Customer A", invoice number "INV-001", today's date, line: "Setup fee", qty 1, unit price 1000, revenue account "4010 Sales Revenue", tax code "CA". Create draft.
4. Open the draft; click Post. Status flips to `posted`. Linked JE id appears.
5. /journal → see the invoice's JE; click in to verify lines (DR 1100 AR 1087.50; CR 4010 Sales 1000.00; CR 2100 Sales Tax Payable 87.50).
6. /reports/trial-balance → totals balance; AR shows 1087.50.
7. /payments/new → pick same customer, amount 1087.50, cash account "1020 Operating Bank Account". Create draft.
8. Open the draft, post it. Status flips to posted. Apply 1087.50 to INV-001.
9. /invoices/INV-001 → status flips to `paid`, amount_due 0.
10. /reports/trial-balance → AR 0, Cash 1087.50, Sales 1000.00 (credit), Tax payable 87.50 (credit). Totals still balance.
11. /reports/aging → empty for "Demo Customer A".

- [ ] **Step 3: Push and watch CI**

```bash
git push origin main
```

- [ ] **Step 4: After Railway+Netlify redeploy, repeat smoke test on the deployed URLs**

---

## Plan 1.2 Definition of Done — Slice 1 COMPLETE

- [ ] All migrations 0010–0015 applied; `\d invoices`, `\d payments`, `\d credit_memos` show triggers
- [ ] All integration tests pass: `npm -w @accounting/api run test:integration`
- [ ] Adversarial trigger tests (`arTriggers.test.ts`) pass
- [ ] AR roundtrip test (`arRoundtrip.test.ts`) passes — trial balance balances, AR nets to zero after payment applied
- [ ] CI green on `main`
- [ ] Sample customers + tax code seeded for both demo businesses
- [ ] Smoke test (Task 30 Step 2) completes successfully on local stack
- [ ] Smoke test completes on the deployed Railway+Netlify stack
- [ ] Every audit action defined in this plan emits at least once during the smoke test (verify with `SELECT DISTINCT action FROM audit_logs ORDER BY 1;`)
- [ ] Every Slice 1 page route in `App.tsx` renders without console errors
- [ ] `posted_journal_entry_id` is non-null on every posted invoice / payment / credit memo
- [ ] `unapplied_amount` always equals `amount - SUM(applications.applied_amount)` on every payment (write a one-shot consistency check query and confirm zero rows)

When all 12 are checked, **Slice 1 is done.** Subsequent slices (AP, banking, full reports, month-end close, multi-currency, attachments) get their own brainstorming → spec → plan cycles.

