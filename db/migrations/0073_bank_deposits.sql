-- Bank deposits: group funds into a single deposit to a bank account
CREATE TABLE bank_deposits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses(id),
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id),
  deposit_date    DATE NOT NULL,
  deposit_number  TEXT NOT NULL,
  memo            TEXT,
  total_amount    NUMERIC(15,2) NOT NULL DEFAULT 0,
  cash_back_account_id UUID REFERENCES chart_of_accounts(id),
  cash_back_memo  TEXT,
  cash_back_amount NUMERIC(15,2),
  journal_entry_id UUID REFERENCES journal_entries(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, deposit_number)
);

CREATE TABLE bank_deposit_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id      UUID NOT NULL REFERENCES bank_deposits(id) ON DELETE CASCADE,
  business_id     UUID NOT NULL REFERENCES businesses(id),
  received_from   TEXT,
  account_id      UUID REFERENCES chart_of_accounts(id),
  description     TEXT,
  payment_method  TEXT,
  ref_no          TEXT,
  amount          NUMERIC(15,2) NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX bank_deposits_business_date ON bank_deposits(business_id, deposit_date DESC);
CREATE INDEX bank_deposit_lines_deposit ON bank_deposit_lines(deposit_id);

CREATE TRIGGER set_updated_at_bank_deposits
  BEFORE UPDATE ON bank_deposits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
