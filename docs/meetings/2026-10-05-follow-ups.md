# Meeting follow-ups — 2026-10-05

What was asked for in the meeting, checked against the code. Updated 2026-10-07.
Item numbers are fixed so they can be divided up; **(10-01)** marks items left
over from the previous meeting. Aheed's demo walkthrough is at the bottom.

- **November 1, 2026** — Faizan's team starts using the app for actual clients.
- **January 1, 2027** — planned launch to outside customers.

## To do before November 1

| # | What | Owner |
|---|---|---|
| 17 | QA audit (`docs/qa/2026-09-28-app-audit.md`): done, apart from emailing an invoice, Estimate, and three decisions for the firm; see "Audit: what is left" below **(10-01)** | Aheed, firm |
| 18 | Review the reports with the firm. They are all up and agree with each other; see "Reports" below | Aheed, firm |
| 10 | Bank deposit print: show the preview inside the app, like QuickBooks. Print still opens the PDF in a new browser tab, as it did at the meeting | Riham |
| 11 | Make recurring on a bank deposit: Faizan says what is expected, then test it | Riham, Faizan |
| 12 | "+ New" menu: match QuickBooks exactly. Check is now in it (Aheed); the rest of the match is not started | Riham |
| 13 | Write Check: the Order checks link still says "coming soon". Take it out, or say where it should go | Riham |
| 31 | Customers: the same batch actions, inactive switch and delete rule as Vendors. Not started: the list has no tick boxes and a customer cannot be made inactive | Riham |
| 32 | Transactions page: add invoices, bill payments and vendor credits (it lists deposits, expenses, checks, journal entries, bills, payments and credit memos). Sorting still covers only the 25 rows on screen: since 10-08 the server can sort the whole list, but the page does not ask it to | Riham |
| 14 | Test check stubs with a statement and stubs from the same client **(10-01)** | Faizan sends files, Aheed tests |
| 15 | Suspense: reclassify some real lines **(10-01)** | Faizan |
| 16 | Test a real credit card statement **(10-01)** | Faizan |

Riham's rows were checked against the code on 2026-10-08, after her last push
(`06389d5`; her branch and `main` are the same). None of the seven was finished.
Aheed then did most of 13, all of 33, and the Check entry of 12 (see Done). They
are in her pages (Bank Deposit, Journal Entry, Vendors list, the + New menu), so
she should pull before working on them.

**Reports (item 18)**

In the app now: Profit & Loss, Balance Sheet, Statement of Cash Flows (new), Cash
Activity, General Ledger, Trial Balance, A/R Aging, A/P Aging (new), 1099, Management,
Performance, Custom.

`npm -w @accounting/api run report:tie-out` checks them against each other, and on
both local companies everything agrees: the trial balance and balance sheet balance,
net income is the same on the P&L, balance sheet and cash flow statement, and both
aging reports equal their control accounts. Running it found two real bugs, now fixed:

- The P&L and three other reports dropped month-end reversing entries (off by 7,500
  on Blue Widget).
- Every balance sheet would have gone out of balance on January 1, because nothing
  carried the old year's profit into Retained Earnings.

For the firm to pick from, not built: comparative columns, P&L by month, aging detail
by invoice, customer and vendor balance summaries, sales by customer, expenses by
vendor.

**Audit: what is left (item 17)**

Every bug, wrong number and missing feature in the audit is done, except:

- **Emailing an invoice.** It needs a mail service to send from. Save as PDF works.
- **Estimate.** Not built; a job of its own.
- **Three decisions for the firm:** which of the two Contractors pages to keep,
  whether to merge the two rule systems (Accounting → Rules and AI → Coding Rules),
  and a better name for "Spreadsheet Sync".

**Questions for the firm**

- **Card payments (item 6).** A payment on a card statement is no longer posted
  from the card statement; the bank statement records it. If that bank statement
  is never uploaded, the card balance stays too high by the payment. Is that
  acceptable, or should there be a way to post it from the card statement anyway?
- **1099 and card payments.** Payments made to a contractor by card are now left
  off the 1099, because the card processor reports them on a 1099-K. Confirm that
  is how the firm files.
- **Email from the app.** Emailing vendors now opens the user's own mail program
  with the message started. Is that enough, or should the app send the email
  itself? That needs a mail service, and so does emailing an invoice.
- **Pay stubs (22) and payroll.** Payroll can now be run from the app. Are pay
  stubs still wanted, and does Payroll stay in the sidebar?
- **Inventory.** It now posts to the ledger. Three choices were made without the
  firm and need a yes or no: stock leaves at average cost (QuickBooks uses
  first-in-first-out), receiving stock posts through its bill, and shrinkage goes
  to cost of goods sold. `docs/specs/2026-10-07-inventory-ledger-design.md`.
- **Correcting a posted invoice.** The original is voided and the corrected one is
  posted as INV-1042-R1. QuickBooks changes the invoice in place and keeps its
  number. Is a new number acceptable to clients?

## Later (January or after)

None of these are in the code yet. Most need a decision from the firm first.

| # | What |
|---|---|
| 20 | Bank account connection, so transactions arrive on their own. Needs an outside service **(10-01)** |
| 21 | Reconciliation, after 20 **(10-01)** |
| 22 | Pay stubs. Not mentioned this time; ask if still wanted **(10-01)** |
| 23 | Upload a customer's purchase order and turn it into a sales invoice |
| 24 | Stripe: (a) clients pay their vendors from the app, (b) we get paid for the software |
| 25 | Modules per client, priced separately (bookkeeping vs. AR, AP and the rest) |
| 26 | Sign in with Microsoft 365 or Google |
| 27 | One login shared with the practice management software |
| 28 | Security review and testing |
| 29 | Mobile app, last |
| 30 | Moving the practice management software off Base44 (separate project) |

## Not code

- Faizan: keep testing and send findings (video is fine).
- Sample checks for the "Timeout" client **(10-01)**.
- Clean the test entries out of the real company **(10-01)**.
- Get the product / company name in writing and check it is available.

## Done

| # | What | Who |
|---|---|---|
| 1 | Journal entry amounts show commas and two decimals | Aheed, `896e7bb` |
| 2 | Typing 9 becomes 9.00, on every amount box in the app | Aheed, `896e7bb` |
| 3 | Delete is under More on Journal Entry, Bank Deposit, Expense and Check | Riham, `7dd3df1` |
| 4 | Attachments work on bank deposits | Aheed, `9c6edcb` |
| 5 | Statement review: the bank account picker lists only bank accounts | Aheed, `85b13bf` |
| 6 | Card statement: the payment line is not posted and never touches the bank account | Aheed, `a267697` |
| 7 | A check takes its category from the stub's payee and memo ("food") | Aheed, `b3cf55f` |
| 8 | New account and Edit account panels reach the top of the window | Aheed, `4370f0b` |
| 9 | Vendor dropdown in the AI inbox, with the AI matching renamed payees **(10-01)** | Riham, `40d1214` |
| 19 | General Ledger fiscal-year presets use the client's fiscal year **(10-01)** | Riham, `e9acc5a` |
| 13 | Audit history on Journal Entry and Bank Deposit, and Copy on Bank Deposit, work | Aheed, `11452ee` |
| 33 | Vendors list: Email and "Ask vendor for info" start a message in the user's mail program | Aheed, `258cdef` |
| 12 | Check is in the "+ New" menu (the rest of 12 is open) | Aheed, `8ebcbdb` |

Audit bugs fixed (part of item 17), all Aheed:

| What | Where |
|---|---|
| AI inbox no longer fills in an account the coding engine did not accept | `6f79a03` |
| A new invoice's due date follows its terms and the customer's default terms | `55b09ed` |
| 1099 report counts expenses and checks paid to contractors; card payments left out | `085d093` |
| Management Reports shows revenue by month (every month read 0.00) | `8d33f9a` |
| Net Operating Income on the Profit & Loss takes operating expenses off | `95b12eb` |
| Bank Transactions → Categorize starts with no account chosen | `614d5d4` |
| A/P Aging report; both aging reports split 61–90 / 91+ and equal the ledger | `861868f` |
| Statement of Cash Flows (operating, investing, financing) | `ad9deca` |
| P&L and three other reports count reversing entries | `0ebf728` |
| Balance sheet still balances after year end; year to date follows the fiscal year | `0115d24` |
| Client Overview and A/P Overview agree with the ledger | `460abea` |
| Payments, Credit Memos, Bill Payments and Vendor Credits open on This year | `cb49588` |
| Vendor page counts, Books Review month, recurring template amounts | `f23ed00` |
| Fixed Assets says when the register and the ledger differ | `453a0fe` |
| Contractors → Create bill keeps the contractor; Copy link confirms; journal entry links to its source | `d7241c6` |
| Codes read as words, quantities lose their padding, Ctrl K on Windows | `4f32db4` |
| The auto-post switch saves (it never had); capitalization threshold has a setting | `9666e52` |
| Bank Accounts shows book balances; pages print without the sidebar and top bar | `551ad65` |
| The search box finds customers, vendors, invoices and bills | `a0bdc04` |
| Bank Transactions → Categorize shows the coding engine's suggestion | `4cb59f6` |

Features the audit listed as missing (part of item 17), all Aheed:

| What | Where |
|---|---|
| Integration Transactions → Categorize shows the coding engine's suggestion | `6587a79` |
| An invoice saves as a PDF | `6a6070a` |
| Transfer between two accounts | `c71ccb4` |
| Pay Bills: every unpaid bill, several vendors at once | `5f9fa96` |
| Run payroll from the app | `d069f4b` |
| Inventory reaches the ledger: cost of goods sold, opening stock, adjustments | `a1a6073` |
| A journal entry's Class column picks a cost center | `20b1e25` |
| Edit an employee, a recurring template, a tax code, a learned coding rule | `454f93f`, `59c6abc`, `99081d8`, `3c9bb88` |
| Correct a posted invoice | `2ca153d` |
| No ids on shipping labels, Receipts or Fixed Assets | `4d791cc`, `c3cd71f` |
| Dashboard shows cash, owed to you, you owe, and profit this month | `37033c9` |
| Table headers all in capitals; Employee, Fixed Asset and Purchase Order pages restyled | `f687b0b`, `c3cd71f` |

Also added by Riham since the meeting: Write Check (Accounts Payable → Checks),
the Transactions page, the table-settings gear on list pages, vendor batch
actions with active / inactive, and a fuller add-vendor popup in the AI inbox.
Pulled 2026-10-08, all Riham: on the Transactions page, date-range and amount
filters, Due date and Balance columns, a settings panel for rows, columns and
filters, and print / CSV; a vendor's page now lists every kind of transaction, with
a searchable vendor list down the side that folds away and sorts by open balance;
and long options in dropdowns are no longer cut off.

After pulling, run `npm run db:migrate` (migrations `0084`–`0090`).

## Decided — no work

- Keep our sidebar layout; no QuickBooks-style tabs across the top.
- Keep the Check stubs tab in the AI inbox, and keep the label "Memo".
- Clicking anywhere on a General Ledger row opens the transaction.
- Payroll stays in the sidebar for now. The firm believes there is no payroll
  module, but the app has one, so show it before anyone removes it.

## Unclear

- **The product name.** Heard as "Mathematica" / "amatica"; "Acumatica" was heard
  on 10-01 and is an existing accounting product.
- **"VIA"** on the purchase order line of the weekend list. Nobody knew.
- **Riham's QuickBooks rules** from Claude: what they changed and where they live.
- **Riham's missing changes.** Her branch and `main` are identical on GitHub, so
  anything missing is only on her machine.
- **Who is doing the Base44 move** (item 30).

## Demo for the next meeting (Aheed)

Aheed's finished items, in the same numbering, with where each lives and what to
click. Item 3 and the other Riham items are hers to show. Every change of Aheed's
since the meeting is in this section: the first four parts are for the meeting, and
"Smaller fixes to check yourself" at the end covers the rest.

**Before the meeting**

- Run `npm run db:migrate`, start localhost, and open **Green Gadgets Inc.** It
  already has what the demo needs: the card account `2673 Amex Payable-9001`, the
  sample August Amex statement waiting in the inbox, four bank statements, and
  40 check stubs.
- For the second half of item 6, post a journal entry dated 8/12/2026: debit
  `2673 Amex Payable-9001`, credit `1020 Operating Bank Account`, 3,671.29. It
  stands in for the bank statement's record of the card payment.
- Have any small file ready to attach (item 4).
- Do not click Post on the Amex statement during the demo; that uses it up. The
  PDF is `SAMPLE Amex statement Aug 2026.pdf` in Downloads if it has to go in again.

### Asked for in the meeting

1. **Amounts with commas and two decimals.** + New → Journal entry. Type `9000`
   in a Debits box and press Tab: it reads 9,000.00.
2. **9 becomes 9.00.** Same form: type `9` in the next Credits box and Tab.
   Click back into a box to show it turns into the plain number for editing.
   Then show it is everywhere: + New → Expense, or + New → Bank deposit.
4. **Attachments on a bank deposit.** + New → Bank deposit. Pick the bank
   account, add one line with an account and an amount, drop a file on
   Attachments, and save. The deposit reopens with the file listed; click it to
   download. Accounting → Receipts shows the same file tagged "deposit".
5. **Bank account picker.** AI → Document Inbox → Review on any bank statement.
   "Bank account (this statement)" lists six accounts: the five set up under
   Banking plus OB Test Checking. Accounts Receivable, Inventory and Equipment
   are no longer in it.
6. **Card payment.** AI → Document Inbox → Review on the American Express
   statement (purple card icon). The card is preselected. Find 08/12
   `PAYMENT RECEIVED - THANK YOU`, 3,671.29: the category shows the card account,
   the tick box is locked, and the Post button counts 19 entries, not 20.
   - Without the stand-in entry it reads "Waiting for the bank statement".
   - With it, it reads "Recorded from the bank statement" with an Open link.
   - Ask the card-payment question from "Questions for the firm" here.
7. **Check stub categories.** This one cannot be shown end to end yet: none of
   the 18 checks on the long bank statement match any of the 40 stubs, because
   they are from different accounts (item 14). What can be shown: AI → Document
   Inbox → Check stubs, where each stub carries its payee, memo ("Food") and
   account. Once a matching statement is in, the check line reads "From check
   stub" and its category is filled instead of Suspense.
8. **Account panels.** Accounting → Chart of Accounts → New account: the panel
   reaches the top of the window. Edit on any account does too.

### Audit bugs (item 17)

- **Invoice due date.** + New → Invoice. Due date is 30 days out. Change Terms
  to Net 60 and it moves. Pick Tailspin Toys: terms become Net 45. Pick Fabrikam
  Inc: Net 15.
- **1099.** Accounts Payable → 1099s, year 2026. Demo Contractor B is 931.00
  (was 391.00) and Summit Legal is 2,021.00 (was 1,657.00): their direct
  expenses now count. Dana Brooks Design is 317.00 (was 1,446.00): the 1,446.00
  was paid by card, which is the second question for the firm.
- **Management Reports.** Reports → Management Reports. "Revenue by month" has
  figures in it, and they add up to the 12-month total above.
- **Profit & Loss.** Reports → Profit & Loss. Net Operating Income is no longer
  the same as Total Income; it is gross profit less operating expenses.
- **Categorize.** Accounting → Bank Transactions → Categorize on any row. The
  account box is empty and Submit stays off until one is chosen.
- **AI inbox guesses.** Nothing to click: a line the engine is not sure of no
  longer arrives with an account filled in from a loose name match.

### Reports (item 18)

- **A/P Aging.** Accounts Payable → Aging. The total is 10,790.00, the same as
  Accounts Payable on the Balance Sheet; the unused vendor credit shows as a negative.
- **A/R Aging.** Accounts Receivable → Aging. The total is 32,376.16, the same as
  Accounts Receivable (it was 34,416.16 before, with money on account left out).
  Point out the separate 61 - 90 and 91 and over columns.
- **Statement of Cash Flows.** Reports → Cash Flows. Operating, investing and
  financing add up to the net change, and Cash at end matches the bank accounts on
  the Balance Sheet. Click any amount to see its entries.
- **Balance Sheet after year end.** Reports → Balance Sheet, set the date to
  1/31/2027: it still says "In balance", with this year's profit inside Retained
  Earnings.
- **The check itself.** In a terminal: `npm -w @accounting/api run report:tie-out`.
  Every line reads OK.

### New features (item 17)

- **Dashboard.** The home page opens with four figures for the client: cash in the
  bank, owed to you, you owe, and profit this month. Each one opens the page behind it.
- **Transfer.** + New → Transfer. Move 500.00 from Operating Bank Account to another
  bank account and save: it opens as a journal entry labelled Transfer.
- **Pay Bills.** Accounts Payable → Pay Bills. Every unpaid bill is listed. Tick
  bills from two vendors, pick the bank account, and pay: one payment per vendor.
- **Run payroll.** Payroll → Pay Runs → Run payroll. Enter hours for the employees,
  check the totals at the bottom, and save. This is the answer to "there is no
  payroll module".
- **Inventory in the ledger.** Inventory → Overview has an amber note that stock
  worth 16,058.65 is not in the ledger. Click Post opening balance, then open
  Reports → Balance Sheet: Inventory is 16,058.65. Ask the inventory question from
  "Questions for the firm" here.
- **Invoice PDF.** Open any invoice → ⋯ → Save as PDF.
- **Correct an invoice.** Open a posted invoice with nothing paid on it → ⋯ →
  Correct invoice. Change an amount and save: the original shows Voided and the
  new one is posted with -R1 on its number. Ask the invoice question here.
- **Cost centers.** + New → Journal entry: the Class column lists the cost centers
  from Setup → Cost Centers.
- **Editing.** Four things that could only be created or deleted before:
  - Payroll → Employees → open one → Edit.
  - Accounting → Recurring Transactions → Edit on a row. Untick Active and save:
    the row reads Paused.
  - Setup → Tax Codes → Edit. The rate is typed as a percent (8.75). A changed
    rate starts on the date given and leaves earlier invoices alone. A code that
    is switched off is no longer offered on a new invoice.
  - AI → Coding Rules → the pencil on a rule changes the account it posts to.
- **Integration Transactions.** Accounting → Integration Transactions → Categorize
  shows the same suggestion as Bank Transactions.
- **Audit history (item 13).** Open a journal entry made in the app → More → Audit
  history: who created, posted or edited it and when. A bank deposit has the same.
  Entries that came with the demo data have no history to show.
- **Copy a bank deposit (item 13).** Open a deposit → More → Copy: a new deposit
  with the same bank account, memo and lines, dated today.
- **Emailing vendors (item 33).** Accounts Payable → Vendors. Tick a few vendors →
  Batch actions → Email: the mail program opens with them in BCC. On a row's menu,
  Ask vendor for info opens a ready-written request for their W-9 and details. A
  vendor with no email address gets a message saying so.
- **Check in + New (item 12).** + New → Check, under Vendors.

### Other fixes worth a minute

- **Auto-post switch.** AI → Coding Rules. Tick "Auto-post high-confidence
  transactions", reload the page: it stays ticked. (It never saved before.) The
  capitalization threshold is on the same card.
- **Bank balances.** Accounting → Bank Accounts has a Book balance column.
- **Printing.** Open any invoice → ⋯ → Print: the preview has no sidebar or top bar.
- **Search.** Type `contoso` or an invoice number in the search box at the top:
  customers, vendors, invoices and bills appear under the matching pages.
- **Suggestions on Categorize.** Accounting → Bank Transactions → Categorize: under
  the account box is the engine's suggestion with its confidence and a Use link.
- **Fixed Assets.** Accounting → Fixed Assets shows an amber note that the register
  (43,000.00) and the ledger differ, with the amounts.

### Smaller fixes to check yourself

Not worth meeting time, but each one is a change you can see.

- **Payable and receivable figures.** Accounts Payable → Overview: under
  Outstanding bills it now shows the unused vendor credit and a net payable of
  10,790.00, the same as A/P Aging. Accounting → Client Overview: receivable and
  payable equal the Balance Sheet (they left out money on account).
- **Lists open on This year.** Accounts Receivable → Payments and Credit Memos,
  Accounts Payable → Bill Payments and Vendor Credits. The date filter starts on
  This year, so the rows match the totals above them. It was the last 3 months,
  which could show an empty table under a total.
- **Vendor page.** Accounts Payable → Vendors → open a vendor with a past-due
  bill. The bill reads Overdue in the list (it said Open), and the bar no longer
  says "0 open bills" beside "1 overdue".
- **Books Review.** Accounting → Books Review opens on this month. It opened on
  next December.
- **Recurring amounts.** Accounting → Recurring Transactions: Monthly Office Rent
  and Quarterly Insurance show their amounts. Every row read 0.00.
- **Contractors.** Payroll → Contractors → Create bill on a row: the bill form
  opens with that contractor, their terms and the due date filled in.
- **Copy link.** Any invoice → ⋯ → Copy link: "Link copied" appears.
- **Journal entry to its source.** Reports → General Ledger → click a row that
  came from an invoice or a bill. The read-only entry has an "Open the source
  transaction" link.
- **Words instead of codes.** A fixed asset says Straight line, a bill payment
  says ACH, Setup → Users says Firm admin. Quantities read 1, not 1.0000.
  AI → Coding Rules shows vendor names with capitals. The search box says Ctrl K.
- **No ids on screen.** Inventory → Shipping Labels: the For column reads
  "Invoice INV-..." or "Sales order SO-..." and opens it. Accounting → Receipts:
  real file names and a Record column in words. A fixed asset's page shows account
  names, and its depreciation history has an Open entry link.
- **Table headers.** Open Customers or Vendors: every column header is in
  capitals. The sortable ones were not.
- **Three pages restyled.** Open an employee, a fixed asset and a purchase order.
  Each has the same header, tiles and ⋯ menu as an invoice; Delete and Void are
  under ⋯.
- **Reversing entries on the P&L.** Switch to Blue Widget Co. Net income on
  Reports → Profit & Loss equals the Balance Sheet's. It was off by 7,500.00,
  because a month-end accrual counted and the entry reversing it did not.
