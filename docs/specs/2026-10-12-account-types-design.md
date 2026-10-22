# Account types the QuickBooks way — design (2026-10-12)

Asked for by Faizan in his first test video (item 57 in
[`../meetings/2026-10-12-faizan-video-1.md`](../meetings/2026-10-12-faizan-video-1.md)):
the chart of accounts should have QuickBooks' account types and detail types, and
the Balance Sheet should group by them (bank accounts, other current assets,
fixed assets; current and long-term liabilities).

## What an account stores

Nothing new. An account already has:

- a **base type**: `asset`, `liability`, `equity`, `revenue` or `expense`
  (`chart_of_accounts.account_type`). Debits, credits and every report total
  depend on this and it does not change.
- a **detail type**: free text (`detail_type`, added in migration `0054`).

The QuickBooks **account type** sits between the two ("Bank", "Fixed Assets",
"Long Term Liabilities"). It is not stored. It is worked out from the detail
type, so there is no second column that can disagree with the first. (Migration
`0101`, below, only fills in detail types on the starting chart.)

## The list

`packages/shared/src/accountGroups.ts` holds the one list: fifteen account types
under the five base types, each with its detail types, copied from QuickBooks.
It was already in the add-account form; it moved to the shared package so the
API and the web read the same one.

| Base type | Account types |
|---|---|
| Asset | Bank, Accounts receivable (A/R), Other Current Assets, Fixed Assets, Other Assets |
| Liability | Credit Card, Accounts payable (A/P), Other Current Liabilities, Long Term Liabilities |
| Equity | Equity |
| Revenue | Income, Other Income |
| Expense | Cost of Goods Sold, Expenses, Other Expense |

`accountGroup({ account_type, detail_type })` gives the account type:

1. The detail type is looked up among the account types of the account's own
   base type, ignoring case. A detail type can never move an asset under
   liabilities.
2. Older detail types still on existing accounts ("Cash on Hand", "Equipment",
   "Accounts Payable", "Mortgage" and so on) are mapped by a short legacy table.
3. Anything else, including no detail type, falls back to the plainest type of
   its kind: Other Current Assets, Other Current Liabilities, Equity, Income,
   Expenses.

One exception, applied by the callers that know about Banking: an asset account
set up under Banking is a **Bank** account whatever its detail type says.

## Where it shows

- **Chart of Accounts.** The Account Type column shows the account type ("Bank")
  instead of the base type ("asset"). The edit form picks an account type and
  then a detail type of that kind, as the add-account form already did; picking
  an account type fills in its first detail type, because the detail type is
  what is kept.
- **Balance Sheet.** `balanceSheet` adds `group` to every line. The page lays
  the sheet out as QuickBooks does (`apps/web/src/lib/balanceSheetLayout.ts`):

  ```
  Assets
    Current Assets
      Bank Accounts ............ Total Bank Accounts
      Accounts Receivable ...... Total Accounts Receivable
      Other Current Assets ..... Total Other Current Assets
    Total Current Assets
    Fixed Assets ............... Total Fixed Assets
    Other Assets ............... Total Other Assets
  Total Assets
  Liabilities
    Current Liabilities
      Accounts Payable, Credit Cards, Other Current Liabilities
    Total Current Liabilities
    Long-Term Liabilities
  Total Liabilities
  Equity (unchanged)
  ```

  An account type with no balances is left out. The flat lists and the totals
  the API already returned are unchanged, so the sheet balances exactly as it
  did; the grouping only decides where a line is printed.
- **Bank pickers.** What counts as a bank account (statement review, Pay bills,
  the Expense payment account) uses the same rule.
- **Profit & Loss.** Already grouped by detail type into cost of goods sold,
  expenses and other expenses (`profitLossService.expenseSection`). Not changed.

## The starting chart (added 10-16)

The chart a new company starts with (`seed_default_coa`) gave no account a
detail type, so every new client's Balance Sheet piled up under Other Current
Assets and Other Current Liabilities. Migration `0101` gives each starting
account a QuickBooks detail type (Operating Bank Account → Checking, Equipment →
Machinery & Equipment, Notes Payable → Notes Payable and so on), held in one SQL
function, `coa_default_detail_type`.

The same migration fills in existing companies, but only where nothing is
guessed: a blank detail type on an account that still has the code, name and
base type it was seeded with, or a system account (known by its system key
whatever it is called now). A detail type someone chose is never overwritten,
and an account the client added, renamed or retyped is left blank.

Two knock-on effects, both deliberate:

- **Depreciation Expense** gets QuickBooks' detail type Depreciation, which sits
  under Other Expense, so on the P&L it moves from operating expenses to other
  expenses. Net income does not change.
- **Auto-coding transfers.** With Operating Bank Account tagged Checking, the
  transfer rule's detail-type lookup could pick the account the money leaves.
  It now looks for Savings and Money Market only; a transfer whose description
  says "checking" still finds a checking account by name, as before.

## The P&L

Since 2026-10-22 (item 83 in `../meetings/2026-10-21-faizan-video-2.md`) the P&L
is laid out as QuickBooks lays it out, from the same account types:

Income → Total Income; Cost of Goods Sold → Total Cost of Goods Sold; **Gross
Profit**; Expenses → Total Expenses; **Net Operating Income**; Other Income →
Total Other Income; Other Expenses → Total Other Expenses; **Net Other
Income**; **Net Income**.

Each line of `GET /reports/pnl` carries its `section` (`income`, `cogs`,
`operating`, `other_income`, `other_expense`), with a total for each and
`net_other_income`. Gross Profit no longer counts Other Income. An income
account with no detail type is Income unless its name says other income,
interest or dividends; an expense account with no detail type falls back as
before (`expenseSection`). Cost of Goods Sold and the two "other" sections are
left out when empty. `revenue_*` and `expense_*` still list every income and
every expense account, for the mobile app.

## Not done here

- **Accounts outside the starting chart are not rewritten.** One with no detail
  type shows under the fallback type until someone gives it one in the edit
  form. Tidying a client's own accounts in one go is a data fix per client, to
  be reviewed by an accountant, not guessed by a migration.
- **Importing a chart** still maps type names with its own alias table in
  `CoaListPage.tsx`; its detail names predate this list.
