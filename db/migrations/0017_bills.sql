CREATE TYPE bill_status AS ENUM ('draft', 'posted', 'paid', 'voided');

CREATE TABLE bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  bill_number text NOT NULL,
  bill_date date NOT NULL,
  due_date date NOT NULL,
  status bill_status NOT NULL DEFAULT 'draft',
  subtotal numeric(19,4) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  total numeric(19,4) NOT NULL DEFAULT 0 CHECK (total >= 0),
  ap_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  posted_journal_entry_id uuid REFERENCES journal_entries(id),
  memo text,
  terms text,
  posted_at timestamptz,
  posted_by_user_id uuid REFERENCES users(id),
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT bills_posted_has_je CHECK (
    (status = 'draft' AND posted_journal_entry_id IS NULL)
    OR (status <> 'draft')
  )
);
CREATE UNIQUE INDEX uq_bills_business_number ON bills(business_id, bill_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_bills_biz_status ON bills(business_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_bills_vendor ON bills(vendor_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_bills_due_date ON bills(business_id, due_date) WHERE deleted_at IS NULL AND status IN ('posted','paid');
CREATE TRIGGER bills_updated_at BEFORE UPDATE ON bills FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE bill_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  line_number int NOT NULL,
  description text NOT NULL,
  quantity numeric(19,4) NOT NULL CHECK (quantity > 0),
  unit_price numeric(19,4) NOT NULL CHECK (unit_price >= 0),
  expense_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  line_subtotal numeric(19,4) NOT NULL CHECK (line_subtotal >= 0),
  UNIQUE (bill_id, line_number)
);
