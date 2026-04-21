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
