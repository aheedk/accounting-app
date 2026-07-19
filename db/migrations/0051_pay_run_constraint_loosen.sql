-- Replace the biconditional CHECK with two one-way implications so that
-- voiding a finalized pay run can preserve the original journal_entry_id link.
-- Old: (status = 'finalized') = (journal_entry_id IS NOT NULL AND finalized_at IS NOT NULL)
-- New: draft  → je IS NULL   (draft can't have a JE)
--      finalized → je IS NOT NULL AND finalized_at IS NOT NULL   (finalized must have one)
--      void allows either (preserves audit back-link to the reversed JE)
ALTER TABLE pay_runs
  DROP CONSTRAINT pr_finalized_has_je,
  ADD CONSTRAINT pr_draft_no_je CHECK (
    status != 'draft' OR journal_entry_id IS NULL
  ),
  ADD CONSTRAINT pr_finalized_has_je CHECK (
    status != 'finalized' OR (journal_entry_id IS NOT NULL AND finalized_at IS NOT NULL)
  );
