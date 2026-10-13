# Showing Faizan's first-video fixes — click-through

A walk through everything built from Faizan's first test video, in the order
that is easiest to show. The item numbers are the ones in
[`../meetings/2026-10-12-faizan-video-1.md`](../meetings/2026-10-12-faizan-video-1.md),
which has the status of every item and the reasons behind each change.

**None of this has been clicked through in a browser yet.** Run the whole list
once yourself before showing it; it doubles as the test pass. Tick the box as
each one works.

## Before you start

- The work is in `main` on this machine only until it is pushed. The deployed
  site does not have it yet.
- Sign in as a **firm admin** (step 1 needs it).
- Pick a company whose accounts have detail types set, or set a few first
  (step 16). An account with no detail type lands under Other Current Assets or
  Other Current Liabilities on the Balance Sheet.
- Have one posted journal entry ready to reverse (step 12).

## Top bar and sidebar

- [ ] **1. Logo goes to the client list (68).** Click the logo at the top of the
  sidebar. Client Overview opens, with every client of the firm. Type in
  "Search clients" above the table; the list narrows as you type.
  *Not done yet:* the top bar still shows the last client as selected.
- [ ] **2. Search in the company switcher (67).** Open the company name in the
  top bar. Type part of a client's name in the search box; Enter opens the
  first match.
- [ ] **3. Tab names (69).** Look at the browser tab. It reads the page, then the
  company ("Balance Sheet - Acme LLC"). Open a second page in another tab and
  the two can be told apart.
- [ ] **4. + New in a new tab (63).** Open + New, then Ctrl+click (or middle-click)
  Expense. It opens in a new browser tab. Check is under Expense in the same
  column (70).

## Date boxes (53)

This changed every date box in the app, so try it in more than one place.

- [ ] **5.** On any form (+ New → Expense is fine), double-click the date. All of
  it is selected; type over it.
- [ ] **6.** Type `101226`, press Tab: it becomes 10/12/2026. Also try `10/12/26`,
  `10-12-2026` and `10/12` (this year). Type `abc`: it goes back to the last
  good date.
- [ ] **7.** The calendar button at the right of the box still opens the calendar.

## Expense, Check, Bank deposit

- [ ] **8. Bank accounts only (58).** + New → Expense. The payment account list
  has bank accounts and credit cards, nothing else (no Equipment, no
  receivables). + New → Check and + New → Bank deposit list bank accounts only.
- [ ] **9. Add new from the picker (60).** On Expense or Check, type a name that
  does not exist in Payee. "Add vendor" and "Add customer" sit under the list;
  pick one, save the small form, and the new name is the payee. On Bank deposit,
  the Received from box on a line has "Add new customer".
- [ ] **10. The bank is remembered (59).** On Check, pick a bank, fill in a check
  and choose "Save and new". The next check starts on the same bank with the
  next check number. Leave the page and come back with + New → Check: still the
  same bank. Same on Expense and Bank deposit.
- [ ] **11. Close button (62).** Open a check from Accounts Payable → Checks. The
  X at the top right, Cancel and "Save and close" all return to the list you
  came from, not to a fixed page.

## Journal entry

- [ ] **12. Reverse opens for editing (61).** Open a posted journal entry and
  click Reverse. The entry screen opens titled "Reverse Journal Entry #83R":
  debits and credits swapped, the date on the first day of the next month, an
  amber note saying what it reverses. Nothing is posted yet. Change the date,
  save. Open the original: it is still posted, and the reversal is a separate
  entry with the same number and an R.
- [ ] **13. Back once, not twice (54).** Reports → General Ledger, click a
  transaction to open it, change the memo and save. "Save and close" puts you
  back on the General Ledger by itself. If you saved and stayed on the entry,
  the browser's Back **once** is enough.

Retest while you are here, since Faizan saw these on an older build: attachments
on a bank deposit (50), editing a saved check changes it in place with no void
(51), and the arrow keys in a debit or credit box do not change the amount (52).

## Reports

- [ ] **14. One title (55).** Open Balance Sheet, Profit & Loss, Trial Balance and
  General Ledger. Each shows its name once, in the report header, with no
  second heading above it.
- [ ] **15. Sort the General Ledger (64).** Click a column heading (Name,
  Memo / Description, Debit). The lines inside each account sort A to Z; click again for Z to A; a
  third click goes back to date order. An arrow on the heading shows the
  direction.
- [ ] **16. Account types (57).** Accounting → Chart of Accounts. The Account Type
  column reads Bank, Fixed Assets, Credit Card, Long Term Liabilities and so on,
  not "asset" or "liability". Edit an account: choose the account type, then a
  detail type from that type's list.
- [ ] **17. Balance Sheet layout (57).** Reports → Balance Sheet. Assets are laid
  out as Current Assets (bank accounts, receivables, other current), Fixed
  Assets and Other Assets; liabilities as Current and Long-Term. Each block has
  a subtotal, and the totals are the same as before.
- [ ] **18. Printing (55, 65, 66).** Print the General Ledger. In the browser's
  print dialog, Layout now offers Portrait and Landscape. On a report longer
  than one page, the company, report name and dates repeat at the top of every
  page. Print or export the Balance Sheet and Profit & Loss: there is no Section
  column; each section is a heading row.

## Not ready to show

- **Gear icon (56).** Waiting on Faizan to say which page.
- **"No client selected" (68).** The client list is there (step 1); a top bar and
  sidebar with no client chosen need a sketch first.
- **My Menu.** For discussion at the next meeting, not built or removed.
