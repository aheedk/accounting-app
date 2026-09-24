-- =====================================================================
-- AI auto-coding engine.
--
-- Adds:
--   * account_coding_memory -- per-client learned vendor -> split template
--   * bank_transactions.suggestion -- current suggestion (lines + confidence)
--   * businesses.ai_auto_post_enabled -- per-business auto-post gate, off by default
--   * upload support on the two staging tables (source + uploaded_by_user_id),
--     which requires gmail_message_id to become nullable.
-- =====================================================================

-- --------------------------------------------------------------------
-- Learned coding rules, keyed by normalized vendor + direction.
-- bank_account_id is nullable: NULL means "any account for this client".
-- --------------------------------------------------------------------
CREATE TABLE account_coding_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  normalized_vendor text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('debit', 'credit')),
  bank_account_id uuid REFERENCES bank_accounts(id) ON DELETE CASCADE,
  -- Split template: [{ account_id, debit, credit, memo }]. Always a list so a
  -- loan payment (principal + interest) is representable from day one.
  lines jsonb NOT NULL,
  times_applied integer NOT NULL DEFAULT 0,
  times_corrected integer NOT NULL DEFAULT 0,
  last_applied_at timestamptz,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One rule per (client, vendor, direction, account). Two partial indexes
-- because NULL bank_account_id must collapse to a single row, and a plain
-- UNIQUE constraint treats NULLs as distinct.
CREATE UNIQUE INDEX account_coding_memory_scoped_key
  ON account_coding_memory (business_id, normalized_vendor, direction, bank_account_id)
  WHERE bank_account_id IS NOT NULL;

CREATE UNIQUE INDEX account_coding_memory_global_key
  ON account_coding_memory (business_id, normalized_vendor, direction)
  WHERE bank_account_id IS NULL;

CREATE INDEX account_coding_memory_lookup
  ON account_coding_memory (business_id, normalized_vendor);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON account_coding_memory
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --------------------------------------------------------------------
-- Current suggestion for a bank transaction.
-- Shape: { confidence, source_layer, lines: [{account_id, debit, credit, memo}] }
-- NULL means unclassified.
-- --------------------------------------------------------------------
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS suggestion jsonb;

-- --------------------------------------------------------------------
-- Auto-post is a firm policy decision: off unless explicitly enabled.
-- --------------------------------------------------------------------
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS ai_auto_post_enabled boolean NOT NULL DEFAULT false;

-- --------------------------------------------------------------------
-- Uploads: documents that never came from Gmail.
-- --------------------------------------------------------------------
ALTER TABLE email_import_staging
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS original_filename text;

ALTER TABLE invoice_import_staging
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS original_filename text;

ALTER TABLE email_import_staging
  DROP CONSTRAINT IF EXISTS email_import_staging_source_check;
ALTER TABLE email_import_staging
  ADD CONSTRAINT email_import_staging_source_check CHECK (source IN ('email', 'upload'));

ALTER TABLE invoice_import_staging
  DROP CONSTRAINT IF EXISTS invoice_import_staging_source_check;
ALTER TABLE invoice_import_staging
  ADD CONSTRAINT invoice_import_staging_source_check CHECK (source IN ('email', 'upload'));

-- Uploaded documents have no Gmail id. Keep de-duplication for email by
-- swapping the UNIQUE constraint for a partial unique index that ignores NULLs.
ALTER TABLE email_import_staging ALTER COLUMN gmail_message_id DROP NOT NULL;
ALTER TABLE email_import_staging
  DROP CONSTRAINT IF EXISTS email_import_staging_gmail_message_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS email_import_staging_gmail_message_id_key
  ON email_import_staging (gmail_message_id)
  WHERE gmail_message_id IS NOT NULL;

ALTER TABLE invoice_import_staging ALTER COLUMN gmail_message_id DROP NOT NULL;
ALTER TABLE invoice_import_staging
  DROP CONSTRAINT IF EXISTS invoice_import_staging_gmail_message_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS invoice_import_staging_gmail_message_id_key
  ON invoice_import_staging (gmail_message_id)
  WHERE gmail_message_id IS NOT NULL;
