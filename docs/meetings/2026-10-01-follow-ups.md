# Meeting follow-ups — 2026-10-01

Requests taken from the meeting recording transcript, checked against the code.
Parts of the recording were unclear or not in English, so the last section lists
what could not be made out. Status as of 2026-10-06. Anything still open here is
carried into the to-do list in [`2026-10-05-follow-ups.md`](./2026-10-05-follow-ups.md),
marked **10-01**. What was shown at the next meeting is in
[`../demos/2026-10-05-aheed.md`](../demos/2026-10-05-aheed.md).

## Done

| # | Request | Where |
|---|---|---|
| 1 | Clicking a Check, Deposit, Expense or Journal Entry in the General Ledger opens that entry's own form | `0106db9`, `e92959e` |
| 2 | Entries "created by a source transaction" go straight to the source instead of a greyed-out page | `e92959e` |
| 3 | Delete a journal entry (QuickBooks "More > Delete") | `1f1382c` |
| 4 | Attachments on entries | `9dd25e2` |
| 5 | Save and post in one step | `f5b200b` |
| 6 | Save and close / Save and new, like QuickBooks (the extra Save and Save draft buttons were later dropped as repetitive) | `0b4947d`, `4bd6a99` |
| 7 | Next journal line copies the description above and fills the balancing amount | `4380b5c` |
| 8 | Typing 26 for the year becomes 2026; ledger dates editable on any preset | `0c6a779`, `96b5a86` |
| 9 | Ledger keeps its date range when you go Back from a transaction | `9c3a8bc` |
| 10 | Debit and Credit columns available in the ledger (plus Class, Create Date, Created By, Last Modified) under Customize | `9c3a8bc` |
| 11 | Check number field | `eaed249` |
| 12 | ADJ column can be hidden or filtered | Riham, `e335777` |
| 13 | Name / Memo / Split columns, single signed Amount column | Riham `8a3d269` (Name/Split), `e92959e` |
| 14 | Dropdowns no longer use the browser's own look | Riham `09685fa` (dropdowns), `864592f` (payee box) |
| 15 | Bank Deposit form ("+ New > Bank deposit"), with GL drill-through | Riham, `428fb69`, `6f2ecf1` |
| 16 | Credit card statement upload: charges post as credit card expenses, payments and refunds reduce the card, a payment already on the bank statement is spotted and left out | `b624b71`, `dc258f3` |
| 17 | Bank statements recognise credit card payments and pick the right card by issuer name | `b624b71` |
| 18 | Check stubs: upload stubs or photos; checks on a bank statement take their payee and category from the stub, and checks already posted can be filled in from the Check stubs tab | `b624b71`, `dc258f3` |
| 19 | Chart of Accounts: every field on the edit-account screen is editable, including the account number and account type; system accounts (AR, AP, Suspense...) can be renumbered and renamed too | `12235b3` |

### Also completed (not raised in the meeting)

| # | Change | Where |
|---|---|---|
| 20 | General Ledger matched to QuickBooks: steady running balance, real transaction types (Expense, Check, Payroll...), numbers and names filled in, correct ADJ column, amounts in the account's natural sign | `e92959e` |
| 21 | General Ledger follow-ups: credit memo and vendor credit numbers (CM-/VC-), clearer memos, names on payroll rows | `e92959e` |
| 22 | General Ledger date, name and description are clickable and open the transaction | `5c94d52` |
| 23 | Expense category can be any account in the chart, not just expense accounts; expense accounts listed first, with Add new account | `864592f`, `623091e` |
| 24 | "Add new" on account, vendor and customer dropdowns across the app | `864592f` |
| 25 | Arrow keys work in every dropdown and popup menu | `1b6c136` |
| 26 | Switching company opens that company's dashboard | `a33d169` |
| 27 | Other tabs left on the old company show a "What happened to this page?" screen | `96ecc52` |
| 28 | Chart of Accounts page controls at the bottom as well as the top | `f9ccd6f` |
| 29 | Excel, PDF and print exports with a header (company, report, period), footer, page numbers and proper number formatting | `86ed7a6`, `fe79368` |
| 30 | Clear message in the AI inbox when the Anthropic API key is rejected, instead of "Internal server error"; production now uses a service account key that does not expire | `2f8c736` |
| 31 | AI inbox upload takes photos (PNG, JPEG, WebP) as well as PDFs, and says what it read | `dc258f3` |
| 32 | Long scanned bank statements (20 pages, ~160 lines) are read in full, and a PDF with several accounts (checking and savings) becomes one statement per account | `b862b50` |
| 33 | Handwritten check stubs with no year ("7/1") get the right year instead of one the AI guessed | `d3030e2` |
| 34 | Suspense (asked for by the firm after the meeting): what the AI cannot categorize goes to a Suspense account instead of being left blank or guessed; AI → Suspense lists it and reclassifies it, optionally teaching the AI; a period cannot close while Suspense has a balance | `456aa80` |
| 35 | Bottom action bar (Save, Delete, Void...) sits flush at the bottom of the window on every form; content no longer shows underneath it or gets cut off above it | `556f53b` |
| 36 | Check no. box: on payments and bill payments it no longer turns into "Ref no." after picking a payment method (the dropdown was losing the choice); the Expense form now says "Check no." when paying by check too | `83ef128` |
| 37 | Vendor dropdown in the AI inbox: the Name column on a bank statement review suggests the client's vendors and matches a renamed payee ("Duke Power" to "Duke Energy") by shared words, while staying free text for an unlisted or corrected payee | `40d1214` |
| 38 | Report period presets: This/Last Fiscal Year (and their to-date variants) now use the business's own fiscal year start month instead of duplicating the calendar-year presets | `e9acc5a` |

## Open

1. **Finish testing with real documents** (spec:
   `docs/specs/2026-10-04-card-statements-and-check-stubs-design.md`).
   - Bank statement upload: tested with the July statement (checking and savings), works.
   - Check stubs: upload works. The July stubs (#5359–5398, payroll) are drawn on an
     account whose statement has not been uploaded yet (likely CHK 5180), so matching
     still needs that statement.
   - Credit card statement: test with the sample Amex statement, or a real one,
     after adding a Credit Card account to the client.
   - Suspense: try reclassifying a few lines from AI → Suspense.
2. ~~**Vendor dropdown in the AI inbox.**~~ Done, see `40d1214` in the table above.

## Bigger items, for later

- **Linking bank and credit card accounts** for daily transaction feeds. Needs
  an outside service (the kind Plaid provides), so an account and credentials
  come before any code.
- **Pay stubs.** Promised for the next meeting. Nothing in the code yet.
- **Reconciliation.** Mentioned in passing; left as something that will follow
  once bank linking exists.
- ~~**Report period presets.**~~ Done, see `e9acc5a` in the table above.

## Not code

- **QA audit report in plain English.** Asked for in readable form rather than
  the markdown file, and to walk through it together before fixing anything.
  The report is `docs/qa/2026-09-28-app-audit.md`; its fixes are still deferred.
- **Sample checks for the "Timeout" client**, from the months that already have
  bank statements, for testing.
- ~~**Clean up test entries** added to a real company by mistake. The journal
  entry Delete button makes this possible.~~ Done, 2026-10-08: all August 2026
  seed/test activity for TIME OUT removed (3 bank deposits, 7 expenses, and
  the journal entries they'd posted).
- **Faizan will record a video** of further changes and send it.
- **Match the "+ New" menu to QuickBooks.** Mostly done in Riham's `d418377`.

## Could not make out

- **"Check… payment… payment account"** during the Chart of Accounts part:
  something about the payment account on a check; the request itself is lost.
- **"You don't need like 100 chart of accounts"**: possibly page size, possibly
  the default list of accounts.
- **"Import… first numbers… due to/from"**: something about importing a chart of
  accounts and its account numbers.
- **Acumatica ERP** was named, most likely as a product to look at for reference.
