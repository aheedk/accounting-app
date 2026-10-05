# Meeting follow-ups — 2026-10-01

Requests taken from the meeting recording transcript, checked against the code.
Parts of the recording were unclear or not in English, so the last section lists
what could not be made out. Status as of 2026-10-04.

## Done

| # | Request | Where |
|---|---|---|
| 1 | Clicking a Check, Deposit, Expense or Journal Entry in the General Ledger opens that entry's own form | `0106db9`, `e92959e` |
| 2 | Entries "created by a source transaction" go straight to the source instead of a greyed-out page | `e92959e` |
| 3 | Delete a journal entry (QuickBooks "More > Delete") | `1f1382c` |
| 4 | Attachments on entries | `9dd25e2` |
| 5 | Save and post in one step | `f5b200b` |
| 6 | Save / Save and new / Save and close, like QuickBooks | `0b4947d` |
| 7 | Next journal line copies the description above and fills the balancing amount | `4380b5c` |
| 8 | Typing 26 for the year becomes 2026; ledger dates editable on any preset | `0c6a779`, `96b5a86` |
| 9 | Ledger keeps its date range when you go Back from a transaction | `9c3a8bc` |
| 10 | Debit and Credit columns available in the ledger (plus Class, Create Date, Created By, Last Modified) under Customize | `9c3a8bc` |
| 11 | Check number field | `eaed249` |
| 12 | ADJ column can be hidden or filtered | already in place |
| 13 | Name / Memo / Split columns, single signed Amount column | `e92959e` |
| 14 | Dropdowns no longer use the browser's own look | Riham's AppSelect work, `864592f` |
| 15 | Bank Deposit form ("+ New > Bank deposit"), with GL drill-through | Riham, `428fb69`, `6f2ecf1` |
| 16 | Credit card statement upload: charges post as credit card expenses, payments and refunds reduce the card, a payment already on the bank statement is spotted and left out | `b624b71`, `dc258f3` |
| 17 | Bank statements recognise credit card payments and pick the right card by issuer name | `b624b71` |
| 18 | Check stubs: upload stubs or photos; checks on a bank statement take their payee and category from the stub, and checks already posted can be filled in from the Check stubs tab | `b624b71`, `dc258f3` |

### Also completed (not raised in the meeting)

| # | Change | Where |
|---|---|---|
| 19 | General Ledger matched to QuickBooks: steady running balance, real transaction types (Expense, Check, Payroll...), numbers and names filled in, correct ADJ column, amounts in the account's natural sign | `e92959e` |
| 20 | General Ledger follow-ups: credit memo and vendor credit numbers (CM-/VC-), clearer memos, names on payroll rows | `e92959e` |
| 21 | General Ledger date, name and description are clickable and open the transaction | `5c94d52` |
| 22 | Expense category can be any account in the chart, not just expense accounts | `864592f` |
| 23 | "Add new" on account, vendor and customer dropdowns across the app | `864592f` |
| 24 | Arrow keys work in every dropdown and popup menu | `1b6c136` |
| 25 | Switching company opens that company's dashboard | `a33d169` |
| 26 | Other tabs left on the old company show a "What happened to this page?" screen | `96ecc52` |
| 27 | Chart of Accounts page controls at the bottom as well as the top | `f9ccd6f` |
| 28 | Excel, PDF and print exports with a header (company, report, period), footer, page numbers and proper number formatting | `86ed7a6`, `fe79368` |
| 29 | Clear message in the AI inbox when the Anthropic API key is rejected, instead of "Internal server error"; production now uses a service account key that does not expire | `2f8c736` |
| 30 | AI inbox upload takes photos (PNG, JPEG, WebP) as well as PDFs, and says what it read | `dc258f3` |
| 31 | Long scanned bank statements (20 pages, ~160 lines) are read in full, and a PDF with several accounts (checking and savings) becomes one statement per account | `b862b50` |
| 32 | Handwritten check stubs with no year ("7/1") get the right year instead of one the AI guessed | `d3030e2` |
| 33 | Suspense (asked for by the firm after the meeting): what the AI cannot categorize goes to a Suspense account instead of being left blank or guessed; AI → Suspense lists it and reclassifies it, optionally teaching the AI; a period cannot close while Suspense has a balance | `456aa80` |

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
2. **Vendor dropdown in the AI inbox.** The Name column is free text. It should
   be a dropdown of the client's vendors, with the AI matching the extracted
   name ("Duke Power" to "Duke Energy") and the user able to correct it. Riham
   said "I'll fix that" in the meeting — confirm who owns it.
3. **Chart of Accounts: everything editable.** The edit-account screen should
   allow changing every field, including the account number.

## Bigger items, for later

- **Linking bank and credit card accounts** for daily transaction feeds. Needs
  an outside service (the kind Plaid provides), so an account and credentials
  come before any code.
- **Pay stubs.** Promised for the next meeting. Nothing in the code yet.
- **Reconciliation.** Mentioned in passing; left as something that will follow
  once bank linking exists.
- **Report period presets.** Riham noted the presets were not tested and their
  definitions still need filling in.

## Not code

- **QA audit report in plain English.** Asked for in readable form rather than
  the markdown file, and to walk through it together before fixing anything.
  The report is `docs/qa/2026-09-28-app-audit.md`; its fixes are still deferred.
- **Sample checks for the "Timeout" client**, from the months that already have
  bank statements, for testing.
- **Clean up test entries** added to a real company by mistake. The journal
  entry Delete button makes this possible.
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
