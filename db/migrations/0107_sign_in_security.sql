-- Signing in, second pass (security review 2026-10-21,
-- docs/qa/2026-10-20-security-review.md; spec
-- docs/specs/2026-10-08-accounts-and-roles-design.md, "Firm security settings").
--
-- users.must_change_password: a password a firm admin made (a new login, or a
-- reset) is known to that admin, so the person chooses their own before using
-- the app. Logins that already exist are not asked.
--
-- users.totp_last_step: the 30-second step of the last code accepted, so a
-- code read over someone's shoulder cannot be used again in its minute.
--
-- firms.require_two_step: every login of the firm sets up the second step
-- before using the app.
--
-- firms.idle_sign_out_minutes: a browser left alone this long is signed out,
-- as QuickBooks does (one hour unless changed).
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step bigint;

ALTER TABLE firms ADD COLUMN IF NOT EXISTS require_two_step boolean NOT NULL DEFAULT false;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS idle_sign_out_minutes integer NOT NULL DEFAULT 60;
DO $$ BEGIN
  ALTER TABLE firms ADD CONSTRAINT firms_idle_sign_out_minutes_check
    CHECK (idle_sign_out_minutes IN (15, 30, 60, 120, 180));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
