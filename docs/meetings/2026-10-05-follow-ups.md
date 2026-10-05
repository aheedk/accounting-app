# Meeting follow-ups — 2026-10-05

Requests taken from the meeting recording transcript, checked against the code on
`main`. Items are numbered straight through so they can be divided up ("I'll take
1–6, you take 7–12"). Parts of the recording were unclear or not in English; the
last section lists what could not be made out.

**Dates set in the meeting**

- **November 1, 2026** — Faizan's team starts using the app for actual clients.
- **January 1, 2027** — planned launch to outside customers.

Owner is who was asked or who volunteered in the meeting; "open" means nobody was named.

## A. Asked for in this meeting — to do

| # | Request | What the code does today | Owner |
|---|---|---|---|
| 1 | **Journal entry amounts with commas and two decimals** (9,000.00), the same as the rest of the app | The debit and credit boxes are plain number inputs (`JournalEntryEditor.tsx:514`, `:526`), so they show `9000`. Totals underneath are already formatted. | Aheed |
| 2 | **Typing 9 becomes 9.00** when you tab out of an amount box. Asked for on the journal entry; apply to every amount box | Not done; the box keeps exactly what was typed. Same inputs as item 1, so do both together. | Aheed |
| 3 | **Journal entry: put Delete under a "More" button**, as QuickBooks does. The "are you sure" prompt stays | Delete is its own button in the bottom bar (`JournalEntryEditor.tsx:652`); the confirmation is there. Bank Deposit already has a More menu to copy. | Aheed |
| 4 | **Attachments on bank deposits do not work** (Faizan; they work on checks) | An Attachments area is on the Bank Deposit form (`BankDepositPage.tsx:946`), so this is a bug to reproduce, not a missing feature. Not reproduced yet. | Aheed |
| 5 | **Statement review: the bank account picker should list only bank accounts**, not most of the chart | It lists every asset account except Suspense (`EmailImportReviewPage.tsx:561`). Should be accounts whose type is Bank (Checking, Savings, Money Market, Cash on hand, Trust...). | Aheed |
| 6 | **Card statement: the payment line should not go to the bank account.** See "The card payment decision" below | Payment lines are coded to the client's bank account (`cardPaymentSourceAccount`), with a check for the same payment already posted from the bank statement. | Aheed |
| 7 | **Checks on a bank statement should get their category from the stub's description** ("food" on the stub means a food account), not land in Suspense | Partly done. A matched stub fills payee and memo, but the category only fills when the AI's suggested account name matched an account in the chart (`emailImports.ts:171`). A stub that says "food" with no matching suggestion still leaves the check in Suspense. Fix: run the stub's payee and memo through the coding engine when there is no direct match. | Aheed |
| 8 | **Test check stubs against the statement they belong to.** The stubs and the statement used so far are from different companies, so every stub shows Unmatched | Nothing to build until the files arrive. | Faizan sends a statement and its stubs; Aheed tests |
| 9 | **New account panel leaves a sliver at the top** instead of reaching the top of the window | Small layout bug in `AccountCreateDrawer.tsx`. Aheed raised it himself. | Aheed |
| 10 | **Bank deposit print should open a preview first**, as QuickBooks does, instead of going straight to download or print | Three print options exist (slip and summary, summary only, alignment test). No preview step. | Riham |
| 11 | **Make recurring on a bank deposit is untested.** Riham built the popup but has not seen what a recurring deposit should look like | Popup is on `main`. Needs Faizan to say what is expected, then a test. | Riham, Faizan |
| 12 | **"+ New" menu: copy QuickBooks completely.** The answer in the meeting was "pretty much, yes" | Riham kept the older entries and added the missing ones (Bank deposit). Remove whatever QuickBooks does not have. | Riham |
| 13 | **Bank Deposit → More: Copy and Audit history** | Both show a "coming soon" message (`BankDepositPage.tsx:1072`, `:1105`). Not raised aloud, but visible in the menu that was demoed. | Riham |

### The card payment decision (item 6)

This took the longest in the meeting and ended with "Aheed, make that change", so
the reasoning is written out.

- **Today:** on a card statement the payment line (`PAYMENT RECEIVED 3,671.29`) is
  coded to the operating bank account: debit the card, credit the bank.
- **The firm's point:** the bank statement already records that payment as debit
  Amex payable, credit cash. The charges on the card statement credit Amex
  payable. So the card account is already complete from those two documents, and
  the card statement should not touch the bank account at all.
- **Faizan's worry:** recording the payment from both statements counts it twice.
  The firm's answer was that it only doubles if the card statement posts to the
  bank, which is exactly what should stop.
- **What was asked, literally:** the payment line should show the card account
  chosen at the top of the statement (the test account created in the meeting was
  "Amex Payable 9001", type Credit Card), and the bank statement's payment should
  go to that same account.
- **How to build it:** a line that debits and credits the same account does
  nothing, so the payment line on a card statement should simply not post. It
  shows the card account, is marked as recorded from the bank statement, links to
  that bank entry once it exists, and is unticked. The "already recorded" check
  that exists today becomes the normal case instead of the exception.
- **One thing to confirm with the firm:** if the bank statement for that month is
  never uploaded, the card balance stays too high by the payment. Suggested
  answer: show such payments as "waiting for the bank statement" so they are
  visible. Update `docs/specs/2026-10-04-card-statements-and-check-stubs-design.md`
  in the same change.

## B. Decided in the meeting — no work

14. **Keep our sidebar layout.** QuickBooks shows a section's pages as tabs across
    the top; ours opens one full page. Riham raised switching; the group kept ours.
15. **Keep the Check stubs tab** in the AI inbox (Statements, Invoices, Check stubs,
    History). It was asked whether it is needed; nobody wanted it removed.
16. **"Memo" stays "Memo"** on check stubs; no rename to Description.
17. **Payroll stays in the sidebar for now** and "will end up being taken off". The
    reason given was that there is no payroll module, but the app does have one
    (Overview, Employees, Contractors, Taxes, Compliance, with manual tax entry).
    Worth showing the firm before anyone removes it.
18. **Clicking anywhere on a General Ledger row opens the transaction.** Aheed
    offered to undo it; the answer was to keep it.
19. **A few wrong letters on handwritten stubs are acceptable.**
20. **The "Due from Employees" account was not treated as a system problem.** Riham
    said the AI created accounts while reading a made-up bank statement. On `main`
    the only place an account can be created is the Chart of Accounts screen and
    the Add new account option, so the AI inbox did not create it. If it happens
    again, note which screen was open.

## C. Shown and accepted

Everything below was demonstrated and accepted with no further request: opening
entries from the General Ledger, journal entry delete with its confirmation, Save
and close / Save and new, description and amount carried to the next journal
line, two-digit years, the ledger keeping its date range, Debit and Credit
columns, check number, memo and attachments on expenses, check stub upload and
reading, editing an account's number, Add new in dropdowns, arrow keys, company
switch opening the dashboard, the stale-tab screen, the Chart of Accounts pager,
the PDF export matching the page, Suspense, and the credit card statement upload
itself (apart from item 6).

From Riham: bank deposit More menu with separate Void and Delete, print options,
the history panel, "View more" with date range and type filters, the search bar
update, and the fix for pages that took 10–15 seconds to load.

## D. Carried over from 2026-10-01 — still not done

| # | Item | State |
|---|---|---|
| 21 | **Vendor dropdown in the AI inbox.** The Name column should be a dropdown of the client's vendors, with the AI matching the name it read ("Duke Power" to "Duke Energy") | Still free text. Riham said "I'll fix that" on 10-01; not raised today, owner still unconfirmed. |
| 22 | **Check stub matching tested with real files** | Still blocked on files; now item 8. |
| 23 | **Suspense: reclassify a few real lines** from AI → Suspense | Not done. Shown today only in passing. |
| 24 | **Credit card statement with a real statement** | Only the sample Amex statement has been used. Do after item 6. |
| 25 | **Linking bank and credit card accounts** for daily feeds | Confirmed again today ("we should have that too"). Needs an outside service and an account with it before any code. Now item 31. |
| 26 | **Pay stubs** | Promised on 10-01 for this meeting. Nothing in the code, not mentioned today. |
| 27 | **Reconciliation** | Still waiting on bank linking. |
| 28 | **Report period presets** | Riham said they were untested and their definitions unfinished. Not mentioned today. Fold into item 30. |
| 29 | **QA audit fixes** (`docs/qa/2026-09-28-app-audit.md`) | Aheed said today he has read it but not worked on any. 8 are marked "wrong numbers or broken behaviour", including invoice due dates, the 1099 report and Profit & Loss net operating income. These matter before November 1. The plain-English walkthrough asked for on 10-01 has not happened either. |

Also still open from 10-01, not code: sample checks for the "Timeout" client,
cleaning test entries out of a real company (the Delete button now allows it),
and Faizan's video of further changes (he said again today he has many points and
will record or send them).

## E. New features raised today

| # | Feature | Notes |
|---|---|---|
| 30 | **Put every report up, then review them together** | Reports in the app now: Trial Balance, General Ledger, Aging, Profit & Loss, Balance Sheet, Cash Flow, 1099, Custom, Management, Performance. The audit says Management Reports shows $0 revenue and P&L net operating income is wrong, so fix those first. |
| 31 | **Bank account connection** so transactions arrive on their own | Same as item 25. Nothing in the code. |
| 32 | **Purchase order upload → sales invoice.** Upload a customer's purchase order in the AI inbox and it becomes an accounts receivable invoice | New document type alongside statements, invoices and stubs. Nothing in the code. |
| 33 | **Stripe, two separate uses.** (a) Clients pay their vendors from the app instead of writing checks. (b) We get paid by customers for the software | Nothing in the code. Needs a Stripe account first. Paying vendors on a client's behalf moves other people's money, so check what Stripe requires for that before designing it. |
| 34 | **Modules per client, priced separately.** Bookkeeping at one price; Accounts Receivable, Accounts Payable and the rest at another | Nothing in the code. Needs a per-company list of enabled modules that hides sidebar sections and blocks their routes. |
| 35 | **Sign in with Microsoft 365 or Google** | Nothing in the code; login is email and password. (The Google connection that exists is only for reading the firm's Gmail inbox.) |
| 36 | **One login with the practice management software.** Staff signed in there should reach the accounting app without a second login | Design together with item 35. |
| 37 | **Security review and testing.** Nobody can see another company's data; one person can have several companies; database encryption was mentioned; "various levels of security" | Company separation and four roles exist. No dedicated security test pass has been done. The firm's view: needed before selling outside, less so for internal use. Aheed's view: do it anyway. |
| 38 | **Mobile app** | Agreed to leave for last. |
| 39 | **Moving the practice management software off Base44.** Some of its database and backend features are Base44's own, so everything has to be confirmed working before Base44 is dropped | Separate project from this repo. Someone said "I'll work on that" and described cloning the code; the speaker is not clear. |

## F. Working together

- **The same work was done twice.** Aheed and Riham both built the expense
  click-through from the General Ledger and both worked on bank deposits. Agreed:
  split the work by item number from this list.
- **Riham's "vanished" changes.** She said several of her changes disappeared
  after a merge and her localhost had an error after pulling. What the repo shows:
  her branch `origin/riham` and `origin/main` are the same commit, so nothing of
  hers is waiting on GitHub. Her bank deposit More menu, print options and Make
  recurring popup are on `main`. Anything still missing exists only on her
  machine, or was overwritten in a merge and has to be found in her local history
  before it is redone.
- **Speak English in meetings** so the transcript can be used.
- **Faizan:** thorough testing, and keep sending findings (video is fine).

## G. Suggested split

- **Aheed:** 1–9 (journal entry polish, attachments bug, bank picker, card
  payment, stub categories, account panel), then 29 and 30.
- **Riham:** 10–13 and 21.
- **Faizan:** files for item 8, expected behaviour for item 11, testing, 23, 24.
- **Needs a decision from the firm before work starts:** 33, 34, 35–37, and
  whether payroll (17) and pay stubs (26) are still wanted.

For November 1 the list that matters is A, plus 21, 29 and 30. Everything in E
except the report review is January work or later.

## Could not make out

- **"What is the VIA for"** on the purchase order line of the weekend list. Nobody
  in the meeting knew either.
- **The product or company name.** Spelled out letter by letter, then heard as
  "Mathematica" and "amatica". It was said the same name could serve for the
  product and the company, and someone will check whether it is available. On
  10-01 "Acumatica" was heard, which is an existing accounting product. Get the
  spelling in writing.
- **"You can host Azure"**, said during the mobile app item.
- **"Should be updated because in banks it shows account and for other assets it
  shows other assets"**, about the bank account type. The firm could not recall
  the original point; the discussion ended at item 5, which may be all of it.
- **Riham's QuickBooks rules.** She described giving Claude a lot of QuickBooks
  material through an add-on and getting "a bunch of rules" that she cannot
  explain and wants Faizan to test. It is not clear what these rules changed or
  where they live.
- **Sections not in English** during the check stub and credit card discussions.
  Items 6 and 7 are built from the English parts on either side.
