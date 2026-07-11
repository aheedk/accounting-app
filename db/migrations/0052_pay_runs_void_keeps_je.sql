-- Void keeps the JE back-link (mirrors the slice-8 fix on
-- expense_transactions.et_posted_has_je, commit 8b747dd). The old biconditional
-- forced journal_entry_id/finalized_at to NULL on void, dropping the audit
-- link to the reversed JE. Replace with one-way implications:
--   draft     -> no JE
--   finalized -> JE + finalized_at present
--   void      -> either (keeps whatever finalize set)
ALTER TABLE pay_runs DROP CONSTRAINT pr_finalized_has_je;
ALTER TABLE pay_runs ADD CONSTRAINT pr_finalized_has_je CHECK (
  (status <> 'draft' OR journal_entry_id IS NULL)
  AND (status <> 'finalized' OR (journal_entry_id IS NOT NULL AND finalized_at IS NOT NULL))
);
