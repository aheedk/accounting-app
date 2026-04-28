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
