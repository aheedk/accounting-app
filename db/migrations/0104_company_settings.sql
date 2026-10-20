-- A client's own defaults: invoice numbering, terms, sales tax and the expense
-- payment method (Setup -> Company Settings, 2026-10-20). The defaults are what
-- the app did before, so nothing changes until someone edits them.
-- Spec: docs/specs/2026-10-20-company-settings-design.md
-- IF NOT EXISTS: this was 0103 on a branch before Riham's 0102 landed, and a
-- database that ran it under that name runs it again as 0104.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS invoice_number_prefix text NOT NULL DEFAULT ''
    CHECK (invoice_number_prefix ~ '^[A-Za-z0-9-]{0,10}$'),
  -- NULL means 1001, where invoice numbers have always started.
  ADD COLUMN IF NOT EXISTS invoice_next_number bigint
    CHECK (invoice_next_number IS NULL OR invoice_next_number BETWEEN 1 AND 999999999),
  ADD COLUMN IF NOT EXISTS default_invoice_terms_days int NOT NULL DEFAULT 30
    CHECK (default_invoice_terms_days BETWEEN 0 AND 365),
  ADD COLUMN IF NOT EXISTS default_bill_terms_days int NOT NULL DEFAULT 30
    CHECK (default_bill_terms_days BETWEEN 0 AND 365),
  ADD COLUMN IF NOT EXISTS default_sales_tax_code_id uuid REFERENCES tax_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_expense_payment_method text NOT NULL DEFAULT 'cash'
    CHECK (default_expense_payment_method IN ('cash', 'check', 'credit_card', 'debit_card', 'ach', 'other'));
