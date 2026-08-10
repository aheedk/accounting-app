# Expense Transaction Payment Method — Design Spec

**Status:** Implemented 2026-08-10.

## Goal

Record and display how each Expense Transaction was paid.

## Decisions

- Reuse the existing PostgreSQL `payment_method` enum and canonical values: `cash`, `check`, `ach`, `wire`, `card`, and `other`.
- New expenses require an explicit Payment Method through shared validation and the web form.
- Existing expenses migrate to `other` because their method cannot be inferred safely.
- Payment Method is descriptive metadata. The selected payment account continues to determine the ledger credit account.
- The field appears on create, list, detail, Excel, and print views, and the list supports a Payment Method filter.
- Liability accounts are valid payment accounts for card-paid expenses, matching existing service validation.
- Existing create/post/void audit actions capture the field in their entity snapshots; no new audit action is required.
