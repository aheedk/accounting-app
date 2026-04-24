CREATE TYPE purchase_order_status AS ENUM ('draft', 'sent', 'received', 'closed', 'void');

CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  po_number text NOT NULL,
  vendor_id uuid NOT NULL REFERENCES vendors(id),
  order_date date NOT NULL,
  expected_delivery_date date,
  status purchase_order_status NOT NULL DEFAULT 'draft',
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  CONSTRAINT po_unique_number UNIQUE (business_id, po_number)
);
CREATE INDEX idx_po_business ON purchase_orders(business_id);
CREATE INDEX idx_po_vendor ON purchase_orders(vendor_id);
CREATE TRIGGER purchase_orders_updated_at BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_number int NOT NULL,
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  description text,
  quantity numeric(19,4) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(19,4) NOT NULL CHECK (unit_cost >= 0),
  CONSTRAINT pol_unique_line_number UNIQUE (purchase_order_id, line_number)
);
CREATE INDEX idx_pol_po ON purchase_order_lines(purchase_order_id);
