-- Locked accounts: visible with history intact, but reject edits and new
-- journal postings until unlocked. Distinct from is_active (inactive hides
-- the account from pickers entirely).
ALTER TABLE chart_of_accounts ADD COLUMN is_locked boolean NOT NULL DEFAULT false;
