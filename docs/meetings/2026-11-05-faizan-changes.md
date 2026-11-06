# Faizan's changes — 11-05

What Faizan asked for on 11-05, from the transcript of his screen recording,
with a first look at the code for each bug. Item numbers carry on from
[`2026-10-25-follow-ups.md`](./2026-10-25-follow-ups.md) (which ended at 97).
**Built and verified 11-06: everything below except 109, which needs a
library decision first — see its own row.** Full typecheck, lint, and the
backend and web test suites all pass. One real regression turned up along the
way and was fixed: 107's new partial-posting rule broke an older test
(`statementBalances.test.ts`) that had incidentally left a row unticked while
testing something unrelated (the period/balances carrying over for Reconcile);
that test now ticks both rows as it meant to, and a new test covers 107's own
behavior directly.

**Four bugs stop work, so they come first (98 to 101).** He couldn't save a
bill, post a credit card statement, reconcile the main bank account, or open a
deposit from the General Ledger. The causes of 99 and 100 are already found in
the code, below.

## Bugs

| # | Where | What he saw | First look | Built |
|---|---|---|---|---|
| 98 | Bills → new bill | Filled in a made-up bill, Save and close: **"Input validation failed"**. Invoices and customer payments save fine | The bill page shows only the server's general message, not which field it refused. The other pages name the field (`pickErr`, `lib/apiErrors.ts`); this one doesn't (`BillNewPage.tsx:136`). Make it name the field first, then fix whatever that is. A line with a description but no account, or a vendor typed but not picked, are the likely ones | **11-06.** The real cause: a line with a description but no account slips past the client-side check (which only required one or the other) and the server rejects the whole save with its generic message. Invoices already catch this before submitting; bills now do too, and `BillNewPage.tsx` wires up `pickErr` as a backstop for anything else the server refuses |
| 99 | AI review → credit card statement | 139 transactions, all reviewed and coded, Post: **"Transaction … invalid UUID"**. A team member got the same | **Cause found.** Post sends every row of the statement, and for a row without an account (one not ticked, or one the AI already posted by itself) it sends an empty account. The server requires an account on every row, even the ones it then skips (`routes/emailImports.ts:281`, sent from `EmailImportReviewPage.tsx:535`). Fix with 107: the same code | **11-06.** The account is now optional on a row that is unticked, already auto-posted, or a card payment (none of those get posted); a row that *is* ticked but still has no account gets a clear, specific error instead of the generic one |
| 100 | Reconcile | **1020 Operating Bank isn't in the account list**, and can't be searched for, though statements were posted into it today and it shows as a bank, with its balance, in the Chart of Accounts | **Cause found.** The list leaves out every account with a system key (`bankReconciliationWorksheetService.ts:96`). 1020 is the bank account every company is created with, and it carries the key `operating_bank`, so **no company can reconcile its main bank account**. Cash on hand has a key too. The rule was presumably meant to keep built-in accounts like A/R and A/P out | **11-06.** Only the true control accounts (A/R, A/P, sales tax payable, retained earnings, suspense) are excluded now; `cash_on_hand` and `operating_bank` are back in the picker like any other bank account |
| 101 | General Ledger → a deposit | Clicking a deposit to change it turns the **screen white**, every time. Other transactions open and save from the ledger | To reproduce: open a deposit from the ledger and read the browser console. A white screen is the page crashing as it opens | **11-06.** Found it: a deposit wrapped from an AI-coded bank statement never had `received_from`/`payment_method`/`ref_no` typed in, so the database holds `null` for them — and the line editor's combobox calls `.trim()` on that value as it renders, crashing every time, for every such deposit. `getDeposit` now always hands back a string, never null |

## Changes

| # | Where | What he wants | Built |
|---|---|---|---|
| 102 | Chart of Accounts → Import → Download sample template | The template has only Name, Code and Account Type. Add **Detail Type**, so it has what the Chart of Accounts has: number, name, account type, detail type (`CoaListPage.tsx:534`) | **11-06.** The import itself already read a Detail Type column when one was in the file; only the downloaded sample was missing it |
| 103 | Journal entry | **Up and down arrow keys** move to the row above or below in the amount columns, as in QuickBooks. Today they don't move | **11-06** |
| 104 | Check | A check number already used **shows a message saying so, and still saves**. Nobody is stopped; whoever enters it just knows. Today nothing is said. Item 88 did the same for journal numbers | **11-06.** Same wording and timing as the journal entry's own version, scoped to the same bank account (a check number is a sequence per checkbook, not per business) |
| 105 | AI review (bank and card statements) | **Sort by any column heading**, as in the General Ledger. Sorting by type puts all the deposits, payments and checks together, which makes checking and recoding faster | **11-06** |
| 106 | AI review (bank and card statements) | A **Memo** column between Name and Amount, to add a note to any transaction | **11-06.** Appended to the posted entry's own memo when the line is posted; not saved anywhere for a row left for later, same as every other typed edit on this screen today |
| 107 | AI review (bank and card statements) | **Post only the transactions ticked**, and leave the rest on the review page for later, when he doesn't know yet what some of them are. Today posting finishes the whole statement, and the rows not posted disappear. He has asked for this before | **11-06.** The statement now only moves to Approved once every row is posted or a card payment; a partial post reopens the same statement with the ticked rows marked Posted and the rest still waiting |
| 108 | General Ledger | **Freeze the column headings** at the top of the page while scrolling down | **11-06** |
| 109 | General Ledger → Excel | The page and the PDF look good; the Excel file doesn't. **Bold the headings and subtotals.** Note: the free edition of the Excel library we use (SheetJS) can't write bold, so the file needs writing another way. Decide when building | **Not built.** The free SheetJS really can't write styled cells; the fix is a new dependency (`exceljs` is the standard alternative — MIT-licensed, writes bold/styled cells, actively maintained). Adding a library is the one kind of change worth a nod before doing it, so this is left for Riham to say go-ahead on |
| 110 | General Ledger → Customize | Columns show **in the order they are ticked**: Debit, Credit, Balance gives those three in that order, as in QuickBooks. He ticked Debit, Credit, Balance and got Balance, Debit, Credit | **11-06.** Ticking a column on only ever added it to the visible list, never moved it in the display order, which stayed fixed at whatever it started as. Ticking one now moves it to the end of the display order too |
| 111 | General Ledger and the other reports | **A search box** that finds any transaction, amount or name in the report. The browser's Ctrl+F didn't find a transaction he looked for ("SPI logo", as transcribed) | **11-06, General Ledger only** (the "every report" and Ctrl+F questions below are still open). The search itself already existed and already matched name/amount/memo — it was buried inside Customize, and a match inside a collapsed account was never rendered at all, so Ctrl+F had nothing to find. Now there's a visible search box in the toolbar, and a match auto-expands its account |

## Order to build

1. **100 and 99:** each is one cause, already found, and both block daily work.
2. **98 and 101:** reproduce, then fix.
3. **107 with 105 and 106:** the review page, together with 99.
4. **104 and 103:** small.
5. **108, 110, 111, then 109:** the General Ledger. 109 needs the Excel question decided.
6. **102.**

## Ask Faizan

- 98: if it doesn't happen here, which fields the bill had.
- 101: whether it is every deposit or one in particular, and which company.
- 111: the General Ledger first, or every report at once? And should Ctrl+F open the app's search?
