# Meeting follow-ups — 2026-10-05

What was asked for in the meeting, checked against the code. Updated 2026-10-07.
Item numbers are fixed so they can be divided up; **(10-01)** marks items left
over from the previous meeting.

- **November 1, 2026** — Faizan's team starts using the app for actual clients.
- **January 1, 2027** — planned launch to outside customers.

## To do before November 1

| # | What | Owner |
|---|---|---|
| 5 | Statement review: the bank account picker lists only bank accounts, not every asset | Aheed |
| 6 | Card statement: the payment line must not post to the bank account (see note below) | Aheed |
| 7 | Checks on a bank statement take their category from the stub's memo ("food") instead of going to Suspense | Aheed |
| 8 | New account panel: close the gap at the top of the window | Aheed |
| 17 | Fix the QA audit bugs (`docs/qa/2026-09-28-app-audit.md`). 8 are serious: invoice due dates, the 1099 report, Profit & Loss **(10-01)** | Aheed |
| 18 | Put every report up and review them together, after 17 | Aheed |
| 10 | Bank deposit print: show a preview first, like QuickBooks | Riham |
| 11 | Make recurring on a bank deposit: Faizan says what is expected, then test it | Riham, Faizan |
| 12 | "+ New" menu: match QuickBooks exactly | Riham |
| 13 | More menu: Copy and Audit history on Bank Deposit, and Audit history on Journal Entry, still say "coming soon" | Riham |
| 31 | Customers: the same batch actions, inactive switch and delete rule as Vendors | Riham |
| 32 | Transactions page: add invoices, bill payments and vendor credits; sorting only covers the rows on screen | Riham |
| 33 | Vendor menu: Email and "Ask vendor for info" still say "coming soon" | Riham |
| 14 | Test check stubs with a statement and stubs from the same client **(10-01)** | Faizan sends files, Aheed tests |
| 15 | Suspense: reclassify some real lines **(10-01)** | Faizan |
| 16 | Test a real credit card statement, after 6 **(10-01)** | Faizan |

**Item 6, the card payment.** Today the payment line on a card statement posts
debit card, credit bank. The firm wants it to show the card account instead,
because the bank statement already records the payment. Build it so the payment
line on a card statement does not post at all and links to the bank statement's
entry. To confirm with the firm: if that bank statement is never uploaded, the
card balance stays too high, so show those payments as "waiting for the bank
statement".

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
| 9 | Vendor dropdown in the AI inbox, with the AI matching renamed payees **(10-01)** | Riham, `40d1214` |
| 19 | General Ledger fiscal-year presets use the client's fiscal year **(10-01)** | Riham, `e9acc5a` |

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
