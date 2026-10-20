-- Estimates: a quote to a customer that becomes an invoice when the work goes
-- ahead (item 17, the QA audit's last missing transaction type). Nothing here
-- is in the books; the invoice made from an estimate is.
-- Spec: docs/specs/2026-10-20-estimates-design.md.
DO $$ BEGIN
  CREATE TYPE estimate_status AS ENUM ('pending', 'accepted', 'rejected', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  estimate_number text NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id),
  estimate_date date NOT NULL,
  -- Shown as "Expired" while pending past it; not a lock.
  expiration_date date,
  status estimate_status NOT NULL DEFAULT 'pending',
  -- The message to the customer, printed on the estimate.
  memo text,
  subtotal numeric(19,4) NOT NULL DEFAULT 0,
  tax_total numeric(19,4) NOT NULL DEFAULT 0,
  total numeric(19,4) NOT NULL DEFAULT 0,
  accepted_by text,
  accepted_date date,
  -- The invoice it became; set together with status 'closed'.
  invoice_id uuid REFERENCES invoices(id),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  CONSTRAINT estimates_unique_number UNIQUE (business_id, estimate_number),
  CONSTRAINT estimates_expiration_after_date CHECK (expiration_date IS NULL OR expiration_date >= estimate_date),
  CONSTRAINT estimates_closed_has_invoice CHECK ((status = 'closed') = (invoice_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_estimates_business_date ON estimates (business_id, estimate_date DESC);
CREATE INDEX IF NOT EXISTS idx_estimates_customer ON estimates (customer_id);
CREATE INDEX IF NOT EXISTS idx_estimates_invoice ON estimates (invoice_id) WHERE invoice_id IS NOT NULL;
DROP TRIGGER IF EXISTS estimates_updated_at ON estimates;
CREATE TRIGGER estimates_updated_at BEFORE UPDATE ON estimates FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS estimate_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  line_number int NOT NULL,
  -- The product picked, kept so the form can show it again; the line still
  -- reads right if the product is later deleted.
  inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity numeric(19,4) NOT NULL CHECK (quantity > 0),
  unit_price numeric(19,4) NOT NULL CHECK (unit_price >= 0),
  -- What the invoice line will credit: the product's income account.
  revenue_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  tax_code_id uuid REFERENCES tax_codes(id),
  line_subtotal numeric(19,4) NOT NULL,
  tax_amount numeric(19,4) NOT NULL DEFAULT 0,
  line_total numeric(19,4) NOT NULL,
  CONSTRAINT estimate_lines_unique_number UNIQUE (estimate_id, line_number)
);
CREATE INDEX IF NOT EXISTS idx_estimate_lines_estimate ON estimate_lines (estimate_id);
