# Custom roles — Design Spec

**Status:** Designed 2026-11-09. Asked for by Aheed: "make a proper one that you can
also edit and add roles and change the users permissions through there, make it super
customizable". Builds on `2026-10-08-accounts-and-roles-design.md`, which this does not
change for anyone who keeps a built-in role.

## What it is

A firm admin makes roles of their own on **Setup → Roles**: a name, a line saying what
it is for, and, for each of ten areas of the books, how far the role goes. A role is
then given to a login on Setup → Users, firm-wide or for one company, exactly where a
built-in role is given today. Logins are made on Setup → Users as before ("Add user"),
and can be given a custom role from the start.

The five built-in roles stay as they are and are shown on the same page as fixed
rows, so a firm admin can see what each one amounts to and **duplicate** one as the
starting point for their own.

## Levels

Each area gets one of five levels. Every level above "No access" is one of the
existing tiers, so a route behaves for a custom role exactly as it already does for
the built-in role of that tier, and no route needs a new guard:

| Level | Same as, in that area | Lets the login |
|---|---|---|
| No access | — | The area is off the menu and every call to it is refused |
| View | View only | Read |
| Enter | Staff | Data entry; where the company asks for approval, entries wait for it |
| Post | Accountant | Also post, void, approve, close, reconcile |
| Full | Firm admin | Also delete, the area's settings, revealing a tax id or SSN, reopening a period |

## Areas

| Area | What is in it (API path after `/businesses/:id`) |
|---|---|
| Sales | invoices, estimates, payments received, credit memos, customers |
| Expenses & bills | bills, bill payments, vendor credits, expenses, checks, vendors, contractors, A/P overview, unpaid bills |
| Banking | bank accounts, bank lines and imports, rules, deposits, transfers, reconciliation, integrations |
| Accounting | journal entries, chart of accounts, periods, fixed assets, recurring, budgets, cost centers, approvals, books review, the transaction list |
| Payroll | employees, pay runs, payroll taxes, compliance, check stubs |
| Inventory | items, item receipts, purchase and sales orders, shipping labels |
| Reports | every report, custom reports, exports |
| AI & documents | AI inbox, coding rules, Suspense, email and invoice imports, the AI chat |
| Company & activity | company settings, tax codes, activity log, QuickBooks import |
| Messages | the thread with the client |

The map is one list, in `packages/shared/src/permissions.ts`, used by the API to
enforce and by the web app to build the menu. A test fails if any business route has
no area, so a new route has to be placed on purpose (as `roleMatrix.test.ts` already
makes it be guarded on purpose).

**Shared lookups.** Forms in one area need lists from others: an invoice needs items
and accounts. So the list reads (not the detail pages) of the company, accounts,
customers, vendors, items, tax codes, cost centers, bank accounts and periods are open
to any login with access to the company. Attachments (`/files`, `/receipts`) go with
the role's highest level anywhere, so whoever can enter a bill can attach its PDF.

**Reading across areas.** The AI chat reads sales, purchases, banking and the ledger,
so it needs at least View in each of those besides AI & documents. Search leaves out
what the role cannot see (invoices and estimates without Sales; bills, checks and
expenses without Expenses & bills; customers and vendors are lookups).

## What stays firm admin only

The firm's users, roles, sign-in security, adding a client, the firm overview, the
firm's Gmail and the firm-wide activity log. A login with a custom role is never a firm
admin: it is stored with the built-in role `staff`, which outside a company is the same
as accountant or view only (a database check keeps the two together). That way every
firm-level guard, the access token and the list of companies work unchanged.

## Where a role applies

- **Firm-wide**: the login's own role, built-in or custom.
- **For one company**: Setup → Users → Grant access, with a role, built-in or custom.
  It wins over the firm-wide one there, as today.
- A custom-role login sees only the companies it has been granted, like staff.
- **The Payroll tick box** stays. Payroll opens only when the box is on *and* the role
  has Payroll above No access.
- **Approval**: an entry waits for approval when the level for its area is Enter in a
  company that asks for approval (the same rule as staff). Approving needs Post in
  Accounting (where approvals are) and Post in the entry's own area, so a login cannot
  approve what it could not have recorded itself.

## Changing roles

- A role's levels can be changed at any time. The API reads them on every request,
  so the change holds at once; open browsers renew their session and redraw the menu.
- A role in use cannot be deleted: the page says who has it, to be moved first.
- Names are unique in the firm, ignoring case, and cannot be a built-in role's name.
- Creating, changing and deleting a role are in the Activity Log (`role.create`,
  `role.update`, `role.delete`), with the levels before and after.
- Moving the last firm admin to a custom role is refused, as switching it off is.

## In the web app

- **Setup → Roles** (`/setup/roles`, firm admin only): the built-in roles, then the
  firm's own, each with its level per area. New role, Edit, Duplicate, Delete. The
  editor is a grid: one row per area, the five levels across, a line under each area
  saying what it covers, and a count of the logins and company grants that use it.
- **Setup → Users**: the role menus (the login's role, the role in Add user, the role
  in Grant access) list the built-in roles, then the firm's own. Each user's row links
  to the role it has, to change what it allows.
- **What a login sees follows its level on the page it is on.** `useEffectiveRole()`
  gives, for a custom role, the built-in role of the level for the area of the page
  that is open, so `useCan()`, `hideUnless()` and every page that hides a button keep
  working. The sidebar, + New and search ask `useCanOpen()`, which uses the level for
  the area of each page it is asked about.
- The company switcher and My account show the custom role's name.

## Not built

- Levels finer than the tiers (say, edit bills but not create them). Every route has
  one guard today; a finer cut would need a guard per action on 254 routes.
- A role per person without naming it. A role for one person is a role with that
  person's name.
- Client roles. A client login stays the built-in Client.
