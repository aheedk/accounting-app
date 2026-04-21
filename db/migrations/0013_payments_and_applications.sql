CREATE TYPE payment_status AS ENUM ('draft', 'posted', 'voided');
CREATE TYPE payment_method AS ENUM ('cash', 'check', 'ach', 'wire', 'card', 'other');

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  payment_date date NOT NULL,
  payment_method payment_method NOT NULL,
  reference text,
  amount numeric(19,4) NOT NULL,
  unapplied_amount numeric(19,4) NOT NULL,
  cash_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  status payment_status NOT NULL DEFAULT 'draft',
  posted_journal_entry_id uuid REFERENCES journal_entries(id),
  memo text,
  posted_at timestamptz,
  posted_by_user_id uuid REFERENCES users(id),
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount > 0),
  CHECK (unapplied_amount >= 0 AND unapplied_amount <= amount),
  CHECK (status <> 'posted' OR posted_at IS NOT NULL),
  CHECK (status <> 'posted' OR posted_journal_entry_id IS NOT NULL)
);
CREATE INDEX idx_payments_customer ON payments (customer_id, status);
CREATE INDEX idx_payments_business_date ON payments (business_id, payment_date DESC);
CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payment_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid REFERENCES payments(id),
  credit_memo_id uuid,
  invoice_id uuid REFERENCES invoices(id),
  applied_amount numeric(19,4) NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by_user_id uuid REFERENCES users(id),
  CHECK (applied_amount > 0),
  CHECK (invoice_id IS NOT NULL),
  CHECK ((payment_id IS NOT NULL) <> (credit_memo_id IS NOT NULL))
);
CREATE INDEX idx_pa_payment ON payment_applications (payment_id);
CREATE INDEX idx_pa_invoice ON payment_applications (invoice_id);
CREATE INDEX idx_pa_credit ON payment_applications (credit_memo_id);
