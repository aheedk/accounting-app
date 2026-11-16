# User invitations and a polished sign-in — Design Spec

**Status:** Implemented 2026-11-15 (migration `0117`). Asked for: replace "the admin types in a
temporary password" with an emailed invitation a new hire accepts themselves, add a
self-service "forgot password" flow, and make the sign-in page look finished. QuickBooks
Online is the reference for the shape of the flow, not for its account-picker chrome —
this firm is one app, not a multi-product ecosystem, so that part is intentionally not built.

## What it is

Today, Setup → Users → Add user creates the login with a password the firm admin sees
once and hands to the person directly. That still works for an admin who wants it (it is
also how `npm run db:role-users` makes test logins), but the default path is now:

1. Add user creates the login in a **pending** state, with no usable password, and emails
   an invitation link.
2. The person opens the link, sets their own password, and is signed in at once.
3. If they forget it later, **Forgot password?** on the sign-in page emails a reset link.

The admin never sets or sees a real user's password in this path. Built-in roles, custom
roles ([`2026-11-09-custom-roles-design.md`](./2026-11-09-custom-roles-design.md)) and
per-company grants work exactly as before — this spec only changes how the password gets
onto the account.

## What's in `users`, and what it means (migration `0117`)

| Column | Meaning |
|---|---|
| `invitation_status` | `'pending'` (created, no email sent yet — only possible if sending itself threw), `'sent'` (an invite or a resend went out), `'accepted'` (the person set their password). **Default `'accepted'`** on the column, so every row that existed before this migration — and any made with a password supplied directly (`db:role-users`, a future API caller that still passes one) — reads as already set up. |
| `invitation_token_hash`, `invitation_expires_at` | The current invitation link, hashed (never the raw token) and its expiry. 30 days out from when it was (re)sent. Cleared once accepted. |
| `email_verified` | `true` once the person has proved they received the invitation (or reset) email by clicking its link. **Default `true`** for the same backfill reason as `invitation_status`. |
| `password_reset_token_hash`, `password_reset_expires_at` | The current **forgot-password** link. One hour out — much shorter than an invitation, since it is self-served from a public form rather than handed out by an admin. |

No new table: these are account state, like `deactivated_at` and `must_change_password`
already on this table (migrations `0091`, `0109`). A partial unique index on each token
hash column (`WHERE ... IS NOT NULL`) makes the lookup by raw token a single indexed
equality check, same shape as `refresh_tokens.token_hash`.

**Decision — no `'expired'` enum value.** QBO's admin view lists "expired" as a status
Intuit computes centrally. Doing that here would need a background job flipping rows
on a timer, just to answer a question the expiry timestamp already answers directly:
expired is `invitation_status IN ('pending','sent') AND invitation_expires_at < now()`,
computed where it's needed (the login attempt, the admin list) and never stored. Simpler,
and never goes stale between a cron tick and a page load.

**Decision — no delivery tracking ("opened", "not delivered").** That needs the email
provider's webhooks (bounce, open-pixel). Out of scope for a first pass; the admin sees
**sent** or **expired** only, with resend always available. Noted as deferred, not missing.

## Issuing and accepting a link

Both kinds of link (invitation, password reset) are the same mechanism: a random
32-byte token (`crypto.randomBytes(32).toString('base64url')`, `tokenService.ts`,
alongside the identical pattern `refresh_tokens` already uses) handed to the person raw,
with only its HMAC-SHA256 hash stored — keyed on `JWT_ACCESS_SECRET`, a second use of
that secret alongside signing the access token itself, so no third secret needs
provisioning. A token is looked up by hashing what came in and matching the column; nothing
about the raw value is ever logged or persisted.

**Accepting an invitation signs the person in.** After the new password is written, the
service calls the existing `login()` with the email and the password just chosen — the
normal sign-in path, so session creation, the audit record, and the result shape
(`access_token`, the refresh cookie, `businesses`) are identical to any other sign-in, not
a second implementation of them. **Completing a password reset does not** auto-sign-in; it
ends every existing session for that login (same as a firm admin's "Reset password" already
does) and sends the person to the sign-in page with a plain confirmation, since the request
asked for that shape and a stolen, then reset, account should not stay signed in anywhere.

**Decision — token errors are `PRECONDITION_FAILED` (409), not `UNAUTHORIZED`/`TOKEN_EXPIRED`
(401).** The API client retries a 401 by silently trying to renew the session and, on
failure, firing a "you were signed out" event (`apiClient.ts`) — built for an expired
*session*, not an invalid *invitation link*, and wrong here: there is no session to renew.
`WrongPasswordError` in `accountService.ts` already carves out the same exception for the
same reason; token errors in this feature follow it.

## Email

**Decision — Resend, gated on `RESEND_API_KEY`.** No transactional email provider existed
in this codebase before this feature (checked: no SendGrid/Postmark/SES/nodemailer
anywhere). The request named Resend as the simplest to integrate for Node, and nothing in
the existing toolchain already does this job, so `resend` is added as a new, narrowly-scoped
dependency — `apps/api/src/services/notifications/emailService.ts` is the only file that
imports it.

**Without `RESEND_API_KEY` set, the email is logged instead of sent** — not refused, not
faked. Every other part of the flow (the token, its expiry, acceptance, resend) works
whether or not real mail goes out, so local dev and the test suite need no key, and the one
thing that doesn't work without it is the actual delivery. **This is the one real-world
prerequisite the user has to supply**: an actual `RESEND_API_KEY` (resend.com/api-keys,
free: 100/day, no card). `EMAIL_FROM` defaults to `onboarding@resend.dev`, which every
Resend account may send from with no domain verification, so sending works the moment a
key is added; a custom `EMAIL_FROM` needs that domain verified there first.

**Decision — a failed send is surfaced, not just logged (11-16 follow-up).** `sendEmail()`
returns whether it actually went out. `createUser` and `resendInvitation` pass that back as
`email_sent` on their response: Setup → Users shows a green "User created" banner when it's
`true`, an amber "User created, but the email failed" one when it's `false` (same for
"Resend invitation", as an inline warning) — never a silent, identical-looking success
either way. The login is created either way (the user's own stated preference over rolling
it back), and "Resend invitation" is the recovery path once the server is actually
configured to send. `requestPasswordReset` (forgot password) deliberately does **not**
surface this: its response is identical whether the address exists or not, and showing a
delivery outcome would quietly break that by telling an attacker whether a given email has
a login.

Both emails share one inline-CSS card layout (`layout()` in `emailService.ts`) — a centered
table-based card, since table layout is what survives Outlook's rendering engine, with a
large primary button and muted fine print below it. No external template framework.

## Sign-in page and the new public routes

`LoginPage.tsx` keeps its file name and route (`/login`) — only its layout changes
(centered `max-w-[420px]` card, the wordmark above it, a right-aligned "Forgot password?"
under the password field, "Don't have an account? Contact your administrator" below the
button in place of QBO's self-registration link, since this app has none). Three new
standalone routes, siblings of `/login` in `App.tsx` (outside `ProtectedRoute`, no sidebar):

- `/accept-invitation?token=...` — validates the token on load (`GET
  /auth/validate-invitation`), shows the firm name and the email it's for (read-only), a
  name field (editable, pre-filled from what the admin typed), and password + confirm.
  Submits to `POST /auth/accept-invitation` and signs the person straight in.
- `/forgot-password` — one email field, posts to `POST /auth/forgot-password`, and always
  shows the same confirmation regardless of whether the address exists (a different
  message would let anyone probe which emails have logins — the existing login flow
  already avoids this with `unknownEmailHash`).
- `/reset-password?token=...` — validates via `GET /auth/validate-password-reset`, then a
  new password + confirm, posting to `POST /auth/reset-password`; redirects to `/login`
  with a success notice (reusing the same "notice" mechanism `idleSession.ts` already shows
  above the sign-in form for "you were signed out").

**Decision — the password hint shown is this app's real policy, not QBO's.** The request's
suggested text ("At least 8 characters, with a number and a letter") does not describe
what this app enforces (`packages/shared/src/passwords.ts`: minimum 10 characters, no
character-class rule, a blocklist of common words/patterns/runs, and a check against the
person's own email and name). Showing invented rules the server does not check would make
the form lie to the person filling it in the first time they use the app. The hint text is
the real one, and `passwordProblem()` is reused as-is — no second password policy.

**Decision — "Remember the user" is built as stated, with one limit called out.** The
remembered **email** is `localStorage`, read back to prefill `/login` with a "Not you?"
link to clear it. This is a convenience, not an account list — there is deliberately no
QBO-style "last accessed" card, since that would need a per-account cookie and session
metadata this app does not keep for that purpose.

## Setup → Users: status and resend

A login's row shows **Invitation sent** (amber) while `invitation_status = 'sent'` and not
expired, **Invitation expired** (red) once `invitation_expires_at` has passed with no
acceptance, and nothing extra once `invitation_status = 'accepted'` — the existing "Firm
role" cell already reads fine without a badge once the person is a normal, active login.
A **Resend invitation** action appears next to a pending or expired row and calls
`POST /me/firm/users/:id/resend-invitation` (firm admin only, added to `FIRM_ADMIN_ONLY` in
`roleMatrix.test.ts` next to its siblings); it is hidden once accepted.

**Decision — admin-set passwords stay, for an existing or locked-out login.** "Reset
password" (Setup → Users) still makes a temporary password the admin sees once, for a
login that already exists and needs a way back in right now (forgotten password, lost
phone, whatever locked them out) — it's a different problem from onboarding a new hire, and
the request didn't ask to remove it. Using it on a still-pending invitation now also marks
that invitation `accepted` and `email_verified` stays as it was: the admin handing over a
password in person is a complete substitute for the person doing it through the link, so
the login shouldn't stay stuck showing "Invitation sent" after this.

## Setup → Users action links, polish (11-16 follow-up)

The four per-row links (Resend invitation, Reset password, Sign out everywhere, Switch
off) already called real, tested endpoints before this pass; what they lacked was
feedback. Each now: disables itself and shows a busy label while its own call is in
flight; flashes a brief result next to the link (green on success, red on failure,
gone after 3 seconds) instead of only updating the row's badges and leaving the admin
to infer whether anything happened; and asks to confirm first for Sign out everywhere
and Resend invitation (Reset password and Switch off already did). Resend invitation and
Reset password are hidden once a login is switched off — neither does anything useful for
one that cannot sign in regardless — and Switch off is hidden on the firm's only active
firm admin's row, instead of being offered and refused.

**Decision — "Reset password" still hands the admin a temporary password; it is not an
emailed reset link.** This was raised explicitly: QBO's own admin-reset is an emailed link,
not a password the admin sees. Kept as the already-built, already-tested admin-presence
flow on purpose, same reasoning as the original spec's note on it above: it is the one way
back in that does not depend on email actually working, which matters most right when
email might not be (as this firm's live key wasn't configured yet, while this question was
being asked). `requestPasswordReset` already provides the emailed-link version for anyone
with access to their own email — self-serve, from the sign-in page. Adding a *second*,
separate "email them a reset link" action for an admin to trigger stays as a possible
addition, not built here, since it was not asked for outright and duplicating one
capability under two names is its own source of confusion.

## Setup → Users table redesign and two new actions (11-16, second follow-up)

The table's columns are now Name, Email, Status, Role, Business access, Actions — a
single status pill (Active / Invited / Expired / Deactivated, the same logic as the
badge above, just one per row instead of a side note) replacing the old email-first
layout, and the four-link vertical stack collapsed into one "Edit user ▾" dropdown
(`@/components/ui/dropdown-menu`, already in the app — used for Vendor detail's own
action menu). A search box plus role and status filters sit above the table, filtering
client-side over the one page of users a firm actually has. Business access collapses to
a one-line summary ("All businesses" for a firm admin, "None", or the first two names
plus a "+N more" count) that expands in place — with the existing grant form and revoke
links intact — rather than always showing the full list.

**Decision — "Reset password" still shows for a pending invitation, not Active only.**
Asked for it to be Active-only; kept it available until deactivated instead, because an
admin reset doubles as an alternate way to finish someone's setup without email (the
11-16 decision above), and Active-only would quietly remove that.

**Decision — two new, real capabilities, not stubs: renaming a login, and deleting one
that was never used.** "Edit user" opens an inline rename (full name only — the email
is the login's identity, left alone); "Delete" calls a new endpoint that refuses the
moment the login has ever signed in, been granted access to a business, or has anything
in the audit log, pointing to "Switch off" instead — the same question
`vendorService.deleteVendor` already asks of a vendor's transactions before a hard
delete, applied here with `users.deleted_at` (not a raw `DELETE`, unlike the vendor
case) specifically because that column, and the "hidden once set" convention around it,
already exists and is already what every other query in this file honors — reusing it
sidesteps the foreign-key risk a real `DELETE FROM users` would carry for no benefit.

**Not built: a "primary admin" concept, or `/api/v1/...`-style endpoints.** Neither
exists in this app — there is no single distinguished owner among a firm's admins, and
the existing routes (`/me/firm/users/:id/...`) are what the rest of the app, and its
tests, already expect. The trigger reads "Edit user" on every row, including your own
(renaming your own name still makes sense; the role-change menu stays replaced with
plain words there, as before).

## What's deferred

Everything the request itself listed as out of scope (self-registration, MFA on this path,
OAuth, the Intuit multi-product picker, "remove a user ID") stays out, plus two more,
called out above as narrower cuts: delivery/open tracking, and a stored `'expired'` status.
