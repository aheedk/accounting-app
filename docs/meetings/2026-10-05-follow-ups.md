# Meeting follow-ups — 2026-10-05

What was asked for in the meeting, checked against the code. Updated 2026-10-07.
Item numbers are fixed so they can be divided up; **(10-01)** marks items left
over from the previous meeting. Aheed's demo walkthrough is at the bottom.

- **November 1, 2026** — Faizan's team starts using the app for actual clients.
- **January 1, 2027** — planned launch to outside customers.

## To do before November 1

| # | What | Owner |
|---|---|---|
| 17 | QA audit bugs (`docs/qa/2026-09-28-app-audit.md`). 7 of the 8 serious ones are fixed. Left: inventory never reaches the ledger (a larger job), then the less serious lists **(10-01)** | Aheed |
| 18 | Put every report up and review them together. The 1099, Management and Profit & Loss numbers are fixed, so this can go ahead | Aheed |
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
