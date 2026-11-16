-- Invitation and forgot-password links, in place of an admin-typed temporary
-- password. Spec: docs/specs/2026-11-15-user-invitations-and-signin-design.md
--
-- invitation_status: pending (created, not yet mailed), sent (a link went
-- out), accepted (the person set their own password). Default 'accepted' so
-- every row from before this migration, and any made by a caller that still
-- supplies a password directly (db:role-users), reads as already set up.
-- "Expired" is not a stored value: it's invitation_status IN ('pending',
-- 'sent') AND invitation_expires_at < now(), computed where it's asked.
--
-- email_verified: true once the person has clicked an invitation or reset
-- link mailed to them. Default true for the same backfill reason.
--
-- password_reset_*: a separate, shorter-lived link (one hour) for the
-- self-service "forgot password" flow; unrelated to an open invitation.
ALTER TABLE users ADD COLUMN IF NOT EXISTS invitation_status text NOT NULL DEFAULT 'accepted';
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_invitation_status_check
    CHECK (invitation_status IN ('pending', 'sent', 'accepted'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invitation_token_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invitation_expires_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS users_invitation_token_hash
  ON users (invitation_token_hash) WHERE invitation_token_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_password_reset_token_hash
  ON users (password_reset_token_hash) WHERE password_reset_token_hash IS NOT NULL;
