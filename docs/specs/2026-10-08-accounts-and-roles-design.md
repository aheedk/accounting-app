# Accounts and roles — Design Spec

**Status:** Implemented 2026-10-08 (migrations `0091`–`0095`). It is the "features there
should be" list from the role audit (`docs/qa/2026-10-08-role-audit.md`), built. Three
items on that list need something from outside and are not built; they are at the end.

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
  is no emailed reset link because the app has no mail service.
- **Wrong passwords.** Five in a row hold a login for fifteen minutes. A new password
  from a firm admin lifts the hold.
- **Two-step sign-in.** A 6-digit code from any authenticator app (RFC 6238), after the
  password. Each person turns it on for themselves; it counts only once confirmed with
  a code, so an abandoned set-up locks nobody out. A firm admin can turn it off for
  someone who has lost their phone. The secret is encrypted with the same key as social
  security numbers. *Not built:* a QR code (the key is typed in), and requiring it for
  a role.
- **Sessions.** Each sign-in is a session, and the access token names it. My account
  lists where a person is signed in, with Sign out for one or for all the others.
  Signing out stops the access token at once, not when it expires.
  *How:* which sessions have ended is kept in memory in the API and reloaded from the
  database on start. One API instance runs today. With more than one, the others would
  catch up within the token's fifteen minutes, not at once.

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
