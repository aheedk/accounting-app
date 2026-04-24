CREATE TABLE bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  institution text,
  account_last_four text CHECK (account_last_four ~ '^\d{4}$' OR account_last_four IS NULL),
  cash_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_bank_accounts_biz_cash ON bank_accounts(business_id, cash_account_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_bank_accounts_biz ON bank_accounts(business_id) WHERE deleted_at IS NULL;
CREATE TRIGGER bank_accounts_updated_at BEFORE UPDATE ON bank_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
