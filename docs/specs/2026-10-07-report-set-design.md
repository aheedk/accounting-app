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

## 4. Not built

Left for the review with the firm to choose from: aging detail (one line per invoice
or bill), open invoices and unpaid bills, customer and vendor balance summaries and
detail, the account list, and sales by product or service.
