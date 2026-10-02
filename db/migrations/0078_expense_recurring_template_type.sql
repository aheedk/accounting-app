-- Lets a recurring template materialize an Expense, same as the existing
-- 'deposit' template type does for Bank Deposits.
ALTER TYPE recurring_template_type ADD VALUE IF NOT EXISTS 'expense';
