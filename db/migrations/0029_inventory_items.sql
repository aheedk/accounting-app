-- Slice 7: inventory_items are the item master. quantity_on_hand is NOT
-- stored on the row — it is computed from stock_movements (subquery SUM).
-- stock_movements captures signed quantity deltas against an item. Ledger
-- integration (inventory JEs) is deferred — Slice 7 is pure CRUD + stock
-- adjustments with no postJournalEntry call.

CREATE TYPE stock_movement_reason AS ENUM ('adjustment', 'opening_balance', 'manual_in', 'manual_out', 'write_off');

CREATE TABLE inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  sku text NOT NULL CHECK (length(sku) BETWEEN 1 AND 100),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description text,
  unit_of_measure text NOT NULL DEFAULT 'each',
  purchase_cost numeric(19,4),
  sale_price numeric(19,4),
  income_account_id uuid REFERENCES chart_of_accounts(id),
  expense_account_id uuid REFERENCES chart_of_accounts(id),
  inventory_asset_account_id uuid REFERENCES chart_of_accounts(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX uq_inventory_items_biz_sku ON inventory_items(business_id, sku) WHERE deleted_at IS NULL;
CREATE INDEX idx_inventory_items_biz ON inventory_items(business_id) WHERE deleted_at IS NULL;
CREATE TRIGGER inventory_items_updated_at BEFORE UPDATE ON inventory_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  movement_date date NOT NULL,
  quantity_delta numeric(19,4) NOT NULL CHECK (quantity_delta <> 0),
  reason stock_movement_reason NOT NULL,
  memo text,
  posted_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_movements_item_date ON stock_movements(inventory_item_id, movement_date DESC);
