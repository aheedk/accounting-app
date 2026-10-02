-- The shared payment_method enum (used by payments, bill_payments, and
-- expense_transactions) has no way to tell a credit card from a debit card —
-- both collapse to 'card'. The Expense form's payment method dropdown needs
-- the distinction (QBO shows them separately), so add the two values rather
-- than fork a second enum. Existing 'card' rows are left alone; nothing reads
-- these new values yet except the new Expense feature.
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'credit_card';
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'debit_card';
