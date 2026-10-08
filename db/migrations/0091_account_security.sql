-- Signing in and accounts (docs/specs/2026-10-08-accounts-and-roles-design.md).
--
-- A login can be switched off, is locked for a while after too many wrong
-- passwords, can ask for a second step (a code from an authenticator app), and
-- can be signed out everywhere. Each signed-in browser is listed with where it
-- was opened.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  -- Access tokens issued before this no longer count. Refresh tokens are revoked row by row.
  ADD COLUMN IF NOT EXISTS sessions_revoked_at timestamptz,
  -- The authenticator secret, encrypted like a social security number. Set while
  -- setting up; the second step is asked for only once totp_enabled_at is set.
  ADD COLUMN IF NOT EXISTS totp_secret bytea,
  ADD COLUMN IF NOT EXISTS totp_enabled_at timestamptz;

-- A refresh token is replaced every time it is used, so the row is a session's
-- latest token. session_id and session_started_at are carried from one to the
-- next: which sign-in this is, and when it happened. The access token names its
-- session too, so ending one session ends that one and no other.
ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS session_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS session_started_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS ip_address text;

UPDATE refresh_tokens SET session_started_at = created_at WHERE session_started_at > created_at;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session ON refresh_tokens (session_id);
