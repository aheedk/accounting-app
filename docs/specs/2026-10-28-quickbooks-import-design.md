# Moving a client from QuickBooks — Design Spec

**Status:** Proposed 2026-10-28, not decided. Nothing in it is built. Written after
Riham's question of 10-28 about moving the firm's QuickBooks clients over so
Faizan's team can start working in the app. What is still to decide is in section 8.

Column names and report layouts below are QuickBooks' as we understand them. Check
them against real exports from one of the firm's clients before building.

## 1. The question

Riham's plan (10-28), for Faizan's team to start the following week:

- Export the chart of accounts, customers and vendors from QuickBooks, and bring
  them in with the uploads the app already has.
- Set opening balances by hand as of the cutover date. Doable for a few clients,
  tedious for many.
- From then on, enter new transactions here. Past invoices, bills and journal
  entries stay in QuickBooks, since bringing them over "would be a whole separate
  thing to build".

She also asked whether to move a few clients or all of them.

## 2. What the app has today

Checked against the code on 2026-10-28.

| | Today | Where |
|---|---|---|
| Chart of accounts | Upload of Name, Code, Account Type and Detail Type. QuickBooks' type names and detail types are understood. Code is required, so a QuickBooks company without account numbers fails on every row. Sub-accounts come in as top-level accounts. | `apps/web/src/pages/coa/CoaListPage.tsx` |
| Customers | Upload of Name, Company Name, Email, Phone and Terms Days. No addresses. | `apps/web/src/pages/customers/CustomerListPage.tsx` |
| Vendors | Upload of Name, Email, Phone and Terms Days. No addresses. | `apps/web/src/pages/vendors/VendorListPage.tsx` |
| Products and services | No upload. A new invoice needs one on every line. | `apps/web/src/pages/invoices/InvoiceNewPage.tsx` |
| Opening balance of an account | Entered per account on the account form; posts against Opening Balance Equity. Not part of the upload. | `apps/api/src/services/core/chartOfAccountsService.ts` |
| Opening balance of a customer or vendor | Stored on the customer or vendor only. Nothing posts it, no report reads it, and a payment can't be applied to it. | `customerService.ts`, `vendorService.ts` |
| Journal entries, invoices, bills | No upload. | |
| Bank transactions | CSV upload, and a whole upload can be undone. | `apps/api/src/routes/bankTransactions.ts` |

The rest of this spec relies on these:

- An entry posts only into a fiscal period that exists and is open
  (`ledgerService.postJournalEntry`).
- Invoice numbers, and bill numbers, are unique within a company. The next invoice
  number is the highest number made of the company's prefix and digits, plus one
  (`invoiceService.getNextInvoiceNumber`).
- A reconciliation ticks whole transactions. Since item 94 it finishes only at a
  zero difference.
- Income and expense start each fiscal year at zero, and earlier years are carried
  in Retained Earnings ([year-end spec](./2026-10-13-year-end-retained-earnings-design.md)).
- The deposit screen lists the customer payments waiting in Undeposited Funds one
  by one (`bankDepositService.listUndepositedPayments`). A deposit can also take
  "other funds" lines from any account.
- Opening stock posts debit Inventory, credit Opening Balance Equity
  ([inventory ledger spec](./2026-10-07-inventory-ledger-design.md)).

## 3. The plan: what it gets right, and what it misses

**Right:** the lists can come over by upload today, and nothing brings past
transactions over.

**Misses.** Faizan's team would run into each of these in the first week:

- **Products and services.** There is no upload, and invoices need them.
- **Open invoices and unpaid bills.** A customer's opening balance can't take a
  payment. So when a customer pays an invoice raised in QuickBooks, there is
  nothing here to apply the payment to. Each open invoice and bill has to come over
  as its own document.
- **Uncleared bank items.** Without the checks and deposits that hadn't cleared at
  cutover, the first reconciliation can't reach zero, so it can't be finished.
- **Payments not yet deposited.** A lump balance in Undeposited Funds doesn't show
  on the deposit screen as payments. It can be taken with an "other funds" line,
  or everything can be deposited in QuickBooks before cutover.
- **Account numbers, sub-accounts and addresses** are lost or rejected, as in the
  table above.

**Too pessimistic:**

- Opening balances don't need typing account by account. QuickBooks' Trial Balance
  as of the cutover date is one journal entry.
- History doesn't need the QuickBooks API. QuickBooks' Journal report exports every
  transaction.

## 4. Options

| Option | What comes over | Work |
|---|---|---|
| A. Riham's plan, with the gaps above filled by hand | Lists; opening balances, open invoices and bills, and uncleared items typed in | Nothing to build. Hours of typing for each client. |
| B. Import steps that read QuickBooks' own exports (proposed) | Everything in A without the typing, and optionally the full history | About 1.5–2 weeks for all of it; the pilot's part in 3–4 days |
| C. The QuickBooks API | Every invoice, bill and payment as its own document, linked as in QuickBooks | Weeks. An app registered with Intuit and approved for production use, and each client's company connected to it. |

B gets nearly everything C would, from files the firm can already export, without
waiting on Intuit. C pays off only for many clients with long histories where the
original documents matter.

## 5. Proposed design (option B)

An **Import from QuickBooks** page for each company: a checklist of the steps
below, in order. Each step:

- takes QuickBooks' export as it comes out (Excel or CSV, with QuickBooks' header
  rows, total rows and column names);
- shows a preview before anything posts: what will be created, rows it can't match
  (an account, customer or vendor name it doesn't know), and totals that don't
  agree;
- posts through the existing services (accounts, customers, vendors,
  `invoiceService`, `billService`, `ledgerService.postJournalEntry`), so imported
  records behave like ones entered by hand and are in the audit trail;
- is kept as one import batch that can be undone as a whole, like a bank upload.

The cutover date is chosen first. A month end is simplest. The fiscal periods
covering it must exist, and so must those for any history brought over.

### Step 1: Lists

- **Chart of accounts:** take QuickBooks' Account List export as it is. Give a code
  when QuickBooks has none (the next free one in the type's range). Keep
  sub-accounts: QuickBooks writes them as `Parent:Child`.
- **Customers and vendors:** take QuickBooks' column names, the billing address,
  and terms by name ("Net 30") as well as by days.
- **Products and services (new):** name, SKU, description, sales price, cost, and
  income and expense accounts by name. For stock items, the inventory asset
  account and the quantity on hand.
- Sales tax codes and their agencies are set up by hand on Settings → Tax Codes
  (a few for each client).

### Step 2: Opening balances

QuickBooks' Trial Balance as of the cutover date becomes one journal entry dated
that day. Lines that a later step brings in in detail go to Opening Balance Equity
instead of their own account, so nothing is counted twice:

- Accounts Receivable and Accounts Payable (step 3);
- each bank account's uncleared items (step 4), so the bank opens at its cleared
  balance;
- Inventory Asset, when stock comes in with the products and is posted as opening
  stock.

Once the later steps are done, Opening Balance Equity comes back to what QuickBooks
shows for it.

With a mid-year cutover, the year's income and expenses all sit in this one entry.
The year's totals are right, but the months before cutover are not. Step 5 fixes
that.

### Step 3: Open invoices and unpaid bills

- From QuickBooks' Open Invoices report (or A/R Aging Detail) and its Unpaid Bills
  report.
- Each open invoice becomes a posted invoice with its QuickBooks number, customer,
  date, due date and terms. It has one line for the open balance, credited to
  Opening Balance Equity. Bills are the same the other way round. A bill with no
  number gets one: QuickBooks doesn't require it, the app does.
- Negative rows (credit memos, and payments not yet applied) come in as credit
  memos, vendor credits, or unapplied payments.
- The open balance includes its sales tax, which is already in Sales Tax Payable
  from step 2, so the line has no tax code.
- New invoice numbers carry on from QuickBooks' highest, as long as the company's
  invoice prefix matches QuickBooks' numbers.
- A/R and A/P Aging here then match QuickBooks' as of cutover, and Accounts
  Receivable and Payable match the trial balance.

### Step 4: Uncleared bank items

- From QuickBooks' list of each bank account's transactions not yet cleared at the
  cutover date.
- Each becomes its own entry against Opening Balance Equity, with its date, number
  and payee, so it can be ticked when it clears. With step 2 opening the bank at
  its cleared balance, the book balance comes out at QuickBooks'.

### Step 5 (optional): History

- From QuickBooks' Journal report for the years wanted: every transaction with its
  date, type, number, name, memo and lines.
- Each transaction becomes a journal entry with its date, QuickBooks type, number
  and name. Past P&Ls, balance sheets, the general ledger and this year's months
  then work here.
- It brings the ledger, not the original invoices and bills: an old invoice is a
  journal entry here.
- With history in, step 2 is not posted. The trial balance becomes the check
  instead.
  - Step 3 still brings the open invoices and bills as documents. One entry at
    cutover moves the history's Accounts Receivable and Payable balances to Opening
    Balance Equity, so they aren't counted twice.
  - Step 4 isn't needed, since each uncleared item is already an entry of its own.
    Instead the import marks every history entry on a bank account as reconciled,
    except those QuickBooks shows as uncleared. The first reconciliation here then
    starts where QuickBooks' last one ended.

### The check

At the end, the page puts our trial balance as of the cutover date beside
QuickBooks', and lists any account that differs. It does the same for the A/R and
A/P aging totals. A client counts as moved when they match to the cent.

## 6. Not covered

- **Payroll.** Each employee's year-to-date pay and taxes (for W-2s and wage limits)
  has nowhere to go: nothing in the payroll code takes them. Keep payroll in
  QuickBooks until year-end for clients who run it here, and move it on January 1.
- Attachments (receipts, PDFs), recurring templates, budgets, bank rules, and
  users and their access.
- Past reconciliations. They stay in QuickBooks.

## 7. Size and order

Rough guesses for one developer, tests included:

| Part | Size |
|---|---|
| Step 1: lists, and the products upload | 1.5 days |
| Import batches with undo, and the preview | 1 day |
| Step 2: trial balance | 1 day |
| Step 3: open invoices and bills | 2 days |
| Step 4: uncleared bank items | 1 day |
| The check | half a day |
| Step 5: history | 3–4 days |

Steps 1–4 and the check come to about a week, or a bit more. History adds 3–4 days.

For a pilot of two or three clients, build steps 1–3 first (3–4 days). Their
uncleared bank items, and if need be their open invoices and bills, can be typed in
by hand while the rest is built. Build history before moving everyone else.

## 8. To decide

- Whether to build this at all, and whether the first week is a pilot of a few
  clients or everyone.
- The cutover date: a month end, 2026-10-31 if the pilot starts the week of 11-02.
- Whether to bring history, and how many years of it.
- Who builds what. Suggested: Riham takes step 1, since she has already looked into
  the uploads, and Aheed takes steps 2 and 3.
- How long to keep QuickBooks for looking things up.
