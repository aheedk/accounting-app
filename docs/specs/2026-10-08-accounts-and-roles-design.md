# Accounts and roles — Design Spec

**Status:** Implemented 2026-10-08 (migrations `0091`–`0095`). It is the "features there
should be" list from the role audit (`docs/qa/2026-10-08-role-audit.md`), built. Three
items on that list need something from outside and are not built; they are at the end.
Signing in was tightened on 2026-10-21 (migration `0109`, "Firm security settings"
below; the reasons are in `docs/qa/2026-10-20-security-review.md`).

Everything here is off, or unchanged, until someone turns it on: no login is switched
off, nobody has two-step sign-in, payroll is open as before, and no company asks for
approval.

## Signing in

- **Switching a login off.** A firm admin can switch a login off and back on (Setup →
  Users). It is not deleted: the person's name stays on everything they did. It takes
  effect at once, on sessions they already have. Not your own login, and not the last
  firm admin.
- **Passwords.** Anyone changes their own under My account; every other browser is
  signed out. A firm admin can give a login a new one-time password, shown once. There
  is no emailed reset link because the app has no mail service. A password a firm admin
  made (a new login, or a reset) must be replaced by the person's own at their first
  sign-in with it, before the app opens. A new password needs 10 characters at least
  and is refused when it is a run (`1234567890`), is built on a word attackers try first
  (`Password2026!`, `Summer123`), or holds the person's own email or name
  (`packages/shared/src/passwords.ts`).
- **Wrong passwords.** Five in a row hold a login for fifteen minutes. A new password
  from a firm admin lifts the hold. A wrong current password given from inside a session
  (changing the password, turning the second step off) counts too, and the fifth also
  ends every session of the login.
- **Two-step sign-in.** A 6-digit code from any authenticator app (RFC 6238), after the
  password. Each person turns it on for themselves; it counts only once confirmed with
  a code, so an abandoned set-up locks nobody out. A firm admin can turn it off for
  someone who has lost their phone. The secret is encrypted with the same key as social
  security numbers. A code is good once: the 30-second step of the last code accepted is
  kept, and a code from that step or before is refused. A firm can require it of every
  login (below). *Not built:* a QR code (the key is typed in), and requiring it of one
  role only.
- **Sessions.** Each sign-in is a session, and the access token names it. My account
  lists where a person is signed in, with Sign out for one or for all the others.
  Signing out stops the access token at once, not when it expires.
  *How:* which sessions have ended is kept in memory in the API and reloaded from the
  database on start. One API instance runs today. With more than one, the others would
  catch up within the token's fifteen minutes, not at once.
- **How long a session lasts.** The browser renews its session while the person uses the
  app. Left alone for the firm's idle limit (an hour unless changed), it is signed out:
  the app warns two minutes before ("Still there?") and the sign-in page then says why;
  the API also refuses to renew a session not renewed within the limit, so a closed or
  frozen tab cannot be picked up later. Whatever the limit, a session ends 12 hours after
  signing in. The refresh cookie lasts no longer than the session may. The mobile app's
  sessions (its key is kept in the phone's secure store, `POST /auth/refresh-mobile`)
  last 30 days without use instead (`JWT_MOBILE_REFRESH_TTL_DAYS`): the phone's own lock
  guards it in between. Everything else here applies to the phone as well.
- **A session that ends while the app is open** (12 hours up, a new password set
  elsewhere, signed out by a firm admin) takes the browser to the sign-in page,
  which says so.
- **A role changed** takes effect on the person's next request, in a browser
  already open: the firm-wide role is carried in the access token, so changing
  it makes their tokens stop counting and the browser renews (without signing
  out) into one that carries the new role.
- **A copied sign-in key.** The refresh token is replaced each time it is used. If one
  that was replaced more than a minute ago comes back, someone kept a copy: the whole
  session is ended and the Activity Log says so. Within the minute it is only refused,
  as two tabs renewing together do that.

## Firm security settings

Setup → Users, "Sign-in security", firm admins only (`GET`/`PATCH /me/firm/security`):

| Setting | Default | What it does |
|---|---|---|
| Require the second step for every login | Off | Anyone without it set up is asked to set it up at their next sign-in, before anything else. A firm admin can turn it on only with their own second step on, so it cannot lock them out. While it is on, a person cannot turn theirs off; a lost phone is a firm admin's reset, then a new set-up at sign-in. |
| Sign out a browser left alone for | 1 hour | 15 minutes, 30 minutes, 1, 2 or 3 hours, as QuickBooks offers. |

**The set-up gate.** A login with steps left (its own password, the second step) signs
in, but its access token says so, and the API answers only `/me` and `/auth/*` for it
(`ACCOUNT_SETUP_REQUIRED`, 403, from `middleware/auth.ts`). The web app shows only the
set-up page; each step renews the session, which then carries what is left. A firm
turning the second step on reaches people already signed in at their next renewal,
within fifteen minutes.

## Roles

There are five roles now, in this order:

| Role | Reads | Changes |
|---|---|---|
| Firm admin | Everything | Everything |
| Accountant | Everything but the firm's users | Posts, voids, approves; everything staff do |
| Staff | The same | Data entry |
| **View only** (new) | What staff read | Nothing |
| Client | Its reports, invoices, bills and messages | Sends documents in; writes messages |

- **View only** is for a reviewer or an auditor. It ranks between client and staff, so
  every guard that asks for staff already refuses it.
- **A role is shown only what it can use.** The menus, and now the pages: a button or
  form the API would refuse is not on the page. Forms only an accountant can save
  (Journal entry, Transfer, Credit memo, Vendor credit, Pay Bills, Run payroll) are
  closed to staff. In code: `useCan()` and `hideUnless(can.accountant)` from
  `apps/web/src/lib/roleAccess.ts`.
- **Payroll can be closed to a login** (Setup → Users, the Payroll tick box). On by
  default. A firm admin always has it. It closes the payroll screens; pay that has
  been run is still in the general ledger as journal entries.
- **Activity log** (Setup → Activity Log): who did what, across a company, newest
  first. For an accountant and up, because it shows payroll records. A firm admin can
  switch it to sign-ins and changes to the firm's users.

## The approval step

The original design says staff make drafts and an accountant posts. That was true of
invoices, bills and payments. Expenses, checks, bank deposits, categorizing a bank or
integration line, item receipts and stock adjustments have no draft: they are in the
books when saved.

- **A switch per company**, off by default, turned on by a firm admin on Accounting →
  Approvals.
- With it on, when a **staff** login saves one of those, nothing is recorded. The
  request is kept exactly as sent and the answer is "Sent for approval".
- An accountant sees what is waiting and **approves** or **rejects** with a note. Staff
  see their own and what became of them.
- **Approving sends the kept request again as the accountant**, to the same route. It
  goes through every check that route makes and is recorded by the service that always
  records it. No posting logic exists twice. If recording is refused (a closed
  period), it stays waiting and the accountant is told why.
- The record made shows the accountant as the one who recorded it; the approval shows
  who entered it. Both are in the activity log.
- *Not built:* files attached while entering are not carried through approval, and an
  entry cannot be edited while it waits (reject it and enter it again).

## For a client

- **Send documents**: statements, bills, receipts, check stubs. They land in the AI
  inbox and reach the books only when an accountant approves them.
- **Bills** beside invoices, read only.
- **Customer statements** (also for the firm): Accounts Receivable → Statements.
- **Messages**: one thread per company between the client and the firm, with an unread
  count. Every role can read it; everyone but View only can write.

## Not built

| What | Why |
|---|---|
| Invite a user by email; emailed password reset | No mail service. A firm admin passes on a one-time password instead |
| Pay and be paid online | Needs a Stripe account (item 24 of the 10-05 meeting) |

## Where it is enforced

- `apps/api/src/lib/clientAccess.ts`: everything a client may do. A new route is closed
  to clients until it is added there.
- `apps/api/src/middleware/payrollAccess.ts` and `approvalHold.ts`: mounted once in
  `app.ts` in front of every router, so no route file had to change.
- `apps/api/tests/integration/roleMatrix.test.ts`: every route called as all five roles.
  What staff may change and what only a firm admin may do are exact lists there.
