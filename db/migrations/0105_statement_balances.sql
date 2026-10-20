-- What a statement says about its account as a whole, read by the AI with its
-- lines, and the account it was approved against (item 72, 10-16 follow-ups).
-- Reconcile takes the ending balance and date from here instead of having them
-- typed. NULL where the statement could not be read, or came before this.
-- Spec: docs/specs/2026-10-04-card-statements-and-check-stubs-design.md, section 4.
ALTER TABLE email_import_staging
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date,
  -- As printed: a bank account's balance, or what is owed on a card.
  ADD COLUMN IF NOT EXISTS beginning_balance numeric(19,4),
  ADD COLUMN IF NOT EXISTS ending_balance numeric(19,4),
  -- The statement's own account (bank account or card), chosen when it was
  -- approved; before, only the free-text account_hint said which it was.
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS email_import_staging_account_period_idx
  ON email_import_staging (account_id, period_end DESC)
  WHERE account_id IS NOT NULL;
