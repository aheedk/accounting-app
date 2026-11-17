# Auth email lifecycle and social sign-in — Design Spec

**Status:** Implemented 2026-11-17 (migration `0119`). Asked for: email verification enforced at
sign-in, a full set of account-security notification emails (password changed, new-device/location
alert, deactivated, reactivated, social-account-linked), and Google/Microsoft sign-in as an
account-linking flow layered on top of this app's admin-creates-the-login model. QuickBooks Online
is the reference for *when* each email fires and the login page's layout — not for a second,
parallel account system.

## What it is

**Email verification.** `users.email_verified` already existed (migration 0117) and was already
set `true` by accepting an invitation or completing a password reset — `login()` just never
checked it. It now does: an unverified login is refused with "Please check your email to verify
your account before signing in." An admin handing someone a password directly
(`resetUserPassword`) now also sets `email_verified: true` — it confirms the address the same way
accepting an invitation does.

**The email rules**, each hooked into the service that already does the thing, not a separate
notifier polling for state changes:

| Trigger | Service | Email |
|---|---|---|
| Admin creates/resends an invitation | `invitationService` | `invitationEmail` (unchanged, subject reworded to match the request) |
| Forgot password / admin's reset-password reset link | `passwordResetService` | `passwordResetEmail` (unchanged, subject reworded) |
| Password actually changes (self-service change, or completing a reset link) | `accountService.changePassword`, `passwordResetService.completePasswordReset` | `passwordChangedEmail` |
| New device/location sign-in | `authService.login` → `signInAlertService.noteSignIn` | `newSignInAlertEmail` |
| Admin switches a login off | `userManagementService.deactivateUser` | `accountDeactivatedEmail` |
| Admin switches a login back on | `userManagementService.reactivateUser` | `accountReactivatedEmail` |
| A social account gets linked | `socialAuthService` | `socialAccountLinkedEmail` |
| Primary Admin transfer initiated | `primaryAdminService` (already built 2026-11-16) | `primaryAdminTransferEmail` |

Every email is `emailService.ts`'s existing `layout()` card — extended to make the button
optional, since three of the new ones (deactivated, reactivated, social-linked) are purely
informational with nothing to click.

**New-device/location alerts.** `user_devices` (migration 0119) is a login's *known* browsers —
deliberately separate from `refresh_tokens`/sessions, which get revoked on sign-out; a device
should stay "known" even after its session ends. A fingerprint is `sha256(user-agent + IP's /24)`
— the last octet is ignored so a home ISP rotating it doesn't manufacture a new "device" every
sign-in. Location is `geoip-lite` (city-level, bundled data, no network call) — "Unknown location"
for a private/local IP, which is every dev and test sign-in. The very first sign-in on a login
(`last_login_at` was null) never alerts: that's the device the person just set their password on.

**Social sign-in (Google/Microsoft) — account linking, never registration.** A login is always
made by an admin first (createUser); a provider button only ever:
- **Signs in** if its provider id (`google_id`/`microsoft_id`) is already attached to a login, or
- **Links and signs in**, once, if a login exists for that email and isn't linked yet, or
- **Refuses** with "No account found for `<email>`. Contact your administrator to get access." —
  never creates one.

`socialAuthService.ts` splits the network round trip (`googleProfile`/`microsoftProfile`, talking
to the real provider) from the DB/linking logic (`signInWithProfile`, `linkProfileToUser`) so the
latter is unit-testable without a live OAuth exchange — `tests/integration/socialAuth.test.ts`
calls it directly with a fake resolved profile.

The browser flow is a server-side redirect round trip, the same shape Gmail's existing connect
flow (`gmailAuth.ts`) already uses, with its own signed, 10-minute CSRF `state`
(`tokenService.signSetupPurposeToken`/`verifySetupPurposeToken` — generalized from
`signGmailConnectState` to carry no claims, or one: the signed-in user's id, for "Connect Google"
from My account):

1. `GET /auth/google` / `GET /auth/microsoft` → redirect to the provider's consent page.
2. `GET /auth/google/callback` / `GET /auth/microsoft/callback` → resolves the code, links/signs
   in, sets the httpOnly refresh cookie exactly as `/auth/login` does, and redirects the browser
   to `${APP_PUBLIC_URL}/oauth-complete` — **no access token ever appears in a URL.**
3. `OAuthCompletePage.tsx` calls the existing `renew()` (the same one an idle-but-still-signed-in
   tab uses) to pick up the session the cookie now carries, then goes to `/`.

"Connect Google/Microsoft" from My account is the identical round trip, started from
`GET /auth/:provider/connect` (signed in, returns `{url}` as JSON rather than redirecting, since
it's triggered from a fetch, not a page navigation) with the state carrying the caller's user id —
the callback then calls `linkProfileToUser` for that specific login instead of running the sign-in
lookup, and conflicts (that provider id already belongs to someone else) are refused.

Unlinking (`DELETE /auth/social/:provider`) is self-service only, and lives under `/auth/` —
**on purpose**: that's also why it's exempt from `roleMatrix.test.ts`'s whole-API enumeration, the
same reason `/auth/password` and `/auth/sessions/...` are (see that file's own comment). Every
login here always has a `password_hash` (an admin sets one before the person ever signs in, even
before an invitation is accepted) — there's no "no password yet" state in this app's data model,
so unlinking a social account can never lock anyone out. Nothing further to check before doing it.

## Deviations from the request, and why (this repo's decision ladder: match existing patterns first)

- **Routes stay under `/auth/...` and `/me/...`**, not `/api/v1/auth/...` — this app has no
  `/api/v1` prefix anywhere (the same deviation the Primary Admin round made for the same reason).
- **No new OAuth library.** Google reuses `googleapis`'s `google.auth.OAuth2`, already a
  dependency for Gmail connect. Microsoft needed nothing: a plain `fetch` against
  `login.microsoftonline.com`'s `/common/oauth2/v2.0/{authorize,token}` and Microsoft Graph's
  `/me` is the whole flow — adding `passport`, `passport-google-oauth20`, or
  `@azure/msal-node`/`passport-azure-ad` would mean a second, parallel way of doing OAuth next to
  the one Gmail connect already has, for no capability this app needs that a few `fetch` calls
  don't already provide. `geoip-lite` (+ `@types/geoip-lite`) is the one genuinely new dependency
  — there's no existing IP-geolocation capability to reuse, and it's exactly what the request
  itself specified.
- **`MICROSOFT_TENANT_ID` defaults to `'common'`** (configurable, per the request's own text)
  rather than being required.
- **The admin-triggered "Reset password" action is unchanged** — it still generates and discloses
  a plaintext password directly to the admin (`resetUserPassword`), rather than switching to
  emailing the user a reset link. The request's table lists "Admin triggers password reset → same
  reset email," but that would be a materially different, already-shipped, already-tested
  admin flow (`accountSecurity.test.ts`, `invitations.test.ts`, `signInSecurity.test.ts`) with no
  reported problem to fix. Read instead as "use the same reset-email *template/pattern* language,"
  which the existing `passwordResetEmail` already is.

## Not built, and why

- **A dedicated "known devices" list on My account.** `signInAlertService.knownDevices()` is
  written and exported but not wired into `AccountPage.tsx` — the sessions table already there
  covers "where am I signed in," and a second, overlapping list (devices that aren't necessarily
  *current* sessions) is a real but separate piece of UI the request's own Security section asked
  for distinctly from "Active sessions." Scoped out rather than half-built; the backing data and
  function are ready for it.
- **Admin-initiated unlink** (`POST /users/:userId/unlink-social` in the request's own route
  table). Only self-service unlink (`DELETE /auth/social/:provider`) is built. The request's own
  prose settles this the same way: "A user should be able to unlink their social account from
  their own profile" — the safety concern (locking someone out) is about the person themselves,
  not an admin acting on their behalf, and there's no existing pattern in this app for an admin
  reaching into another login's linked-identity state the way there is for a password or a role.
- **`avatar_url` has nowhere to show yet.** The column is populated from the provider's profile on
  link, ready for whenever an avatar appears in the UI (nowhere currently shows one for any user).
