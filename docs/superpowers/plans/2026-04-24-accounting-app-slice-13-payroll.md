# Slice 13 — Payroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Replace the final 5 ComingSoon stubs (Payroll Overview, Employees, Payroll Contractors, Payroll Taxes, Compliance) with real ledger-posting payroll features.

**Architecture:**
- **Employees** with libsodium-style encrypted SSN (reuses `lib/fieldCrypto.ts` introduced in slice 8 + the existing `FIELD_ENCRYPTION_KEY` env var).
- **Pay Runs** as the workflow entity. On finalize, posts a JE: DR Wages Expense + DR Payroll Tax Expense / CR Cash + CR Payroll Tax Liabilities.
- **Payroll Taxes** = a list of accrued tax liabilities + "Record tax payment" action (DR Liability / CR Cash).
- **Compliance** = static checklist with optional document uploads (reuses `fileStorage` + `files` table from slice 10).
- **Payroll Contractors** = filtered view of `vendors WHERE is_1099 = true` (reuses slice 8 contractor flag).

**Tech Stack:** No new deps. fieldCrypto already exists. Files infra already exists.

---

## Locked decisions

1. **No automated tax engine.** Pay run lines are manually entered: gross, federal_wh, state_wh, fica_employee, fica_employer, medicare_employee, medicare_employer, other_deductions. The user picks the tax rates from their accountant; we just store them.
2. **SSN encrypted at rest.** Encrypted via `encryptField` from `lib/fieldCrypto.ts`. Only `ssn_last_four` returned to clients by default. Full SSN exposed via `GET /employees/:id/ssn-reveal` (firm_admin only, audit-logged).
3. **Pay runs are immutable once finalized.** A finalized run posts the JE and locks. To correct, void + re-create.
4. **Payroll Contractors don't get pay runs.** The "Pay contractor" action creates a Bill against the vendor (uses `billService`).
5. **Compliance items** seeded automatically per business (state_registration, new_hire_report, labor_law_poster, annual_filing).
6. **Plan-impl sync.**

---

## Phase A — Infra + DB

### Task 1: Migration `0044_employees.sql`

```sql
CREATE TYPE pay_frequency AS ENUM ('weekly', 'biweekly', 'semimonthly', 'monthly');
CREATE TYPE w4_filing_status AS ENUM ('single', 'married_jointly', 'married_separately', 'head_of_household');

CREATE TABLE employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  full_name text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 200),
  email text,
  phone text,
  address jsonb,
  ssn_encrypted bytea,
  ssn_last_four text CHECK (ssn_last_four IS NULL OR ssn_last_four ~ '^\d{1,4}$'),
  hire_date date NOT NULL,
  termination_date date,
  default_pay_rate_cents bigint NOT NULL DEFAULT 0 CHECK (default_pay_rate_cents >= 0),
  default_pay_frequency pay_frequency NOT NULL DEFAULT 'biweekly',
  w4_filing_status w4_filing_status,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT employees_ssn_consistent CHECK (
    (ssn_encrypted IS NULL AND ssn_last_four IS NULL)
    OR (ssn_encrypted IS NOT NULL AND ssn_last_four IS NOT NULL)
  )
);
CREATE INDEX idx_employees_business ON employees(business_id) WHERE deleted_at IS NULL;
CREATE TRIGGER employees_updated_at BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Commit: `feat(db): employees table with encrypted SSN`.

### Task 2: Migration `0045_pay_runs.sql`

```sql
CREATE TYPE pay_run_status AS ENUM ('draft', 'finalized', 'void');

CREATE TABLE pay_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  pay_period_start date NOT NULL,
  pay_period_end date NOT NULL CHECK (pay_period_end >= pay_period_start),
  pay_date date NOT NULL,
  status pay_run_status NOT NULL DEFAULT 'draft',
  journal_entry_id uuid REFERENCES journal_entries(id),
  wages_expense_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  payroll_tax_expense_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  cash_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  fed_tax_liability_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  state_tax_liability_account_id uuid REFERENCES chart_of_accounts(id),
  fica_liability_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  finalized_at timestamptz,
  finalized_by_user_id uuid REFERENCES users(id),
  CONSTRAINT pr_finalized_has_je CHECK (
    (status = 'finalized') = (journal_entry_id IS NOT NULL AND finalized_at IS NOT NULL)
  )
);
CREATE INDEX idx_pr_business ON pay_runs(business_id);
CREATE TRIGGER pay_runs_updated_at BEFORE UPDATE ON pay_runs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE pay_run_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_run_id uuid NOT NULL REFERENCES pay_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  gross numeric(19,4) NOT NULL CHECK (gross >= 0),
  federal_wh numeric(19,4) NOT NULL DEFAULT 0,
  state_wh numeric(19,4) NOT NULL DEFAULT 0,
  fica_employee numeric(19,4) NOT NULL DEFAULT 0,
  fica_employer numeric(19,4) NOT NULL DEFAULT 0,
  medicare_employee numeric(19,4) NOT NULL DEFAULT 0,
  medicare_employer numeric(19,4) NOT NULL DEFAULT 0,
  other_deductions numeric(19,4) NOT NULL DEFAULT 0,
  net numeric(19,4) NOT NULL,
  CONSTRAINT prl_unique UNIQUE (pay_run_id, employee_id)
);
CREATE INDEX idx_prl_pay_run ON pay_run_lines(pay_run_id);
```

Commit: `feat(db): pay_runs + pay_run_lines`.

### Task 3: Migration `0046_payroll_tax_liabilities.sql`

```sql
CREATE TYPE payroll_tax_period AS ENUM ('monthly', 'quarterly', 'annual');
CREATE TYPE payroll_tax_status AS ENUM ('accrued', 'paid');

CREATE TABLE payroll_tax_liabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  period payroll_tax_period NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL CHECK (period_end >= period_start),
  liability_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  status payroll_tax_status NOT NULL DEFAULT 'accrued',
  paid_at timestamptz,
  payment_journal_entry_id uuid REFERENCES journal_entries(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ptl_paid_has_je CHECK (
    (status = 'paid') = (payment_journal_entry_id IS NOT NULL)
  )
);
CREATE INDEX idx_ptl_business ON payroll_tax_liabilities(business_id);
CREATE TRIGGER payroll_tax_liabilities_updated_at BEFORE UPDATE ON payroll_tax_liabilities FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Commit: `feat(db): payroll_tax_liabilities table`.

### Task 4: Migration `0047_compliance_items.sql`

```sql
CREATE TYPE compliance_item_key AS ENUM (
  'state_registration', 'new_hire_report', 'labor_law_poster', 'annual_filing'
);
CREATE TYPE compliance_item_status AS ENUM ('open', 'in_progress', 'done', 'na');

CREATE TABLE compliance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  item_key compliance_item_key NOT NULL,
  status compliance_item_status NOT NULL DEFAULT 'open',
  due_date date,
  notes text,
  document_file_id uuid REFERENCES files(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ci_unique UNIQUE (business_id, item_key)
);
CREATE INDEX idx_ci_business ON compliance_items(business_id);
CREATE TRIGGER compliance_items_updated_at BEFORE UPDATE ON compliance_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Auto-seed default items per business (similar to period_review_tasks pattern).
CREATE OR REPLACE FUNCTION seed_compliance_items() RETURNS trigger AS $$
BEGIN
  INSERT INTO compliance_items (business_id, item_key) VALUES
    (NEW.id, 'state_registration'),
    (NEW.id, 'new_hire_report'),
    (NEW.id, 'labor_law_poster'),
    (NEW.id, 'annual_filing')
  ON CONFLICT (business_id, item_key) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER businesses_seed_compliance
  AFTER INSERT ON businesses
  FOR EACH ROW EXECUTE FUNCTION seed_compliance_items();

-- Backfill for existing businesses
DO $$
DECLARE b record;
BEGIN
  FOR b IN SELECT id FROM businesses LOOP
    INSERT INTO compliance_items (business_id, item_key) VALUES
      (b.id, 'state_registration'),
      (b.id, 'new_hire_report'),
      (b.id, 'labor_law_poster'),
      (b.id, 'annual_filing')
    ON CONFLICT (business_id, item_key) DO NOTHING;
  END LOOP;
END $$;
```

Commit: `feat(db): compliance_items table with auto-seed`.

### Task 5: DB types + audit + schemas + factories + truncateAll

Append types for `EmployeesTable`, `PayRunsTable`, `PayRunLinesTable`, `PayrollTaxLiabilitiesTable`, `ComplianceItemsTable`. Add to DB.

Audit actions:
```ts
EMPLOYEE_CREATE: 'employee.create',
EMPLOYEE_UPDATE: 'employee.update',
EMPLOYEE_DELETE: 'employee.delete',
EMPLOYEE_SSN_REVEAL: 'employee.ssn_reveal',
PAY_RUN_CREATE: 'pay_run.create',
PAY_RUN_UPDATE: 'pay_run.update',
PAY_RUN_FINALIZE: 'pay_run.finalize',
PAY_RUN_VOID: 'pay_run.void',
PAYROLL_TAX_RECORD: 'payroll_tax.record',
PAYROLL_TAX_PAY: 'payroll_tax.pay',
COMPLIANCE_ITEM_UPDATE: 'compliance_item.update',
```

Zod schemas: `employee.ts`, `payRun.ts`, `payrollTax.ts`, `complianceItem.ts`. Re-export.

Factories: `makeEmployee`, `makePayRun`.

`truncateAll` prepend: `'compliance_items', 'payroll_tax_liabilities', 'pay_run_lines', 'pay_runs', 'employees'`.

Commit: `feat(shared,api): slice 13 audit, schemas, factories, types, truncateAll`.

---

## Phase B — Services (parallel, in 2 batches due to load)

### Batch 1 (3 agents)

#### Task 6: `employeeService` (TDD, 2 tests)
- `create`, `update`, `delete` (soft), `list`, `get`.
- `revealSSN(db, ctx, employee_id)` — firm_admin only, audit-logged.
- Tests: create with SSN → ssn_last_four extracted; revealSSN audit-logged.

#### Task 7: `complianceService` (TDD, 1 test)
- `listForBusiness`, `update(trx, ctx, { item_id, patch: { status?, due_date?, notes?, document_file_id? } })`.
- Test: list returns 4 default items for a fresh business.

#### Task 8: `payrollOverviewService` (TDD, 1 test)
Read-only:
```ts
{
  next_pay_date: string | null,
  total_liabilities_outstanding: string,
  last_pay_run_total: string,
  employee_count: number,
}
```

### Batch 2 (2 agents)

#### Task 9: `payRunService` (TDD, 3 tests)
- `createDraft(trx, ctx, { business_id, pay_period_start, pay_period_end, pay_date, accounts: { wages, payroll_tax, cash, fed_tax_liability, state_tax_liability?, fica_liability }, lines: [{ employee_id, gross, federal_wh, state_wh, fica_employee, fica_employer, medicare_employee, medicare_employer, other_deductions }] })`. Compute net per line: `gross - federal_wh - state_wh - fica_employee - medicare_employee - other_deductions`.
- `finalize(trx, ctx, { pay_run_id })` — posts JE, links it, status='finalized'. JE shape:
  - DR wages_expense (sum of gross)
  - DR payroll_tax_expense (sum of fica_employer + medicare_employer)
  - CR cash (sum of net)
  - CR fed_tax_liability (sum of federal_wh)
  - CR state_tax_liability (sum of state_wh) — only if state_tax_liability_account_id is set
  - CR fica_liability (sum of fica_employee + fica_employer + medicare_employee + medicare_employer)
- `voidRun(trx, ctx, { pay_run_id })` — voids the JE if finalized.
- Tests: create computes net; finalize posts balanced JE; void reverses.

#### Task 10: `payrollTaxService` (TDD, 1 test)
- `recordLiability(trx, ctx, { business_id, period, period_start, period_end, liability_account_id, amount, notes? })` — insert; audit RECORD.
- `payLiability(trx, ctx, { liability_id, cash_account_id, payment_date })` — posts DR liability / CR cash JE; status='paid'.
- `listLiabilities(db, business_id, opts: { status? })`.
- Test: pay_liability flips status + posts JE.

---

## Phase C — Routes (parallel)

### Task 11: employees.ts route
GET list/detail, POST create (firm_admin), PATCH update, DELETE, GET `/:id/ssn-reveal` (firm_admin).

### Task 12: payRuns.ts route
CRUD + `/:id/finalize` + `/:id/void`.

### Task 13: payrollTaxes.ts + payrollOverview.ts routes
List/record/pay endpoints; overview GET.

### Task 14: compliance.ts route
GET list, PATCH `/:id`.

---

## Phase D — Web (parallel)

### Task 15: PayrollOverviewPage
KPI cards.

### Task 16: EmployeeListPage + New + Detail
SSN masked by default; Reveal button (firm_admin) calls reveal endpoint.

### Task 17: PayrollContractorsPage
Filtered Vendors view (where `is_1099 = true`) + "Create contractor pay" → opens Bill creation prefilled with the vendor.

### Task 18: PayrollTaxesPage
List of accrued liabilities with "Record payment" action.

### Task 19: CompliancePage
Checklist of 4 default items + status select + notes + document upload.

### Task 20 (SOLO): Wire 5 routes in App.tsx.

---

## Phase E — Merge + push

Standard. Migrations 0044-0047 auto-run. **Deploy prereq:** `FIELD_ENCRYPTION_KEY` already set on Railway from slice 8 deploy — no new env vars.

---

## Definition of Done

- Final 5 ComingSoon stubs in `/payroll/*` replaced.
- Migrations 0044-0047 applied (47 total since project start).
- ~9 new tests (slice 12 baseline 149 → ≥158).
- A pay run can be created with employees + lines, finalized to post a balanced JE.
- A tax liability can be recorded and paid (DR Liability / CR Cash JE).
- Compliance items auto-seed for a new business.
- Employee SSN encrypted at rest; reveal endpoint audit-logs every call.
- **Spec definition of done met:** all 23 ComingSoon stubs from spec section 2 replaced (verify `grep ComingSoonPage apps/web/src/App.tsx | wc -l` returns 0).
