-- Add transaction_type to journal_entries so bank imports can store
-- Deposit / Check / Expense instead of the generic source_type.
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS transaction_type text
  CHECK (transaction_type IN (
    'deposit','check','expense',
    'journal_entry','invoice','bill','payment',
    'bill_payment','vendor_credit','credit_memo'
  ));
