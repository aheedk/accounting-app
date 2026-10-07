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

## 3. Not built

Left for the review with the firm to choose from: comparative columns (this period
against last), P&L by month, aging detail (one line per invoice or bill), customer and
vendor balance summaries, sales by customer, expenses by vendor.
