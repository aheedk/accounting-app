# Meeting follow-ups — 2026-10-10

What was asked for in the meeting, taken from the recording transcript and checked
against the code on 2026-10-11. Item numbers carry on from
[`2026-10-05-follow-ups.md`](./2026-10-05-follow-ups.md); everything still open
there is carried into this file and keeps its number. **(10-05)** and **(10-01)**
mark which meeting an item first came from.

- **November 1, 2026** — Faizan's team starts using the app for actual clients.
  Confirmed again in this meeting; Faizan expects the remaining fixes to take
  about ten days.
- **January 1, 2027** — planned launch to outside customers.

## What changed in this meeting

- **Payroll comes out.** The firm is not doing a payroll module. A payroll
  company may be partnered with later.
- **Roles need to be adjustable.** The app will be sold two ways: to accounting
  firms (for their clients) and straight to small businesses. The five fixed
  roles do not fit both, so access has to be customizable.
- **Paying bills should print checks.** Marking bills paid is not enough.
- **Email should go out through the user's own mailbox.** Opening the mail
  program is not enough.
- **We are responsible for the data.** Hosting, backups and a second copy were
  raised as ours to sort out, with no room for compromise on security.
- **Faizan has already sent his test findings** (a 19-minute video, a PDF and
  check stubs, in the Teams chat). Aheed had not seen them.

## To do before November 1

| # | What | Owner |
|---|---|---|
| 34 | Go through Faizan's 19-minute video and the files in the Teams chat, and turn each change into an item here. He is recording a second video. This is the largest unknown on the list | Aheed |
| 36 | Pay bills: after paying, offer to print the checks, in a check format that fits check stock. See "Pay bills and checks" below | Aheed, Faizan gives the format |
| 37 | Year end: net income into Retained Earnings. Faizan says it is not happening. See "Retained Earnings" below | Aheed, Faizan |
| 38 | Phone numbers: ten digits with the area code, shown the same way everywhere (vendors, customers, the company). The test vendors have seven digits; fix them too | Riham |
| 39 | Statement review: Equipment showed up in the bank account picker. Not reproduced; needs the company from the demo. See "Equipment in the bank picker" below | Aheed |
| 40 | "This year" should follow the client's fiscal year everywhere. Today only the General Ledger does. See "Fiscal year" below | Riham |
| 41 | Vendors list: the Open balance column is not right (Riham said so in the demo). See "Vendor balance" below | Riham |
| 43 | Backups before real client data arrives on November 1: confirm the database is backed up, how often, and that a restore works. See "Security and data" below | Aheed, Riham |
| 44 | Card payment "waiting for the bank statement": test both orders, bank statement uploaded before the card statement and after | Faizan |
| 45 | A check approved from the AI inbox should show its number at the top of the page. See "Check number" below | Riham |
| 17 | QA audit: done apart from emailing an invoice (now item 47), Estimate, and two decisions for the firm; see "Still needs an answer" **(10-01)** | Aheed, firm |
| 18 | Review the reports with the firm **(10-05)** | Aheed, firm |
| 11 | Make recurring on a bank deposit: Faizan says what is expected, then test it **(10-05)** | Riham, Faizan |
| 14 | Test check stubs with a statement and stubs from the same client. Faizan has sent the files, so this is no longer waiting on him **(10-01)** | Aheed |
| 15 | Suspense: reclassify some real lines **(10-01)** | Faizan |
| 16 | Test a real credit card statement **(10-01)** | Faizan |

### Notes on the items

**Payroll (35, done).** It is out of the menus; the code and the tables are
left alone until a payroll partner is chosen, so nothing has to be rebuilt or
migrated.
Contractors and the 1099 report are not payroll and stay under Accounts Payable.
That also settles the audit question of which of the two Contractors pages to
keep: the Accounts Payable one. Pay stubs (item 22) are dropped with it.

**Pay bills and checks (36).** In the demo, paying two bills only marked them
paid. What was asked for: paying bills by check brings up the checks to print on
check stock, as QuickBooks does. The app can already print one check from Write
Check (`previewCheck` in `apps/web/src/lib/download.ts`), but it is a plain
single-check page, not a layout made for pre-printed stock. Two things are
needed from Faizan: what QuickBooks does after Pay bills, and which check stock
the firm prints on (voucher, three to a page). Paying online from the app is
item 24 and stays later.

**Retained Earnings (37).** What the code does today: the Balance Sheet shows
this year's profit as a Net Income line, and adds the profit of earlier years
into the Retained Earnings line itself. Nothing is posted to the ledger at year
end, so the Retained Earnings account in the General Ledger and Trial Balance
does not change. The test companies only have 2026 activity, so no year has
rolled over yet and there is nothing on screen to show it working. To do: put
prior-year activity into a test company and show Faizan the Balance Sheet on
January 1. Then decide whether closing a year should post a real closing entry
(net income to Retained Earnings), which is what he described and what an
accountant will look for in the ledger.

**Equipment in the bank picker (39).** The picker lists accounts whose detail
type is a bank type, any account set up under Banking, and the account already
chosen on that statement (`apps/web/src/lib/bankAccountOptions.ts`). So
Equipment is there for one of two reasons: it was added as a bank account under
Banking in that company, or it was the account preselected on that statement.
Checked on 10-12 against the local test companies: Equipment is not set up
under Banking in either, a bank statement opens with no account preselected,
and the picker does not list it. So the rule holds and the cause is in the data
of the company used in the demo. Open Banking in that company and see whether
Equipment is listed as a bank account; if it is, remove it there.

**Fiscal year (40).** Faizan explained it in the meeting: for a company whose
year runs July to June, "This year" must give July 1 to June 30. The General
Ledger presets do this. These lists still use the calendar year: Transactions,
the bank transactions inbox, Bills, Bill Payments, Payments, Credit Memos and
Vendor Credits. Check the other reports as well.

**Vendor balance (41).** The Vendors list works the open balance out in the
browser. Not checked yet, but the likely cause is that it counts open bills and
leaves out vendor credits and payments not yet applied, which is what the
Accounts Payable overview had wrong before 10-08.

**Check number (45).** In the demo a check approved from the AI inbox opened
without "5519" at the top. The Write Check page does title itself "Check #5519",
so the record shown was probably one of the older ones saved as an expense.
Riham's later commits (`2dd9ce5`, `aafc9fb`) label an edited check as a check.
Open one approved after those and confirm.

**Security and data (43).** Said in the meeting: once small businesses use the
app we are responsible for their data and its backup; a second environment that
is copied to continuously was suggested. For November 1 the minimum is knowing
that the production database is backed up and that a restore has been tried
once. The rest (a standby copy, a written recovery plan, a full security review)
is item 28.

## Needs something from the firm first

| # | What | Needed |
|---|---|---|
| 46 | Custom access. Start from one of the five roles, tick what it can open and change, and save it under a name. Ready-made suggestions to start from. No brand-new roles from scratch | A list of what a small business owner, their bookkeeper and their staff should each be able to do. Large; a spec comes first |
| 47 | Send email from the app through the user's own mailbox, Gmail or Outlook, whichever they use. Covers emailing vendors, and emailing an invoice from the audit | A Google and a Microsoft app registration for the product, which needs the company name settled |

## Later (January or after)

| # | What |
|---|---|
| 20 | Bank account connection, so transactions arrive on their own. Brought up again at the start of this meeting. Whether statements should arrive too was left unsure; transactions are the point. Needs an outside service **(10-01)** |
| 21 | Reconciliation against a connected bank, after 20. A manual reconciliation worksheet is built (see Done) **(10-01)** |
| 23 | Upload a customer's purchase order and turn it into a sales invoice **(10-05)** |
| 24 | Stripe: (a) clients pay their vendors from the app, (b) we get paid for the software **(10-05)** |
| 25 | Modules per client, priced separately. Now tied to the two ways of selling (firms and small businesses) and to item 46 **(10-05)** |
| 26 | Sign in with Microsoft 365 or Google **(10-05)** |
| 27 | One login shared with the practice management software **(10-05)** |
| 28 | Security review and testing; a standby copy of the database; a written recovery plan. One known hole: connecting the firm's Gmail needs no sign-in **(10-05)** |
| 29 | Mobile app, last **(10-05)** |
| 48 | An assistant in the corner of the app that can answer questions and do things in it. Aheed's idea; agreed as a later thing |
| 49 | A payroll partner, if payroll is ever offered |

## Not code

- **Base44 move (item 30).** Aheed moves the other project (heard as "ledger
  flow", the practice management software) off Base44, before the next meeting.
  The firm is still making changes there and does not want it to go deeper into
  Base44. This answers the open question of who is doing it.
- **Claude plan.** Aheed and Riham are both hitting their limits (Riham lost
  Wednesday to it). A spare login on the firm's team account will be added for
  them to share.
- **GitHub access.** Someone was to be added as a collaborator during the
  meeting; see "Unclear".
- **Marketing.** Start thinking about how the product will be sold; an AI agent
  for it was mentioned.
- Faizan: keep testing and send findings by video. A second video is coming.
- Sample checks for the "Timeout" client **(10-01)**.
- Get the product / company name in writing and check it is available
  **(10-05)**. Item 47 waits on it.
- Next meeting: probably Tuesday. Aheed's start date at his job is not set and
  may change his hours.

## Done

| # | What | Who |
|---|---|---|
| 35 | Payroll is out of the sidebar, + New and search. Its pages still open by address. "Add contractor" moved under Vendors in + New. The Payroll tick box on Setup → Users is still there | Aheed, 10-12 |
| 42 | Audit history: it did nothing on a record not saved yet, which is what happened in the demo. On Journal Entry, Bank Deposit, Expense and Check it is now grayed out until the record is saved, and says why | Aheed, 10-12 |
| 21 | Manual bank reconciliation: a worksheet and a history page under Banking. Not reviewed or tested by Aheed yet | Riham, `569350c` |

After pulling, run `npm run db:migrate` (migration `0097`, from Riham's
reconciliation work).

## Already done — say so next time

Raised in the meeting as missing or unsure, but in the code:

- **Deleting a vendor or customer with no transactions.** Riham said she had not
  added it. It works for both: Delete is offered when there are no transactions
  and refused otherwise, with Make inactive instead. Vendors since migration
  `0084`, customers since 10-08. A zero balance is not the same as zero
  transactions, as was said in the meeting, and the rule uses transactions.
- **Invoices on the Transactions page.** Riham said she still had to add them.
  Invoices, bill payments and vendor credits were added on 10-08.
- **Changing the vendor on a posted entry** no longer voids it and makes a new
  one; the entry is changed in place (`8ba8a9a`).

## Decided — no work

- The Checks page stays under Accounts Payable. QuickBooks has no checks page
  of its own, and that is fine.
- The Type filter on the Transactions page keeps every option it has, including
  types the app does not create yet.
- Transfer stays. So do Pay bills, editing in the four new places, and messages.
- One cost center (class) per journal line is right.
- A firm admin cannot invent a new role; access is customized from the existing
  ones (item 46).
- Check lines in the AI inbox have no vendor until the stubs are read; that is
  expected. It is tested under item 14.

## Still needs an answer

Asked on 10-05 and not answered in this meeting:

- **Card payments.** If the bank statement is never uploaded, the card balance
  stays too high by the payment. Acceptable, or should it be postable from the
  card statement? Item 44 is the test that should settle it.
- **1099 and card payments.** Card payments to a contractor are left off the
  1099. Confirm that is how the firm files.
- **Staff entries.** Should the approval step (staff entries wait for an
  accountant) be on for the firm's clients? Also: staff can add a customer but
  not edit one, and an accountant cannot add a bank account or a tax code.
- **Who may connect the firm's Gmail.** Today anyone who can reach the API can.
- **Inventory.** Average cost, receiving through the bill, and shrinkage to cost
  of goods sold were chosen without the firm.
- **Correcting a posted invoice** gives it a new number (INV-1042-R1).
  QuickBooks keeps the number.
- **Audit decisions:** whether to merge the two rule systems (Accounting → Rules
  and AI → Coding Rules), and a better name for "Spreadsheet Sync".
- **Reports to add** (item 18): comparative columns, P&L by month, aging detail,
  balance summaries, sales by customer, expenses by vendor.

Answered in this meeting, and now items above: payroll and pay stubs (35),
email from the app (47), what each role may do (46, in part).

## Unclear

- **The GitHub username** to add. Heard as "Ramken12" and "Raman 12", and who it
  belongs to could not be made out.
- **Whose email** the shared Claude login will use. Left as "we'll figure it
  out".
- **Whether a bank connection should bring in statements** as well as
  transactions. Faizan was asked what QuickBooks does; the answer is not in the
  recording.
- **Which page** the audit history failed to open on (item 42).
- **The check format** (item 36). "We need to figure out check format" was said
  and left there.
- **The product name** is still not settled **(10-05)**.
