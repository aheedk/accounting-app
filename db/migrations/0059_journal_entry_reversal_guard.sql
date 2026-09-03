CREATE UNIQUE INDEX uq_journal_entries_one_reversal
  ON journal_entries (reversed_entry_id)
  WHERE reversed_entry_id IS NOT NULL;
