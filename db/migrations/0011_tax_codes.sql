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
