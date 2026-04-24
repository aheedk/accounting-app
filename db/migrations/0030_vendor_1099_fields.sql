-- 0030_vendor_1099_fields.sql
-- Replace plaintext vendors.tax_id with encrypted blob + last-4 + type enum.
-- WARNING: this drops the old plaintext column. The app has no real tenant
-- data yet (demo only), so the loss is acceptable. If real data ever exists,
-- write a one-shot script that encrypts each row before this migration runs.

CREATE TYPE tax_id_type AS ENUM ('SSN', 'EIN');

ALTER TABLE vendors
  DROP COLUMN tax_id;

ALTER TABLE vendors
  ADD COLUMN tax_id_encrypted bytea,
  ADD COLUMN tax_id_last_four text CHECK (tax_id_last_four IS NULL OR tax_id_last_four ~ '^\d{1,4}$'),
  ADD COLUMN tax_id_type tax_id_type;

ALTER TABLE vendors
  ADD CONSTRAINT vendors_tax_id_consistent CHECK (
    (tax_id_encrypted IS NULL AND tax_id_last_four IS NULL AND tax_id_type IS NULL)
    OR (tax_id_encrypted IS NOT NULL AND tax_id_last_four IS NOT NULL AND tax_id_type IS NOT NULL)
  );
