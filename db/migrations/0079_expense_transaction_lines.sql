-- Expand expense_transactions from a single category/amount pair to a QBO-style
-- multi-line form (one payee + payment account, many category lines) — the
-- outbound equivalent of bank_deposits/bank_deposit_lines.

ALTER TABLE expense_transactions ADD COLUMN customer_id uuid REFERENCES customers(id);
ALTER TABLE expense_transactions ADD COLUMN reference text;
ALTER TABLE expense_transactions ADD COLUMN total_amount numeric(19,4) NOT NULL DEFAULT 0;

UPDATE expense_transactions SET reference = check_number, total_amount = amount;

CREATE TABLE expense_transaction_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_transaction_id uuid NOT NULL REFERENCES expense_transactions(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id),
  category_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  description text,
  amount numeric(19,4) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_etl_expense ON expense_transaction_lines(expense_transaction_id);

-- Every existing expense becomes a one-line expense under the new shape.
INSERT INTO expense_transaction_lines (expense_transaction_id, business_id, category_account_id, amount, sort_order)
SELECT id, business_id, expense_account_id, amount, 0 FROM expense_transactions;

-- Historical rows keep source_type='adjustment' on their journal entry —
-- je_protect_posted_row() treats source_type as permanent identity on a
-- posted JE and refuses to let even an in-place edit move it. They stay
-- resolved through transactionDescriptorService.ts's legacy expense_transactions
-- back-link (case 'manual'/'adjustment'), which already points at
-- /accounting/expenses/:id; only new expenses get the dedicated 'expense' type.

ALTER TABLE expense_transactions DROP CONSTRAINT et_payee;
ALTER TABLE expense_transactions ADD CONSTRAINT et_payee CHECK (
  payee_text IS NOT NULL OR vendor_id IS NOT NULL OR customer_id IS NOT NULL
);
ALTER TABLE expense_transactions ADD CONSTRAINT et_payee_single CHECK (
  NOT (vendor_id IS NOT NULL AND customer_id IS NOT NULL)
);

ALTER TABLE expense_transactions DROP COLUMN expense_account_id;
ALTER TABLE expense_transactions DROP COLUMN amount;
ALTER TABLE expense_transactions DROP COLUMN check_number;
CREATE INDEX idx_et_customer ON expense_transactions(customer_id) WHERE customer_id IS NOT NULL;
