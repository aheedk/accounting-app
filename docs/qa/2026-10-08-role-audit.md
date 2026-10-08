# Role audit — 2026-10-08

Until now the app had only ever been tested signed in as a firm admin. This is a pass
over the other three roles: what each can see and do, what was wrong, what was fixed,
and what is still missing.

## How it was tested

1. **Every API route as every role.** All 254 routes were called as a client, a staff
   member, an accountant and a firm admin. This is now a test that stays in the suite
   (`apps/api/tests/integration/roleMatrix.test.ts`).
2. **Every page as every role.** Signed in on localhost as a client, as staff and as an
   accountant, and opened all 86 pages, watching for refused or failed requests.
3. **The code.** Every place the web app checks a role.

## The roles

As found on the day of the audit, there were four. A fifth, View only, was added
afterwards (see "Features there should be"). This is how they stand now:

| Role | Can read | Can change |
|---|---|---|
| **Client** | The dashboard figures, its invoices and bills, customer statements, six reports (Profit & Loss, Balance Sheet, Cash Flows, Trial Balance, A/R Aging, A/P Aging), and its messages | Nothing in the books. It can send documents in and write messages |
| **View only** | Everything staff read | Nothing |
| **Staff** | Everything except a full social security number, a vendor's tax id, the firm's user list and the activity log | Data entry: customers, vendors and items; invoice, bill and payment drafts; expenses, checks and deposits; categorizing bank lines; purchase and sales orders; attachments |
| **Accountant** | The same as staff, and the activity log | Everything staff can, plus posting and voiding, journal entries, credit memos, vendor credits, transfers, Pay Bills, payroll, recurring templates, reconciliation, closing a period, budgets, the chart of accounts, the AI inbox, coding rules and approvals |
| **Firm admin** | Everything | Everything, including users, clients, company settings, bank accounts, tax codes, adding and deleting employees, deleting records, and reopening a period |

On the day of the audit, in numbers: a client was let into 13 of the 113 read routes
and none of the 141 that change something; staff into 44 of the 141; an accountant into
120; a firm admin into all.

## Found and fixed

| # | What was wrong | Fix |
|---|---|---|
| 1 | **A client login could read almost everything**: 107 of the 113 read routes, including payroll, employees, bank lines, the AI inbox and audit history. The design gives a client its reports and invoices only | A client is now refused everything that is not on a short list. A new route is closed to clients until it is added to that list. `5afc8e5` |
| 2 | Two routes had no role check at all. Any login, a client included, could trigger a poll of the firm's mailbox | Both guarded. `5afc8e5` |
| 3 | **A firm admin lost clients on reloading the page.** Signing in listed every client of the firm; reloading listed only the ones granted by name | Reloading gives the same list as signing in. `1a69563` |
| 4 | Nothing in the menus looked at the role. A client saw the whole sidebar, the + New menu and every search result, and found out page by page that none of it would load | The sidebar, + New and search offer only what the role can open. A page reached another way says it is not part of your access. `388cf49` |
| 5 | On the pages a client can use, links led to pages it cannot: Receive payment, the customer, the journal entry, and every amount on the four statements | Removed for a client. `648c399` |
| 6 | **Ten pages ignored a role given for one company.** Setup → Users can make someone an accountant for one client only; those pages, and the badge by the user's name, read the firm-wide role instead | They all use the role on the open company, which is the one the API checks. `c79c9eb` |
| 7 | + New offered staff six forms they cannot save: Credit memo, Pay bills, Vendor credit, Run payroll, Journal entry, Transfer | Left out for staff. `c79c9eb` |
| 8 | Add bank account, New tax code and Seed a year were offered to everyone and refused for all but a firm admin | Shown to a firm admin only. `c79c9eb` |
| 9 | A refusal read "Requires accountant" | It says who can do it: "This needs an accountant or a firm admin." `5afc8e5` |

Nothing returned a server error for any role, before or after.

## Decisions for the firm

1. **Staff post to the ledger.** The original design says staff make drafts and an
   accountant posts. That holds for invoices, bills and payments. It does not hold for
   expenses, checks, bank deposits, categorizing a bank or integration line, item
   receipts and stock adjustments: these have no draft, so they are in the books the
   moment staff save them. *There is now a switch for it:* with approval turned on for
   a company (Accounting → Approvals), those wait for an accountant. It is off by
   default. Should it be on for the firm's clients?
2. **Staff can add a customer or a vendor but cannot edit one.** Fixing a typo in a
   name needs an accountant.
3. **What only a firm admin can do.** An accountant can run payroll and edit an
   employee but cannot add one. An accountant also cannot add a bank account or a tax
   code, delete any record, or change company settings (the AI auto-post switch and the
   capitalization threshold among them). Confirm each of these is meant.
4. **What a client should see.** Now: invoices, bills, customer statements, six reports
   and messages, and it can send documents in. Not bank balances, not the General
   Ledger.
5. **Connecting the firm's Gmail needs no sign-in.** The address that starts it
   (`/auth/gmail`) and the one Google returns to can be opened by anyone who can reach
   the API, and whoever completes Google's consent becomes the mailbox the AI inbox
   reads. It should be for a firm admin only. Left alone because it is the firm's own
   setup step, and how that is done in production has to be known before it is locked.

## Features there should be

The audit listed these as missing. All but three are now built
(`docs/specs/2026-10-08-accounts-and-roles-design.md`). Each is off, or unchanged,
until someone turns it on.

**Accounts and signing in**

| What | Now |
|---|---|
| Remove or switch off a user | **Built.** Setup → Users → Switch off. It ends the person's sessions at once and can be switched back on. `e4be47a`, `497fe6d` |
| Change your own password; reset a forgotten one | **Built.** My account → Password. A firm admin can give a login a new one-time password. An emailed reset link is not built (no mail service) |
| A limit on wrong passwords | **Built.** Five in a row hold a login for fifteen minutes |
| Two-step sign-in | **Built.** Each person turns it on under My account, with any authenticator app. Requiring it for a role is not built |
| Sign out everywhere; where a user is signed in | **Built.** My account → Where you are signed in. Signing out also stops a session at once |
| Invite by email | **Not built.** Needs a mail service |

**Roles and permissions**

| What | Now |
|---|---|
| Hide what a role cannot use on every page | **Built.** Thirty more pages; forms only an accountant can save are closed to staff. `7862b1c` |
| A view-only role | **Built.** "View only": reads what staff read, changes nothing. `ca7a526` |
| An approval step | **Built.** A switch per company on Accounting → Approvals. `2d47079`, `3e159c8` |
| Access by area | **Built for payroll.** Setup → Users, the Payroll tick box. `7d7b18c` |
| A log of who did what | **Built.** Setup → Activity Log, for an accountant and up. `8b9b906` |

**For a client login**

| What | Now |
|---|---|
| Upload documents | **Built.** Send documents; they wait in the AI inbox for an accountant. `6c49cc2`, `7175ef7` |
| See what they owe in detail | **Built.** Bills, and Accounts Receivable → Statements for their customers. `007f22c` |
| Pay and be paid online | **Not built.** Needs a Stripe account |
| Messages | **Built.** One thread per company, with an unread count |

## Checking it again

- `npm run db:role-users` makes accountant, staff, view-only and client logins on a
  local database and prints a new password for them.
- In `apps/api`: `npx vitest run tests/integration/roleMatrix.test.ts`. It calls every
  route as all five roles. The two lists in that file, what staff may change and what
  only a firm admin may do, are the permission table. A new route fails the test until
  it is put in one of them on purpose.
- What a client may open is in two places that have to agree:
  `apps/api/src/lib/clientAccess.ts` (enforced) and `apps/web/src/lib/roleAccess.ts`
  (what the menus show).
