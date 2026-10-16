# Faizan's test findings — first video (written up 2026-10-12)

What Faizan asked for in his first recorded walkthrough, taken from the
transcript. This is the output of item 34 in
[`2026-10-10-follow-ups.md`](./2026-10-10-follow-ups.md); item numbers carry on
from that file. A second video is coming and gets its own file. The PDF and the
check stubs he sent with the video are not covered here.

**Status on 2026-10-12, end of day:** of the 21 items, 15 are built, 1 is partly
built (68), 4 were fixed or in place already (50, 51, 52, 70), and 1 is waiting
on Faizan (56). Everything built passed the
typecheck and the web tests. The API tests added today for the Balance Sheet
were not run (Docker was off). How to show each item is in Aheed's demo for the
10-16 meeting, [`../demos/2026-10-16-aheed.md`](../demos/2026-10-16-aheed.md).

## Bugs — something is broken

| # | Where | What | Status |
|---|---|---|---|
| 50 | Bank deposit | Attachments do not work: neither "Add attachment" nor dropping a file | **Already fixed** on 10-07 (`9c6edcb`), before this list was written. Retest on the current build |
| 51 | Check | Editing a saved check (he only changed a description) voided the original and posted a new one | **Already fixed** on 10-08 (`8ba8a9a`): the entry is changed in place. Retest on the current build |
| 52 | Journal entry | The up and down arrow keys still raise and lower the debit and credit amounts | **Already fixed** on 10-07 (`896e7bb`): the amount box is a text box now. Retest on the current build |
| 53 | Date boxes | Double-click should select the whole date so it can be typed over, as in QuickBooks | **Done.** Every date box is typed as text (10/12/2026); double-click or Ctrl+A selects all of it, and the calendar is behind a button |
| 54 | General Ledger | After opening a transaction from the ledger, Back has to be pressed twice | **Done.** Saving was adding the same page to the history again; it replaces it now |
| 55 | Reports | The report title is shown twice. Keep one header, on every page | **Done.** The page heading above the report header is gone on the eight report pages. On paper the header repeats on every page |
| 56 | Unclear page | A gear icon next to the account and vendor does nothing | **Waiting on Faizan:** which page |

## Changes to how things work

| # | Where | What | Status |
|---|---|---|---|
| 57 | Chart of accounts | Account type and detail type as in QuickBooks; Balance Sheet grouped by them | **Done.** See "Account types" below |
| 58 | Bank deposit, Expense, Check | The bank account picker should list bank accounts only | **Done.** Expense lists bank accounts and credit cards. Check and Bank deposit already listed the Banking accounts only |
| 59 | Expense, Check | Keep the bank chosen on the first one when entering several | **Done.** "Save and new" keeps it, and a new check, expense or deposit starts on the one last used |
| 60 | Bank deposit, Expense | "Add new" in the customer / payee picker | **Done.** "Add vendor" and "Add customer" on Check and Expense; "Add new customer" under Received from on a deposit |
| 61 | Journal entry | Reverse should open the entry screen so the date can be changed before posting | **Done.** See "Reverse" below |
| 62 | Expense, Check, Bank deposit | A close (X) button on the page | **Done**, on Journal entry too. It, Cancel and "Save and close" go back to the page the record was opened from |
| 63 | + New | Each entry should be openable in a new browser tab | **Done.** They are links now |
| 64 | General Ledger | Sort by clicking a column heading | **Done.** First click A to Z, second Z to A, third back to date order. Sorting is inside each account |
| 65 | Printing reports | Choose landscape or portrait | **Done.** The print page was forcing one, which removes the Layout choice from the browser's print dialog. It no longer forces one |
| 66 | Balance Sheet, P&L | Take out the Section column | **Done** in the print and the Excel export; each section is a heading row |

## New things

| # | What | Status |
|---|---|---|
| 67 | Search box in the client list at the top | **Done** |
| 68 | A firm dashboard with no client selected; the logo goes back to it | **Partly.** See "Firm dashboard" below |
| 69 | Browser tab names | **Done.** The tab says the page, then the company |
| 70 | "Check" under Expenses in the menu | **Already there** in + New, under Expense. If he means the sidebar, ask |

## To discuss, not to build yet

- **My Menu** (the button at the bottom of the sidebar). Faizan does not think
  it is needed. He wants to talk about it at the next meeting and then most
  likely remove it.

## Notes on the items

**Already fixed (50, 51, 52).** All three were fixed in `main` on 10-07 and
10-08. He saw them anyway, so the site he tested was behind `main`, or the video
is older than it looks. Worth finding out which before the next video, or the
same thing will happen again.

**Account types (57).** Spec:
[`../specs/2026-10-12-account-types-design.md`](../specs/2026-10-12-account-types-design.md).
The QuickBooks list (Bank, Other Current Assets, Fixed Assets, Credit Card, Long
Term Liabilities and the rest) was already in the add-account form. It is now
the one list everything reads. The Chart of Accounts shows the account type
instead of "asset", its edit form picks an account type and then a detail type,
and the Balance Sheet is laid out as Current Assets (bank, receivable, other
current), Fixed Assets, Other Assets, then Current and Long-Term Liabilities,
each with a subtotal. Nothing new is stored: the account type is read from the
detail type. **An account with no detail type shows under the plainest type**
(Other Current Assets, Other Current Liabilities) until someone sets one, so the
test companies' charts need a pass before this looks right in a demo. The P&L
was already grouped this way.

**Reverse (61).** A change in behaviour, not a fix. Reverse used to ask for a
reason and post straight away. It now opens the entry screen as the reversal
(debits and credits swapped, first day of the next month, the same number with
an R) and nothing posts until it is saved, so the date or anything else can be
changed first. The original entry stays posted, as in QuickBooks. The old
button voided the original; that is no longer offered on a journal entry, where
Delete and editing in place cover it.

**Date boxes (53).** This touches every date box in the app, so it is the first
thing to try in the browser. Typing 10/12/26, 10-12-2026, 101226 or 10/12 all
work; something that is not a date goes back to the last good one.

**Printing (55, 65).** With no forced orientation the print dialog offers
Layout again, and it starts on whatever the browser used last. The General
Ledger used to open in landscape by itself; now that is one click in the dialog.

**Firm dashboard (68).** The firm-wide page already existed as Accounting →
Client Overview: every client with receivables, payables, transactions waiting
for review, open periods and the last reconciliation, and a click opens that
client. What was done: the logo at the top of the sidebar goes there for a firm
admin (to the dashboard for everyone else), and the page has a client search.
What is not done: the top bar still shows the last client as selected while on
that page, and the sidebar is still that client's. A true "no client selected"
state changes the app shell and needs a sketch agreed with the firm first. Also
open: Client Overview is firm admin only, so an accountant who is not an admin
gets the client's dashboard from the logo.

**Bank accounts only (58).** The rule for what a bank account is now comes from
the account type list, so it also covers item 39 from the 10-10 notes (Equipment
in the bank picker): an account shows as a bank only if its detail type is a
bank type or it is set up under Banking.

## Still to do

1. Start Docker and run the API tests (`balanceSheetReport.test.ts` has a new one).
2. Give the test companies' accounts detail types so the Balance Sheet groups properly.
3. The "no client selected" shell for item 68, after a sketch.

## Ask Faizan

- **Item 56, the gear icon.** The recording says "accountable and vendor here
  the gear icon is not". It comes between the date boxes and the bank picker,
  so it is probably on the Expense or Check page. Which page, and what should
  the gear open?
- **Item 70, which menu.** Check is already in + New under Expense. If he means
  the sidebar, Checks sits under Accounts Payable and he wants it next to
  Expenses.
- **Which site he tests on**, and when the video was recorded (see "Already
  fixed").
- **Item 55.** The header was read as "the page title above the report
  header". If he meant something else on the printed page, say so.
