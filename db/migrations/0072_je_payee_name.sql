-- Add payee_name to journal_entries for the GL "Name" column.
-- For future bank imports the AI extraction will populate this field.
-- For existing entries we do a best-effort regex extraction from the memo.
-- Common bank description formats seen in practice:
--   "CCD DEBIT, VENDOR XXXX..."       → extract the text after ", " up to digits
--   "TD BILL PAY SERV, VENDOR PMT..." → extract text between ", " and " ONLINE PMT" etc.
--   "ACH DEBIT VENDOR ..."            → extract first meaningful word(s)
--   "VENDOR NAME ONLINE PMT ..."      → extract first word(s) before common suffixes

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS payee_name text;

BEGIN;
SET LOCAL app.allow_edit = 'on';

UPDATE journal_entries
SET payee_name = trim(both from extracted)
FROM (
  SELECT id,
    CASE
      -- "CCD DEBIT, VENDOR ..." or "ACH DEBIT, VENDOR ..."
      WHEN memo ~* '^\s*(CCD|ACH|POS)\s+DEBIT\s*,\s*' THEN
        -- Remove prefix, then strip trailing transaction codes (long digit strings)
        regexp_replace(
          regexp_replace(memo, '^\s*(CCD|ACH|POS)\s+DEBIT\s*,\s*', '', 'i'),
          '\s+\d{6,}.*$', ''
        )
      -- "TD BILL PAY SERV, VENDOR ONLINE PMT ..." or similar bill pay formats
      WHEN memo ~* '^\s*TD BILL PAY' THEN
        regexp_replace(
          regexp_replace(memo, '^\s*TD BILL PAY(MENT)?\s*(SERV)?\s*,?\s*', '', 'i'),
          '\s+(ONLINE\s*PMT|PMT|TDB|TDBILL).*$', '', 'i'
        )
      -- "ACH DEBIT VENDOR KEYWORD ..." (no comma)
      WHEN memo ~* '^\s*ACH DEBIT\s+\S' THEN
        -- Take everything after "ACH DEBIT " up to first digit sequence
        regexp_replace(
          regexp_replace(memo, '^\s*ACH DEBIT\s+', '', 'i'),
          '\s+\d{4,}.*$', ''
        )
      -- Simple single or two-word descriptions that are already the vendor name
      -- (PAYROLL, INSURANCE, etc.)
      WHEN memo ~* '^\s*[A-Z][A-Z &/.-]{2,30}\s*$' THEN
        initcap(trim(memo))
      ELSE NULL
    END AS extracted
  FROM journal_entries
  WHERE source_type = 'bank_import'
    AND transaction_type IN ('expense', 'check')
    AND memo IS NOT NULL
) sub
WHERE journal_entries.id = sub.id
  AND sub.extracted IS NOT NULL
  AND trim(sub.extracted) <> ''
  -- Don't overwrite if it already has a value
  AND journal_entries.payee_name IS NULL;

COMMIT;
