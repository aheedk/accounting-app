# Credit card statements and check stub matching — Design Spec

**Status:** Implemented 2026-10-04. Both items come from the 2026-10-01 meeting
(`docs/meetings/2026-10-01-follow-ups.md`, open items 1–2 and the check stubs item).

## 1. Credit card statement upload

### Goal

Upload a credit card statement to the AI inbox, choose which card it belongs to, code
each charge to a category, and post it — with the card's payable account on the other
side, the same way bank statements post against the bank account.

### Decisions

- **One pipeline with bank statements.** A card statement is stored in
  `email_import_staging` like a bank statement, with `statement_kind = 'credit_card'`
  (migration `0081`). The review screen, coding engine, learning and approve route are
  shared; only the account and the meaning of each line differ.
- **Recognised by the AI.** The extraction prompt gains a `credit_card_statement`
  document type. Each line is a `charge` (purchase, fee, interest), a `payment` (money
  paid toward the card), or a `refund` (return or statement credit). The card's issuer
  name and last four digits are kept to preselect the right card account.
- **Stored in the bank-statement shape.** At ingest a charge becomes an outflow and a
  payment or refund an inflow (`type` `expense` / `deposit`), with the card meaning kept in
  `card_type`. The account side of every entry is the card (a liability), so a charge
  credits the card and debits the category; a payment or refund debits the card.
- **What each line becomes once posted:**
  - charge → an Expense paid by credit card (`payment_method = 'credit_card'`), shown in
    the ledger as **Credit Card Expense**;
  - refund → a **Credit Card Credit** (card debited, category credited);
  - payment → a **Credit Card Payment** (card debited, bank account credited).

  Refunds and payments stay imported entries, editable on `/transactions/:id`.
- **Choosing the card.** For card statements the account picker lists liability
  accounts with the Credit Card detail type first, then any other liability. The
  statement's issuer / last four are matched against card account names to preselect.
  The approve route rejects a non-liability account for a card statement.
- **Payment lines code to the bank, not the card.** The coding engine's
  credit-card-payment rule points at the card, which is the statement's own account
  here. For a card statement's payment lines the suggestion is the client's bank account
  instead (the only one, or the one whose name the description mentions).
- **The same payment is never posted twice.** A card payment shows on both statements:
  the bank's ("CHASE CARD PAYMENT") and the card's ("PAYMENT RECEIVED"). Before posting,
  each line is checked for a posted entry from another document that already moves the
  same amount between the same two accounts within 5 days. Matches are marked **Already
  recorded**, link to that entry, and are unticked by default. This covers transfers
  between a client's own bank accounts too.
- **Bank statements: card payments to the right card.** The existing rule now prefers
  the card whose name matches the issuer in the description (Chase, Amex, Capital One…)
  when a client has several cards.

## 2. Check stub matching

### Goal

A bank statement says "CHECK 1042 · $1,250.00" and little else. Accountants get the
client's check stubs (or check register or check images) to learn the payee and purpose.
Upload those, and fill each check's payee and category automatically.

### Decisions

- **Uploaded like any other document.** PDFs and images (PNG, JPEG) go into the same
  AI inbox drop zone. A new `check_stubs` document type extracts each check's number,
  date, payee, amount, memo and suggested category.
- **Kept as their own records.** Extracted stubs are saved in `check_stubs` (migration
  `0081`), one row per check, with the source file kept for reference. A stub is
  `unmatched` until it is used.
- **Matching rule.** A stub matches a statement check line when the check numbers are
  equal and the amounts agree to the cent. With no check number on the statement line, a
  stub matches on amount alone only when exactly one unmatched stub has that amount
  within 60 days. Check numbers are read from the line's `check_number` field (now
  extracted for bank statements) or from its description ("CHECK 1042", "CHK #1042").
- **On the statement review screen** a matched check line shows the stub, and its payee
  and category are prefilled from it. The category comes from the stub's suggestion,
  falling back to the vendor's default or the client's coding history. Approving the
  statement marks the stub matched to the posted entry.
- **Checks that were already posted.** The Check stubs tab lists every stub; an
  unmatched stub whose check is already in the books (an imported check with the same
  number and amount) offers **Apply**, which sets that expense's payee, memo and, if
  chosen, category through the expense service, and marks the stub matched.
- **Nothing posts from a stub on its own.** Stubs only describe checks that the bank
  statement proves cleared.

## 3. Long statements and several accounts in one file

A bank's monthly PDF is often scanned and holds more than one account (for
example checking and savings, 20 pages, ~160 lines). Two things follow:

- **Room to read it.** Extraction streams the response with `max_tokens`
  48000 instead of a fixed 8192 (which cut the JSON off mid-way and made the
  file read as "unknown"). The per-line running balance is no longer asked
  for, since nothing used it. If the output still runs out,
  `ExtractionTooLongError` becomes a clear message asking for the PDF to be
  split. The API's request timeout is 15 minutes, since a long statement takes
  ~3 minutes to read.
- **One statement per account.** The model lists `accounts` (name, last 4) and
  tags each line with `account_last4`. `statementImportService.splitByAccount`
  turns that into one inbox statement per account, titled with the account
  (`account_hint`). Emailed files do the same; only the first statement keeps
  the `gmail_message_id`, which is unique and marks the email as seen.
