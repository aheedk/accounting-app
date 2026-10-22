# Faizan's test findings — second video (10-21, written up 10-22)

What Faizan asked for in the video he recorded on 10-21, taken from the
transcript. Item numbers carry on from
[`2026-10-16-follow-ups.md`](./2026-10-16-follow-ups.md) (last was 82). The
first video is [`2026-10-12-faizan-video-1.md`](./2026-10-12-faizan-video-1.md).

**Status on 10-22:** the six new items that could be built are built (83, 85
to 89), with one found on the way (91). Two wait on Faizan (84, 90). Typecheck
and the web tests pass, and so do the API tests for the P&L, the ledger and
journal entries. One migration, `0110`, which Railway runs on deploy.

**Most of this video repeats the first one, and describes the app as it was
before 10-12.** He shows Reverse asking only for a reason and numbering the
reversal 24, "Back to practice" still naming Michael Pharmacy, + New entries
that cannot open in a new tab, and the Chart of Accounts saying "Assets" on
every asset. All of those were changed on 10-12 or 10-16 and pushed.

**Why (answered 10-22):** Faizan tests on the deployed web app,
https://shiny-dusk-be3da0.netlify.app, and Netlify had stopped picking up
pushes about a week earlier. It is up to date again on 10-22 (checked: the
live bundle has every change through item 89).

**The API on Railway was behind too (fixed 10-22).** It had skipped every push
since 10-21 as "No changes to watched files": it only rebuilt for changes under
`apps/api`, and judged a push by its last commit, which was a merge of Riham's
mobile-only work. So the updated web app talked to the API of 10-20 (Estimates
said "Failed", the P&L had no sections). `railway.json` now watches every path
the API is built from and has its health check back (see the recovery plan).
The deploy that followed waited out a Railway outage that had switched builds
off for Hobby plans, and went live at 17:24 EDT with migrations `0108` to
`0110` in. Everyone was signed out once, as the new session limits apply.

## Already built: he asked again

Each was built after the first video; the item number is the first video's.
Retest on the current build.

| What he asked | Where it stands |
|---|---|
| A search box for the client name | **Built** (item 67): "Search clients" at the top of the company switcher, and a client search on the firm page |
| "Back to practice" still shows the last client | **Built** (item 68, 10-16): the firm page has no client selected; the top bar says "All clients · no client selected" |
| Browser tabs named for the page (P&L, Balance Sheet) | **Built** (item 69): the tab says the page, then the company |
| Chart of Accounts: account type and detail type, with subtypes (Bank, Other Current Assets, Fixed Assets…) | **Built** (item 57). An account with no detail type shows under the plainest type until someone sets one |
| Balance Sheet laid out as QuickBooks: Bank, Other Current Assets, Fixed Assets; Current and Long-Term Liabilities | **Built** (item 57) |
| + New entries open in a new tab | **Built** (item 63): they are links |
| Double-click a date selects all of it | **Built** (item 53): every date box is typed as text; double-click or Ctrl+A selects it all |
| "Add new customer" on a bank deposit | **Built** (item 60): under Received from |
| Keep the bank from the last check or expense | **Built** (item 59): a new check, expense or deposit starts on the account last used |
| A close (X) button on Expense, Check, Journal entry, Bank deposit | **Built** (item 62). Escape is new: item 86 below |
| Take the Section line out of the P&L and Balance Sheet print | **Built** (item 66) |
| Reverse should open the entry so the date can be changed, numbered 23R | **Built** (item 61): Reverse opens the entry screen as the reversal, first day of next month, numbered with an R; nothing posts until it is saved |
| Sort the General Ledger by its column headings | **Built** (item 64). Hiding a column from its heading is new: item 87 below |
| Print shows two headers; keep only client, report and period, on every page of the General Ledger | **Built** (item 55, 10-16) |
| Print in portrait or landscape | **Built** (item 65, 10-16) |

## New in this video

| # | Where | What | Status |
|---|---|---|---|
| 83 | P&L | Laid out as QuickBooks: Income, Cost of Goods Sold, Gross Profit, Expenses, Net Operating Income, then Other Income and Other Expenses, Net Other Income, Net Income. Other Income sat inside Income and every expense was one list | **Done.** See "P&L" below |
| 84 | P&L | "A liability shows on the P&L." The P&L reads only income and expense accounts, so this is an account whose type is income or expense but whose name is a liability's | To find out: see "Ask Faizan" |
| 85 | Journal entry, Expense, Check, Bank deposit | The account box cuts long account names off | **Done.** The whole name shows, on two lines if the column is narrow, in the box and in the list; the account column is wider. The list shows the QuickBooks type (Bank, Expenses) where it said "asset" |
| 86 | Expense, Check, Journal entry, Bank deposit | Escape closes the entry screen, as the X does | **Done.** When a list, menu or dialog is open, Escape closes that first; a second Escape closes the screen. Nothing typed is saved, as with the X |
| 87 | General Ledger | Each column heading gives Sort ascending, Sort descending, Default order and Hide column, as in QuickBooks | **Done.** A ⋮ appears beside a heading on hover. A hidden column comes back from Customize → columns. Clicking the heading still sorts, as before |
| 88 | Journal entry | The same journal number can be used again (entry 1 in January, entry 1 again in February) | **Done** (migration `0110`). Typing a number that is used already says so under the box, with the other entry's date; saving goes ahead. Reversing two entries with the same number gives both an R number |
| 89 | Every page | A button to hide the sidebar | **Done.** The panel button left of the company name hides and shows it. Kept per browser |
| 90 | + New, then a bank screen | "The bank is not showing here." Not clear which screen or which box | To find out: see "Ask Faizan" |
| 91 | Chart of Accounts import | Found while checking 83: an imported "Cost of Goods Sold" account was given the detail type Cost of Labor, which is an ordinary expense, so it showed under Expenses; "Long Term Liability" showed as current | **Done.** Fixed for new imports; see "Import" below |

## Notes on the items

**P&L (83).** The P&L reads the same account types as the Chart of Accounts.
An income account is Other Income when its detail type is one of QuickBooks'
Other Income types (Interest Earned, Dividend Income…); with no detail type,
when its name says other income, interest or dividends. Cost of Goods Sold and
Other Expense work the same way. Cost of Goods Sold and the two "other"
sections only show when something is in them, as in QuickBooks. Gross Profit
no longer counts interest and other income. Excel and print follow the page.
The phone app reads the old totals, which are still sent; its Gross Profit is
now the QuickBooks one too (Riham: worth a look).

**Same number again (88).** QuickBooks warns and lets it through, and so does
this. A number ending in R is still kept for reversals. Looking an entry up by
number can now find two.

**Import (91).** The import now reads a "Detail type" column, as QuickBooks'
own export has, and keeps it. It also takes QuickBooks' type names as they are
("Accounts receivable (A/R)", "Long Term Liabilities" were refused or misread).
**Accounts imported before 10-22 are not changed**: a cost of goods account
imported with Cost of Labor still shows under Expenses in the Chart of
Accounts until its detail type is changed in the edit form. On the P&L it is
already under Cost of Goods Sold when its name says so.

## How to check

1. **P&L (83):** Reports → Profit & Loss on a client with cost of goods and
   interest income. Cost of Goods Sold sits between Total Income and Gross
   Profit; Other Income comes after Net Operating Income.
2. **Account names (85):** + New → Journal entry; pick an account with a long
   name. The whole name shows in the box.
3. **Escape (86):** + New → Expense, type a memo, press Escape: back to the
   page before. Open the category list and press Escape: only the list closes.
4. **Column menu (87):** General Ledger, hover Amount, click ⋮ → Sort
   descending; then ⋮ → Hide column.
5. **Same number (88):** + New → Journal entry, type a number used last month:
   the note under the box says so; Save works.
6. **Hide the sidebar (89):** the panel button left of the company name.

## Ask Faizan

- ~~Which site he tests on~~: the Netlify site, which had stopped updating
  (answered 10-22, above). Netlify and Railway are both current since 10-22,
  17:24 EDT, so he can record again.
- **Item 84:** which account showed as a liability on the P&L, and on which
  client.
- **Item 90:** which screen the bank was missing from (deposit, check,
  expense), and the bank account's name. A bank account shows in those pickers
  if its detail type is a bank type (Checking, Savings, Cash on hand…) or it is
  set up under Banking.
