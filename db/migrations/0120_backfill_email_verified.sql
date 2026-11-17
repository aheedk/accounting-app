-- The email-verification gate added in migration 0119's follow-up
-- (services/auth/authService.ts's login()) checks email_verified, which was
-- already being set true on accepting an invitation or completing a reset —
-- but only going forward. An account that already finished setup (accepted
-- its invitation, or was handed a password directly by an admin) before this
-- gate existed was never retroactively marked verified, and got wrongly
-- locked out. Anyone already past setup — accepted their invitation, or no
-- longer has a pending admin-set temp password — clearly already controls
-- the address; back-mark them verified.
-- Spec: docs/specs/2026-11-17-auth-email-lifecycle-and-social-login-design.md
UPDATE users
SET email_verified = true
WHERE email_verified = false
  AND (invitation_status = 'accepted' OR must_change_password = false);
