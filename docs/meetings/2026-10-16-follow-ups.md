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
[`../demos/2026-10-16-aheed.md`](../demos/2026-10-16-aheed.md). What was built
after it, for the 10-20 meeting, is in
[`../demos/2026-10-20-aheed.md`](../demos/2026-10-20-aheed.md) and under
"Done since the meeting" below. Most of it was
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
| 72 | Reconciliation: take the statement ending balance and ending date from a bank statement already uploaded (AI inbox), with typing them in still possible. Also offer to upload the statement right on the reconciliation page, and keep it attached to the reconciliation. Uploaded statements did not keep their balances, so the extraction had to read them first. **Reading done 10-20 (Aheed):** the AI reads each statement's period and beginning and ending balance, the review page shows them (editable) and checks the lines add up to them, and approving keeps them with the account the statement was approved against; `GET /businesses/:id/email-imports/statement-balances?account_id=` lists them per account. **Left (Riham):** fill the reconciliation's ending balance and date from that, and the upload on the reconciliation page | Riham, Aheed (extraction) |
| 34 | Faizan's first video is written up ([`2026-10-12-faizan-video-1.md`](./2026-10-12-faizan-video-1.md), items 50 to 70, all done). His PDF and the check stubs from the Teams chat are still to go through. He is recording more points in a second video **(10-10)** | Aheed |
| 36 | Pay bills prints checks: built 10-13. Left: Faizan confirms the check stock the firm prints on, and a test print is lined up against it. Not asked in this meeting **(10-10)** | Aheed, Faizan |
| 37 | Year end: built 10-13. Left: ask Faizan whether he wants a posted closing entry as well. Not asked in this meeting **(10-10)** | Aheed, Faizan |
| 43 | Backups: the tool is built. Left: run it against production once (needs the connection string from Railway), and decide how often and where our own copy is kept. Uploaded files are in no backup yet; see the recovery plan. 10-20: [`../guides/recovery-plan.md`](../guides/recovery-plan.md) written **(10-10)** | Aheed, Riham |
| 44 | Card payment "waiting for the bank statement": test both orders **(10-10)** | Faizan |
| 17 | QA audit: emailing an invoice (item 47) and two decisions for the firm. Estimate built 10-20 **(10-01)** | Aheed, firm |
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
March statement and Cash in Bank account; item 74 (the fixed report + PDF +
Reports listing) shipped 10-19 as well. 72's reading half (Aheed) is done
10-20: statements keep their period and balances and the account they were
approved against. What's left of this group: the balance/date auto-fill on
the reconciliation page (Riham), and uploading the statement there.

**Item 71 — matching rules, for the firm to review.** None of this was asked
for at this level of detail in the meeting; these are the specific calls made
to build it. Worth confirming with Faizan before relying on it for real
clients:

- A statement line and a book transaction only match on the **exact same
  amount**. No rounding, no "close enough."
- They also have to be dated within **3 business days** of each other (banks
  often post a transaction a day or two after it happened). This window is a
  judgment call — open to being tightened or loosened.
- A deposit can only ever match a line that puts money in, and a
  check/payment only a line that takes money out — never crossed, even if the
  dollar amount happens to line up.
- If more than one transaction fits the same amount and date window, the one
  whose payee or memo shares a word with the statement line's description
  wins (e.g. "REGIONS" appearing on both sides).
- If it's still tied after that, whichever date is closest wins.
- If it's still tied even then, **nothing is ticked** — both are left for the
  user to check by hand rather than risk matching the wrong one.
- Each book transaction and each statement line can only be used in one
  match — never double-counted.
- Only an uploaded statement that has already been **reviewed and approved**
  (not one still sitting unreviewed) is used to auto-tick anything.
- A statement counts as "for this reconciliation" when its own latest line is
  within **10 days** of the statement ending date being reconciled, and — if
  more than one approved statement could apply — only if the account name on
  the upload clearly points to one of them. If it's unclear which statement
  or which account, nothing is auto-ticked and the worksheet opens fully
  manual, the same as it does today with no statement at all.
- Related, from item 75: a reconciliation on an account for the first time
  ever still starts from a $0 beginning balance (unchanged, existing
  behavior) — so even with everything auto-matched, the difference won't
  reach zero until every earlier period on that account has also been
  reconciled. That's expected, not a bug in the matching.

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
| 24 | Stripe: clients pay their vendors from the app, and we get paid for the software. See 79 and 80 **(10-05)** |
| 25 | Modules per client, priced separately **(10-05)** |
| 26 | Sign in with Microsoft 365 or Google **(10-05)** |
| 27 | One login shared with the practice management software **(10-05)** |
| 28 | Security review and testing; a standby copy of the database; a written recovery plan. The Gmail hole is closed. **10-20:** the review is done and its fixes are in ([`../qa/2026-10-20-security-review.md`](../qa/2026-10-20-security-review.md)), and the recovery plan is written ([`../guides/recovery-plan.md`](../guides/recovery-plan.md)). Left: a standby copy, and enforcing the web app's Content-Security-Policy **(10-05)** |
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
| 74 | Reconciliation reports: every completed reconciliation is now a fixed, PDF-able report under Reports → For my accountant → Reconciliation Reports, same as QuickBooks keeps. Also linked from Banking → Reconcile History, which already listed completed ones but had nowhere to send "the report" to | Riham **(10-19)** |

Done before the meeting and in the demo, not walked through: every item from
Faizan's first video (50 to 70), item 28's Gmail fix, and 35, 36, 37, 40, 41
and 42 from 10-10. See the demo.

### Done since the meeting (Aheed, for 10-20)

What to click is in [`../demos/2026-10-20-aheed.md`](../demos/2026-10-20-aheed.md).

| # | What |
|---|---|
| 76 | My Menu taken out of the sidebar |
| 77 | Firm view: a "Books Closed Through" column, the end of each client's latest closed period, also in the Excel download |
| 78 | A cut-off account name shows in full on hover, in the box and its list, in every account picker and drop-down; the account list also opens wider than a narrow box |
| 39 | Equipment (and receivables, long-term assets, inventory) can no longer be set up under Banking, and never shows in a bank picker |
| 23 | A customer's purchase order, uploaded or emailed, waits in the AI inbox as a PO; approving it posts the sales invoice with the next invoice number, the PO number in the memo, the customer's terms, and the order's quantities and prices. Spec: the AI auto-coding spec, "A customer's purchase order" |
| — | Setup → Company Settings: invoice number prefix and start number, default invoice and bill terms, default sales tax, default expense payment method. All invoices now follow one numbering rule (recurring ones and sales orders came out as INV-0001 beside the form's 1001). Spec: [`../specs/2026-10-20-company-settings-design.md`](../specs/2026-10-20-company-settings-design.md) |
| 28 | Security review ([`../qa/2026-10-20-security-review.md`](../qa/2026-10-20-security-review.md)): a record's id can no longer reach another client's record (60 lookups and the AI inbox); payees on checks and expenses must be the client's own; uploaded files of types that can run code are only downloaded; sign-in limited per address; a wrong email answers as slowly as a wrong password; security headers on the web app (the script policy reports only, for now) |
| 72 (reading) | Statements keep what they say about the account: the period and the beginning and ending balance, read by the AI, shown and editable on review with a check that the lines add up to them (a missed line shows before posting), and kept with the account the statement was approved against, for Reconcile. Spec: [`../specs/2026-10-04-card-statements-and-check-stubs-design.md`](../specs/2026-10-04-card-statements-and-check-stubs-design.md), section 4 |
| 28, 43 | Recovery plan ([`../guides/recovery-plan.md`](../guides/recovery-plan.md)): what to do for each kind of failure, and which secrets to keep outside Railway |
| 17 (Estimate) | Estimates, the QA audit's last missing transaction type: Accounts Receivable → Estimates and + New → Estimate. Pending, accepted (with who and when), rejected, shown as expired past their date; Create invoice makes a draft invoice with the next invoice number, the customer's terms and the estimate's lines, and closes the estimate. Save as PDF; search; the customer's page lists them. Spec: [`../specs/2026-10-20-estimates-design.md`](../specs/2026-10-20-estimates-design.md) |

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
