ALTER TABLE email_import_staging   ADD COLUMN IF NOT EXISTS pdf_data bytea;
ALTER TABLE invoice_import_staging ADD COLUMN IF NOT EXISTS pdf_data bytea;
