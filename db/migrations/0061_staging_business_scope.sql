-- Store the extracted "addressed to" company name and allow rejection reason
-- business_id is now set at ingestion (not just at approval) for matched records

ALTER TABLE email_import_staging
  ADD COLUMN IF NOT EXISTS addressed_to text,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE invoice_import_staging
  ADD COLUMN IF NOT EXISTS addressed_to text,
  ADD COLUMN IF NOT EXISTS rejection_reason text;
