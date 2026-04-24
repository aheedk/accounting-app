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
