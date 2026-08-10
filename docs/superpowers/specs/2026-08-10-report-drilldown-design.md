# Report Amount Drill-Down — Design Spec

**Status:** Implemented 2026-08-10.

## Goal

Make report amounts interactive wherever the application has an exact, reconcilable detail destination.

## Rules

- Profit & Loss account amounts open General Ledger for the same account and period.
- Balance Sheet and Trial Balance account amounts open cumulative General Ledger activity through the report date.
- Cash Flow summary balances open the matching cash-account ledger period; transaction amounts open their journal entry.
- General Ledger transaction debits and credits open their journal entry.
- Formula totals and grouped amounts remain plain when no exact detail view exists. In particular, Aging buckets and 1099 totals are not linked to merely related entity pages.
- All drill-down links use the same visible primary-color and hover-underline treatment.
- Reversal-based voids count both the voided original and posted reversal in Balance Sheet and Cash Flow, matching General Ledger math.
