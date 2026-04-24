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
