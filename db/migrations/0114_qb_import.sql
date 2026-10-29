-- Moving a client from QuickBooks (docs/specs/2026-10-28-quickbooks-import-design.md).
-- Each upload on Setup -> Import from QuickBooks is one batch; every record it
-- made is listed against it, so the whole upload can be undone. The cutover
-- date is the batch's own: the service keeps every active batch of a company
-- on the same one.
CREATE TABLE IF NOT EXISTS qb_import_batches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  step               text NOT NULL CHECK (step IN (
                       'accounts', 'customers', 'vendors', 'items',
                       'open_invoices', 'open_bills', 'uncleared', 'history', 'trial_balance')),
  cutover_date       date NOT NULL,
  file_name          text,
  -- What the upload made and, for the trial balance, QuickBooks' own figures for the check.
  summary            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  undone_at          timestamptz,
  undone_by_user_id  uuid REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS qb_import_batches_business_idx
  ON qb_import_batches (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS qb_import_records (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    uuid NOT NULL REFERENCES qb_import_batches(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN (
                'account', 'account_renamed', 'customer', 'vendor', 'inventory_item', 'stock_movement',
                'journal_entry', 'invoice', 'bill', 'credit_memo', 'vendor_credit', 'reconciliation')),
  entity_id   uuid NOT NULL,
  -- For 'account_renamed': the name and code the account had before, to put back on undo.
  previous    jsonb,
  sort_order  integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS qb_import_records_batch_idx ON qb_import_records (batch_id, sort_order);
