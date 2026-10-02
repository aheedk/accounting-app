-- 0073_bank_deposits.sql added the bank_deposits table but never extended the
-- journal_entry_source_type enum, so postJournalEntry(source_type: 'bank_deposit')
-- would fail at insert time. Added as a new migration rather than editing 0073
-- in place, since ALTER TYPE ... ADD VALUE only runs for environments that
-- re-apply the file and this one has already been committed.
ALTER TYPE journal_entry_source_type ADD VALUE IF NOT EXISTS 'bank_deposit';
