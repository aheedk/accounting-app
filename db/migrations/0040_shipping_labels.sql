CREATE TABLE shipping_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  invoice_id uuid REFERENCES invoices(id),
  sales_order_id uuid REFERENCES sales_orders(id),
  carrier text NOT NULL,
  tracking_number text NOT NULL,
  shipped_at date NOT NULL,
  cost numeric(19,4),
  label_file_id uuid REFERENCES files(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  CONSTRAINT sl_link_required CHECK (invoice_id IS NOT NULL OR sales_order_id IS NOT NULL)
);
CREATE INDEX idx_sl_business ON shipping_labels(business_id);
CREATE INDEX idx_sl_invoice ON shipping_labels(invoice_id);
CREATE INDEX idx_sl_so ON shipping_labels(sales_order_id);
CREATE TRIGGER shipping_labels_updated_at BEFORE UPDATE ON shipping_labels FOR EACH ROW EXECUTE FUNCTION set_updated_at();
