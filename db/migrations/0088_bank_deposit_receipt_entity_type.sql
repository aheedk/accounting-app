-- Lets a file attach to a bank deposit, same as expense_transaction/journal_entry/check.
ALTER TYPE receipt_linked_entity_type ADD VALUE IF NOT EXISTS 'bank_deposit';
