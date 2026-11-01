-- QuickBooks import (docs/specs/2026-10-28-quickbooks-import-design.md): the
-- history upload also gives a vendor with no default expense account the one
-- QuickBooks used for it most. The record keeps the account it set, so undoing
-- the upload can take it off again.
ALTER TABLE qb_import_records DROP CONSTRAINT IF EXISTS qb_import_records_entity_type_check;
ALTER TABLE qb_import_records ADD CONSTRAINT qb_import_records_entity_type_check CHECK (entity_type IN (
  'account', 'account_renamed', 'customer', 'vendor', 'inventory_item', 'stock_movement',
  'journal_entry', 'invoice', 'bill', 'credit_memo', 'vendor_credit', 'reconciliation',
  'vendor_default'));
