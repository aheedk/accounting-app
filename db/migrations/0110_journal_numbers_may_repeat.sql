-- A journal number may be used again, as in QuickBooks: Faizan's firm numbers
-- entries from 1 each month (item 88, 2026-10-21 notes). The entry screen warns
-- when a number is already used; the database no longer refuses it. The index
-- stays, without UNIQUE, for finding entries by number.
DROP INDEX IF EXISTS uq_journal_entries_business_number;

CREATE INDEX IF NOT EXISTS ix_journal_entries_business_number
  ON journal_entries (business_id, journal_number);
