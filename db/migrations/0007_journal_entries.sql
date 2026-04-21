CREATE TYPE journal_entry_status AS ENUM ('draft', 'posted', 'voided');
CREATE TYPE journal_entry_source_type AS ENUM (
  'manual', 'invoice', 'payment', 'credit_memo', 'reversal', 'adjustment'
);

CREATE TABLE journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  period_id uuid NOT NULL REFERENCES fiscal_periods(id),
  entry_date date NOT NULL,
  memo text,
  reference text,
  status journal_entry_status NOT NULL DEFAULT 'draft',
  source_type journal_entry_source_type NOT NULL DEFAULT 'manual',
  source_id uuid,
  reversed_entry_id uuid REFERENCES journal_entries(id),
  posted_at timestamptz,
  posted_by_user_id uuid REFERENCES users(id),
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES users(id),
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'posted' OR posted_at IS NOT NULL),
  CHECK (status <> 'voided' OR voided_at IS NOT NULL)
);

CREATE INDEX idx_je_business_period ON journal_entries (business_id, period_id, status);
CREATE INDEX idx_je_business_date ON journal_entries (business_id, entry_date DESC);
CREATE INDEX idx_je_source ON journal_entries (source_type, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX idx_je_reversed ON journal_entries (reversed_entry_id) WHERE reversed_entry_id IS NOT NULL;

CREATE TRIGGER trg_je_updated_at
  BEFORE UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE journal_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  line_number int NOT NULL,
  account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  debit numeric(19,4) NOT NULL DEFAULT 0,
  credit numeric(19,4) NOT NULL DEFAULT 0,
  memo text,
  UNIQUE (journal_entry_id, line_number),
  CHECK (debit >= 0 AND credit >= 0),
  CHECK (NOT (debit > 0 AND credit > 0)),
  CHECK (debit > 0 OR credit > 0)
);

CREATE INDEX idx_jel_account ON journal_entry_lines (account_id);
CREATE INDEX idx_jel_entry ON journal_entry_lines (journal_entry_id);
