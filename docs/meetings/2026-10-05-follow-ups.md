# Meeting follow-ups — 2026-10-05

What was asked for in the meeting, checked against the code. Updated 2026-10-07.
Item numbers are fixed so they can be divided up; **(10-01)** marks items left
over from the previous meeting. Aheed's demo walkthrough is at the bottom.

- **November 1, 2026** — Faizan's team starts using the app for actual clients.
- **January 1, 2027** — planned launch to outside customers.

## To do before November 1

| # | What | Owner |
|---|---|---|
| 17 | QA audit (`docs/qa/2026-09-28-app-audit.md`): every bug and wrong number is fixed. What is left is listed under "Audit: what is left" below, and all of it needs a decision before it is built **(10-01)** | Aheed, firm |
| 18 | Review the reports with the firm. They are all up and agree with each other; see "Reports" below | Aheed, firm |
| 10 | Bank deposit print: show a preview first, like QuickBooks | Riham |
| 11 | Make recurring on a bank deposit: Faizan says what is expected, then test it | Riham, Faizan |
| 12 | "+ New" menu: match QuickBooks exactly | Riham |
| 13 | More menu: Copy and Audit history on Bank Deposit, and Audit history on Journal Entry, still say "coming soon" | Riham |
| 31 | Customers: the same batch actions, inactive switch and delete rule as Vendors | Riham |
| 32 | Transactions page: add invoices, bill payments and vendor credits; sorting only covers the rows on screen | Riham |
| 33 | Vendor menu: Email and "Ask vendor for info" still say "coming soon" | Riham |
| 14 | Test check stubs with a statement and stubs from the same client **(10-01)** | Faizan sends files, Aheed tests |
| 15 | Suspense: reclassify some real lines **(10-01)** | Faizan |
| 16 | Test a real credit card statement **(10-01)** | Faizan |

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

- **Inventory never reaches the ledger.** The last serious one. It needs three
  answers first (how receipts post, average cost or first-in-first-out, what to do
  with stock already entered): `docs/specs/2026-10-07-inventory-ledger-design.md`.
- **Features, each a job of its own:** run payroll from the app, AI suggestions on
  Bank Transactions, editing posted invoices, emailing an invoice or saving it as a
  PDF, cost centers, Transfer and Estimate, searching customers and invoices, paying
  several vendors' bills at once.
- **Look and naming:** unstyled Fixed Asset, Purchase Order and Employee pages, a
  fuller dashboard, mixed table header capitals, the two Contractors pages, the two
  rule systems, and the name "Spreadsheet Sync".

**Questions for the firm**

- **Card payments (item 6).** A payment on a card statement is no longer posted
  from the card statement; the bank statement records it. If that bank statement
  is never uploaded, the card balance stays too high by the payment. Is that
  acceptable, or should there be a way to post it from the card statement anyway?
- **1099 and card payments.** Payments made to a contractor by card are now left
  off the 1099, because the card processor reports them on a 1099-K. Confirm that
  is how the firm files.
- **Pay stubs (22) and payroll.** Are pay stubs still wanted, and does Payroll
  stay in the sidebar?
- **Inventory.** The three answers in the inventory proposal, if inventory is to be
  used for clients at all this year.

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

Audit bugs fixed (part of item 17), all Aheed:

| What | Where |
|---|---|
| AI inbox no longer fills in an account the coding engine did not accept | `6f79a03` |
| A new invoice's due date follows its terms and the customer's default terms | `55b09ed` |
| 1099 report counts expenses and checks paid to contractors; card payments left out | `085d093` |
| Management Reports shows revenue by month (every month read 0.00) | `8d33f9a` |
| Net Operating Income on the Profit & Loss takes operating expenses off | `95b12eb` |
| Bank Transactions → Categorize starts with no account chosen | `614d5d4` |
| A/P Aging report; both aging reports split 61–90 / 91+ and equal the ledger | `5099ac8` |
| Statement of Cash Flows (operating, investing, financing) | `8ab2737` |
| P&L and three other reports count reversing entries | `bd80fcb` |
| Balance sheet still balances after year end; year to date follows the fiscal year | `f6101a7` |
| Client Overview and A/P Overview agree with the ledger | `556aeaa` |
| Payments, Credit Memos, Bill Payments and Vendor Credits open on This year | `7ed7be7` |
| Vendor page counts, Books Review month, recurring template amounts | `26e921a` |
| Fixed Assets says when the register and the ledger differ | `70a62f8` |
| Contractors → Create bill keeps the contractor; Copy link confirms; journal entry links to its source | `528485e` |
| Codes read as words, quantities lose their padding, Ctrl K on Windows | `c91f78a` |
| The auto-post switch saves (it never had); capitalization threshold has a setting | `34eee11` |
| Bank Accounts shows book balances; pages print without the sidebar and top bar | `c1f13f0` |

Also added by Riham since the meeting: Write Check (Accounts Payable → Checks),
the Transactions page, the table-settings gear on list pages, vendor batch
actions with active / inactive, and a fuller add-vendor popup in the AI inbox.

After pulling, run `npm run db:migrate` (migrations `0084`–`0088`).

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
click. Item 3 and the other Riham items are hers to show.

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

### Other fixes worth a minute

- **Auto-post switch.** AI → Coding Rules. Tick "Auto-post high-confidence
  transactions", reload the page: it stays ticked. (It never saved before.) The
  capitalization threshold is on the same card.
- **Bank balances.** Accounting → Bank Accounts has a Book balance column.
- **Printing.** Open any invoice → ⋯ → Print: the preview has no sidebar or top bar.
- **Fixed Assets.** Accounting → Fixed Assets shows an amber note that the register
  (43,000.00) and the ledger differ, with the amounts.
