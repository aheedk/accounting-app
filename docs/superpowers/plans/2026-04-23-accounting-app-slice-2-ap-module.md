# Slice 2 — Accounts Payable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the AP module (vendors, bills, bill payments, vendor credits, 1099 report) as the mirror of Slice 1's AR module. Plugs into the same ledger service so bills post as `DR Expense / CR AP` and bill payments post as `DR AP / CR Cash`.

**Architecture:** Same patterns as Slice 1 AR. New tables (`vendors`, `bills`, `bill_lines`, `bill_payments`, `bill_payment_applications`, `vendor_credits`). Services live under `apps/api/src/services/ap/`. Web pages under `apps/web/src/pages/` matching the AP sidebar group already in place. Only `core/ledgerService.postJournalEntry` writes to `journal_entries`. `is_1099` bool on vendors drives the 1099 report.

**Tech Stack:** Identical to Slice 1. No new dependencies.

---

## Locked decisions (inherits from Slice 1, explicitly restated)

1. Single firm, multi-firm-ready schema — `firm_id` on joins is `{firm_id, business_id}` per-business.
2. AP tables follow AR table patterns exactly. Enum names: `bill_status = 'draft'|'posted'|'paid'|'voided'`, `bill_payment_status = 'draft'|'posted'|'voided'`, `vendor_credit_status = 'draft'|'posted'|'applied'|'voided'`, `payment_method = reuse existing`.
3. Bills have lines with `expense_account_id` (any non-deleted CoA row with `account_type='expense'`). Tax on bills is deferred (no tax_code_id on bill lines for Slice 2). Bill line subtotal = quantity × unit_price. Bill.total = SUM(lines.line_subtotal).
4. Bill Payment JE = `DR AP / CR Cash`. Inverse of AR Payment.
5. Vendor Credit JE = `DR AP / CR Expense (via contra-expense account or a designated "Vendor Credit" revenue-contra)`. Choose `revenue_account_id` naming parallel to AR credit_memos but point at an expense account. Keep field name `offset_account_id` to avoid confusion — any CoA row (usually expense contra) the firm chooses.
6. System AP control account = `2000` (Accounts Payable, liability). Seeded by `db/migrations/0009_default_coa_function.sql` already.
7. `vendors.is_1099` (bool, default false) drives the 1099 annual report, which aggregates posted bill_payments by vendor for the tax year.
8. No 1099 withholding in Slice 2 scope (flagged as Slice 3+).
9. Auth, tenancy, RBAC: unchanged from Slice 1.
10. **Plan and code must stay in sync:** any implementation deviation from the plan → patch the plan markdown in the same commit (standard drill since Slice 1).

---

## Pacing + gotchas (learned during Slice 1 execution)

Apply every time:
- `catch (e: any)` forbidden. Use `catch (e: unknown)` + typed narrowing.
- `exactOptionalPropertyTypes: true` — zod `.optional()` → build patches conditionally with `if (parsed.X !== undefined) ...`.
- Audit rows in throwing transactions get rolled back — write failure audits in their own committed transaction.
- `COALESCE(current_setting('app.X', true), '')` on every `current_setting` call in PL/pgSQL trigger functions.
- `CREATE CONSTRAINT TRIGGER` does NOT support transition tables — use per-row.
- `pg` driver's `date` OID 1082 already has the string parser override in `apps/api/src/db/index.ts`; don't duplicate it.
- `decimal.js` must be imported named: `import { Decimal } from 'decimal.js'`.
- Service signature: `(trx: Transaction<DB>, ctx: ServiceCtx, args: X)`. Routes own `db.transaction().execute(...)`. Audit written in the SAME transaction as the mutation on success paths.
- Only `core/ledgerService.postJournalEntry` writes to `journal_entries`; AP services pass `{ source_type: 'bill'|'bill_payment'|'vendor_credit', source_id, ... }`.
- Numeric columns: avoid double-wrap `Generated<ColumnType<>>`. Use `ColumnType<string, string | number | undefined, string | number>`.
- Existing tenancy middleware is mounted via `router.use('/businesses/:businessId', requireAuth, resolveBusiness);` — new routers must follow this pattern.

---

## Phase A — Data layer

### Task 1: vendors table

**Files:**
- Create: `db/migrations/0016_vendors.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  email text,
  phone text,
  billing_address jsonb,
  tax_id text,
  is_1099 boolean NOT NULL DEFAULT false,
  default_terms_days int NOT NULL DEFAULT 30 CHECK (default_terms_days BETWEEN 0 AND 365),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_vendors_business_name ON vendors(business_id, name) WHERE deleted_at IS NULL;
CREATE INDEX idx_vendors_biz ON vendors(business_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vendors_1099 ON vendors(business_id) WHERE is_1099 = true AND deleted_at IS NULL;
CREATE TRIGGER vendors_updated_at BEFORE UPDATE ON vendors FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

- [ ] **Step 2: Apply**

```bash
npm run db:migrate
```

- [ ] **Step 3: Commit**

```bash
git add db/migrations/0016_vendors.sql
git commit -m "feat(db): vendors table"
```

---

### Task 2: bills + bill_lines tables

**Files:**
- Create: `db/migrations/0017_bills.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TYPE bill_status AS ENUM ('draft', 'posted', 'paid', 'voided');

CREATE TABLE bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  bill_number text NOT NULL,
  bill_date date NOT NULL,
  due_date date NOT NULL,
  status bill_status NOT NULL DEFAULT 'draft',
  subtotal numeric(19,4) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  total numeric(19,4) NOT NULL DEFAULT 0 CHECK (total >= 0),
  ap_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
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
  CONSTRAINT bills_posted_has_je CHECK (
    (status = 'draft' AND posted_journal_entry_id IS NULL)
    OR (status <> 'draft')
  )
);
CREATE UNIQUE INDEX uq_bills_business_number ON bills(business_id, bill_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_bills_biz_status ON bills(business_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_bills_vendor ON bills(vendor_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_bills_due_date ON bills(business_id, due_date) WHERE deleted_at IS NULL AND status IN ('posted','paid');
CREATE TRIGGER bills_updated_at BEFORE UPDATE ON bills FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE bill_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  line_number int NOT NULL,
  description text NOT NULL,
  quantity numeric(19,4) NOT NULL CHECK (quantity > 0),
  unit_price numeric(19,4) NOT NULL CHECK (unit_price >= 0),
  expense_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  line_subtotal numeric(19,4) NOT NULL CHECK (line_subtotal >= 0),
  UNIQUE (bill_id, line_number)
);
```

- [ ] **Step 2: Apply + commit**

```bash
npm run db:migrate
git add db/migrations/0017_bills.sql
git commit -m "feat(db): bills + bill_lines tables"
```

---

### Task 3: bill_payments + bill_payment_applications

**Files:**
- Create: `db/migrations/0018_bill_payments.sql`

- [ ] **Step 1: Write**

```sql
CREATE TYPE bill_payment_status AS ENUM ('draft', 'posted', 'voided');

CREATE TABLE bill_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  payment_date date NOT NULL,
  payment_method payment_method NOT NULL,
  reference text,
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  unapplied_amount numeric(19,4) NOT NULL DEFAULT 0 CHECK (unapplied_amount >= 0),
  cash_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  status bill_payment_status NOT NULL DEFAULT 'draft',
  posted_journal_entry_id uuid REFERENCES journal_entries(id),
  memo text,
  posted_at timestamptz,
  posted_by_user_id uuid REFERENCES users(id),
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bill_payments_unapplied_le_amount CHECK (unapplied_amount <= amount),
  CONSTRAINT bill_payments_posted_has_je CHECK ((status = 'draft' AND posted_journal_entry_id IS NULL) OR (status <> 'draft'))
);
CREATE INDEX idx_bill_payments_biz_status ON bill_payments(business_id, status);
CREATE INDEX idx_bill_payments_vendor ON bill_payments(vendor_id);
CREATE INDEX idx_bill_payments_date ON bill_payments(business_id, payment_date);
CREATE TRIGGER bill_payments_updated_at BEFORE UPDATE ON bill_payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE bill_payment_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_payment_id uuid REFERENCES bill_payments(id) ON DELETE CASCADE,
  vendor_credit_id uuid, -- FK added in 0019
  bill_id uuid NOT NULL REFERENCES bills(id),
  applied_amount numeric(19,4) NOT NULL CHECK (applied_amount > 0),
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by_user_id uuid REFERENCES users(id),
  CONSTRAINT bpa_exactly_one_source CHECK (
    (bill_payment_id IS NOT NULL)::int + (vendor_credit_id IS NOT NULL)::int = 1
  )
);
CREATE INDEX idx_bpa_payment ON bill_payment_applications(bill_payment_id);
CREATE INDEX idx_bpa_vendor_credit ON bill_payment_applications(vendor_credit_id);
CREATE INDEX idx_bpa_bill ON bill_payment_applications(bill_id);
```

- [ ] **Step 2: Apply + commit**

```bash
npm run db:migrate
git add db/migrations/0018_bill_payments.sql
git commit -m "feat(db): bill_payments + bill_payment_applications tables"
```

---

### Task 4: vendor_credits + close FK loop

**Files:**
- Create: `db/migrations/0019_vendor_credits.sql`

- [ ] **Step 1: Write**

```sql
CREATE TYPE vendor_credit_status AS ENUM ('draft', 'posted', 'applied', 'voided');

CREATE TABLE vendor_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  credit_date date NOT NULL,
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  remaining_amount numeric(19,4) NOT NULL CHECK (remaining_amount >= 0),
  offset_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  ap_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  status vendor_credit_status NOT NULL DEFAULT 'draft',
  posted_journal_entry_id uuid REFERENCES journal_entries(id),
  memo text,
  posted_at timestamptz,
  posted_by_user_id uuid REFERENCES users(id),
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vc_remaining_le_amount CHECK (remaining_amount <= amount),
  CONSTRAINT vc_posted_has_je CHECK ((status = 'draft' AND posted_journal_entry_id IS NULL) OR (status <> 'draft'))
);
CREATE INDEX idx_vendor_credits_biz_status ON vendor_credits(business_id, status);
CREATE INDEX idx_vendor_credits_vendor ON vendor_credits(vendor_id);
CREATE TRIGGER vendor_credits_updated_at BEFORE UPDATE ON vendor_credits FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Close the FK loop on bill_payment_applications now that vendor_credits exists
ALTER TABLE bill_payment_applications
  ADD CONSTRAINT bpa_vendor_credit_fk FOREIGN KEY (vendor_credit_id) REFERENCES vendor_credits(id);
```

- [ ] **Step 2: Apply + commit**

```bash
npm run db:migrate
git add db/migrations/0019_vendor_credits.sql
git commit -m "feat(db): vendor_credits + close bill_payment_applications FK loop"
```

---

### Task 5: AP triggers (immutability + JE source extension)

**Files:**
- Create: `db/migrations/0020_ap_triggers.sql`

- [ ] **Step 1: Write**

```sql
-- Mirror Slice 1's ar_protect_posted pattern for AP entities.
CREATE OR REPLACE FUNCTION ap_protect_posted()
RETURNS TRIGGER AS $$
DECLARE
  v_entity text := TG_ARGV[0];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'cannot delete posted % %', v_entity, OLD.id USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'posted' THEN
    IF NEW.status = 'voided' THEN
      IF COALESCE(current_setting('app.allow_void', true), '') <> 'on' THEN
        RAISE EXCEPTION 'cannot void posted % % outside controlled void path', v_entity, OLD.id USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    -- Allow posted -> paid (bills) via sub-ledger update
    -- Nested IF so NEW.status literal only evaluates under matching v_entity branch
    IF v_entity = 'bill' THEN
      IF NEW.status = 'paid' THEN RETURN NEW; END IF;
    END IF;
    -- Allow posted -> applied (vendor_credits)
    IF v_entity = 'vendor_credit' THEN
      IF NEW.status = 'applied' THEN RETURN NEW; END IF;
    END IF;
    IF v_entity = 'bill' THEN
      IF (NEW.status, NEW.bill_number, NEW.vendor_id, NEW.bill_date, NEW.due_date,
          NEW.subtotal, NEW.total, NEW.ap_account_id,
          NEW.posted_journal_entry_id, NEW.business_id)
         IS DISTINCT FROM
         (OLD.status, OLD.bill_number, OLD.vendor_id, OLD.bill_date, OLD.due_date,
          OLD.subtotal, OLD.total, OLD.ap_account_id,
          OLD.posted_journal_entry_id, OLD.business_id) THEN
        RAISE EXCEPTION 'cannot mutate posted bill %', OLD.id USING ERRCODE = '23514';
      END IF;
    ELSIF v_entity = 'bill_payment' THEN
      IF (NEW.status, NEW.amount, NEW.vendor_id, NEW.payment_date, NEW.cash_account_id,
          NEW.posted_journal_entry_id, NEW.business_id)
         IS DISTINCT FROM
         (OLD.status, OLD.amount, OLD.vendor_id, OLD.payment_date, OLD.cash_account_id,
          OLD.posted_journal_entry_id, OLD.business_id) THEN
        RAISE EXCEPTION 'cannot mutate posted bill_payment %', OLD.id USING ERRCODE = '23514';
      END IF;
    ELSIF v_entity = 'vendor_credit' THEN
      IF (NEW.status, NEW.amount, NEW.vendor_id, NEW.credit_date, NEW.ap_account_id,
          NEW.offset_account_id, NEW.posted_journal_entry_id, NEW.business_id)
         IS DISTINCT FROM
         (OLD.status, OLD.amount, OLD.vendor_id, OLD.credit_date, OLD.ap_account_id,
          OLD.offset_account_id, OLD.posted_journal_entry_id, OLD.business_id) THEN
        RAISE EXCEPTION 'cannot mutate posted vendor_credit %', OLD.id USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bills_protect_posted BEFORE UPDATE OR DELETE ON bills FOR EACH ROW EXECUTE FUNCTION ap_protect_posted('bill');
CREATE TRIGGER trg_bill_payments_protect_posted BEFORE UPDATE OR DELETE ON bill_payments FOR EACH ROW EXECUTE FUNCTION ap_protect_posted('bill_payment');
CREATE TRIGGER trg_vendor_credits_protect_posted BEFORE UPDATE OR DELETE ON vendor_credits FOR EACH ROW EXECUTE FUNCTION ap_protect_posted('vendor_credit');

-- Extend je_check_source to accept the new AP source_types
CREATE OR REPLACE FUNCTION je_check_source()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.source_type = 'reversal' THEN
    IF NEW.source_id IS NULL OR NOT EXISTS (SELECT 1 FROM journal_entries WHERE id = NEW.source_id) THEN
      RAISE EXCEPTION 'reversal entry must reference an existing journal_entries row' USING ERRCODE = '23514';
    END IF;
    IF NEW.reversed_entry_id IS NULL OR NEW.reversed_entry_id <> NEW.source_id THEN
      RAISE EXCEPTION 'reversal entry reversed_entry_id must match source_id' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.source_type = 'manual' THEN RETURN NEW; END IF;
  IF NEW.source_id IS NULL THEN
    RAISE EXCEPTION 'source_id required for source_type %', NEW.source_type USING ERRCODE = '23514';
  END IF;
  IF NEW.source_type = 'invoice' AND NOT EXISTS (SELECT 1 FROM invoices WHERE id = NEW.source_id) THEN
    RAISE EXCEPTION 'invoice % not found', NEW.source_id USING ERRCODE = '23514';
  ELSIF NEW.source_type = 'payment' AND NOT EXISTS (SELECT 1 FROM payments WHERE id = NEW.source_id) THEN
    RAISE EXCEPTION 'payment % not found', NEW.source_id USING ERRCODE = '23514';
  ELSIF NEW.source_type = 'credit_memo' AND NOT EXISTS (SELECT 1 FROM credit_memos WHERE id = NEW.source_id) THEN
    RAISE EXCEPTION 'credit_memo % not found', NEW.source_id USING ERRCODE = '23514';
  ELSIF NEW.source_type = 'bill' AND NOT EXISTS (SELECT 1 FROM bills WHERE id = NEW.source_id) THEN
    RAISE EXCEPTION 'bill % not found', NEW.source_id USING ERRCODE = '23514';
  ELSIF NEW.source_type = 'bill_payment' AND NOT EXISTS (SELECT 1 FROM bill_payments WHERE id = NEW.source_id) THEN
    RAISE EXCEPTION 'bill_payment % not found', NEW.source_id USING ERRCODE = '23514';
  ELSIF NEW.source_type = 'vendor_credit' AND NOT EXISTS (SELECT 1 FROM vendor_credits WHERE id = NEW.source_id) THEN
    RAISE EXCEPTION 'vendor_credit % not found', NEW.source_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Expand the journal_entries.source_type CHECK to accept new source_types
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_type_check
  CHECK (source_type IN ('manual', 'invoice', 'payment', 'credit_memo', 'bill', 'bill_payment', 'vendor_credit', 'reversal'));
```

- [ ] **Step 2: Apply + commit**

```bash
npm run db:migrate
git add db/migrations/0020_ap_triggers.sql
git commit -m "feat(db): AP triggers (protect_posted + je source check extension)"
```

---

### Task 6: Augment DB type with AP tables

**Files:**
- Modify: `apps/api/src/db/types.ts`

- [ ] **Step 1: Add AP enum types + table interfaces**

Add after the AR types (find `InvoiceLinesTable`, `PaymentsTable`, `CreditMemosTable` blocks and add the AP equivalents after them). Append to the DB interface export.

```ts
export type BillStatus = 'draft' | 'posted' | 'paid' | 'voided';
export type BillPaymentStatus = 'draft' | 'posted' | 'voided';
export type VendorCreditStatus = 'draft' | 'posted' | 'applied' | 'voided';

export interface VendorsTable {
  id: Generated<string>;
  business_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  billing_address: ColumnType<unknown, unknown, unknown> | null;
  tax_id: string | null;
  is_1099: Generated<boolean>;
  default_terms_days: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface BillsTable {
  id: Generated<string>;
  business_id: string;
  vendor_id: string;
  bill_number: string;
  bill_date: ColumnType<string, string, string>;
  due_date: ColumnType<string, string, string>;
  status: Generated<BillStatus>;
  subtotal: ColumnType<string, string | number | undefined, string | number>;
  total: ColumnType<string, string | number | undefined, string | number>;
  ap_account_id: string;
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

export interface BillLinesTable {
  id: Generated<string>;
  bill_id: string;
  line_number: number;
  description: string;
  quantity: ColumnType<string, string | number, string | number>;
  unit_price: ColumnType<string, string | number, string | number>;
  expense_account_id: string;
  line_subtotal: ColumnType<string, string | number, string | number>;
}

export interface BillPaymentsTable {
  id: Generated<string>;
  business_id: string;
  vendor_id: string;
  payment_date: ColumnType<string, string, string>;
  payment_method: PaymentMethod;
  reference: string | null;
  amount: ColumnType<string, string | number, string | number>;
  unapplied_amount: ColumnType<string, string | number | undefined, string | number>;
  cash_account_id: string;
  status: Generated<BillPaymentStatus>;
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

export interface BillPaymentApplicationsTable {
  id: Generated<string>;
  bill_payment_id: string | null;
  vendor_credit_id: string | null;
  bill_id: string;
  applied_amount: ColumnType<string, string | number, string | number>;
  applied_at: Generated<Timestamp>;
  applied_by_user_id: string | null;
}

export interface VendorCreditsTable {
  id: Generated<string>;
  business_id: string;
  vendor_id: string;
  credit_date: ColumnType<string, string, string>;
  amount: ColumnType<string, string | number, string | number>;
  remaining_amount: ColumnType<string, string | number, string | number>;
  offset_account_id: string;
  ap_account_id: string;
  status: Generated<VendorCreditStatus>;
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

Append to the `DB` interface:
```ts
  vendors: VendorsTable;
  bills: BillsTable;
  bill_lines: BillLinesTable;
  bill_payments: BillPaymentsTable;
  bill_payment_applications: BillPaymentApplicationsTable;
  vendor_credits: VendorCreditsTable;
```

Also extend `JournalEntrySourceType`:
```ts
export type JournalEntrySourceType =
  | 'manual' | 'invoice' | 'payment' | 'credit_memo'
  | 'bill' | 'bill_payment' | 'vendor_credit'
  | 'reversal';
```

- [ ] **Step 2: typecheck + commit**

```bash
npm -w @accounting/api run typecheck
git add apps/api/src/db/types.ts
git commit -m "feat(api): augment DB type with AP tables + JE source_type extension"
```

---

### Task 7: Audit actions + AP error classes

**Files:**
- Modify: `packages/shared/src/auditActions.ts`
- Modify: `packages/shared/src/errorCodes.ts` (if new codes needed)
- Create: `apps/api/src/lib/apErrors.ts`

- [ ] **Step 1: Add AP audit action constants**

Append to `packages/shared/src/auditActions.ts` inside the `AUDIT` const:

```ts
  VENDOR_CREATE: 'vendor.create',
  VENDOR_UPDATE: 'vendor.update',
  VENDOR_DELETE: 'vendor.delete',
  BILL_CREATE: 'bill.create',
  BILL_UPDATE: 'bill.update',
  BILL_ADD_LINE: 'bill.add_line',
  BILL_REMOVE_LINE: 'bill.remove_line',
  BILL_POST: 'bill.post',
  BILL_VOID: 'bill.void',
  BILL_PAYMENT_CREATE: 'bill_payment.create',
  BILL_PAYMENT_POST: 'bill_payment.post',
  BILL_PAYMENT_VOID: 'bill_payment.void',
  BILL_PAYMENT_APPLY: 'bill_payment.apply',
  BILL_PAYMENT_UNAPPLY: 'bill_payment.unapply',
  VENDOR_CREDIT_CREATE: 'vendor_credit.create',
  VENDOR_CREDIT_POST: 'vendor_credit.post',
  VENDOR_CREDIT_APPLY: 'vendor_credit.apply',
  VENDOR_CREDIT_VOID: 'vendor_credit.void',
```

- [ ] **Step 2: Write `apps/api/src/lib/apErrors.ts`**

```ts
import { ERR } from '@accounting/shared';
import { BusinessRuleError } from './errors.js';

export class BillHasApplicationsError extends BusinessRuleError {
  constructor(bill_id: string, application_count: number) {
    super(ERR.PRECONDITION_FAILED,
      `Bill ${bill_id} has ${application_count} applied payment(s); unapply before voiding`,
      { bill_id, application_count });
    this.name = 'BillHasApplicationsError';
  }
}

export class BillPaymentHasApplicationsError extends BusinessRuleError {
  constructor(bill_payment_id: string, application_count: number) {
    super(ERR.PRECONDITION_FAILED,
      `Bill payment ${bill_payment_id} has ${application_count} active application(s); unapply before voiding`,
      { bill_payment_id, application_count });
    this.name = 'BillPaymentHasApplicationsError';
  }
}
```

Note: OverApplicationError is already in `arErrors.ts` and the `kind` arg accepts a string — reuse by passing `'bill'` or `'bill_payment'` or `'vendor_credit'` as needed.

- [ ] **Step 3: Build shared + commit**

```bash
npm -w @accounting/shared run build
git add packages/shared/src/auditActions.ts apps/api/src/lib/apErrors.ts
git commit -m "feat(shared,api): AP audit actions + AP error classes"
```

---

### Task 8: AP zod schemas

**Files:**
- Create: `packages/shared/src/schemas/vendor.ts`
- Create: `packages/shared/src/schemas/bill.ts`
- Create: `packages/shared/src/schemas/billPayment.ts`
- Create: `packages/shared/src/schemas/vendorCredit.ts`
- Create: `packages/shared/src/schemas/tenNinetyNine.ts`
- Modify: `packages/shared/src/schemas/index.ts` (re-export)

- [ ] **Step 1: Write vendor.ts**

```ts
import { z } from 'zod';

export const vendorCreateSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  billing_address: z.record(z.string().max(200)).nullable().optional(),
  tax_id: z.string().max(50).nullable().optional(),
  is_1099: z.boolean().optional(),
  default_terms_days: z.number().int().min(0).max(365).optional(),
});
export type VendorCreate = z.infer<typeof vendorCreateSchema>;

export const vendorUpdateSchema = vendorCreateSchema.partial();
export type VendorUpdate = z.infer<typeof vendorUpdateSchema>;
```

- [ ] **Step 2: Write bill.ts**

```ts
import { z } from 'zod';

const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);

export const billLineCreateSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: moneyStr,
  unit_price: moneyStr,
  expense_account_id: z.string().uuid(),
});

export const billDraftCreateSchema = z.object({
  vendor_id: z.string().uuid(),
  bill_number: z.string().min(1).max(100),
  bill_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().nullable().optional(),
  terms: z.string().nullable().optional(),
  lines: z.array(billLineCreateSchema).min(1),
});
export type BillDraftCreate = z.infer<typeof billDraftCreateSchema>;

export const billVoidSchema = z.object({ void_reason: z.string().min(1).max(500) });
```

- [ ] **Step 3: Write billPayment.ts**

```ts
import { z } from 'zod';
const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);

export const billPaymentDraftCreateSchema = z.object({
  vendor_id: z.string().uuid(),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payment_method: z.enum(['cash','check','ach','wire','card','other']),
  reference: z.string().max(200).nullable().optional(),
  amount: moneyStr,
  cash_account_id: z.string().uuid(),
  memo: z.string().nullable().optional(),
  initial_applications: z.array(z.object({
    bill_id: z.string().uuid(),
    applied_amount: moneyStr,
  })).optional(),
});

export const billPaymentApplicationSchema = z.object({
  bill_id: z.string().uuid(),
  applied_amount: moneyStr,
});

export const billPaymentVoidSchema = z.object({ void_reason: z.string().min(1).max(500) });
```

- [ ] **Step 4: Write vendorCredit.ts**

```ts
import { z } from 'zod';
const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);

export const vendorCreditCreateSchema = z.object({
  vendor_id: z.string().uuid(),
  credit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: moneyStr,
  offset_account_id: z.string().uuid(),
  memo: z.string().nullable().optional(),
});

export const vendorCreditApplySchema = z.object({
  bill_id: z.string().uuid(),
  applied_amount: moneyStr,
});

export const vendorCreditVoidSchema = z.object({ void_reason: z.string().min(1).max(500) });
```

- [ ] **Step 5: Write tenNinetyNine.ts**

```ts
import { z } from 'zod';

export const tenNinetyNineQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(9999),
});
export type TenNinetyNineQuery = z.infer<typeof tenNinetyNineQuerySchema>;
```

- [ ] **Step 6: Update schemas/index.ts**

Append:
```ts
export * from './vendor.js';
export * from './bill.js';
export * from './billPayment.js';
export * from './vendorCredit.js';
export * from './tenNinetyNine.js';
```

- [ ] **Step 7: Build + commit**

```bash
npm -w @accounting/shared run build
git add packages/shared/src/schemas/
git commit -m "feat(shared): zod schemas for vendors, bills, bill payments, vendor credits, 1099"
```

---

### Task 9: Extend factories + truncateAll

**Files:**
- Modify: `apps/api/tests/helpers/factories.ts`
- Modify: `apps/api/tests/helpers/testDb.ts`

- [ ] **Step 1: Add AP factories**

Append to `factories.ts`:

```ts
export async function makeVendor(db: Kysely<DB>, business_id: string, opts: Partial<{ name: string; email: string | null; is_1099: boolean }> = {}) {
  return db.insertInto('vendors').values({
    business_id,
    name: opts.name ?? `Vendor ${Math.random().toString(36).slice(2, 8)}`,
    email: opts.email ?? null,
    is_1099: opts.is_1099 ?? false,
  }).returningAll().executeTakeFirstOrThrow();
}
```

- [ ] **Step 2: Extend truncateAll**

Add tables in reverse-dependency order BEFORE the existing AR tables:
```ts
'bill_payment_applications',
'bill_payments',
'vendor_credits',
'bill_lines',
'bills',
'vendors',
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/tests/helpers/factories.ts apps/api/tests/helpers/testDb.ts
git commit -m "test(api): factories for vendors; extended truncateAll"
```

---

## Phase B — Services

### Task 10: Vendor service (TDD, 3 tests)

**Files:**
- Create: `apps/api/src/services/ap/vendorService.ts`
- Create: `apps/api/tests/integration/vendorService.test.ts`

- [ ] **Step 1: Write tests mirroring customerService.test.ts**

Reference pattern: `apps/api/tests/integration/customerService.test.ts`. Three tests: createCustomer happy path, updateCustomer patches, deleteCustomer soft-deletes. Substitute `vendor` for `customer`, `makeVendor` for `makeCustomer`.

- [ ] **Step 2: Write service mirroring customerService.ts**

Reference: `apps/api/src/services/ar/customerService.ts`. Replace `customers`/`customer_id`/`Customer*` with `vendors`/`vendor_id`/`Vendor*`. Use `AUDIT.VENDOR_*` constants. Add optional `is_1099` + `tax_id` fields to CreateVendorInput.

- [ ] **Step 3: Run + commit**

```bash
npm -w @accounting/api run test:integration -- vendorService
git add apps/api/src/services/ap/vendorService.ts apps/api/tests/integration/vendorService.test.ts
git commit -m "feat(api): vendor service with TDD"
```

---

### Task 11: Bill service createDraft/post/void (TDD, 5 tests)

**Files:**
- Create: `apps/api/src/services/ap/billService.ts`
- Create: `apps/api/tests/integration/billService.test.ts`

- [ ] **Step 1: Write tests — mirror `invoiceService.test.ts` (5 tests)**

Test shapes (substitute bill for invoice, vendor for customer, expense_account_id for revenue_account_id + drop tax_code_id):
1. `createDraft creates a bill with computed totals` — 2 lines, total = sum(line_subtotals)
2. `postBill generates JE: DR Expense / CR AP` — verify JE lines
3. `postBill rejects empty bill`
4. `postBill rejects already-posted bill`
5. `voidBill creates reversing JE and flips bill to voided`

Full test file structure:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeVendor, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as billSvc from '../../src/services/ap/billService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000bbb01', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
  await seedYearPeriods(t.db, biz.id, 2026);
  await seedCoa(t.db, biz.id);
  const ap = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '2000').executeTakeFirstOrThrow();
  const expense = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '5010').executeTakeFirstOrThrow();
  const vendor = await makeVendor(t.db, biz.id, { name: 'Acme Supply' });
  return { firm, biz, user, ctx, ap, expense, vendor };
}

describe('billService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('createDraft creates a bill with computed totals', async () => {
    const { biz, ctx, vendor, expense } = await setup(t);
    const bill = await t.db.transaction().execute(trx =>
      billSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id,
        bill_number: 'BILL-001', bill_date: '2026-04-15', due_date: '2026-05-15',
        memo: 'Office supplies', terms: null,
        lines: [
          { description: 'Printer ink', quantity: '2', unit_price: '50.0000', expense_account_id: expense.id },
          { description: 'Paper', quantity: '5', unit_price: '10.0000', expense_account_id: expense.id },
        ],
      }),
    );
    expect(bill.bill.subtotal).toBe('150.0000');
    expect(bill.bill.total).toBe('150.0000');
    expect(bill.lines).toHaveLength(2);
  });

  it('postBill generates JE: DR Expense / CR AP', async () => {
    const { biz, ctx, vendor, expense, ap } = await setup(t);
    const draft = await t.db.transaction().execute(trx =>
      billSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id,
        bill_number: 'BILL-002', bill_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'Services', quantity: '1', unit_price: '500.0000', expense_account_id: expense.id }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: draft.bill.id }));
    expect(posted.status).toBe('posted');
    expect(posted.posted_journal_entry_id).toBeTruthy();

    const je = await t.db.selectFrom('journal_entries').selectAll().where('id', '=', posted.posted_journal_entry_id!).executeTakeFirstOrThrow();
    expect(je.source_type).toBe('bill');
    expect(je.source_id).toBe(draft.bill.id);

    const lines = await t.db.selectFrom('journal_entry_lines').selectAll()
      .where('journal_entry_id', '=', je.id).orderBy('line_number').execute();
    const expLine = lines.find(l => l.account_id === expense.id)!;
    expect(expLine.debit).toBe('500.0000');
    const apLine = lines.find(l => l.account_id === ap.id)!;
    expect(apLine.credit).toBe('500.0000');

    const audit = await t.db.selectFrom('audit_logs').selectAll().where('action', '=', 'bill.post').execute();
    expect(audit).toHaveLength(1);
  });

  it('postBill rejects empty bill', async () => {
    const { biz, ctx, vendor, expense } = await setup(t);
    const draft = await t.db.transaction().execute(trx =>
      billSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id,
        bill_number: 'BILL-003', bill_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'X', quantity: '1', unit_price: '10', expense_account_id: expense.id }],
      }),
    );
    await t.db.deleteFrom('bill_lines').where('bill_id', '=', draft.bill.id).execute();
    await expect(
      t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: draft.bill.id })),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
  });

  it('postBill rejects already-posted bill', async () => {
    const { biz, ctx, vendor, expense } = await setup(t);
    const draft = await t.db.transaction().execute(trx =>
      billSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id,
        bill_number: 'BILL-004', bill_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'X', quantity: '1', unit_price: '10', expense_account_id: expense.id }],
      }),
    );
    await t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: draft.bill.id }));
    await expect(
      t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: draft.bill.id })),
    ).rejects.toMatchObject({ code: ERR.INVALID_STATE_TRANSITION });
  });

  it('voidBill creates reversing JE and flips bill to voided', async () => {
    const { biz, ctx, vendor, expense } = await setup(t);
    const draft = await t.db.transaction().execute(trx =>
      billSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id,
        bill_number: 'BILL-005', bill_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'X', quantity: '1', unit_price: '50.0000', expense_account_id: expense.id }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: draft.bill.id }));
    await t.db.transaction().execute(trx => billSvc.voidBill(trx, ctx, { bill_id: posted.id, void_reason: 'data entry error' }));
    const after = await t.db.selectFrom('bills').selectAll().where('id', '=', posted.id).executeTakeFirstOrThrow();
    expect(after.status).toBe('voided');
    const jes = await t.db.selectFrom('journal_entries').selectAll()
      .where('source_id', '=', posted.posted_journal_entry_id!).execute();
    const reversal = jes.find(j => j.source_type === 'reversal');
    expect(reversal).toBeTruthy();
  });
});
```

- [ ] **Step 2: Write service**

Mirror `apps/api/src/services/ar/invoiceService.ts`. Mapping:
- `invoices` → `bills`, `invoice_lines` → `bill_lines`, `invoice_number` → `bill_number`, `issue_date` → `bill_date`
- `customer_id` → `vendor_id`, `revenue_account_id` → `expense_account_id`
- `ar_account_id` → `ap_account_id`, code `'1100'` → `'2000'`
- Remove all tax handling (no `tax_code_id`, no `tax_amount`, no `tax_total`, no `getEffectiveRate`)
- Simple `total = subtotal = SUM(line_subtotal)` where `line_subtotal = quantity * unit_price`
- JE shape: DR expense per distinct expense_account_id (sum of line_subtotals), CR AP for total
- Import `BillHasApplicationsError` from `../../lib/apErrors.js`
- Use `AUDIT.BILL_*` constants
- Extend `JournalEntrySourceType` cast to `'bill' satisfies JournalEntrySourceType`

Full signature:
```ts
export type BillLineInput = {
  description: string;
  quantity: string;
  unit_price: string;
  expense_account_id: string;
};
export type CreateDraftBillInput = {
  business_id: string;
  vendor_id: string;
  bill_number: string;
  bill_date: string;
  due_date: string;
  memo: string | null;
  terms: string | null;
  lines: BillLineInput[];
};

export async function createDraft(trx, ctx, input) { ... }
export async function postBill(trx, ctx, { bill_id }) { ... }
export async function voidBill(trx, ctx, { bill_id, void_reason }) { ... }
export async function getBillWithLines(db, business_id, bill_id) { ... }
export async function listBills(db, q) { ... }
```

- [ ] **Step 3: Run + commit**

```bash
npm -w @accounting/api run test:integration -- billService
git add apps/api/src/services/ap/billService.ts apps/api/tests/integration/billService.test.ts
git commit -m "feat(api): bill service with createDraft/post/void via ledger"
```

---

### Task 12: Bill addLine/removeLine + recompute

**Files:**
- Modify: `apps/api/src/services/ap/billService.ts` (append)
- Modify: `apps/api/tests/integration/billService.test.ts` (append 1 test)

- [ ] **Step 1: Add test mirroring invoiceService addLine/removeLine test**

Append to `billService.test.ts` (6th test):
```ts
it('addLine and removeLine work on drafts; refused on posted', async () => {
  const { biz, ctx, vendor, expense } = await setup(t);
  const draft = await t.db.transaction().execute(trx =>
    billSvc.createDraft(trx, ctx, {
      business_id: biz.id, vendor_id: vendor.id,
      bill_number: 'BILL-006', bill_date: '2026-04-15', due_date: '2026-05-15',
      memo: null, terms: null,
      lines: [{ description: 'A', quantity: '1', unit_price: '10', expense_account_id: expense.id }],
    }),
  );
  const after = await t.db.transaction().execute(trx =>
    billSvc.addLine(trx, ctx, { bill_id: draft.bill.id,
      line: { description: 'B', quantity: '2', unit_price: '5', expense_account_id: expense.id } }),
  );
  expect(after.lines).toHaveLength(2);
  expect(after.bill.subtotal).toBe('20.0000');

  await t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: draft.bill.id }));
  await expect(
    t.db.transaction().execute(trx =>
      billSvc.addLine(trx, ctx, { bill_id: draft.bill.id,
        line: { description: 'C', quantity: '1', unit_price: '1', expense_account_id: expense.id } }),
    ),
  ).rejects.toMatchObject({ code: ERR.INVALID_STATE_TRANSITION });
});
```

- [ ] **Step 2: Append `addLine`, `removeLine`, `recomputeBillTotals` to `billService.ts`**

Mirror `invoiceService.ts` equivalents. Substitute `bill_lines` / `bill_id`. `recomputeBillTotals` updates `subtotal` and `total` (both equal SUM(line_subtotal)).

- [ ] **Step 3: Run + commit**

```bash
npm -w @accounting/api run test:integration -- billService
git add apps/api/src/services/ap/billService.ts apps/api/tests/integration/billService.test.ts
git commit -m "feat(api): bill addLine/removeLine with totals recompute"
```

---

### Task 13: Bill payment service (TDD, 6 tests)

**Files:**
- Create: `apps/api/src/services/ap/billPaymentService.ts`
- Create: `apps/api/tests/integration/billPaymentService.test.ts`

- [ ] **Step 1: Write tests mirroring `paymentService.test.ts` (6 tests)**

Substitute: `payments` → `bill_payments`, `payment_applications` → `bill_payment_applications`, `customer_id` → `vendor_id`, `invoice_id` → `bill_id`. JE flips direction: **DR AP / CR Cash** (AR was DR Cash / CR AR).

Tests:
1. `postBillPayment generates JE: DR AP / CR Cash` — verify debit and credit are flipped relative to AR
2. `partial bill payment leaves bill posted (not paid) and unapplied_amount=0`
3. `overpayment leaves bill_payment with unapplied_amount > 0`
4. `addApplication after posting decrements unapplied_amount and may flip bill to paid`
5. `over-application is rejected with OVERAPPLICATION`
6. `voidBillPayment is refused while applications exist`

- [ ] **Step 2: Write service mirroring paymentService.ts**

Map: `payments` → `bill_payments`, `payment_applications` → `bill_payment_applications`, `customer_id` → `vendor_id`, `invoice_id` → `bill_id`, `invoices` → `bills`, `credit_memos` → `vendor_credits`, `source_type: 'payment'` → `'bill_payment'`. JE: cash_account_id as credit (amount), ap_account as debit. AP account lookup: `getSystemAccount(..., business_id, '2000')`.

Apply same reduce-as-string pattern learned in Slice 1 Task 15.

- [ ] **Step 3: Run + commit**

```bash
npm -w @accounting/api run test:integration -- billPaymentService
git add apps/api/src/services/ap/billPaymentService.ts apps/api/tests/integration/billPaymentService.test.ts
git commit -m "feat(api): bill payment service with applications + auto-paid bill flip"
```

---

### Task 14: Vendor credit service (TDD, 3 tests)

**Files:**
- Create: `apps/api/src/services/ap/vendorCreditService.ts`
- Create: `apps/api/tests/integration/vendorCreditService.test.ts`

- [ ] **Step 1: Write tests mirroring `creditMemoService.test.ts`**

Tests:
1. `post creates JE: DR AP / CR Offset` (inverse of credit memo which was DR Sales Returns / CR AR)
2. `apply vendor credit to bill reduces remaining_amount, no JE generated`
3. `over-application is rejected`

- [ ] **Step 2: Write service mirroring creditMemoService.ts**

Map: `credit_memos` → `vendor_credits`, `customer_id` → `vendor_id`, `revenue_account_id` (Sales Returns) → `offset_account_id`, `ar_account_id` → `ap_account_id`, code `'1100'` → `'2000'`, `source_type: 'credit_memo'` → `'vendor_credit'`, `payment_applications` → `bill_payment_applications`, `payments` → `bill_payments`, `invoices` → `bills`, `invoice_id` → `bill_id`, `credit_memo_id` → `vendor_credit_id`.

JE flips: `DR AP / CR offset_account` (the offset account is typically an expense contra).

Apply-to-bill path: DOES NOT generate a JE (same as AR credit memo). Just inserts a bpa row + decrements remaining_amount + maybe-marks bill paid.

- [ ] **Step 3: Run + commit**

```bash
npm -w @accounting/api run test:integration -- vendorCreditService
git add apps/api/src/services/ap/vendorCreditService.ts apps/api/tests/integration/vendorCreditService.test.ts
git commit -m "feat(api): vendor credit service with post/apply/void"
```

---

### Task 15: AP adversarial trigger tests + AP roundtrip

**Files:**
- Create: `apps/api/tests/integration/apTriggers.test.ts`
- Create: `apps/api/tests/integration/apRoundtrip.test.ts`

- [ ] **Step 1: Write apTriggers.test.ts mirroring `arTriggers.test.ts`**

2 tests: `cannot UPDATE subtotal on posted bill`, `cannot DELETE posted bill_payment`.

- [ ] **Step 2: Write apRoundtrip.test.ts mirroring `arRoundtrip.test.ts`**

Scenario: create bill for $500 → post → record payment $500 → post + apply → bill flips to `paid`. Verify trial balance: AP=0 (DR 500 from payment = CR 500 from bill), Cash=−500 (expense outflow), Expense=+500 (DR).

- [ ] **Step 3: Run + commit**

```bash
npm -w @accounting/api run test:integration -- "apTriggers|apRoundtrip"
git add apps/api/tests/integration/apTriggers.test.ts apps/api/tests/integration/apRoundtrip.test.ts
git commit -m "test(api): AP adversarial triggers + full roundtrip integration"
```

---

### Task 16: 1099 report service (TDD, 1 test)

**Files:**
- Create: `apps/api/src/services/ap/reports/tenNinetyNineReportService.ts`
- Create: `apps/api/tests/integration/tenNinetyNineReport.test.ts`

- [ ] **Step 1: Write test**

Scenario: 2 vendors, one 1099-flagged, one not. 3 posted bill payments in 2026 (one to 1099 vendor for $600, one to non-1099 for $500, one to 1099 for $200). Query 1099 report for 2026 → only the 1099 vendor appears with total $800.

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeVendor, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as billSvc from '../../src/services/ap/billService.js';
import * as payment from '../../src/services/ap/billPaymentService.js';
import * as rpt from '../../src/services/ap/reports/tenNinetyNineReportService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000bbb09', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('1099 report', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('aggregates posted bill payments by 1099 vendor for the year', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const cash = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id','=',biz.id).where('code','=','1020').executeTakeFirstOrThrow();
    const expense = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id','=',biz.id).where('code','=','5010').executeTakeFirstOrThrow();
    const v1099 = await makeVendor(t.db, biz.id, { name: 'Contractor Co', is_1099: true });
    const vNot = await makeVendor(t.db, biz.id, { name: 'Staples', is_1099: false });

    const makeBill = async (vendor_id: string, num: string, amount: string) => {
      const d = await t.db.transaction().execute(trx => billSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id, bill_number: num, bill_date: '2026-03-01', due_date: '2026-04-01',
        memo: null, terms: null,
        lines: [{ description: 'Services', quantity: '1', unit_price: amount, expense_account_id: expense.id }],
      }));
      return t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: d.bill.id }));
    };
    const payBill = async (vendor_id: string, bill_id: string, amount: string, date: string) => {
      const dr = await t.db.transaction().execute(trx => payment.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id, payment_date: date, payment_method: 'check',
        reference: null, amount, cash_account_id: cash.id, memo: null,
        initial_applications: [{ bill_id, applied_amount: amount }],
      }));
      return t.db.transaction().execute(trx => payment.postBillPayment(trx, ctx, { bill_payment_id: dr.bill_payment.id }));
    };

    const b1 = await makeBill(v1099.id, 'B-1099-A', '600.0000');
    const b2 = await makeBill(vNot.id, 'B-NOT', '500.0000');
    const b3 = await makeBill(v1099.id, 'B-1099-B', '200.0000');
    await payBill(v1099.id, b1.id, '600.0000', '2026-04-01');
    await payBill(vNot.id, b2.id, '500.0000', '2026-04-01');
    await payBill(v1099.id, b3.id, '200.0000', '2026-06-15');

    const rows = await rpt.tenNinetyNine(t.db, { business_id: biz.id, year: 2026 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.vendor_name).toBe('Contractor Co');
    expect(rows[0]!.total_paid).toBe('800.0000');
  });
});
```

- [ ] **Step 2: Write service**

```ts
import { type Kysely, sql } from 'kysely';
import { addMoney, toMoneyString } from '@accounting/shared';
import type { DB } from '../../../db/types.js';

export type TenNinetyNineRow = {
  vendor_id: string;
  vendor_name: string;
  tax_id: string | null;
  total_paid: string;
};

export async function tenNinetyNine(db: Kysely<DB>, q: { business_id: string; year: number }): Promise<TenNinetyNineRow[]> {
  const start = `${q.year}-01-01`;
  const end = `${q.year}-12-31`;
  const rows = await db.selectFrom('bill_payments as bp')
    .innerJoin('vendors as v', 'v.id', 'bp.vendor_id')
    .select(({ fn }) => [
      'v.id as vendor_id', 'v.name as vendor_name', 'v.tax_id',
      fn.coalesce(fn.sum<string>('bp.amount'), sql.lit('0')).as('total_paid'),
    ])
    .where('bp.business_id', '=', q.business_id)
    .where('bp.status', '=', 'posted')
    .where('bp.payment_date', '>=', start)
    .where('bp.payment_date', '<=', end)
    .where('v.is_1099', '=', true)
    .where('v.deleted_at', 'is', null)
    .groupBy(['v.id', 'v.name', 'v.tax_id'])
    .orderBy('v.name')
    .execute();
  return rows.map(r => ({
    vendor_id: r.vendor_id,
    vendor_name: r.vendor_name,
    tax_id: r.tax_id,
    total_paid: toMoneyString(addMoney(r.total_paid ?? '0', '0')),
  }));
}
```

- [ ] **Step 3: Run + commit**

```bash
npm -w @accounting/api run test:integration -- tenNinetyNineReport
git add apps/api/src/services/ap/reports/tenNinetyNineReportService.ts apps/api/tests/integration/tenNinetyNineReport.test.ts
git commit -m "feat(api): 1099 report service with TDD"
```

---

## Phase C — Routes

### Task 17: Vendor routes

**Files:**
- Create: `apps/api/src/routes/vendors.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write `routes/vendors.ts` mirroring `customers.ts`**

Exact same shape:
```ts
import { Router } from 'express';
import type { Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as vend from '../services/ap/vendorService.js';
import type { ServiceCtx } from '../lib/ctx.js';

const router = Router({ mergeParams: true });

function ctxFromReq(req: Request): ServiceCtx { /* same as customers.ts */ }

router.use('/businesses/:businessId', requireAuth, resolveBusiness);

router.get('/businesses/:businessId/vendors', async (req, res, next) => {
  try { res.json({ vendors: await vend.listVendors(db, req.tenancy!.business_id) }); }
  catch (e) { next(e); }
});

router.get('/businesses/:businessId/vendors/:id', async (req, res, next) => {
  try { res.json(await vend.getVendor(db, req.tenancy!.business_id, req.params['id']!)); }
  catch (e) { next(e); }
});

router.post('/businesses/:businessId/vendors', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.vendorCreateSchema.parse(req.body);
    // Build input conditionally for exactOptionalPropertyTypes
    const input: Parameters<typeof vend.createVendor>[2] = { business_id: req.tenancy!.business_id, name: body.name, email: body.email ?? null };
    if (body.phone !== undefined) input.phone = body.phone ?? null;
    if (body.is_1099 !== undefined) input.is_1099 = body.is_1099;
    if (body.tax_id !== undefined) input.tax_id = body.tax_id ?? null;
    if (body.default_terms_days !== undefined) input.default_terms_days = body.default_terms_days;
    const created = await db.transaction().execute(trx => vend.createVendor(trx, ctxFromReq(req), input));
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.patch('/businesses/:businessId/vendors/:id', requireMinRole('accountant'), async (req, res, next) => { /* mirror customers patch */ });

router.delete('/businesses/:businessId/vendors/:id', requireMinRole('firm_admin'), async (req, res, next) => { /* mirror customers delete */ });

export default router;
```

- [ ] **Step 2: Wire in `app.ts`**

Add import `import vendorRoutes from './routes/vendors.js';` and `app.use(vendorRoutes);` alongside the other AR routes.

- [ ] **Step 3: Typecheck, lint, commit**

```bash
npm -w @accounting/api run typecheck
npx eslint apps/api/src/routes/vendors.ts
git add apps/api/src/routes/vendors.ts apps/api/src/app.ts
git commit -m "feat(api): vendor routes"
```

---

### Task 18: Bill + bill payment + vendor credit routes

**Files:**
- Create: `apps/api/src/routes/bills.ts`, `billPayments.ts`, `vendorCredits.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Mirror `invoices.ts`, `payments.ts`, `creditMemos.ts`**

Path mapping:
- `/businesses/:businessId/bills` (list, detail, POST, post, void)
- `/businesses/:businessId/bill-payments` (list, detail, POST, post, void, applications)
- `/businesses/:businessId/vendor-credits` (list, POST, post, apply, void)

Reuse the `Request`-typed `ctxFromReq` helper in each. Use `schemas.billDraftCreateSchema`, `billVoidSchema`, `billPaymentDraftCreateSchema`, `billPaymentApplicationSchema`, `billPaymentVoidSchema`, `vendorCreditCreateSchema`, `vendorCreditApplySchema`, `vendorCreditVoidSchema`.

Exactly mirror the exactOptionalPropertyTypes patch-building patterns from `invoices.ts` / `payments.ts` / `creditMemos.ts`.

- [ ] **Step 2: Wire in app.ts** — add 3 imports + 3 `app.use(...)`.

- [ ] **Step 3: Typecheck, lint, commit**

```bash
npm -w @accounting/api run typecheck
npx eslint apps/api/src/routes/{bills,billPayments,vendorCredits}.ts
git add apps/api/src/routes/bills.ts apps/api/src/routes/billPayments.ts apps/api/src/routes/vendorCredits.ts apps/api/src/app.ts
git commit -m "feat(api): bill + bill payment + vendor credit routes"
```

---

### Task 19: 1099 report route

**Files:**
- Create: `apps/api/src/routes/tenNinetyNineReport.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write mirroring `agingReport.ts`**

```ts
import { Router } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import * as rpt from '../services/ap/reports/tenNinetyNineReportService.js';

const router = Router({ mergeParams: true });
router.use('/businesses/:businessId', requireAuth, resolveBusiness);

router.get('/businesses/:businessId/reports/1099', async (req, res, next) => {
  try {
    const q = schemas.tenNinetyNineQuerySchema.parse({ year: req.query['year'] ?? new Date().getFullYear() });
    const rows = await rpt.tenNinetyNine(db, { business_id: req.tenancy!.business_id, year: q.year });
    res.json({ year: q.year, rows });
  } catch (e) { next(e); }
});

export default router;
```

- [ ] **Step 2: Wire in app.ts** (add import + `app.use`).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/tenNinetyNineReport.ts apps/api/src/app.ts
git commit -m "feat(api): 1099 report route"
```

---

## Phase D — Seed + web

### Task 20: AP seed — sample vendors

**Files:**
- Create: `db/seeds/0004_ap.sql`

- [ ] **Step 1: Write**

```sql
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM businesses WHERE deleted_at IS NULL LOOP
    IF NOT EXISTS (SELECT 1 FROM vendors WHERE business_id = r.id) THEN
      INSERT INTO vendors (business_id, name, email, is_1099, tax_id, default_terms_days) VALUES
        (r.id, 'Office Supplies Co',  'orders@officesupplies.example', false, NULL, 30),
        (r.id, 'Acme Contractors LLC', 'ap@acme-contractors.example',  true,  '12-3456789', 30);
    END IF;
  END LOOP;
END $$;
```

- [ ] **Step 2: Apply + commit**

```bash
npm run db:seed
git add db/seeds/0004_ap.sql
git commit -m "feat(db): seed sample vendors (one 1099-flagged)"
```

---

### Task 21: Vendor pages (list/new/detail)

**Files:**
- Create: `apps/web/src/pages/vendors/VendorListPage.tsx`
- Create: `apps/web/src/pages/vendors/VendorNewPage.tsx`
- Create: `apps/web/src/pages/vendors/VendorDetailPage.tsx`

- [ ] **Step 1: Mirror `pages/customers/*`**

Replace `customer` → `vendor`, `/customers` → `/vendors`, `customers API` → `vendors API`. Add `is_1099` checkbox + `tax_id` field to New/Edit forms.

VendorListPage columns: Name, Email, Terms, 1099 (Yes/No badge), Action.
VendorDetailPage: contact card + bills table (GET `/businesses/:id/bills?vendor_id=...`).

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/vendors/
git commit -m "feat(web): vendor list/new/detail pages"
```

---

### Task 22: Bill pages (list + detail)

**Files:**
- Create: `apps/web/src/pages/bills/BillListPage.tsx`, `BillDetailPage.tsx`

- [ ] **Step 1: Mirror `invoices/InvoiceListPage.tsx` + `InvoiceDetailPage.tsx`**

Columns: Bill #, Vendor, Bill Date, Due, Status, Total, Action. Status filter dropdown.

BillDetailPage: header with bill #, status, dates, totals. Post button (draft → posted). Void button (posted/paid → voided). Lines table.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/bills/BillListPage.tsx apps/web/src/pages/bills/BillDetailPage.tsx
git commit -m "feat(web): bill list + detail pages with post/void"
```

---

### Task 23: Bill creation page

**Files:**
- Create: `apps/web/src/pages/bills/BillNewPage.tsx`

- [ ] **Step 1: Mirror `InvoiceNewPage.tsx`**

Drop tax_code dropdown (bills have no tax in Slice 2). Vendor select + line-item grid (description, qty, unit_price, expense account). Expense accounts = `account_type === 'expense' && is_active`.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/bills/BillNewPage.tsx
git commit -m "feat(web): bill creation page"
```

---

### Task 24: Bill payment pages (list/detail/new)

**Files:**
- Create: `apps/web/src/pages/bill-payments/BillPaymentListPage.tsx`
- Create: `apps/web/src/pages/bill-payments/BillPaymentDetailPage.tsx`
- Create: `apps/web/src/pages/bill-payments/BillPaymentNewPage.tsx`

- [ ] **Step 1: Mirror `payments/*`**

Replace `payments` → `bill-payments`, `customer_id` → `vendor_id`, `invoice` → `bill`. Open bills fetched via `/businesses/:id/bills?vendor_id=X&status=posted`.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/bill-payments/
git commit -m "feat(web): bill payment list/detail/new with applications UI"
```

---

### Task 25: Vendor credit pages (list/new/detail)

**Files:**
- Create: `apps/web/src/pages/vendor-credits/VendorCreditListPage.tsx`
- Create: `apps/web/src/pages/vendor-credits/VendorCreditNewPage.tsx`
- Create: `apps/web/src/pages/vendor-credits/VendorCreditDetailPage.tsx`

- [ ] **Step 1: Mirror `credit-memos/*`**

Replace `credit-memos` → `vendor-credits`, `customer_id` → `vendor_id`, `revenue_account_id` → `offset_account_id` (expense contra or similar — use any expense CoA row for Slice 2 simplicity).

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/vendor-credits/
git commit -m "feat(web): vendor credit list/new/detail pages"
```

---

### Task 26: 1099 report page

**Files:**
- Create: `apps/web/src/pages/reports/TenNinetyNineReportPage.tsx`

- [ ] **Step 1: Write**

Year selector (current year default), fetches `/reports/1099?year=N`, shows table: Vendor, Tax ID, Total Paid.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/reports/TenNinetyNineReportPage.tsx
git commit -m "feat(web): 1099 report page"
```

---

### Task 27: Wire AP pages into App.tsx + sidebar + swap ComingSoonPage

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Replace ComingSoonPage for AP items**

In `App.tsx`:
- `/ap/vendors` → `VendorListPage`, `/ap/vendors/new` → `VendorNewPage`, `/ap/vendors/:id` → `VendorDetailPage`
- `/ap/bills` → `BillListPage`, `/ap/bills/new` → `BillNewPage`, `/ap/bills/:id` → `BillDetailPage`
- `/ap/bill-payments` → `BillPaymentListPage`, `/ap/bill-payments/new` → `BillPaymentNewPage`, `/ap/bill-payments/:id` → `BillPaymentDetailPage`
- `/ap/vendor-credits` → `VendorCreditListPage`, `/ap/vendor-credits/new` → `VendorCreditNewPage`, `/ap/vendor-credits/:id` → `VendorCreditDetailPage`
- `/reports/1099` → `TenNinetyNineReportPage`

Rename AP sub-items in `Sidebar.tsx` to match the mockup's hierarchy but point at the new routes:
- AP > Overview → placeholder (hub page later; for now leave as ComingSoon)
- AP > Expense Transactions → placeholder
- AP > Vendors → `/ap/vendors`
- AP > Bills → `/ap/bills`
- AP > Bill Payments → `/ap/bill-payments`
- AP > Contractors → placeholder
- AP > 1099s → `/reports/1099`

(Move "Vendor Credits" to AP group; the mockup didn't include it but we have it. Add it after Bill Payments.)

Also add `/reports/1099` to the Reports > Standard Reports hub.

- [ ] **Step 2: Build + commit**

```bash
npm -w @accounting/web run build
git add apps/web/src/App.tsx apps/web/src/components/layout/Sidebar.tsx
git commit -m "feat(web): wire AP pages into routes + swap ComingSoon placeholders"
```

---

## Phase E — Deploy + smoke

### Task 28: Full-stack migrate + smoke

- [ ] **Step 1: Merge slice-2 to main locally**

Run from `/Users/aheedkamil/projects/accounting-app` (main clone, NOT the worktree):
```bash
git checkout main && git pull && git merge slice-2 && git push origin main
```

- [ ] **Step 2: Let Railway auto-deploy**

The startCommand (`npm run migrate:prod && npm run start:api`) runs migrations 0016-0020 on the prod DB and restarts the api. Watch the log for successful APPLYs.

- [ ] **Step 3: Browser smoke via deployed stack**

Log into the Netlify URL. Walk:
1. Vendors → create, then New Bill → post it.
2. Bill Payments → Record Payment → post + apply. Bill flips to paid.
3. 1099 Report for the current year → shows the vendor if flagged.
4. Trial Balance totals still balanced.
5. Open DevTools: zero red console errors on each new page.

---

## Definition of Done

- All 20 migrations applied (0001-0020).
- Integration suite: prior 66/66 + at least 18 new AP tests = ≥84 tests passing.
- Adversarial AP trigger tests pass.
- AP roundtrip test passes.
- 1099 report test passes.
- Sample vendors seeded (one 1099-flagged).
- Web sidebar AP group links to real pages (not ComingSoonPage).
- Railway migration log shows APPLY 0016 through APPLY 0020.
- Deployed smoke: create a bill, pay it, verify bill flips to paid + TB balances.
- Every new AP audit action emits at least once in the smoke test (vendor.*, bill.*, bill_payment.*, vendor_credit.*).
