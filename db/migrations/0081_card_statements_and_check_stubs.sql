-- Credit card statements share the bank-statement import pipeline; check stubs
-- describe checks so bank-statement check lines can be filled in.
-- Spec: docs/specs/2026-10-04-card-statements-and-check-stubs-design.md

-- Which kind of statement an import is. Existing rows are bank statements.
ALTER TABLE email_import_staging
  ADD COLUMN IF NOT EXISTS statement_kind text NOT NULL DEFAULT 'bank'
    CHECK (statement_kind IN ('bank', 'credit_card'));
-- Issuer / card name and last four digits read from a card statement, used to
-- preselect the matching card account.
ALTER TABLE email_import_staging
  ADD COLUMN IF NOT EXISTS account_hint text;

CREATE TABLE IF NOT EXISTS check_stubs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  check_number text,
  check_date date,
  payee_name text,
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  memo text,
  -- What the AI thought the check was for, by name and (when it matched the
  -- chart of accounts) by id.
  suggested_account_name text,
  suggested_account_id uuid REFERENCES chart_of_accounts(id),
  source_file_id uuid REFERENCES files(id),
  source_filename text,
  -- Emailed stubs: the message they came from, so the poller never reads it twice.
  gmail_message_id text,
  status text NOT NULL DEFAULT 'unmatched'
    CHECK (status IN ('unmatched', 'matched', 'dismissed')),
  -- Deleting the entry a stub was used for frees the stub again.
  matched_journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  matched_at timestamptz,
  matched_by_user_id uuid REFERENCES users(id),
  uploaded_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_check_stubs_business_status ON check_stubs (business_id, status);
CREATE INDEX IF NOT EXISTS idx_check_stubs_business_number ON check_stubs (business_id, check_number);

CREATE TRIGGER set_updated_at_check_stubs
  BEFORE UPDATE ON check_stubs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Card statement payments and refunds are recorded with their own types so the
-- General Ledger can label them ("Credit Card Payment", "Credit Card Credit").
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_transaction_type_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_transaction_type_check
  CHECK (transaction_type IN (
    'deposit', 'check', 'expense', 'journal_entry', 'invoice', 'bill', 'payment',
    'bill_payment', 'vendor_credit', 'credit_memo',
    'credit_card_payment', 'credit_card_credit'
  ));
