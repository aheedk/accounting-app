# General Ledger — Design Spec

**Status:** Implemented. Replaces the three 2026-08-10 specs (report, customization,
report drill-down), which no longer matched the code after the QuickBooks-parity
rework of 2026-10-01.

## Goal

A read-only, business-scoped General Ledger that reads like the QuickBooks Online
report: every account's activity for a period, with a running balance, and every
line leading to the transaction it came from.

## Data (API)

- `GET /businesses/:businessId/reports/general-ledger?period_start&period_end[&account_id]`
  (`services/reports/generalLedgerService.ts`), plus a CSV export endpoint.
- Accounts in code order. Each has a beginning balance, its in-period lines, debit and
  credit totals, and an ending balance. Accounts with no beginning balance and no
  activity are left out unless asked for by id.
- Lines come back in posting order (date, then creation, then line number). The running
  balance is computed in that order, so the page must keep it — never re-sort.
- Balances and the per-line `amount` are signed in the account's natural direction:
  debit-normal for assets and expenses, credit-normal for liabilities, equity and revenue.
  Raw `debit` and `credit` are returned as well.
- Posted reversals and their voided originals are both included (void is reversal-based),
  so a voided entry nets to zero. Drafts are excluded.
- What a line *is* comes from `services/core/transactionDescriptorService.ts`, resolved once
  per journal entry:
  - `transaction_label`: Invoice, Payment, Bill, Bill Payment (Check), Expense, Check,
    Deposit, Payroll, Tax Payment, Journal Entry, and so on.
  - `num`: invoice, bill, credit memo (CM-), vendor credit (VC-) or check number,
    otherwise the journal number.
  - `name`: customer, vendor or payee; a single employee's name, or "N employees", on payroll.
  - `memo`: the document's own memo or line descriptions in place of system-written text.
  - `transaction_path`: the page where that transaction is edited.
  - `is_adjusting`: true only for real adjusting entries and depreciation.

The same descriptor drives the journal entry page's redirect: opening an entry that a
source transaction created goes to `transaction_path` (`?view=entry` shows the entry itself).

## Page (web)

`/reports/general-ledger` (`pages/reports/GeneralLedgerPage.tsx`).

- **Period:** presets plus two dates that are always editable; editing a date switches the
  preset to Custom. The period, preset and account live in the URL, so Back from a
  transaction returns to the same report and the link can be shared.
- **Columns:** Date, Transaction Type, Num, Adj, Name, Memo / Description, Split, Amount and
  Balance by default. Customize also offers Debit, Credit, Class, Create Date, Created By and
  Last Modified, plus reordering. Column and display choices are saved in the browser
  (`lib/generalLedgerCustomization.ts`); data filters reset when the page reopens.
- **Filters:** account type, transaction type (by label), posting status, adjusting vs
  regular, and a search over type, number, name, memo, split and amount.
- **Display:** oldest/newest (newest is the exact reverse, so balances still read
  correctly), comfortable/compact, account numbers and details, beginning balances,
  account totals, report total, collapsible accounts. Negatives use a leading minus.
- **Links:** type, number, date, name, description, debit, credit and amount all open the
  transaction. Split (another account) and Balance (a running total) are not links.
- **Export and print** use the shared layout in `lib/reportExport.ts` (company, report,
  period header; footer with generated time and page numbers) and reflect the current
  filters, columns and totals.

## Drill-down into the ledger

Profit & Loss, Balance Sheet and Trial Balance account amounts open the General Ledger for
that account (P&L: the same period; Balance Sheet and Trial Balance: all activity up to the
report date) via `lib/reportDrilldown.ts`. Formula totals and grouped amounts stay plain
where no exact detail exists.
