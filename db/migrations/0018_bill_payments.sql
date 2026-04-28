CREATE TYPE bill_payment_status AS ENUM ('draft', 'posted', 'voided');

CREATE TABLE bill_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  payment_date date NOT NULL,
  payment_method payment_method NOT NULL,
  reference text,
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  unapplied_amount numeric(19,4) NOT NULL DEFAULT 0 CHECK (unapplied_amount >= 0),
  cash_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  status bill_payment_status NOT NULL DEFAULT 'draft',
  posted_journal_entry_id uuid REFERENCES journal_entries(id),
  memo text,
  posted_at timestamptz,
  posted_by_user_id uuid REFERENCES users(id),
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bill_payments_unapplied_le_amount CHECK (unapplied_amount <= amount),
  CONSTRAINT bill_payments_posted_has_je CHECK ((status = 'draft' AND posted_journal_entry_id IS NULL) OR (status <> 'draft'))
);
CREATE INDEX idx_bill_payments_biz_status ON bill_payments(business_id, status);
CREATE INDEX idx_bill_payments_vendor ON bill_payments(vendor_id);
CREATE INDEX idx_bill_payments_date ON bill_payments(business_id, payment_date);
CREATE TRIGGER bill_payments_updated_at BEFORE UPDATE ON bill_payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE bill_payment_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_payment_id uuid REFERENCES bill_payments(id) ON DELETE CASCADE,
  vendor_credit_id uuid, -- FK added in 0019
  bill_id uuid NOT NULL REFERENCES bills(id),
  applied_amount numeric(19,4) NOT NULL CHECK (applied_amount > 0),
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by_user_id uuid REFERENCES users(id),
  CONSTRAINT bpa_exactly_one_source CHECK (
    (bill_payment_id IS NOT NULL)::int + (vendor_credit_id IS NOT NULL)::int = 1
  )
);
CREATE INDEX idx_bpa_payment ON bill_payment_applications(bill_payment_id);
CREATE INDEX idx_bpa_vendor_credit ON bill_payment_applications(vendor_credit_id);
CREATE INDEX idx_bpa_bill ON bill_payment_applications(bill_id);
