# General Ledger Customization Design

**Status:** Implemented 2026-08-10.

## Goal

Let users tailor the General Ledger to review, print, and export only the activity and columns they need.

## Decisions

- Keep period and account selection as the primary report controls.
- Add client-side filters for account type, transaction type, posting status, and reference or memo text.
- Let users show, hide, and reorder all transaction columns while always retaining account grouping.
- Add oldest/newest sorting, comfortable/compact density, optional account metadata, beginning balances, account totals, and report totals.
- Allow account groups to be collapsed or expanded without losing report state.
- Save column and display preferences in local browser storage; transient data filters are reset when the page is reopened.
- Excel and print output reflect the current filters, ordering, visible columns, and total settings.
- No API or migration change is required because customization operates on the complete General Ledger response.
