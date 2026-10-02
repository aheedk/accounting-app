-- Bank Deposits had no void concept — only Delete, which it implemented as
-- void-then-remove-the-wrapper-row, so the original + reversal pair always
-- stayed in the General Ledger with nothing left to distinguish "deleted"
-- from "voided". Adds a real voided state (keep the record, reverse the JE,
-- read-only) distinct from Delete (remove the record AND hard-delete the JE).
ALTER TABLE bank_deposits ADD COLUMN voided_at timestamptz;
ALTER TABLE bank_deposits ADD COLUMN voided_by_user_id uuid REFERENCES users(id);
