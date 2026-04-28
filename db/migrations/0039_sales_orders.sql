CREATE TYPE sales_order_status AS ENUM ('draft', 'confirmed', 'fulfilled', 'void');

CREATE TABLE sales_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  so_number text NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id),
  order_date date NOT NULL,
  status sales_order_status NOT NULL DEFAULT 'draft',
  invoice_id uuid REFERENCES invoices(id),
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  CONSTRAINT so_unique_number UNIQUE (business_id, so_number)
);
CREATE INDEX idx_so_business ON sales_orders(business_id);
CREATE INDEX idx_so_customer ON sales_orders(customer_id);
CREATE TRIGGER sales_orders_updated_at BEFORE UPDATE ON sales_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE sales_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id uuid NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  line_number int NOT NULL,
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  description text,
  quantity numeric(19,4) NOT NULL CHECK (quantity > 0),
  unit_price numeric(19,4) NOT NULL CHECK (unit_price >= 0),
  CONSTRAINT sol_unique_line_number UNIQUE (sales_order_id, line_number)
);
CREATE INDEX idx_sol_so ON sales_order_lines(sales_order_id);
