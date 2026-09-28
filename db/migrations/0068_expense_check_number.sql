-- Check number for expenses paid by check. Payments and bill payments already
-- store it in their `reference` column; expenses had nowhere to put it.
ALTER TABLE expense_transactions ADD COLUMN IF NOT EXISTS check_number text;
