-- Full manual bank reconciliation: matching every deposit, expense, check and
-- journal entry that hits a bank account against the bank's own statement,
-- until the difference between them is zero. A thin "bulk-lock a date range
-- of already-reviewed bank-feed lines" version already existed (bank_reconciliations
-- / bank_transactions.is_reconciled, 0023_bank_reconciliations.sql) -- that table
-- and its 6 historical rows are untouched; this is the real worksheet the
-- 2026-10-10 meeting asked for, run from its own tables and its own pages.

CREATE TYPE reconciliation_session_status AS ENUM ('in_progress', 'completed', 'cancelled');
CREATE TYPE reconciliation_item_type AS ENUM ('deposit', 'expense', 'check', 'journal_entry', 'service_charge', 'interest');
-- Added to the four source tables below: unreconciled (default) -> cleared
-- (checked in an in-progress worksheet) -> reconciled (the worksheet finished
-- with this item checked, and is now read-only on it).
CREATE TYPE transaction_reconciliation_status AS ENUM ('unreconciled', 'cleared', 'reconciled');

CREATE TABLE reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id),
  statement_beginning_balance numeric(19,4) NOT NULL,
  statement_ending_balance numeric(19,4) NOT NULL,
  statement_ending_date date NOT NULL,
  -- Carried from the prior completed reconciliation's statement_ending_balance,
  -- or 0 for the first one on this account. Stored (not recomputed) so a later
  -- edit to an older reconciliation can never silently reshape this one.
  beginning_balance numeric(19,4) NOT NULL,
  service_charge_amount numeric(19,4) NOT NULL DEFAULT 0,
  service_charge_date date,
  service_charge_account_id uuid REFERENCES chart_of_accounts(id),
  interest_earned_amount numeric(19,4) NOT NULL DEFAULT 0,
  interest_earned_date date,
  interest_earned_account_id uuid REFERENCES chart_of_accounts(id),
  status reconciliation_session_status NOT NULL DEFAULT 'in_progress',
  -- statement_ending_balance - cleared_balance at last save; 0 once completed clean.
  difference numeric(19,4) NOT NULL DEFAULT 0,
  -- Set when an out-of-balance difference was accepted at Finish; the entry
  -- that books it, so Undo can reverse exactly this and nothing else.
  adjustment_journal_entry_id uuid REFERENCES journal_entries(id),
  completed_at timestamptz,
  completed_by_user_id uuid REFERENCES users(id),
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliations_completed_state CHECK (
    (status = 'completed') = (completed_at IS NOT NULL)
  )
);

CREATE INDEX idx_reconciliations_account ON reconciliations(bank_account_id, statement_ending_date DESC);
CREATE INDEX idx_reconciliations_biz_status ON reconciliations(business_id, status);
-- Only one reconciliation may be in progress per account at a time -- Start
-- reads "the latest completed one" as the new beginning balance, which is
-- only well-defined with a single active worksheet ahead of it.
CREATE UNIQUE INDEX uq_reconciliations_account_in_progress ON reconciliations(bank_account_id) WHERE status = 'in_progress';

CREATE TRIGGER set_updated_at_reconciliations
  BEFORE UPDATE ON reconciliations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE reconciliation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES reconciliations(id) ON DELETE CASCADE,
  transaction_type reconciliation_item_type NOT NULL,
  transaction_id uuid NOT NULL,
  transaction_date date NOT NULL,
  description text,
  -- Signed: positive for deposits/credits (money in), negative for payments/debits (money out).
  amount numeric(19,4) NOT NULL,
  is_cleared boolean NOT NULL DEFAULT false,
  cleared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_items_cleared_state CHECK (
    is_cleared = (cleared_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_reconciliation_items_txn ON reconciliation_items(reconciliation_id, transaction_type, transaction_id);
CREATE INDEX idx_reconciliation_items_recon ON reconciliation_items(reconciliation_id);

ALTER TABLE bank_deposits ADD COLUMN reconciliation_status transaction_reconciliation_status NOT NULL DEFAULT 'unreconciled';
ALTER TABLE bank_deposits ADD COLUMN reconciliation_id uuid REFERENCES reconciliations(id);
ALTER TABLE expense_transactions ADD COLUMN reconciliation_status transaction_reconciliation_status NOT NULL DEFAULT 'unreconciled';
ALTER TABLE expense_transactions ADD COLUMN reconciliation_id uuid REFERENCES reconciliations(id);
ALTER TABLE checks ADD COLUMN reconciliation_status transaction_reconciliation_status NOT NULL DEFAULT 'unreconciled';
ALTER TABLE checks ADD COLUMN reconciliation_id uuid REFERENCES reconciliations(id);
ALTER TABLE journal_entries ADD COLUMN reconciliation_status transaction_reconciliation_status NOT NULL DEFAULT 'unreconciled';
ALTER TABLE journal_entries ADD COLUMN reconciliation_id uuid REFERENCES reconciliations(id);

CREATE INDEX idx_bank_deposits_reconciliation ON bank_deposits(reconciliation_id) WHERE reconciliation_id IS NOT NULL;
CREATE INDEX idx_expense_transactions_reconciliation ON expense_transactions(reconciliation_id) WHERE reconciliation_id IS NOT NULL;
CREATE INDEX idx_checks_reconciliation ON checks(reconciliation_id) WHERE reconciliation_id IS NOT NULL;
CREATE INDEX idx_journal_entries_reconciliation ON journal_entries(reconciliation_id) WHERE reconciliation_id IS NOT NULL;

-- The adjusting journal entry booked for an accepted out-of-balance difference
-- reads through the GL and void/delete guards the same as any other entry.
ALTER TYPE journal_entry_source_type ADD VALUE IF NOT EXISTS 'reconciliation_adjustment';

ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_transaction_type_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_transaction_type_check
  CHECK (transaction_type IN (
    'deposit', 'check', 'expense', 'journal_entry', 'invoice', 'bill', 'payment',
    'bill_payment', 'vendor_credit', 'credit_memo',
    'credit_card_payment', 'credit_card_credit', 'transfer', 'reconciliation_adjustment'
  ));
