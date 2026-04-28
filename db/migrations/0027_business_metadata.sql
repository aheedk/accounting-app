-- Slice 6: add editable metadata columns to businesses for the Entity page.
-- tax_id and address are new; legal_name and fiscal_year_start_month already
-- exist from 0003_core_tables.sql but we use IF NOT EXISTS for idempotency.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS tax_id text,
  ADD COLUMN IF NOT EXISTS address jsonb;

-- fiscal_year_start_month already has NOT NULL DEFAULT 1 and a CHECK 1..12.
-- Guard in case the column is missing on an older database.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS fiscal_year_start_month int NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'businesses_fy_start_month_range'
  ) THEN
    ALTER TABLE businesses
      ADD CONSTRAINT businesses_fy_start_month_range
      CHECK (fiscal_year_start_month BETWEEN 1 AND 12);
  END IF;
END$$;
