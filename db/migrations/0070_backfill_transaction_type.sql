-- Backfill transaction_type for existing bank_import journal entries.
-- Logic: if a line in the JE debits an asset account → money came in → deposit.
--        Otherwise → money went out → expense (we can't distinguish check vs card
--        from old data, so expense is the safe default for outflows).
UPDATE journal_entries je
SET transaction_type = CASE
  WHEN EXISTS (
    SELECT 1
    FROM journal_entry_lines jel
    JOIN chart_of_accounts ca ON ca.id = jel.account_id
    WHERE jel.journal_entry_id = je.id
      AND ca.account_type = 'asset'
      AND CAST(jel.debit AS numeric) > 0
  ) THEN 'deposit'
  ELSE 'expense'
END
WHERE je.source_type = 'bank_import'
  AND je.transaction_type IS NULL;
