-- The firm's single top-level owner among its (possibly several) firm admins
-- — QBO's "Primary admin": the one who can't be demoted or deactivated, and
-- the only one who can transfer the designation onward.
-- Spec: docs/specs/2026-11-15-user-invitations-and-signin-design.md
ALTER TABLE firms ADD COLUMN IF NOT EXISTS primary_admin_user_id uuid REFERENCES users(id);

-- A pending transfer of that designation to another firm admin — one at a
-- time, by firm. Same shape as an invitation's token (migration 0117):
-- hashed, time-limited, cleared on accept, decline, or cancel.
ALTER TABLE firms ADD COLUMN IF NOT EXISTS transfer_target_user_id uuid REFERENCES users(id);
ALTER TABLE firms ADD COLUMN IF NOT EXISTS transfer_token_hash text;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS transfer_expires_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS firms_transfer_token_hash
  ON firms (transfer_token_hash) WHERE transfer_token_hash IS NOT NULL;

-- Every existing firm gets one: its earliest-created, still-active firm
-- admin — the closest thing to "whoever actually set this firm up" that the
-- existing data can answer. A firm with no firm admin at all (shouldn't
-- happen; every signup needs at least one) is left null and the app treats
-- that as "nobody is primary yet" rather than guessing.
UPDATE firms f SET primary_admin_user_id = (
  SELECT u.id FROM users u
  WHERE u.firm_id = f.id AND u.role = 'firm_admin' AND u.deleted_at IS NULL AND u.deactivated_at IS NULL
  ORDER BY u.created_at ASC LIMIT 1
) WHERE f.primary_admin_user_id IS NULL;
