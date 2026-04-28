CREATE TYPE bank_transaction_status AS ENUM ('unreviewed', 'matched', 'categorized', 'excluded');

CREATE TABLE bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id),
  transaction_date date NOT NULL,
  description text NOT NULL,
  amount numeric(19,4) NOT NULL,  -- signed: positive = inflow, negative = outflow
  external_id text,  -- bank's row id from CSV if present, for dedupe
  status bank_transaction_status NOT NULL DEFAULT 'unreviewed',
  matched_journal_entry_id uuid REFERENCES journal_entries(id),
  excluded_reason text,
  is_reconciled boolean NOT NULL DEFAULT false,
  reconciliation_id uuid,  -- FK added in 0023
  imported_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid REFERENCES users(id),
  CONSTRAINT bt_terminal_has_reviewer CHECK (
    (status = 'unreviewed' AND reviewed_at IS NULL AND reviewed_by_user_id IS NULL)
    OR (status <> 'unreviewed' AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT bt_matched_has_je CHECK (
    (status IN ('matched','categorized')) = (matched_journal_entry_id IS NOT NULL)
  ),
  CONSTRAINT bt_excluded_has_reason CHECK (
    (status = 'excluded') = (excluded_reason IS NOT NULL)
  )
);
CREATE INDEX idx_bt_biz_status ON bank_transactions(business_id, status) WHERE NOT is_reconciled;
CREATE INDEX idx_bt_account ON bank_transactions(bank_account_id);
CREATE INDEX idx_bt_date ON bank_transactions(bank_account_id, transaction_date);
CREATE UNIQUE INDEX uq_bt_external_id ON bank_transactions(bank_account_id, external_id) WHERE external_id IS NOT NULL;
