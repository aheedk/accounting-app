-- Lets a file attach to a check, same as expense_transaction/journal_entry/etc.
ALTER TYPE receipt_linked_entity_type ADD VALUE IF NOT EXISTS 'check';
