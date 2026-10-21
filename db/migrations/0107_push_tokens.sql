-- Expo push tokens, one row per (user, device) — a login may carry the app
-- on more than one device, and a device may change its token on reinstall,
-- so the token itself is the unique key, not the user.
CREATE TABLE push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_tokens_user_id_idx ON push_tokens(user_id);
