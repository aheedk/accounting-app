CREATE TYPE invoice_status AS ENUM ('draft', 'posted', 'voided', 'paid');

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  invoice_number text NOT NULL,
  issue_date date NOT NULL,
  due_date date NOT NULL,
  status invoice_status NOT NULL DEFAULT 'draft',
  subtotal numeric(19,4) NOT NULL DEFAULT 0,
  tax_total numeric(19,4) NOT NULL DEFAULT 0,
  total numeric(19,4) NOT NULL DEFAULT 0,
  ar_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
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
  UNIQUE (business_id, invoice_number),
  CHECK (status <> 'posted' OR posted_at IS NOT NULL),
  CHECK (status <> 'posted' OR posted_journal_entry_id IS NOT NULL),
  CHECK (issue_date <= due_date)
);
CREATE INDEX idx_invoices_customer ON invoices (customer_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_business_date ON invoices (business_id, issue_date DESC) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_number int NOT NULL,
  description text NOT NULL,
  quantity numeric(19,4) NOT NULL,
  unit_price numeric(19,4) NOT NULL,
  revenue_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  tax_code_id uuid REFERENCES tax_codes(id),
  line_subtotal numeric(19,4) NOT NULL,
  tax_amount numeric(19,4) NOT NULL DEFAULT 0,
  line_total numeric(19,4) NOT NULL,
  UNIQUE (invoice_id, line_number),
  CHECK (quantity > 0),
  CHECK (unit_price >= 0)
);
CREATE INDEX idx_invoice_lines_invoice ON invoice_lines (invoice_id);
