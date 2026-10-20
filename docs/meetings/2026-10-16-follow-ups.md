# Meeting follow-ups — 2026-10-16

What was asked for in the meeting, taken from the recording transcript and checked
against the code on 2026-10-19. Item numbers carry on from
[`2026-10-12-faizan-video-1.md`](./2026-10-12-faizan-video-1.md) (which ended at
70); everything still open in
[`2026-10-10-follow-ups.md`](./2026-10-10-follow-ups.md) is carried into this
file and keeps its number. **(10-10)**, **(10-05)** and **(10-01)** mark which
meeting an item first came from.

- **November 1, 2026** — Faizan's team starts using the app for actual clients.
- **January 1, 2027** — planned launch to outside customers.
- **Meetings are now twice a week.** Next: Tuesday 10-20, 5 PM (Aheed's job may
  start the week after, so after 5 PM is the safe time).

Aheed's demo for this meeting is
[`../demos/2026-10-16-aheed.md`](../demos/2026-10-16-aheed.md). Most of it was
not shown: Aheed said the changes from Faizan's video were done and too many and
too small to walk through. Only the firm view and My Menu were shown.

## What changed in this meeting

- **Reconciliation should do the matching itself.** Riham showed the manual
  reconciliation. Ticking every line by hand was called a "dumb system": you
  cannot tell what to tick without checking each line against the statement.
  The app should take the bank statement (uploaded there, or the one already
  uploaded for data entry), compare it with the ledger, tick what matches and
  draft the reconciliation with the items that do not.
- **Completed reconciliations are kept as reports**, unchangeable, with a PDF,
  and listed under Reports → For my accountant, as QuickBooks does.
- **Client data must not be used as-is for building the app.** Faizan read that
  using clients' information to develop software is a legal problem, mainly
  because the statements go through AI. Account numbers on the test statements
  are to be masked, keeping the last four digits.
- **My Menu goes.** Bookmarks and + New already cover it.
- **Stripe sits in Pay Bills**, when it comes, and paying a bill from the app
  (as Bill.com does) is the useful part. Possibly phase two.

## To do before November 1

| # | What | Owner |
|---|---|---|
| 72 | Reconciliation: take the statement ending balance and ending date from a bank statement already uploaded (AI inbox), with typing them in still possible. Also offer to upload the statement right on the reconciliation page, and keep it attached to the reconciliation. Uploaded statements do not keep their balances today, so the extraction has to read them first | Riham, Aheed (extraction) |
| 74 | Reconciliation reports: every completed reconciliation kept as a report that cannot be changed, with a PDF copy, listed under Reports → For my accountant → Reconciliation reports. Banking → Reconcile history already lists completed ones and shows each one's lines; what is missing is the report itself, the PDF and the listing under Reports | Riham |
| 76 | Take My Menu out of the sidebar. Faizan: Bookmarks and + New do what it does. See the note on item 76 | Aheed |
| 77 | Firm view: add a column for the last month whose books were closed. Open periods and the last reconciliation stay; a reconciliation is not the same as closing the books | Aheed |
| 78 | Long account names in the Payment account box (Expense and the like) are cut off with "…" and there is no way to read them. Show the full name on hover | Aheed |
| 34 | Faizan's first video is written up ([`2026-10-12-faizan-video-1.md`](./2026-10-12-faizan-video-1.md), items 50 to 70, all done). His PDF and the check stubs from the Teams chat are still to go through. He is recording more points in a second video **(10-10)** | Aheed |
| 36 | Pay bills prints checks: built 10-13. Left: Faizan confirms the check stock the firm prints on, and a test print is lined up against it. Not asked in this meeting **(10-10)** | Aheed, Faizan |
| 37 | Year end: built 10-13. Left: ask Faizan whether he wants a posted closing entry as well. Not asked in this meeting **(10-10)** | Aheed, Faizan |
| 39 | Equipment in the bank picker: look at Banking in the company from the 10-10 demo **(10-10)** | Aheed |
| 43 | Backups: the tool is built. Left: run it against production once, and decide how often and where our own copy is kept **(10-10)** | Aheed, Riham |
| 44 | Card payment "waiting for the bank statement": test both orders **(10-10)** | Faizan |
| 17 | QA audit: Estimate, emailing an invoice (item 47) and two decisions for the firm **(10-01)** | Aheed, firm |
| 18 | Review the reports with the firm. Item 74 adds one **(10-05)** | Aheed, firm |
| 11 | Make recurring on a bank deposit: Faizan says what is expected, then test it **(10-05)** | Riham, Faizan |
| 14 | Test check stubs with a statement and stubs from the same client **(10-01)** | Aheed |
| 15 | Suspense: reclassify some real lines **(10-01)** | Faizan |
| 16 | Test a real credit card statement **(10-01)** | Faizan |

### Notes on the items

**Reconciliation (71 to 75).** Faizan's definition, for the record: you compare
your records with an outside record, mostly the bank or card statement; if the
balances match it is reconciled, and if not you find and explain why. What is
built (Riham, item 21) is the manual QuickBooks way: type the statement's ending
balance and date, then tick each line that cleared until the difference is zero.
Faizan agreed that is how QuickBooks does it but wants the app to be smarter
(71 and 72), with the manual way kept. In the demo the statement only had
March, May and June, so the difference never reached zero; that was the data,
not the worksheet. The "Summary" report and Reconcile history already exist
under Banking; item 74 is about a fixed report per reconciliation, like
QuickBooks' "Reconciliation reports" under Reports → For my accountant (Faizan
showed his two quarters there; each opens the balances and the transactions, and
cannot be changed). Where the statement upload belongs was settled as the
reconciliation page itself, as QuickBooks has an attach-statement option there.
Item 71 (the smarter matching) shipped 10-19, checked against TIME OUT's real
March statement and Cash in Bank account. What's left of this group: 72's
statement-upload/extraction half (Aheed) and the balance/date auto-fill once
that's ready, and 74's actual report + PDF + Reports listing.

**My Menu (76).** Asked whether it is a QuickBooks thing; nobody knew, and
Faizan said to take it off. He added that larger systems give each job its own
dashboard and menus (accounts payable clerk, controller, CEO). That is later;
see item 81.

**Firm view (77).** Shown in the meeting: the page with no client selected,
reached from the logo, and its "All clients" top bar. Faizan: the top bar is
fine as it is and does not need to open the list; clicking a client in the list
is the way in. What to add is when each client's books were last closed. The
app does close periods (Setup → Fiscal Periods), so the column is
the end of the latest closed period. Aheed mentioned QuickBooks Accountant's
other tabs (bookkeeping, workforce, multi-entity); not wanted for now.

## Needs something from the firm first

| # | What | Needed |
|---|---|---|
| 46 | Custom access, starting from one of the five roles **(10-10)** | A list of what a small business owner, their bookkeeper and their staff should each be able to do |
| 47 | Send email from the app through the user's own mailbox **(10-10)** | Google and Microsoft app registrations, which need the company name |

## Later (January or after)

| # | What |
|---|---|
| 79 | Stripe on invoices: a "Pay now" link on invoices sent to clients. Riham asked; Faizan said doable, maybe phase two |
| 80 | Pay bills from the app, as Bill.com does; Stripe would go in Accounts Payable → Pay Bills. Joins item 24 |
| 81 | A different dashboard and menus for each job (accounts payable person, controller, CEO). Faizan: phase two |
| 82 | More "it is working" signs while things load, like the loading dots Riham added. Faizan wants the app to look busy when it is busy |
| 20 | Bank account connection **(10-01)** |
| 21 | Reconciliation against a connected bank, after 20. The manual worksheet was shown in this meeting; items 71 to 75 come from it **(10-01)** |
| 23 | Upload a customer's purchase order and turn it into a sales invoice **(10-05)** |
| 24 | Stripe: clients pay their vendors from the app, and we get paid for the software. See 79 and 80 **(10-05)** |
| 25 | Modules per client, priced separately **(10-05)** |
| 26 | Sign in with Microsoft 365 or Google **(10-05)** |
| 27 | One login shared with the practice management software **(10-05)** |
| 28 | Security review and testing; a standby copy of the database; a written recovery plan. The Gmail hole is closed **(10-05)** |
| 29 | Mobile app, last **(10-05)** |
| 48 | An assistant in the corner of the app **(10-10)** |
| 49 | A payroll partner, if payroll is ever offered **(10-10)** |

## Not code

- **Mask account numbers on test statements** (from Faizan's legal point).
  Everyone testing with real client statements (Timeout and the rest) replaces
  the account number with its last four digits before uploading. Banking only
  keeps the last four of a bank account number, but an uploaded statement PDF is
  stored as it was sent, so masking has to happen before the upload.
- **Base44 move (item 30): done by Aheed.** The general ledger ("ledger flow")
  project now runs without Base44, with its own back end. Not pushed yet. Aheed
  pushes it to GitHub; then the others pull it and keep working on it from there.
- Faizan records his remaining points in another video **(10-10)**.
- Get the product / company name in writing **(10-05)**. Item 47 waits on it.
- Meetings twice a week; next Tuesday 10-20 at 5 PM.

## Done

Reported by Riham in this meeting:

| # | What | Who |
|---|---|---|
| 38 | Phone numbers formatted the same everywhere, and a company phone field | Riham **(10-10)** |
| 45 | A check's number in its page title | Riham **(10-10)** |
| — | Vendor pages made more like QuickBooks: merging contacts, notes | Riham |
| — | Changing a transaction's account on the vendor page now changes it in the books | Riham |
| — | A loading indicator while a page loads, like QuickBooks' green dots | Riham |
| 71 | Reconciliation ticks what matches automatically now. At Start, it compares the account's open items against an already-approved bank statement for that period and pre-checks the exact matches (amount + within 3 business days, description breaks a tie); genuine mismatches are left for the user. Tested against TIME OUT's real March statement — all 16 of 16 matched | Riham **(10-16)** |
| 73 | "Select all" added to the tick column's header, for whatever the date/type/search filters are currently showing | Riham **(10-16)** |
| 75 | Found the real cause of "stayed in progress for a long time": the worksheet was running one database query per row instead of one for all of them — fixed. The $17,000 difference itself wasn't a bug: a first-ever reconciliation on an account starts at a $0 beginning balance by design, so nothing ticked reads as the full statement amount until items are checked — which item 71 now does automatically | Riham **(10-16)** |

Done before the meeting and in the demo, not walked through: every item from
Faizan's first video (50 to 70), item 28's Gmail fix, and 35, 36, 37, 40, 41
and 42 from 10-10. See the demo.

## Decided — no work

- **Bills, Bill Payments and Pay Bills keep their names.** Asked whether
  accounts payable should say "invoices" (the accounting term) rather than
  "bills": no. Accounts receivable already has Invoices, and searching "bill"
  should find the payable side. Bills are what you record, Pay Bills is paying
  them, and Bill Payments is the list of payments made.
- **The firm view's "All clients" top bar** stays as it is; it does not need to
  be clickable.

## Still needs an answer

Not asked in this meeting:

- **From the 10-16 demo:** which site Faizan tests on (he reported 50, 51 and 52,
  already fixed); whether Depreciation under Other Expense on the P&L is right;
  whether accountants, not only firm admins, should see the firm view; accounts
  with no detail type, set by hand or by his team.
- **Check stock** (36) and **a posted closing entry** (37).
- **Card payments** when the bank statement never comes (44) **(10-05)**.
- **1099 and card payments**: left off the 1099; confirm **(10-05)**.
- **Staff entries**: approval step on for the firm's clients? Staff can add a
  customer but not edit one; an accountant cannot add a bank account or tax
  code **(10-05)**.
- **Inventory**: average cost, receiving through the bill, shrinkage to cost of
  goods sold **(10-05)**.
- **Correcting a posted invoice** gives it a new number (INV-1042-R1);
  QuickBooks keeps the number **(10-05)**.
- **Audit decisions**: merge Accounting → Rules with AI → Coding Rules? A better
  name for "Spreadsheet Sync" **(10-05)**.
- **Reports to add** (18) **(10-05)**.

## Unclear

- **Where in Pay Bills Stripe goes.** "Somewhere here" on the Pay Bills page;
  no detail. Item 80 is later anyway.
- **Whether the statement-upload part of item 72 is now or later.** Faizan said
  "both options should be there" and, a moment later, "we will add that feature
  later" about uploading. Read here as: pulling the balance from a statement
  already uploaded comes first, the upload on the page after.
- From 10-10, still open: the GitHub username to add, whose email the shared
  Claude login uses, whether a bank connection should bring statements too, and
  the product name.
