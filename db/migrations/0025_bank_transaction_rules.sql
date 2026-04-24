CREATE TYPE bank_rule_sign_filter AS ENUM ('any', 'inflow_only', 'outflow_only');

CREATE TABLE bank_transaction_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description_contains text NOT NULL CHECK (length(description_contains) BETWEEN 1 AND 500),
  min_amount numeric(19,4),
  max_amount numeric(19,4),
  sign_filter bank_rule_sign_filter NOT NULL DEFAULT 'any',
  offset_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  priority int NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT btr_amount_range CHECK (min_amount IS NULL OR max_amount IS NULL OR min_amount <= max_amount)
);
CREATE INDEX idx_btr_biz_active ON bank_transaction_rules(business_id, priority) WHERE is_active AND deleted_at IS NULL;
CREATE TRIGGER btr_updated_at BEFORE UPDATE ON bank_transaction_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
