# Meeting follow-ups — 2026-10-25

What was asked for in the meeting (Faizan, Riham, Aheed), taken from the
recording transcript and checked against the code on 2026-10-27. Item numbers
carry on from [`2026-10-21-faizan-video-2.md`](./2026-10-21-faizan-video-2.md)
(which ended at 91). Everything still open there and in
[`2026-10-16-follow-ups.md`](./2026-10-16-follow-ups.md) is carried into this
file and keeps its number. **(10-21)**, **(10-16)**, **(10-10)**, **(10-05)**
and **(10-01)** mark which meeting an item first came from.

- **November 1, 2026:** Faizan's team starts using the app, so it has to be
  hosted by then. Faizan's list for it is hosting, bugs and the financial
  reports. The iPhone and Android apps are not needed for November 1.
- **November and December:** bugs come in and get fixed.
- **January 1, 2027:** the app is sold on its own to outside customers.
- **Next meeting:** Wednesday 10-28 or Thursday 10-29, to be confirmed by text.
  Tuesday was too early.

Aheed's demo for this meeting is
[`../demos/2026-10-25-aheed.md`](../demos/2026-10-25-aheed.md). The second
security pass was read out, and the firm's "Require the second step" setting
was shown; Aheed said it still needs testing properly (item 96). The P&L and the
other fixes from Faizan's second video were mentioned, not shown. Riham showed
the reconciliation and the phone app.

## What changed in this meeting

- **Hosting: Supabase and Azure** (item 92). Faizan: money is not a factor.
  What matters is that it is secure, easy to manage and backed up. The database
  goes to Supabase as soon as possible. The API and the web app go to Azure,
  because the firm works in Office 365. Faizan creates the accounts and Aheed
  sets them up.
- **For November 1:** hosting, bugs and the financial reports. **All of
  QuickBooks' standard reports** are to be added (item 18).
- **Reconciliation matching:** Riham read out the rules (item 71), and Faizan
  agreed with all of them. The one change is the date window, from 3 business
  days to 4 (item 93).
- **A reconciliation is only finished at a zero difference** (item 94).
  Faizan: "you're not supposed to accept the difference".
- **Roles are to be customizable** (item 46). Faizan asked for roles like
  administrator, manager, partner and staff, each with its own access. Agreed:
  a firm can add a role, and change what any role can do, including the five
  there now.
- **Two products.** The app is sold on its own, with the phone apps, and also
  inside LedgerFlow. There, clients shouldn't feel they have left the system:
  - they switch between the two from icons at the top left;
  - they sign in once. The firm's people sign in to LedgerFlow and are not
    asked again by the accounting app.

  Long term; see items 26 and 27.
- **Colors: blue and white, no yellow,** so the app and LedgerFlow match.
  Riham was asked to leave the phone app's colors until then. Which of the two
  apps changes to match the other was left open.
- **The AI assistant is still wanted** (item 48), and was called "very
  important". Faizan: it should work like QuickBooks', saying how to do
  something or linking to the page.
- **After January 1:**
  - **Team:** a support person, possibly hired in Pakistan; Aheed and Riham as
    developers; and a salesperson in the US.
  - **Marketing:** Faizan asked for a marketing plan (item 97).
  - **Pricing:** free months, three to six, may be needed to win people over.
    The AI coding is the edge over QuickBooks.

## To do before November 1

| # | What | Owner |
|---|---|---|
| 92 | **Hosting.** The database (and uploaded files) to Supabase, as soon as possible; the API and the web app to Azure. Faizan creates both accounts in the firm's name and gives Aheed access. Aheed sets them up and does a trial run while Railway stays live, then switches over one evening. The repo side is ready: [`../plans/2026-10-25-azure-supabase-move.md`](../plans/2026-10-25-azure-supabase-move.md). Covers what is left of 43 | Faizan (accounts), Aheed |
| 18 | **All of QuickBooks' standard reports**, then a review of them with the firm. Ten were on Reports → Standard Reports; nine more were added 10-26, and Account List, Customer/Vendor Balance Summary, Open Invoices, Unpaid Bills, A/R and A/P Aging Detail, Customer/Vendor Balance Detail and seventeen from the ledger on 10-27 (below). Left: sales by product/service — needs line-item data the General Ledger doesn't carry, so it isn't a quick one (Riham); the reports from the lists (Aheed); sales tax and exceptions to closing date. See "Reports" below **(10-05)** | Riham |
| 96 | Go through the second security pass on the live site, as demo steps 1 to 3 have it: a new login choosing its own password, a role taken away, requiring the second step. Aheed: "I didn't fully test this" | Aheed |
| 95 | Test the reconciliation (the matching, and item 72's statement upload) on a client whose books are complete for the period. Riham's test data has gaps, so its difference cannot reach zero | Faizan |
| 34 | Faizan's PDF and the check stubs from the Teams chat are still to go through. Both videos are written up **(10-10)** | Aheed |
| 36 | Pay bills prints checks (built 10-13). Left: Faizan confirms the check stock the firm prints on, and a test print is lined up against it **(10-10)** | Aheed, Faizan |
| 37 | Year end (built 10-13). Left: ask Faizan whether he wants a posted closing entry as well **(10-10)** | Aheed, Faizan |
| 43 | Backups: take the first production backup and prove it restores. Uploaded files are in no backup until they move to Supabase (92) **(10-10)** | Aheed |
| 44 | Card payment "waiting for the bank statement": test both orders **(10-10)** | Faizan |
| 84 | Which account showed as a liability on the P&L, and on which client **(10-21)** | Faizan |
| 90 | Which screen the bank was missing from, and the bank account's name **(10-21)** | Faizan |
| 17 | QA audit: emailing an invoice (item 47) and two decisions for the firm **(10-01)** | Aheed, firm |
| 11 | Make recurring on a bank deposit: Faizan says what is expected, then test it **(10-05)** | Riham, Faizan |
| 14 | Test check stubs with a statement and stubs from the same client **(10-01)** | Aheed |
| 15 | Suspense: reclassify some real lines **(10-01)** | Faizan |
| 16 | Test a real credit card statement **(10-01)** | Faizan |

### Notes on the items

**Hosting (92).** Aheed's research said Supabase was the clear gain: the data
is the heavy and sensitive part. Azure would do much what Railway does. Faizan
chose Azure for the hosting anyway, so it sits with the firm's Office 365.
Faizan asked about backups; every option backs up and is well tested, so ease
of use decides. Supabase's Pro plan backs up daily.

In the meeting, Faizan was to pass the logins to Aheed. Both services can add
Aheed as a member instead, with a separate sign-in, so the firm's password
stays with the firm. The plan asks for that on Azure: the Contributor role on
the resource group.

Aheed said Supabase could go first and Azure after. The plan moves both on one
evening, but the database could also move first, with Railway's API pointed at
it.

**Reconciliation (93 to 95).** These are the rules from the 10-16 notes, item
71, as read out in the meeting:

- the exact same amount;
- dated at most 4 business days apart (3 until item 93);
- money in only matches money in;
- a shared word breaks a tie, then the closest date;
- a tie that is left is not ticked;
- each line is used once;
- only approved statements are used;
- a statement counts when it ends within 10 days of the reconciliation's date.

Faizan's only change was 3 business days to 4 (done 10-26). Riham said the rest of the logic
needs Faizan to test it (95). Riham also said the slow start (75) is fixed.

**Reports (18).** Reports → Standard Reports listed ten:

- Business overview: Profit and Loss, Balance Sheet, Statement of Cash Flows.
- For my accountant: General Ledger, Trial Balance, Cash Activity by Account,
  Reconciliation Reports.
- Who owes you, what you owe, and vendors: A/R Aging Summary, A/P Aging
  Summary, 1099.

QuickBooks has several dozen. The ones accountants reach for most come first:
- P&L Detail, by Month and Comparison;
- Balance Sheet Detail and Comparison;
- Journal;
- Transaction List by Date;
- Account List;
- Customer and Vendor Balance;
- A/R and A/P Aging Detail;
- Open Invoices and Unpaid Bills;
- Sales by Customer and by Product/Service;
- Expenses by Vendor;
- Deposit and Check Detail;
- Sales Tax Liability.

**Roles (46).** On 10-10 this waited on a list from the firm of what each kind
of user should do. Faizan now wants the firm to set that up itself:

- add a role;
- tick what it can do;
- change the existing roles the same way.

Today a role is a level (firm admin > accountant > staff > viewer > client),
and the API checks "at least staff" and so on. Custom roles mean checking named
permissions instead, so this needs a spec first.

## After November 1, before January 1

| # | What | Owner |
|---|---|---|
| 46 | Custom roles: add a role, and change what any role can do, including the five there now. See "Roles" above **(10-10)** | Aheed |
| 48 | The AI assistant. **Built 10-25** (below). Left: Faizan's sample questions, which Riham asked for, and Faizan tries it **(10-10)** | Riham, Faizan |
| 97 | A marketing plan: ask AI how best to market an accounting app like QuickBooks. To go through in a meeting or two | Aheed, Riham |
| 28 | Security before outside customers: enforce the web app's script policy, a standby database, and an outside security test. The `xlsx` spreadsheet reader is replaced (10-27, below) **(10-05)** | Aheed |
| 29 | Phone app. Not needed for November 1. Left: a way for Faizan to test it, the same design on iPhone and Android, and how QuickBooks' phone app handles journal entries (debits and credits may not fit a phone) **(10-05)** | Riham |

## Needs something from the firm first

| # | What | Needed |
|---|---|---|
| 47 | Send email from the app through the user's own mailbox **(10-10)** | Google and Microsoft app registrations, which need the company name |

## Later

| # | What |
|---|---|
| 27 | One sign-in shared with LedgerFlow, and icons at the top left to switch between the two, so a client doesn't feel they left. Security-wise, two products: the standalone one, with the phone apps, and the one inside LedgerFlow **(10-05)** |
| 26 | Sign in with Microsoft 365 or Google **(10-05)** |
| 79 | Stripe on invoices: a "Pay now" link **(10-16)** |
| 80 | Pay bills from the app, as Bill.com does **(10-16)** |
| 81 | A different dashboard and menus for each job **(10-16)** |
| 20 | Bank account connection **(10-01)** |
| 21 | Reconciliation against a connected bank, after 20 **(10-01)** |
| 24 | Stripe: clients pay their vendors from the app, and we get paid for the software **(10-05)** |
| 25 | Modules per client, priced separately **(10-05)** |
| 49 | A payroll partner, if payroll is ever offered **(10-10)** |

## Not code

- **Faizan creates the Supabase and Azure accounts** in the firm's name and adds
  Aheed (92). Aheed starts as soon as they exist.
- **Keep a copy of the secrets outside Railway**, `FIELD_ENCRYPTION_KEY` above
  all, in the firm's password manager. This was in the demo and was not
  reached.
- **After January 1:** a support person, a salesperson in the US, and a price.
  QuickBooks' price was guessed at $20 to $30 a user; check it for the marketing
  plan.
- **Mask account numbers on test statements**, keeping the last four digits
  **(10-16)**.

## Done

Reported in the meeting:

| # | What | Who |
|---|---|---|
| 71 | The matching rules, read out and agreed, apart from the window (93) **(10-16)** | Riham |
| 29 (part) | The phone app redesigned after QuickBooks' (10-24). The side menu is gone, because a computer layout on a phone looked wrong; there are tabs along the bottom, a More menu, and a floating + button for creating. Transactions are listed with filters, receipts and statements upload to the AI inbox, and it reads the real data. Faizan liked it | Riham |
| 83, 85 to 89, 91; 28 | Faizan's second video, the out-of-date live site (fixed 10-22), and the second security pass. See the demo | Aheed |

### Done since the meeting

| # | What | Who |
|---|---|---|
| 48 | **The AI assistant** (10-25). "Ask Accmatica", a button in the corner of the app. It answers questions about the client's numbers, read only. It drafts a journal entry, expense, invoice or deposit and opens it in the usual form to check and save, and never saves anything itself. It answers how-to questions | Riham |
| 72 | **Reconciliation, from the statement** (10-26). A statement can be uploaded on the reconciliation page, then reviewed and approved there without going to the AI inbox. The ending balance and date are filled from the latest approved statement. The worksheet shows each statement line as matched or not. A fix: items ticked at Start were left out when the matching ran again on reload. Riham shows it at the next meeting; Faizan tests it (95) **(10-16)** | Riham |
| 93 | **Matching window: 4 business days** (10-26). A book transaction and a statement line can now be up to 4 business days apart, not 3 | Aheed |
| 94 | **Finished only at a zero difference** (10-26), on the web, in the phone app and in the API. "Accept difference and finish" posted an adjusting entry to Opening Balance Equity; it is gone, and the message says to check the ticked items and the ending balance, or save for later. A reconciliation already finished that way keeps its entry, and undoing it still voids the entry | Aheed |
| 18 (part) | **Nine more standard reports** (10-26), on Reports → Standard Reports: Profit and Loss Detail, by Month and Comparison; Balance Sheet Detail and Comparison; Journal; Transaction List by Date; Sales by Customer Summary; Expenses by Vendor Summary. Each is worked out from the General Ledger, the P&L or the Balance Sheet, so it ties out to them, and each has Excel and Print. Spec: [`../specs/2026-10-07-report-set-design.md`](../specs/2026-10-07-report-set-design.md), section 3 | Aheed |
| — | **"What happened to this page?" with one tab open** (10-26). On any client but the first, the screen came up after a reload or sign-in. The assistant's button, added 10-25, loads before sign-in finishes, and it saved the first client over the one open. Live on Netlify 10-26. The screen still comes up when another tab really does switch client, as Faizan asked on 10-01 | Aheed |
| 18 (part) | **Nine more standard reports** (10-27): Account List (every account, grouped by type, with its detail type and balance); Customer and Vendor Balance Summary (each party's current balance, no aging buckets); Open Invoices and Unpaid Bills (one row per document still owed); A/R and A/P Aging Detail (the same open documents, grouped under their aging bucket instead of listed flat); Customer and Vendor Balance Detail (the same open documents, grouped under the party instead). All but Account List read the Aging reports' own per-party and per-document figures rather than re-deriving them, so they tie out the same way. Left of item 18: sales by product/service | Riham |
| 28 (part) | **The `xlsx` spreadsheet reader replaced** (10-27). The web app's "Upload Excel" import (Chart of Accounts, Trial Balance, Spreadsheet Sync) read `.xlsx` files with a version of the `xlsx` package carrying known bugs (a crafted file could corrupt the page's own data, or hang the tab) — the npm registry's own copy of the package was never patched; SheetJS only published the fix on their own site. Same library, now installed from there at the fixed version (0.20.3) instead of npm's stuck one (0.18.5); nothing else in the app changed | Riham |
| 18 (part) | **Seventeen more standard reports** (10-27), from the ledger: Profit and Loss as % of Total Income, Quarterly Summary, Year-to-Date Comparison and by Customer; Balance Sheet Summary; Adjusted Trial Balance; Recent Transactions; Transaction Detail by Account; Transaction List with Splits, by Customer and by Vendor; Sales by Customer Detail; Income by Customer Summary; Deposit Detail; Check Detail; Bill Payment List; Purchases by Vendor Detail. Budget vs. Actuals and Audit Log are listed too and open Financial Planning and the Activity Log. Next: the reports from the lists (contact lists, product/service list, inventory valuation, estimates, open purchase orders, invoice list, collections). Spec section 3 | Aheed |

## Decided — no work

- **Copying the look of QuickBooks' phone app is fine.** QuickBooks has the
  same kind of layout.
- **The matching rules stay as built,** apart from the window (93).

## Still needs an answer

- **Colors:** which blue, and whether this app or LedgerFlow changes to match.
- **The product name.** The assistant calls the app "Accmatica". Is that the
  name? It was asked for in writing on 10-05, and item 47 waits on it.
- **The second step for every login from November 1,** and whether an hour
  left alone and 12 hours in all are right. These were in the demo and were not
  reached.
- **Who besides Aheed signs in to Azure and Supabase,** and who keeps the copy
  of the secrets.
- **From earlier meetings, not asked:**
  - check stock (36);
  - a posted closing entry (37);
  - card payments when the bank statement never comes (44);
  - 1099 and card payments;
  - staff entries and the approval step;
  - inventory at average cost;
  - a corrected invoice getting a new number (INV-1042-R1);
  - the two audit decisions.
  All from **(10-05)** or **(10-10)**.

## Unclear

- **"Make it ready for Khan Art"**, from Faizan's November 1 list. Possibly the
  firm's name, misheard by the transcript.
