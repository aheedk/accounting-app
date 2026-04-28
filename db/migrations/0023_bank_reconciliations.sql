CREATE TABLE bank_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id),
  period_start date NOT NULL,
  period_end date NOT NULL CHECK (period_end >= period_start),
  statement_ending_balance numeric(19,4) NOT NULL,
  reconciled_at timestamptz NOT NULL DEFAULT now(),
  reconciled_by_user_id uuid REFERENCES users(id),
  memo text,
  CONSTRAINT br_unique_period UNIQUE (bank_account_id, period_end)
);
CREATE INDEX idx_br_account ON bank_reconciliations(bank_account_id);

ALTER TABLE bank_transactions
  ADD CONSTRAINT bt_reconciliation_fk FOREIGN KEY (reconciliation_id) REFERENCES bank_reconciliations(id);
