# Report set — Design Spec

**Status:** Implemented 2026-10-07. From the 2026-10-05 meeting (item 18, "put every
report up") and the 2026-09-28 audit (P1 items 6 and 7, P2 item 1, P4 item 15).

## 1. Aging reports

### Goal

An A/P aging to match the A/R one, and both agreeing with the ledger.

### Decisions

- **Two reports, one page.** `AgingReportPage` takes `kind` (`ar` or `ap`). A/R is
  `GET /reports/aging`; A/P is `GET /reports/ap-aging`. Both return rows of
  `{ id, name, current, days_1_30, days_31_60, days_61_90, days_over_90, total }`.
- **Five buckets**, by days past the due date: Current, 1–30, 31–60, 61–90, 91 and
  over. (There was one "61 and over" bucket; QuickBooks splits it.)
- **Money on account is shown as a negative**, aged from its own date:
  - A/R: payments not yet applied, and credit memos not yet used.
  - A/P: bill payments not yet applied, and vendor credits not yet used.

  Without these the report showed only gross open invoices or bills and did not agree
  with the control account. With them the grand total equals Accounts Receivable
  (or Accounts Payable) in the ledger; both tests assert that.
- **As-of date ages the balances, it does not rewind them.** The report takes what is
  open now and ages it to the chosen date. A true historical aging (what was open on
  a past date) is not built.

## 2. Statement of Cash Flows

### Goal

The statement an accountant or lender expects: the change in cash for a period, split
into operating, investing and financing. The page that had this name was a register
of one bank account; it is kept and renamed **Cash Activity**.

### Decisions

- **Indirect method.** Start from net income, then show the change in every other
  balance sheet account as its effect on cash (credits less debits for the period).
  Because every entry balances, the three sections always add up to the change in
  the cash accounts, so the statement cannot fail to foot.
- **Same entries as the Profit & Loss:** posted, and neither side of a void. Net
  income on the statement is the P&L's net income for the same dates.
- **Where an account goes** (`cashFlowSection`), read from its detail type:
  - **Cash:** accounts of type Bank, and any account set up under Banking.
  - **Investing:** Fixed Assets and Other Assets.
  - **Financing:** Long Term Liabilities and all Equity.
  - **Operating:** everything else — receivables, inventory, payables, credit cards,
    other current liabilities — plus accumulated depreciation and amortization, which
    is how depreciation (an expense that used no cash) is added back.
- **Accounts with no detail type** (older charts, the default chart) are placed by
  name: "cash", "checking", "savings" are cash; "equipment", "vehicle", "building"
  and the like are investing; "loan", "note payable", "mortgage" are financing.
- **Endpoint and page:** `GET /reports/statement-of-cash-flows`
  (`period_start`, `period_end`); Reports → Cash Flows. Each line drills into the
  General Ledger for that account and period.

## 3. Standard reports from the ledger (10-26)

### Goal

More of QuickBooks' standard reports, asked for in the 10-25 meeting (item 18), for
November 1.

### Decisions

- **Built from reports the app already has**, in the web app
  (`pages/reports/standardReports.ts`), with no new endpoint. Each one reads the
  General Ledger, the P&L or the Balance Sheet, and counts the same entries they do,
  so it ties out to them.
- **One page for all of them** (`StandardReport.tsx`): the dates, Refresh, Excel and
  Print as on the P&L, in the QuickBooks frame. A row opens its transaction, or the
  account's General Ledger, when the role can open it.
- **The reports:**
  - **Profit and Loss Detail:** the General Ledger's lines for income and expense
    accounts, in the P&L's sections. The balance runs from zero within the period.
  - **Profit and Loss by Month:** a P&L per month and one for the whole period
    (Total). The first and last months are cut at the dates chosen; at most 24.
  - **Profit and Loss Comparison:** the period against the same dates a year
    earlier, with the $ and % change. A % change against zero is left blank.
  - **Balance Sheet Detail:** each balance sheet account from its beginning
    balance, through the period's lines, to its ending balance. This year's net
    income is not in an account (year end is not posted), so it is a line of its
    own under Equity, as on the Balance Sheet.
  - **Balance Sheet Comparison:** as of the date and a year earlier, laid out as
    the Balance Sheet, with the $ and % change.
  - **Journal:** each transaction with all its debits and credits, debits first.
  - **Transaction List by Date:** one row per transaction; its amount is the sum
    of its debits.
  - **Sales by Customer Summary:** income from invoices, credit memos and deposits,
    by the name on the transaction. Journal entries are not sales, as in
    QuickBooks.
  - **Expenses by Vendor Summary:** all expense accounts, by the name on the
    transaction. A stock movement names the item, not who was paid, so it goes
    under Not Specified.
- **Closed to a client login**, like the General Ledger they read.
- **Added 10-27 (Riham), from the aging reports' own figures:** Account List,
  Customer and Vendor Balance Summary, Open Invoices, Unpaid Bills, and A/R and A/P
  Aging Detail.
- **Added 10-27 (Aheed), in `ledgerReports.ts` and `LedgerReportPages.tsx`:**
  - **The account a transaction is "in"**, for the reports that show one line per
    transaction: the bank or credit card it went through, else Undeposited Funds,
    else A/R or A/P; a journal entry, which has none of those, by its first debit.
    An account set up under Banking is a bank account whatever its detail type, as
    on the Balance Sheet. The Split column is the one other account, or –Split–.
  - **Customers and vendors** are told apart by name: a report that goes by
    customer matches the ledger's Name column against the customer list (inactive
    customers too), and the same for vendors.
  - **Profit and Loss as % of Total Income:** each amount as a share of total
    income; blank when there is no income.
  - **Quarterly Profit and Loss Summary:** quarters of the fiscal year, the first
    and last cut at the dates; at most 12.
  - **Profit and Loss Year-to-Date Comparison:** the period beside the fiscal year
    to its end. Opens on this month.
  - **Profit and Loss by Customer:** a column per customer, lines naming no
    customer under Not Specified, and the P&L itself as Total.
  - **Balance Sheet Summary:** one line per account type, laid out as the Balance
    Sheet.
  - **Adjusted Trial Balance:** the Trial Balance as of the end date is the
    adjusted balance; the period's adjusting entries (`is_adjusting`) are the
    adjustments; the unadjusted balance is the one less the other.
  - **Recent Transactions:** by the day each transaction was entered, not its
    date, under its type. Opens on the last four days.
  - **Transaction Detail by Account:** each account's lines in the period, the
    balance running from zero.
  - **Transaction List with Splits:** each transaction, its account first, every
    other line under it; debits plus, credits minus.
  - **Transaction List by Customer / by Vendor:** the transactions naming each one.
  - **Sales by Customer Detail:** the lines behind Sales by Customer Summary;
    ties out to it.
  - **Income by Customer Summary:** income and the costs that name the customer
    (the cost of goods on their invoices).
  - **Deposit Detail:** deposits and payments into each bank account, with where
    the money came from under each. An account set up under Banking is a bank
    account whatever its detail type, as on the Balance Sheet.
  - **Check Detail:** checks and bill payments by check, with what each paid for.
  - **Bill Payment List:** bill payments under the account they were paid from.
  - **Purchases by Vendor Detail:** the lines bills, checks, expenses and card
    charges charge, less vendor credits; not the account that paid them.
  - The loaders also get the company's fiscal year start month, and a page can
    open on this month or the last four days instead of the fiscal year.
- **Links to pages the app already has:** Budget vs. Actuals opens Financial
  Planning, and Audit Log opens the Activity Log (accountant and up). The Standard
  Reports list leaves off what the role cannot open.

## 4. Not built

- **Riham's next:** customer and vendor balance detail, and sales by product or
  service.
- **From the lists rather than the ledger, next:** customer and vendor contact
  lists, the product/service list, inventory valuation, estimates by customer, open
  purchase orders, the invoice list and the collections report.
- **Needs more than the app keeps today:** the sales tax reports (tax by agency),
  exceptions to closing date, statement list, terms and payment method lists, and
  purchases by product or service.
