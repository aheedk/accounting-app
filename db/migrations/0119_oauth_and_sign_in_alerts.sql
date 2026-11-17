-- Social sign-in (account linking, not self-registration) and the
-- new-device/new-location sign-in alert. Spec:
-- docs/specs/2026-11-17-auth-email-lifecycle-and-social-login-design.md
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS microsoft_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;
-- Shown on My account as "Last changed [date]"; also what skips the alert
-- email on the very first sign-in (there's no device to compare against yet).
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS users_google_id ON users (google_id) WHERE google_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_microsoft_id ON users (microsoft_id) WHERE microsoft_id IS NOT NULL;

-- A browser/location this login has signed in from before. A fingerprint
-- (hash of user-agent + the IP's /24) that isn't here yet gets the alert
-- email and a new row; one that is just gets last_seen bumped.
CREATE TABLE IF NOT EXISTS user_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_fingerprint text NOT NULL,
  device_label text,
  ip_address text,
  last_seen timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_fingerprint)
);
CREATE INDEX IF NOT EXISTS user_devices_user_id ON user_devices (user_id);
