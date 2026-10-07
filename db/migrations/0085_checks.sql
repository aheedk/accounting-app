-- Write Check: the third payment method alongside Bank Deposits (money in)
-- and Expenses (money out) -- functionally an expense paid by check, with
-- extra fields for the physical check (check number, mailing address, print
-- queue). A dedicated feature (own table, own page) rather than folding into
-- expense_transactions, same reasoning as Bank Deposits vs a generic JE.
CREATE TYPE check_status AS ENUM ('draft', 'posted', 'void');
CREATE TYPE check_payee_type AS ENUM ('vendor', 'customer', 'other');

CREATE TABLE checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  check_number text NOT NULL,
  payee_id uuid,
  payee_type check_payee_type,
  -- Free-text payee name when payee_type is 'other' (or no vendor/customer is
  -- on file yet) -- same payee_text pattern as expense_transactions.
  payee_text text,
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id),
  payment_date date NOT NULL,
  mailing_address text,
  memo text,
  total_amount numeric(19,4) NOT NULL DEFAULT 0,
  print_later boolean NOT NULL DEFAULT false,
  is_printed boolean NOT NULL DEFAULT false,
  status check_status NOT NULL DEFAULT 'draft',
  journal_entry_id uuid REFERENCES journal_entries(id),
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  posted_by_user_id uuid REFERENCES users(id),
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES users(id),
  CONSTRAINT checks_payee CHECK (payee_text IS NOT NULL OR payee_id IS NOT NULL),
  CONSTRAINT checks_draft_no_je CHECK (
    status <> 'draft' OR (journal_entry_id IS NULL AND posted_at IS NULL)
  ),
  CONSTRAINT checks_posted_has_je CHECK (
    status <> 'posted' OR (journal_entry_id IS NOT NULL AND posted_at IS NOT NULL)
  ),
  CONSTRAINT checks_voided_state CHECK (
    (status = 'void') = (voided_at IS NOT NULL)
  )
);

CREATE TABLE check_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id uuid NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id),
  line_number integer NOT NULL DEFAULT 0,
  account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  description text,
  amount numeric(19,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_checks_biz_date ON checks(business_id, payment_date DESC);
CREATE INDEX idx_checks_biz_status ON checks(business_id, status);
CREATE INDEX idx_checks_bank_account ON checks(bank_account_id);
-- Backs the "next check number for this bank account" lookup.
CREATE INDEX idx_checks_bank_account_number ON checks(bank_account_id, check_number);
CREATE INDEX idx_checks_payee ON checks(payee_id) WHERE payee_id IS NOT NULL;
CREATE INDEX idx_check_lines_check ON check_lines(check_id);

CREATE TRIGGER set_updated_at_checks
  BEFORE UPDATE ON checks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Lets the General Ledger and journal entry page resolve a check's own page
-- directly from journal_entries.source_type, same as 'bank_deposit'/'expense'.
ALTER TYPE journal_entry_source_type ADD VALUE IF NOT EXISTS 'check';
