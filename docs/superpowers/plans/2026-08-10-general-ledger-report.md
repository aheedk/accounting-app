# General Ledger Report Implementation Plan

**Goal:** Deliver a tenant-safe, account-grouped General Ledger report with running balances and exports.

**Architecture:** Add a shared query schema, a read-only Kysely report service over the existing journal tables, authenticated routes, integration coverage, and a QBO-style React report page. No new dependencies or database objects.

## Tasks

- [x] Add date-range and optional account validation in the shared package.
- [x] Add the General Ledger service with natural opening/running/ending balances.
- [x] Add authenticated JSON and CSV endpoints.
- [x] Cover period math, tenant filtering, and reversal-based voids with integration tests.
- [x] Add the report page, account/date filters, exports, print view, navigation, and empty/error states.
- [x] Run typechecks, focused integration tests, unit tests, and production builds.
