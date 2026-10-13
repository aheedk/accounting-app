-- Reconciliation widened to any balance-sheet account (bank, credit card,
-- other current/fixed/long-term asset or liability, equity) -- QuickBooks'
-- reconcile picker is not limited to registered bank accounts, and the 2026-10-12
-- meeting asked for the same. `bank_account_id` always held a bank_accounts.id;
-- it's renamed and retargeted at chart_of_accounts directly, since a reconcilable
-- account no longer requires a bank_accounts row to exist for it.
ALTER TABLE reconciliations RENAME COLUMN bank_account_id TO account_id;
ALTER TABLE reconciliations DROP CONSTRAINT reconciliations_bank_account_id_fkey;
ALTER TABLE reconciliations ADD CONSTRAINT reconciliations_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id);

DROP INDEX idx_reconciliations_account;
CREATE INDEX idx_reconciliations_account ON reconciliations(account_id, statement_ending_date DESC);

DROP INDEX uq_reconciliations_account_in_progress;
CREATE UNIQUE INDEX uq_reconciliations_account_in_progress ON reconciliations(account_id) WHERE status = 'in_progress';
