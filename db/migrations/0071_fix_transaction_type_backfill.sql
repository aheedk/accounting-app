-- Fix the 0070 backfill which incorrectly used "any asset debited" —
-- that catches offset accounts like Due From Employees (also asset-type).
-- For bank_import JEs the first line (line_number = 1) is ALWAYS the bank
-- account (enforced by emailImports.ts). Debit on that line = money in
-- (deposit); credit = money out (expense or check).
--
-- We also upgrade expense→check where the memo names a check number,
-- storing the extracted number in the reference column (GL Num column).
-- The allow_edit flag is needed because reference is a protected field
-- on posted JEs, and these are metadata-only changes (no financial values
-- or identity fields are moving).

BEGIN;
SET LOCAL app.allow_edit = 'on';

-- Step 1: re-classify all bank_import rows using line_number = 1
UPDATE journal_entries je
SET transaction_type = CASE
  WHEN jel.debit::numeric > 0 THEN 'deposit'
  ELSE 'expense'
END
FROM journal_entry_lines jel
WHERE jel.journal_entry_id = je.id
  AND jel.line_number = 1
  AND je.source_type = 'bank_import';

-- Step 2: upgrade expense→check where the memo mentions a check number,
-- and store the extracted number in the reference column (shown as NUM).
UPDATE journal_entries
SET
  transaction_type = 'check',
  reference = regexp_replace(memo, '.*[Cc][Hh][Ee][Cc][Kk]\s*#?\s*(\d+).*', '\1')
WHERE source_type = 'bank_import'
  AND transaction_type = 'expense'
  AND memo ~* 'check\s*#?\s*\d+';

COMMIT;
