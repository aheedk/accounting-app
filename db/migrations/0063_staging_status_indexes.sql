CREATE INDEX IF NOT EXISTS email_import_staging_status_idx
  ON email_import_staging (status, business_id, received_at DESC);

CREATE INDEX IF NOT EXISTS invoice_import_staging_status_idx
  ON invoice_import_staging (status, business_id, received_at DESC);
