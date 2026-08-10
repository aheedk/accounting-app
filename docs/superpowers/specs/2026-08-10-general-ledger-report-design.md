# General Ledger Report — Design Spec

**Status:** Implemented 2026-08-10.

## Goal

Add a read-only, business-scoped General Ledger report sourced exclusively from posted ledger data.

## Locked decisions

- The report accepts a start date, end date, and optional chart-of-accounts filter.
- Accounts are grouped in code order; transactions are ordered by accounting date and stable journal-entry order.
- Each account shows its opening balance, in-period lines, debit/credit totals, running balance, and ending balance.
- Balances use the account's natural sign, matching the existing account register: assets/expenses are debit-normal; liabilities/equity/revenue are credit-normal.
- Posted reversals and their voided originals are both included, preserving the ledger's reversal-based void math. Draft entries are excluded.
- Accounts with no opening balance and no in-period activity are omitted unless explicitly selected.
- Excel and print/PDF output use the same rows visible in the report.
- This is a pure read path. It requires no migration, audit action, or environment variable.

## Interfaces

- `GET /businesses/:businessId/reports/general-ledger`
- `GET /businesses/:businessId/csv-exports/general-ledger`
- Web route: `/reports/general-ledger`

Both API endpoints accept `period_start`, `period_end`, and optional `account_id` query parameters.
