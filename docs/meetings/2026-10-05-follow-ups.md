# Meeting follow-ups — 2026-10-05

What was asked for in the meeting, checked against the code. Updated 2026-10-08.
Anything still open here is carried into
[`2026-10-10-follow-ups.md`](./2026-10-10-follow-ups.md) with the same item
number; work from that file.
Item numbers are fixed so they can be divided up; **(10-01)** marks items left
over from the previous meeting. Aheed's demo for this meeting is
[`../demos/2026-10-10-aheed.md`](../demos/2026-10-10-aheed.md).

- **November 1, 2026** — Faizan's team starts using the app for actual clients.
- **January 1, 2027** — planned launch to outside customers.

## To do before November 1

| # | What | Owner |
|---|---|---|
| 17 | QA audit (`docs/qa/2026-09-28-app-audit.md`): done, apart from emailing an invoice, Estimate, and three decisions for the firm; see "Audit: what is left" below **(10-01)** | Aheed, firm |
| 18 | Review the reports with the firm. They are all up and agree with each other; see "Reports" below | Aheed, firm |
| 11 | Make recurring on a bank deposit: Faizan says what is expected, then test it | Riham, Faizan |
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
- **What each role may do.** The other roles were tested on 10-08
  (`docs/qa/2026-10-08-role-audit.md`). Five things need the firm's answer:
  - Staff can record expenses, checks and deposits, which post at once. There is now
    an approval step that makes those wait for an accountant. It is off. Should it be
    on for the firm's clients?
  - Staff can add a customer but not edit one.
  - An accountant cannot add an employee, a bank account or a tax code.
  - What a client should see. It now gets invoices, bills, statements, six reports and
    messages, and can send documents in.
  - Who may connect the firm's Gmail. Today anyone who can reach the API can.
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
| 28 | Security review and testing. Roles were covered on 10-08 (`docs/qa/2026-10-08-role-audit.md`), and what that audit found missing is built: switching a login off, passwords, a limit on wrong passwords, two-step sign-in, sessions. A full review is still to do; one open hole is that connecting the firm's Gmail needs no sign-in |
| 29 | Mobile app, last |
| 30 | Moving the practice management software off Base44 (separate project) |

## Not code

- Faizan: keep testing and send findings (video is fine).
- Sample checks for the "Timeout" client **(10-01)**.
- ~~Clean the test entries out of the real company **(10-01)**.~~ Done by Riham on
  10-08: the August test activity for TIME OUT is removed.
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
| 12 | "+ New" menu follows QuickBooks: Check, Statement and Sales order under Customers, Purchase order under Vendors, and Other runs deposit, transfer, journal entry, product or service | Aheed, `8ebcbdb` and 10-08 |
| 10 | Bank deposit print: the preview opens inside the app, with the print and download buttons in it. Write Check prints the same way | Aheed, 10-08 |
| 13 | Write Check: the Order checks link is taken out (there is nowhere to order checks from) | Aheed, 10-08 |
| 31 | Customers: tick boxes with batch Email and Make inactive, a "Show inactive customers" switch, and Delete only for a customer with no transactions. Same rules as Vendors | Aheed, 10-08 |
| 32 | Transactions page lists invoices, bill payments and vendor credits, and sorting a column sorts the whole list, not the 25 rows on screen | Aheed, 10-08 |
| — | Role audit: a client login sees only its reports and invoices (it could read almost everything), menus and buttons follow the role, a firm admin keeps every client after a reload | Aheed, `5afc8e5`, `1a69563`, `388cf49`, `648c399`, `c79c9eb` |
| — | Signing in: switch a login off, change or reset a password, a hold after five wrong passwords, two-step sign-in, see and end sessions | Aheed, `e4be47a`, `497fe6d` |
| — | A View only role; payroll can be closed to a login; Activity Log; buttons a role cannot use are off every page | Aheed, `ca7a526`, `7d7b18c`, `8b9b906`, `7862b1c` |
| — | Approval step: staff entries can wait for an accountant (off until a firm admin turns it on for a company) | Aheed, `2d47079`, `3e159c8` |
| — | For a client: send documents, see bills, messages with the firm. Customer statements for everyone | Aheed, `6c49cc2`, `7175ef7`, `007f22c` |

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

After pulling, run `npm run db:migrate` (migrations `0084`–`0096`).

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
