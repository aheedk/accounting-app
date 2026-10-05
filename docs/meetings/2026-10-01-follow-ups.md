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
| 23 | Expense category can be any account in the chart, not just expense accounts | `864592f` |
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

## Demo for the next meeting

Everything above, in the same order and numbering, with where it lives in the
app and what to click to show it. Before the meeting: open a client with some
posted activity, and have a bank statement PDF, a check stub PDF or photo, and
the sample Amex statement (`SAMPLE Amex statement Jul 2026.pdf`) ready to drop
in. The client needs a Credit Card account for item 16.

Items marked **(Riham, pulled)** are Riham's work that came in with a pull;
**(Riham + you)** means she built part of it and you finished it. Everything
unmarked is yours.

### Asked for in the meeting

1. **General Ledger opens each entry's own form.** Reports → General Ledger.
   Click a Check, a Deposit, an Expense and a Journal Entry row in turn; each
   opens its own form, not a generic journal page.
2. **Source transactions open the source.** In the General Ledger, click an
   invoice, bill or payment line. It goes straight to that invoice, bill or
   payment instead of a greyed-out journal entry.
3. **Delete a journal entry.** Open any journal entry → More → Delete. Show it
   is gone from the General Ledger.
4. **Attachments.** On a journal entry or an expense, add a file in the
   Attachments area, then open it again from the same place.
5. **Save and post.** Create a new bill or invoice and click Save and close:
   it is saved and posted in one click, no separate Post step.
6. **Save and close / Save and new.** On the same form there is one button:
   Save and close, with Save and new under the arrow (it remembers the last
   one used). As in QuickBooks there is no separate Post button; saving posts.
   Hover the button to see what it does. Same on journal entries.
7. **Journal line autofill.** + New → Journal entry. Type a description and a
   debit on line 1, then move to line 2: the description is copied and the
   balancing credit is filled in.
8. **Two-digit year.** In any date box type `3/15/26` → it becomes 3/15/2026.
   In the General Ledger, pick a preset (This Month) and show the dates are
   still editable.
9. **Ledger keeps its period.** General Ledger → set a custom date range →
   click a transaction → Back. The same range is still there.
10. **Debit / Credit columns.** General Ledger → Customize → turn on Debit and
    Credit (also Class, Create Date, Created By, Last Modified).
11. **Check number.** New expense (Accounts Payable → Expense Transactions →
    New) with payment method Check: the Check no. field appears. Same on a
    bill payment by check.
12. **(Riham, pulled)** **ADJ column.** General Ledger → Customize: hide or show ADJ, and filter on
    it.
13. **(Riham + you)** **Name / Memo / Split, single Amount.** General Ledger: point out the Name,
    Memo and Split columns and the one signed Amount column.
14. **(Riham + you)** **Dropdowns.** Open any dropdown (account, vendor): it is the app's own
    styled list, not the browser's.
15. **(Riham, pulled)** **Bank deposit.** + New → Bank deposit, save one, then find it in the
    General Ledger and click it to open the deposit.
16. **Credit card statement upload.** AI → Document Inbox → drop the Amex
    statement. It appears under Statements with a card icon and the card name.
    Open it: the card account is preselected, each line is marked Charge,
    Payment or Refund. Pick categories and approve. In the General Ledger the
    lines read Credit Card Expense / Credit Card Credit / Credit Card Payment.
17. **Card payments on bank statements.** Open the July checking statement in
    the inbox: the 7/17 American Express payment ($9,443.41) is coded to the
    Amex card, not an expense, and shows **Already recorded** because the card
    statement posted it.
18. **Check stubs.** Drop a check stub PDF or a photo in the inbox; the message
    says how many checks were read. Open the **Check stubs** tab to see them.
    On a bank statement with those checks, the line shows "From check stub"
    with payee and category filled in; after approving, the stub shows Used.
    (Needs the statement of the account the checks are written on.)
19. **Chart of Accounts fully editable.** Accounting → Chart of Accounts →
    Edit on Accounts Receivable: change its number (1100 → 1150) and name, save.
    Create an invoice to show it still posts to AR. Edit a normal account and
    change its type; the drawer warns if it has a balance.

### Also done (not raised in the meeting)

20. **General Ledger matches QuickBooks.** Show the running balance, the real
    transaction types (Expense, Check, Payroll), numbers and names filled in,
    amounts in the account's natural sign.
21. **Ledger details.** Point out CM-/VC- numbers on credit memos and vendor
    credits and names on payroll rows.
22. **Clickable date, name and description.** In the General Ledger, click a
    date, a name and a description: each opens the transaction.
23. **Any account as an expense category.** New expense → Category: asset and
    liability accounts are offered as well as expenses.
24. **Add new from dropdowns.** In an account, vendor or customer dropdown,
    choose "Add new" and create one without leaving the form.
25. **Arrow keys.** Open a dropdown or a ⋯ menu and move with the arrow keys,
    Enter to pick.
26. **Company switch opens the dashboard.** Switch company from the top bar:
    you land on that company's Dashboard.
27. **Stale tabs.** With two tabs open, switch company in one; the other shows
    "What happened to this page?" instead of the old company's data.
28. **Chart of Accounts pager at the bottom.** Scroll to the bottom of the
    Chart of Accounts: the page controls are there too.
29. **Exports.** General Ledger (or any report) → Export to Excel, PDF and
    Print: header with company, report and period, footer with page numbers,
    numbers formatted.
30. **API key message.** (Explain, no click.) If the AI key is ever rejected,
    the inbox now says so plainly; production uses a non-expiring service
    account key.
31. **Photo uploads.** Drop a phone photo (PNG/JPEG) of a check stub in the
    inbox; the message says what it read.
32. **Long, multi-account statements.** Drop the July bank PDF (20 scanned
    pages, checking and savings). Wait ~3 minutes: it becomes two statements,
    "…Checking 2553" (155 lines) and "…Savings 8344" (6 lines).
33. **Stub dates.** In the Check stubs tab, the handwritten "7/1" stubs show
    7/1/2026, not a guessed year.
34. **Suspense.** In a statement, lines the AI could not place show the amber
    "Suspense · not sure" badge and can be approved as they are. AI → Suspense
    lists them: pick the right account, tick "Remember for this payee",
    Reclassify. Then show that closing the month is refused while Suspense has
    a balance.
35. **Bottom action bar.** Open a journal entry (or any expense, bill, deposit,
    payment) and scroll: the Save / Delete / Void bar stays pinned to the very
    bottom of the window, with nothing showing underneath it, and the last
    section (Memo, Attachments) scrolls fully into view above it.
