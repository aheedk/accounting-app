-- Customers get what vendors have (0084): "Make inactive" hides a customer from
-- dropdowns and keeps their history; Delete is only for one with no transactions.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_customers_business_active ON customers (business_id) WHERE is_active AND deleted_at IS NULL;
