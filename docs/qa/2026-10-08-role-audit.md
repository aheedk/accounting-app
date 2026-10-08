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

## The four roles today

| Role | Can read | Can change |
|---|---|---|
| **Client** | The dashboard figures, its invoices, and six reports: Profit & Loss, Balance Sheet, Cash Flows, Trial Balance, A/R Aging, A/P Aging | Nothing |
| **Staff** | Everything except a full social security number, a vendor's tax id, and the firm's user list | Data entry: customers, vendors and items; invoice, bill and payment drafts; expenses, checks and deposits; categorizing bank lines; purchase and sales orders; attachments |
| **Accountant** | The same as staff | Everything staff can, plus posting and voiding, journal entries, credit memos, vendor credits, transfers, Pay Bills, payroll, recurring templates, reconciliation, closing a period, budgets, the chart of accounts, the AI inbox and coding rules |
| **Firm admin** | Everything | Everything, including users, clients, company settings, bank accounts, tax codes, adding and deleting employees, deleting records, and reopening a period |

In numbers: a client is let into 13 of the 113 read routes and none of the 141 that
change something; staff into 44 of the 141; an accountant into 120; a firm admin into all.

## Found and fixed

| # | What was wrong | Fix |
|---|---|---|
| 1 | **A client login could read almost everything**: 107 of the 113 read routes, including payroll, employees, bank lines, the AI inbox and audit history. The design gives a client its reports and invoices only | A client is now refused everything that is not on a short list. A new route is closed to clients until it is added to that list. `d08f828` |
| 2 | Two routes had no role check at all. Any login, a client included, could trigger a poll of the firm's mailbox | Both guarded. `d08f828` |
| 3 | **A firm admin lost clients on reloading the page.** Signing in listed every client of the firm; reloading listed only the ones granted by name | Reloading gives the same list as signing in. `f894249` |
| 4 | Nothing in the menus looked at the role. A client saw the whole sidebar, the + New menu and every search result, and found out page by page that none of it would load | The sidebar, + New and search offer only what the role can open. A page reached another way says it is not part of your access. `06ac174` |
| 5 | On the pages a client can use, links led to pages it cannot: Receive payment, the customer, the journal entry, and every amount on the four statements | Removed for a client. `88de457` |
| 6 | **Ten pages ignored a role given for one company.** Setup → Users can make someone an accountant for one client only; those pages, and the badge by the user's name, read the firm-wide role instead | They all use the role on the open company, which is the one the API checks. `bcc694d` |
| 7 | + New offered staff six forms they cannot save: Credit memo, Pay bills, Vendor credit, Run payroll, Journal entry, Transfer | Left out for staff. `bcc694d` |
| 8 | Add bank account, New tax code and Seed a year were offered to everyone and refused for all but a firm admin | Shown to a firm admin only. `bcc694d` |
| 9 | A refusal read "Requires accountant" | It says who can do it: "This needs an accountant or a firm admin." `d08f828` |

Nothing returned a server error for any role, before or after.

## Not changed: decisions for the firm

1. **Staff post to the ledger.** The original design says staff make drafts and an
   accountant posts. That holds for invoices, bills and payments. It does not hold for
   expenses, checks, bank deposits, categorizing a bank or integration line, item
   receipts and stock adjustments: these have no draft, so they are in the books the
   moment staff save them. Is that what a staff login should be able to do?
2. **Staff can add a customer or a vendor but cannot edit one.** Fixing a typo in a
   name needs an accountant.
3. **What only a firm admin can do.** An accountant can run payroll and edit an
   employee but cannot add one. An accountant also cannot add a bank account or a tax
   code, delete any record, or change company settings (the AI auto-post switch and the
   capitalization threshold among them). Confirm each of these is meant.
4. **What a client should see.** Today: invoices and six reports. Not bills, not bank
   balances, not the General Ledger.
5. **Connecting the firm's Gmail needs no sign-in.** The address that starts it
   (`/auth/gmail`) and the one Google returns to can be opened by anyone who can reach
   the API, and whoever completes Google's consent becomes the mailbox the AI inbox
   reads. It should be for a firm admin only. Left alone because it is the firm's own
   setup step, and how that is done in production has to be known before it is locked.
6. **Buttons a role cannot use are still on many pages**: Reject in the AI inbox, Void
   on a pay run, Delete on a rule, Post on a bill. They now answer with a clear
   sentence. Hiding them page by page is in the list below.

## Features there should be

**Accounts and signing in**

- **Remove or switch off a user.** A user's role can be changed and their clients taken
  away, but nobody can be removed. Someone who leaves the firm keeps a working login.
- **Change your own password, and reset a forgotten one.** The only password is the one
  shown once when the user is created. Not even a firm admin can reset it.
- **A limit on wrong passwords.** Failed sign-ins are recorded but never slowed or locked.
- **Two-step sign-in**, at least for firm admins.
- **Sign out everywhere**, and a list of where a user is signed in. A login lasts up to
  180 days.
- **Invite by email** instead of reading a password off the screen. Needs a mail service.

**Roles and permissions**

- **Hide what a role cannot use on every page**, not only in the menus.
- **A view-only role** for a reviewer or an auditor: reads everything, changes nothing.
  The nearest today is client, which sees very little.
- **An approval step**: staff enter, an accountant approves, then it posts. This is what
  "staff make drafts" would mean for expenses, checks and deposits.
- **Access by area.** Payroll, with pay rates and the last four digits of each social
  security number, is open to every staff login. A firm will want payroll limited to
  the people who run it.
- **A log of who did what**, for a whole company. The record is kept; it can only be
  seen one record at a time, on four screens.

**For a client login**

- **Upload documents** (statements, receipts, bills) straight into the AI inbox.
- **See what they owe in detail**: bills, and statements for their customers.
- **Pay and be paid online** (the Stripe item from the 10-05 meeting).
- **Messages** between the client and their accountant.

## Checking it again

- `npm run db:role-users` makes accountant, staff and client logins on a local database
  and prints a new password for them.
- In `apps/api`: `npx vitest run tests/integration/roleMatrix.test.ts`. The two lists in
  that file, what staff may change and what only a firm admin may do, are the permission
  table. A new route fails the test until it is put in one of them on purpose.
- What a client may open is in two places that have to agree:
  `apps/api/src/lib/clientAccess.ts` (enforced) and `apps/web/src/lib/roleAccess.ts`
  (what the menus show).
