# Faizan's test findings — first video (written up 2026-10-12)

What Faizan asked for in his first recorded walkthrough, taken from the
transcript. This is the output of item 34 in
[`2026-10-10-follow-ups.md`](./2026-10-10-follow-ups.md); item numbers carry on
from that file. A second video is coming and gets its own file.

Only the lines marked **(checked)** were looked up in the code. The rest is what
he said, not yet confirmed on screen. The PDF and the check stubs he sent with
the video are not covered here.

Nothing is assigned yet; the Owner column is empty on purpose.

## Bugs — something is broken

| # | Where | What | Owner |
|---|---|---|---|
| 50 | Bank deposit | Attachments do not work: neither "Add attachment" nor dropping a file | |
| 51 | Check | Editing a saved check (he only changed a description) voided the original and posted a new one. It should be changed in place, as was done for changing the vendor on a posted entry (`8ba8a9a`) | |
| 52 | Journal entry | The up and down arrow keys still raise and lower the debit and credit amounts. The arrows on the box were taken off; the keys should do nothing too | |
| 53 | Date boxes | Double-click should select the whole date so it can be typed over, as in QuickBooks. Today the date has to be changed piece by piece or from the calendar, and Ctrl+A selects the whole page | |
| 54 | General Ledger | After opening a transaction from the ledger, Back has to be pressed twice to return. Deleting the transaction does return to the ledger correctly | |
| 55 | Reports | The report title is printed twice (seen on the Balance Sheet). Keep one header, and show that one on every page | |
| 56 | Unclear page | A gear icon next to the account and vendor does nothing. See "Unclear" | |

## Changes to how things work

| # | Where | What | Owner |
|---|---|---|---|
| 57 | Chart of accounts | Account type and detail type should follow QuickBooks: Bank, Other Current Assets, Fixed Assets; Current Liabilities, Long-term Liabilities; and so on. The Balance Sheet and P&L group by these, so they change with it. See "Account types" below | |
| 58 | Bank deposit, Expense, Check | The bank account picker should list bank accounts only, not every account. Depends on 57 | |
| 59 | Expense, Check | When entering several in a row, keep the bank account chosen on the first one, so ten checks need the bank picked once | |
| 60 | Bank deposit, Expense | "Add new" in the customer / payee picker, as Check and Journal entry already have | |
| 61 | Journal entry | Reverse should open the entry screen filled in with the reversal, so the date (or anything else) can be changed before posting. Today it asks for a reason and posts on the first day of the next month **(checked: it is a reason prompt, then the void endpoint)** | |
| 62 | Expense, Check, Bank deposit | A close (X) button on the page, as Journal entry has | |
| 63 | + New | Each entry should be openable in a new browser tab. Today they cannot be | |
| 64 | General Ledger | Sort by clicking a column heading: date, transaction type, name, split. Today there is only oldest / newest first **(checked)** | |
| 65 | Printing reports | Let the user choose landscape or portrait. Today it is picked for them: landscape when a report has more than six columns **(checked, `lib/download.ts`)** | |
| 66 | Balance Sheet, P&L | Take out the Section column; code and account are enough. **(checked: the downloads have a Section column; whether he meant the screen too is not clear)** | |

## New things

| # | What | Owner |
|---|---|---|
| 67 | Search box in the client list at the top, to find a client by typing. **(checked: the switcher has none)** | |
| 68 | A firm dashboard with no client selected, as QuickBooks Accountant has: the client list and the firm's own options. Clicking the logo goes back to it. Today "Dashboard" is always inside one client. Large; needs a short spec | |
| 69 | Browser tab names: the tab should say which page is open ("Reports", "Profit and Loss"). **(checked: the app never sets the page title)** | |
| 70 | "Check" under Expenses in the menu. He says it was there on Friday and went away. **(checked: + New has Check under Expense, and the sidebar has Checks under Accounts Payable)** so which menu he means needs asking; see "Unclear" | |

## To discuss, not to build yet

- **My Menu** (the button at the bottom of the sidebar). Faizan does not think
  it is needed. He wants to talk about it at the next meeting and then most
  likely remove it.

## Notes on the items

**Account types (57).** This is the largest item here and the one other items
wait on. He asked us to copy the QuickBooks list rather than describe it: open
the chart of accounts in QuickBooks and take the account types and the detail
types under each. Two things to settle before touching it: existing clients'
accounts need to be mapped onto the new types, and the Balance Sheet and P&L
sections have to be rebuilt from them (Bank, Other Current Assets, Fixed Assets,
Current Liabilities, Long-term Liabilities). Write a spec first.

**Bank accounts only (58).** The statement screens already have a rule for what
counts as a bank account (`apps/web/src/lib/bankAccountOptions.ts`). The entry
pages do not use it. Once 57 gives every bank account the Bank type, the picker
on all three pages can be the accounts of that type. This is also the likely
home of item 39 (Equipment in the bank picker).

**Editing a check (51).** Not looked up yet. Compare with what `8ba8a9a` did for
the vendor change and make every edit of a posted check go the same way.

**Reverse (61).** A real change in behaviour, not a fix: the reversal becomes a
draft the user reviews. The default date can stay the first day of the next
month.

**Close button and new tab (62, 63).** Both are about working like QuickBooks,
where an entry screen is something opened and closed on top of the page behind
it. 63 is small if the + New entries become ordinary links.

## Suggested order

1. The bugs that lose or change data: 51 (check voided on edit), 50 (attachments).
2. The small ones, in one pass: 52, 53, 59, 60, 62, 63, 67, 69, 55, 66.
3. 64 and 65 (ledger sorting, print orientation), then 61 (reverse) and 54.
4. 57 with a spec, then 58 on top of it.
5. 68 after the firm has seen a sketch.

## Unclear

- **Item 56, the gear icon.** The recording says "accountable and vendor here
  the gear icon is not". It comes between the date boxes and the bank picker,
  so it is probably on the Expense or Check page. Ask which page and what the
  gear should open.
- **Item 70, which menu.** Check is already in + New under Expense. If he means
  the sidebar, Checks sits under Accounts Payable and he wants it next to
  Expenses.
- **Item 66.** Whether "section" is the column in the download or an option on
  the screen.
- **Item 54.** He also said an earlier version sent him to a different screen
  after going back; not clear whether that still happens.
