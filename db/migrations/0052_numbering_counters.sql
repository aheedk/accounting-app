-- Atomic per-business sequence counters used by PO/SO/bill/invoice auto-numbering.
-- INSERT ... ON CONFLICT DO UPDATE is a single atomic statement; no TOCTOU race.
-- Idempotent: 0051_numbering_counters creates the same table (bigint variant);
-- this is a no-op wherever that one already ran.
CREATE TABLE IF NOT EXISTS numbering_counters (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  entity_type  text NOT NULL,
  last_value   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, entity_type)
);
