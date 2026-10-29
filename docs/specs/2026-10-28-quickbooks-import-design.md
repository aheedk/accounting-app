# Moving a client from QuickBooks — Design Spec

**Status:** Built 2026-10-29 as Setup → Import from QuickBooks (Aheed). Proposed
2026-10-28, after Riham's question about moving the firm's QuickBooks clients over
so Faizan's team can start working in the app. Sections 1–4 are the proposal as
written; section 5 is what was built, and says where it differs. What is still for
the firm to decide is in section 7.

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

Checked against the code on 2026-10-28, before the import was built.

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

## 5. As built (option B)

Setup → **Import from QuickBooks** (`/setup/quickbooks-import`), for an accountant
and up. A checklist of steps, one card each, then the check and the list of uploads.

### How every step works

- The page reads QuickBooks' export as it comes out (Excel or CSV): it finds the
  heading row under QuickBooks' title rows, follows rows grouped under a customer or
  vendor line, skips "Total for" rows, and reads amounts like `(1,234.56)` and dates
  like `10/31/26` (`apps/web/src/lib/qbImport.ts`).
- The rows go to `POST /businesses/:id/qb-import/<step>`, first with `?dry_run=true`:
  the upload runs in full and is rolled back, so the preview is exactly what bringing
  it in would do. Anything wrong (a name it can't find, a date with no open period,
  an entry that doesn't balance) is listed, and while any is left nothing is brought
  in (422 without `dry_run`).
- It posts through the existing services, so imported records behave like ones
  entered by hand and are in the activity log.
- Each upload is a batch (`qb_import_batches`, migration 0114) listing everything it
  made (`qb_import_records`), and can be undone from the page
  (`POST .../qb-import/batches/:id/undo`). Posted things are voided; accounts,
  customers, vendors and items are removed while nothing uses them. Undo refuses
  when something later depends on the upload: a customer with open invoices, an
  invoice with a payment applied, a bank entry reconciled since.
- All of a company's uploads are on one cutover date, set before the first.
- Code: `apps/api/src/services/import/` (`qbLists.ts`, `qbOpenItems.ts`,
  `qbLedger.ts`, `qbBatches.ts`, and `qbMatch.ts` for finding names).

### Finding names

QuickBooks writes an account by its full name, a sub-account as `Parent:Child`, and,
when the company numbers its accounts, each part with its number in front
("6000 Utilities:6010 Gas"). The name decides; a number only picks between accounts
that share a name. Customers and vendors are found by name, or by the last part of a
QuickBooks `Parent:Child` name.

### The steps, in the order on the page

1. **Chart of accounts.** From the Account List.
   - QuickBooks' Accounts Receivable, Accounts Payable and Retained Earnings are the
     company's own (the default chart has them): those take QuickBooks' name and
     number rather than being added twice.
   - An account already here by full name is left as it is; one here as a different
     type stops the upload.
   - Sub-accounts are kept under their parent.
   - A number already taken, or none at all, gets the next tenth in the type's range
     (1010, 1020... for assets; cost of goods sold in the 5000s, other expenses from
     6000), with a note.
2. **Customers**, 3. **Vendors.** From the contact lists: name, company, email,
   phone, billing address, terms ("Net 30" read as 30 days), notes; a vendor's
   account number. A name already here is left as it is.
4. **Products and services.** Name, SKU, description, price, cost, and the income,
   expense and inventory asset accounts by name. QuickBooks doesn't need a SKU and the
   app does, so an item without one uses its name. Bundles and categories are
   skipped. A stock item's quantity on hand comes in as opening stock on the cutover
   date, posted to Inventory against Opening Balance Equity.
5. **Open invoices**, 6. **Unpaid bills.** From the Open Invoices and Unpaid Bills
   reports. Each open row is a posted invoice or bill with its QuickBooks number,
   date, due date and terms, and one line for the open balance, against Opening
   Balance Equity. A negative row (a credit memo, a payment not yet applied, a vendor
   credit) is a credit memo or vendor credit. Invoice and bill numbers are one to a
   company here, so a number already used (two vendors' bills can share one in
   QuickBooks) gets -2, -3; a bill with none gets one.
7. **Uncleared bank and card items.** One account an upload, chosen on the card, from
   the uncleared sections of its QuickBooks reconciliation report. Each item is an
   entry of its own against Opening Balance Equity. "Nothing was uncleared" records an
   account with none.
8. **History** (optional). From the Journal report. Each transaction is a journal
   entry with QuickBooks' date, number and name. QuickBooks' type becomes the app's
   (journal entries take a fixed list: deposit, check, expense, invoice...) and is
   kept at the start of the memo. Brought in 500 at a time.
9. **Opening balances**, last. From the Trial Balance at the cutover date.
   **Differs from the proposal:** instead of sending chosen lines to Opening Balance
   Equity, the entry is QuickBooks' figure less what is already here, account by
   account (`computeTrialBalance`, so income and expense are the year to date). What
   the steps above brought in is already counted: open invoices on Accounts
   Receivable, uncleared items on the bank, history on everything. So it is right in
   any combination of steps, Opening Balance Equity ends where QuickBooks has it, and
   with full history the entry is empty. The preview shows QuickBooks, here already,
   and the entry for each account. A note says when Accounts Receivable or Payable
   doesn't match the open documents brought in.
   - Then each bank and credit card account is **reconciled to the cutover date**:
     every entry up to then is ticked except the uncleared items, at the balance that
     leaves. The first reconciliation here starts where QuickBooks' last one ended,
     with only the uncleared items to tick. An account with a reconciliation in
     progress is left alone, with a note.
   - Nothing that posts can be added while the opening balances are posted: undo
     them, add the upload, and post them again.

### The check

`GET .../qb-import/check`: once the opening balances are posted, the page puts each
account's balance at the cutover date beside QuickBooks' trial balance (kept with the
upload) and lists any that differ.

### Tests

`apps/api/tests/integration/qbImport.test.ts`: a whole move (lists, open items,
uncleared items, opening entry, the check, the reconciliation, undo), account
mapping, history, and the HTTP routes (dry run, roles, problems). The readers:
`apps/web/src/lib/qbImport.test.ts`.

## 6. Not covered

- **Payroll.** Each employee's year-to-date pay and taxes (for W-2s and wage limits)
  has nowhere to go: nothing in the payroll code takes them. Keep payroll in
  QuickBooks until year-end for clients who run it here, and move it on January 1.
- Attachments (receipts, PDFs), recurring templates, budgets, bank rules, and
  users and their access.
- Past reconciliations. They stay in QuickBooks.

## 7. To decide

- Whether the first week is a pilot of a few clients or everyone. Before the first,
  try the page on one client's real exports: the column names are QuickBooks' as we
  understand them.
- The cutover date: a month end, 2026-10-31 if the pilot starts the week of 11-02.
- Whether to bring history, and how many years of it.
- How long to keep QuickBooks for looking things up.
