-- A customer's purchase order, read from an uploaded or emailed PDF, waits in
-- the AI inbox beside invoices and bills and becomes a sales invoice when it is
-- approved (10-05 meeting, item 23). It is staged as invoice_type 'po'.
ALTER TABLE invoice_import_staging
  DROP CONSTRAINT IF EXISTS invoice_import_staging_invoice_type_check;
ALTER TABLE invoice_import_staging
  ADD CONSTRAINT invoice_import_staging_invoice_type_check CHECK (invoice_type IN ('ap', 'ar', 'po'));
