ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_standalone_number_namespace
  CHECK (
    source_type NOT IN ('manual', 'adjustment')
    OR (
      length(journal_number) <= 99
      AND right(journal_number, 1) <> 'R'
    )
  ) NOT VALID;
