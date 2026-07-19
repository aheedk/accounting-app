-- Race-safe per-business document numbering (replaces count(*)+1 helpers).
-- Concurrent transactions serialize on the counter row via the upsert's row lock.
-- Idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING): 0052_numbering_counters
-- creates the same table on branches that merged the print/riham line first,
-- and either file may already be applied in a given environment.
CREATE TABLE IF NOT EXISTS numbering_counters (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  last_value bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, entity_type)
);

-- Seed from current row counts so existing businesses continue their sequences
-- (matches the old count(*)+1 behavior exactly).
INSERT INTO numbering_counters (business_id, entity_type, last_value)
SELECT business_id, 'invoice', count(*) FROM invoices GROUP BY business_id
ON CONFLICT (business_id, entity_type) DO NOTHING;
INSERT INTO numbering_counters (business_id, entity_type, last_value)
SELECT business_id, 'bill', count(*) FROM bills GROUP BY business_id
ON CONFLICT (business_id, entity_type) DO NOTHING;
INSERT INTO numbering_counters (business_id, entity_type, last_value)
SELECT business_id, 'purchase_order', count(*) FROM purchase_orders GROUP BY business_id
ON CONFLICT (business_id, entity_type) DO NOTHING;
INSERT INTO numbering_counters (business_id, entity_type, last_value)
SELECT business_id, 'sales_order', count(*) FROM sales_orders GROUP BY business_id
ON CONFLICT (business_id, entity_type) DO NOTHING;
