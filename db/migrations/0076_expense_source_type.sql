-- Dedicated journal entry source type for Expenses, replacing the generic
-- 'adjustment' value expenseTransactionService used to reuse. Lets the
-- General Ledger and journal entry page resolve an expense's own page
-- directly from journal_entries.source_type, the same way 'bank_deposit' does.
ALTER TYPE journal_entry_source_type ADD VALUE IF NOT EXISTS 'expense';
