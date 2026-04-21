CREATE TYPE credit_memo_status AS ENUM ('draft', 'posted', 'voided', 'applied');

CREATE TABLE credit_memos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  memo_date date NOT NULL,
  status credit_memo_status NOT NULL DEFAULT 'draft',
  amount numeric(19,4) NOT NULL,
  remaining_amount numeric(19,4) NOT NULL,
  source_payment_id uuid REFERENCES payments(id),
  ar_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  revenue_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  posted_journal_entry_id uuid REFERENCES journal_entries(id),
  memo text,
  posted_at timestamptz,
  posted_by_user_id uuid REFERENCES users(id),
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount > 0),
  CHECK (remaining_amount >= 0 AND remaining_amount <= amount),
  CHECK (status <> 'posted' OR posted_at IS NOT NULL),
  CHECK (status <> 'posted' OR posted_journal_entry_id IS NOT NULL)
);
CREATE INDEX idx_credit_memos_customer ON credit_memos (customer_id, status);
CREATE TRIGGER trg_credit_memos_updated_at
  BEFORE UPDATE ON credit_memos FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE payment_applications
  ADD CONSTRAINT fk_pa_credit_memo FOREIGN KEY (credit_memo_id) REFERENCES credit_memos(id);
