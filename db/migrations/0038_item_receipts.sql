CREATE TABLE item_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id),
  receipt_date date NOT NULL,
  bill_id uuid REFERENCES bills(id),
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id)
);
CREATE INDEX idx_ir_business ON item_receipts(business_id);
CREATE INDEX idx_ir_po ON item_receipts(purchase_order_id);
CREATE TRIGGER item_receipts_updated_at BEFORE UPDATE ON item_receipts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
