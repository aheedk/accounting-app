-- 0031_expense_transactions.sql
CREATE TYPE expense_transaction_status AS ENUM ('draft', 'posted', 'void');

CREATE TABLE expense_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  transaction_date date NOT NULL,
  payee_text text,
  vendor_id uuid REFERENCES vendors(id),
  expense_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  payment_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  memo text,
  status expense_transaction_status NOT NULL DEFAULT 'draft',
  journal_entry_id uuid REFERENCES journal_entries(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  posted_at timestamptz,
  posted_by_user_id uuid REFERENCES users(id),
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES users(id),
  CONSTRAINT et_payee CHECK (payee_text IS NOT NULL OR vendor_id IS NOT NULL),
  CONSTRAINT et_posted_has_je CHECK (
    (status = 'posted') = (journal_entry_id IS NOT NULL AND posted_at IS NOT NULL)
  ),
  CONSTRAINT et_voided_state CHECK (
    (status = 'void') = (voided_at IS NOT NULL)
  )
);

CREATE INDEX idx_et_biz_date ON expense_transactions(business_id, transaction_date DESC);
CREATE INDEX idx_et_biz_status ON expense_transactions(business_id, status);
CREATE INDEX idx_et_vendor ON expense_transactions(vendor_id) WHERE vendor_id IS NOT NULL;
CREATE TRIGGER expense_transactions_updated_at
  BEFORE UPDATE ON expense_transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
