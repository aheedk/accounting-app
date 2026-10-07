-- A transfer between two of a client's own accounts is a journal entry tagged
-- 'transfer', so the General Ledger can label it "Transfer".
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_transaction_type_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_transaction_type_check
  CHECK (transaction_type IN (
    'deposit', 'check', 'expense', 'journal_entry', 'invoice', 'bill', 'payment',
    'bill_payment', 'vendor_credit', 'credit_memo',
    'credit_card_payment', 'credit_card_credit', 'transfer'
  ));
