-- Import history + undo for the banking CSV inbox. Transactions remember the
-- batch that created them; undo removes only still-unreviewed rows (bank
-- transactions stay mutable until reconciled — no protect trigger here).
CREATE TABLE bank_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id),
  filename text,
  rows_submitted int NOT NULL,
  imported int NOT NULL,
  deduped int NOT NULL,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz
);
CREATE INDEX idx_bib_business ON bank_import_batches(business_id);
CREATE INDEX idx_bib_account ON bank_import_batches(bank_account_id);

ALTER TABLE bank_transactions
  ADD COLUMN import_batch_id uuid REFERENCES bank_import_batches(id);
CREATE INDEX idx_bt_batch ON bank_transactions(import_batch_id);
