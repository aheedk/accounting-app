# Chart of Accounts — AI Testing Agent Guide

> **Purpose**: This document is the specification that AI testing agents operate from when probing the Chart of Accounts feature. It is grounded in the actual implementation (routes, service, schema, UI) discovered by codebase inspection — not generic assumptions. Keep it updated whenever the implementation changes.

---

## Status & Progress

**Last updated**: 2026-07-17  
**Phase**: 1 — Foundation complete, paused. Phase 2 (autonomous agents) not yet started.

### What is done
- [x] Full codebase exploration: migration, routes, service, Zod schemas, UI component
- [x] This guide written and grounded in the real implementation
- [x] 13 Vitest integration tests written in `apps/api/tests/integration/chartOfAccountsService.test.ts`
  - 10 regular passing tests covering happy paths, edge cases, and tenant isolation
  - 3 `it.fails()` gap probes documenting known bugs (GAP-2, GAP-3, GAP-4)
- [x] Tests confirmed running against a real Postgres container via `@testcontainers/postgresql` (Docker required)
- [x] Test command: `npm -w @accounting/api run test -- tests/integration/chartOfAccountsService.test.ts`

### What is NOT done yet (Phase 2)
- [ ] Autonomous agent that reads this guide and generates/runs its own probes
- [ ] Auth/role tests (R-01 through R-07) — need HTTP layer, not just service layer
- [ ] UI/state tests (U-01 through U-13) — need a browser automation tool (Playwright recommended)
- [ ] Import flow tests (Gap #7) — no tests exist at all for batch CSV import
- [ ] Guides for other pages (Journal Entries, Invoices, Bills, etc.) — see Section 8

### Gap probe status
| Gap | Test | Current behavior | Fixed? |
|---|---|---|---|
| GAP-2: parent-child cycle | `it.fails(...)` line 180 | A→B→A succeeds (should reject) | No |
| GAP-3: cross-type parent | `it.fails(...)` line 195 | Allowed (should reject) | No |
| GAP-4: deactivate with JEs | `it.fails(...)` line 210 | Returns 200 (should be 422) | No |

> When a gap is fixed: remove the `it.fails()` wrapper so the test becomes a regular passing test. The suite will turn red until you do.

---

## 1. Overview

### What the Chart of Accounts does in this app

The Chart of Accounts (COA) is the master list of every account a business uses to classify financial transactions. In this app it is:

- **Multi-tenant**: every account belongs to exactly one `business_id`. Accounts from different businesses are completely isolated.
- **Seeded on business creation**: `seed_default_coa()` inserts 22 standard accounts automatically. Six of these are **system accounts** (flagged `is_system = true`) that are permanently wired into the AR/AP/ledger services and cannot be renamed, re-parented, or deleted.
- **Audit-tracked**: every create, update, and deactivation writes an entry to `audit_logs` (`coa.create`, `coa.update`, `coa.deactivate`).
- **Hierarchical**: accounts may have a `parent_id` pointing to another account in the same business, forming a tree.
- **Non-destructive**: there is no DELETE endpoint. Accounts are deactivated (`is_active = false`) instead.

### What "correct behavior" means

| Lifecycle event | Expected outcome |
|---|---|
| Business created | 22 default accounts exist; 6 are system accounts |
| Account created | Row in `chart_of_accounts`; audit log `coa.create`; code unique per business |
| Account deactivated | `is_active = false`; audit log `coa.deactivate`; still visible with `include_inactive=true` |
| Account reactivated | `is_active = true`; audit log `coa.update` |
| System account mutation | Name/parent change → rejected; is_active toggle → allowed |
| Hard delete attempt | No endpoint exists (404); DB trigger also blocks DELETE of system accounts |

### UI entry points

The same `CoaListPage` component is mounted at two routes:
- **`/settings/coa`** — accessed via Accounting group in sidebar
- **`/setup/coa`** — accessed via Setup group in sidebar

---

## 2. System Under Test — Quick Reference

### 2a. API Endpoints

| Method | Path | Min Role | Success | Notes |
|---|---|---|---|---|
| `GET` | `/businesses/:businessId/coa` | `staff` (any auth) | `200` | Add `?include_inactive=true` to see deactivated accounts |
| `POST` | `/businesses/:businessId/coa` | `accountant` | `201` | Body: `accountCreateSchema` |
| `PATCH` | `/businesses/:businessId/coa/:accountId` | `accountant` | `200` | Body: `accountUpdateSchema` |
| `DELETE` | *(none)* | — | `404` | No delete endpoint exists |

### 2b. Request/Response Shapes

**POST `/businesses/:businessId/coa`**
```json
{
  "code": "4500",
  "name": "Consulting Revenue",
  "account_type": "revenue",
  "parent_id": null
}
```
Response `201`:
```json
{
  "id": "<uuid>",
  "business_id": "<uuid>",
  "code": "4500",
  "name": "Consulting Revenue",
  "account_type": "revenue",
  "parent_id": null,
  "is_system": false,
  "is_active": true,
  "created_at": "<iso>",
  "updated_at": "<iso>"
}
```

**PATCH `/businesses/:businessId/coa/:accountId`**
```json
{ "is_active": false }
```
Response `200`: full updated account row.

**GET `/businesses/:businessId/coa`**
```json
{ "accounts": [ /* array sorted by code ASC */ ] }
```

### 2c. Validation Rules (Zod)

| Field | Rule | On |
|---|---|---|
| `code` | 1–20 chars; regex `/^[A-Za-z0-9._-]+$/` | Create only |
| `name` | 1–120 chars | Create (required); Update (optional) |
| `account_type` | enum: `asset \| liability \| equity \| revenue \| expense` | Create only; **immutable after creation** |
| `parent_id` | valid UUID or `null`, optional | Create + Update |
| `is_active` | boolean | Update only |

### 2d. Seeded System Accounts

These 6 accounts exist in every business after seeding. They are permanent fixtures.

| Code | Name | account_type | Role |
|---|---|---|---|
| `1010` | Cash on Hand | asset | Used by ledger for cash transactions |
| `1020` | Operating Bank Account | asset | Default bank account |
| `1100` | Accounts Receivable | asset | AR module hard-wired to this account |
| `2010` | Accounts Payable | liability | AP module hard-wired to this account |
| `2100` | Sales Tax Payable | liability | Tax calculations post here |
| `3020` | Retained Earnings | equity | Closing entries post here |

### 2e. Account Types and Normal Balances

| Type | Normal Balance | Increases with | Decreases with | Code Range (convention) |
|---|---|---|---|---|
| `asset` | Debit | Debit | Credit | 1000–1999 |
| `liability` | Credit | Credit | Debit | 2000–2999 |
| `equity` | Credit | Credit | Debit | 3000–3999 |
| `revenue` | Credit | Credit | Debit | 4000–4999 |
| `expense` | Debit | Debit | Credit | 5000–9999 |

---

## 3. What the Testing Agent Should Verify

### 3a. Functional Tests

| # | Test | How to probe | Pass condition |
|---|---|---|---|
| F-01 | List accounts — authenticated | `GET /coa` with valid JWT | `200`; response is an array sorted by `code` ASC |
| F-02 | List accounts — active only (default) | `GET /coa` (no param) | No `is_active = false` accounts returned |
| F-03 | List accounts — include inactive | `GET /coa?include_inactive=true` | Deactivated accounts included |
| F-04 | Create account — all fields | `POST /coa` with code, name, type, parent_id | `201`; returned row matches input; `is_system = false` |
| F-05 | Create account — minimal (no parent) | `POST /coa` with code, name, type only | `201`; `parent_id = null` |
| F-06 | Deactivate account | `PATCH /coa/:id` `{ "is_active": false }` | `200`; `is_active = false` in response |
| F-07 | Reactivate account | `PATCH /coa/:id` `{ "is_active": true }` | `200`; `is_active = true` in response |
| F-08 | Set parent account | `PATCH /coa/:id` `{ "parent_id": "<other-account-id>" }` | `200`; `parent_id` updated |
| F-09 | Clear parent account | `PATCH /coa/:id` `{ "parent_id": null }` | `200`; `parent_id = null` |
| F-10 | Rename non-system account | `PATCH /coa/:id` `{ "name": "New Name" }` | `200`; name updated |
| F-11 | Audit log written on create | After `POST /coa`, query `audit_logs` | Entry with `action = "coa.create"` and correct `entity_id` |
| F-12 | Audit log written on deactivate | After `PATCH is_active: false`, query `audit_logs` | Entry with `action = "coa.deactivate"` |
| F-13 | Audit log written on update | After `PATCH name`, query `audit_logs` | Entry with `action = "coa.update"` |
| F-14 | UI — page renders | Navigate to `/setup/coa` | Account list visible; sorted by code |
| F-15 | UI — create drawer opens | Click "New account" button | Right-side drawer appears |
| F-16 | UI — create drawer saves | Fill drawer form, click Save | New account appears in list; drawer closes |
| F-17 | UI — type filter | Select "asset" in type filter | Only asset accounts visible |
| F-18 | UI — status filter | Select "Inactive" in status filter | Only deactivated accounts visible |
| F-19 | UI — search | Type "1100" in search box | Accounts Receivable row visible |

### 3b. Data Integrity Tests

| # | Test | How to probe | Pass condition |
|---|---|---|---|
| D-01 | Code unique per business | Create two accounts with same code in same business | Second `POST` → error (duplicate) |
| D-02 | Same code allowed across businesses | Create same code in two different businesses | Both `POST` → `201` |
| D-03 | Tenant isolation | Create account in business A; list as business B | Business B sees none of business A's accounts |
| D-04 | System accounts survive seed | Seed a new business; list accounts | All 6 system accounts present (codes 1010, 1020, 1100, 2010, 2100, 3020) |
| D-05 | `account_type` immutable | `PATCH /coa/:id` with `{ "account_type": "liability" }` | Field silently ignored OR `422`; type unchanged |
| D-06 | `updated_at` advances on PATCH | Record `updated_at` before and after PATCH | After PATCH, `updated_at > created_at` |
| D-07 | `created_at` never changes | Record `created_at`; PATCH account; re-fetch | `created_at` identical |
| D-08 | List sorted by code ASC | Create accounts with codes 9000, 1500, 3000 | Returned in order 1500, 3000, 9000 |
| D-09 | Parent must exist in same business | Set `parent_id` to UUID of an account in a different business | `422` or `404` |

### 3c. Validation / Edge Case Tests

| # | Test | Input | Expected |
|---|---|---|---|
| V-01 | Code too short (empty string) | `{ "code": "" }` | `422` |
| V-02 | Code too long (21 chars) | `{ "code": "A".repeat(21) }` | `422` |
| V-03 | Code with space | `{ "code": "1000 A" }` | `422` |
| V-04 | Code with `#` | `{ "code": "1000#" }` | `422` |
| V-05 | Code with `.` (allowed) | `{ "code": "1000.1" }` | `201` |
| V-06 | Code with `-` (allowed) | `{ "code": "1000-A" }` | `201` |
| V-07 | Code with `_` (allowed) | `{ "code": "1000_B" }` | `201` |
| V-08 | Name empty string | `{ "name": "" }` | `422` |
| V-09 | Name 121 chars | `{ "name": "A".repeat(121) }` | `422` |
| V-10 | Invalid account_type | `{ "account_type": "profit" }` | `422` |
| V-11 | Missing account_type | `{}` (no type field) | `422` |
| V-12 | Self-referential parent_id on create | `{ "parent_id": "<this-account-id>" }` (circular) | `422` PRECONDITION_FAILED |
| V-13 | Self-referential parent_id on PATCH | `PATCH { "parent_id": "<same-account-id>" }` | `422` PRECONDITION_FAILED |
| V-14 | Non-existent parent_id | `{ "parent_id": "00000000-0000-0000-0000-000000000001" }` | `422` or `404` |
| V-15 | Rename system account | `PATCH 1100 { "name": "My AR" }` | `422` PRECONDITION_FAILED |
| V-16 | Re-parent system account | `PATCH 1100 { "parent_id": "<id>" }` | `422` PRECONDITION_FAILED |
| V-17 | Deactivate system account | `PATCH 1100 { "is_active": false }` | `200` — allowed (is_active toggle is the one mutation permitted on system accounts) |
| V-18 | DELETE any account | `DELETE /coa/:id` | `404` (no endpoint) |
| V-19 | Duplicate code (case sensitivity) | Create `"CASH"` then `"cash"` | **Both succeed** — code comparison is case-sensitive in Postgres `UNIQUE` constraint |

### 3d. Auth / Role Tests

| # | Test | Role | Endpoint | Expected |
|---|---|---|---|---|
| R-01 | Unauthenticated list | none | `GET /coa` | `401` |
| R-02 | Unauthenticated create | none | `POST /coa` | `401` |
| R-03 | `client` list | client | `GET /coa` | `401` or `403` |
| R-04 | `staff` list | staff | `GET /coa` | `200` |
| R-05 | `staff` create | staff | `POST /coa` | `403` |
| R-06 | `accountant` create | accountant | `POST /coa` | `201` |
| R-07 | `accountant` patch | accountant | `PATCH /coa/:id` | `200` |
| R-08 | `firm_admin` create | firm_admin | `POST /coa` | `201` |
| R-09 | Wrong business in URL | firm_admin | `GET /businesses/<other-biz>/coa` | `403` or empty |

### 3e. UI / State Tests

| # | Test | Action | Expected |
|---|---|---|---|
| U-01 | Page load | Navigate to `/setup/coa` | Table renders; accounts sorted by code |
| U-02 | Empty name submit | Open drawer, leave name blank, click Save | Error shown in UI; no network request sent (or `422` shown) |
| U-03 | Empty type submit | Open drawer, leave type unselected, click Save | Error shown in UI |
| U-04 | Empty code submit | Open drawer, leave code blank, click Save | **Known gap**: no pre-validation; API returns `422`; UI should surface this error |
| U-05 | Successful create | Fill drawer, Save | New account row appears; code in sorted position; drawer closes |
| U-06 | Cancel create | Open drawer, click Cancel | Drawer closes; no account created |
| U-07 | Type filter | Select "expense" | Only expense accounts visible |
| U-08 | Status filter | Select "Inactive" | Only `is_active = false` accounts visible |
| U-09 | Search by code | Type "2010" | Only Accounts Payable visible |
| U-10 | Search by name | Type "Retained" | Retained Earnings account visible |
| U-11 | Export | Click export icon | Excel file downloaded |
| U-12 | Import modal opens | Click Import in dropdown | Modal with file upload zone appears |
| U-13 | Import rejects PDF | Drop a `.pdf` file on import zone | File rejected or shows error |

---

## 4. How the Testing Agent Should Operate

### Setup per test run
```
1. POST /auth/login as firm_admin → get JWT
2. POST /businesses (or use existing) → get businessId
3. Trigger seedDefaultCoa via business creation
4. Record businessId and JWT for all subsequent requests
```

### Probe sequence (happy path)
```
list       → create → verify-in-list → deactivate → verify-inactive
→ reactivate → verify-active → try-forbidden-ops → assert-all-errors → report
```

### Pass / Fail criteria

**Pass**: HTTP status matches expected AND response body contains expected fields in correct shape.

**Fail**:
- Status code differs from expected
- Required field missing from response
- Field has wrong type or value
- UI state doesn't reflect server state within 3 seconds
- Error not surfaced to UI when API returns `4xx`
- `updated_at` unchanged after a mutation

**Regression signal** (escalate immediately):
- Any previously-passing test now returns `500`
- Any audit log entry missing after a mutation
- System account `is_system` field is `false`
- A tenant sees another tenant's accounts

### Isolation
Each agent run should:
- Create a **fresh business** to avoid state pollution
- Run all tests against that business
- Verify cleanup is not required (test data is scoped to the business)

### Reporting format
Each test emits one result object:
```json
{
  "id": "F-04",
  "category": "functional",
  "description": "Create account — all fields",
  "status": "pass | fail | skip",
  "expected": { "statusCode": 201 },
  "actual": { "statusCode": 201, "body": { "code": "4500" } },
  "durationMs": 42,
  "timestamp": "2026-06-26T10:00:00Z",
  "notes": ""
}
```

---

## 5. Accounting-Domain Rules the Agent Must Understand

### Normal balances

The agent must understand which direction increases each account type. Getting this wrong means a debit to an expense account *increases* it, while a credit *decreases* it — opposite of what a debit to a revenue account does.

| Type | Normal Balance | Increases with | Decreases with |
|---|---|---|---|
| `asset` | **Debit** | Debit | Credit |
| `liability` | **Credit** | Credit | Debit |
| `equity` | **Credit** | Credit | Debit |
| `revenue` | **Credit** | Credit | Debit |
| `expense` | **Debit** | Debit | Credit |

### The accounting equation
```
Assets = Liabilities + Equity
```
Every posted journal entry must keep this equation balanced. The COA itself doesn't enforce this — the ledger service does — but assigning the wrong `account_type` to an account (e.g., marking a liability as an asset) will silently corrupt balance sheet reports. The agent should flag when a created account's code prefix doesn't match its type per the convention below.

### Account numbering convention
The seeded COA follows this range convention. User-created accounts should too:

| Range | Expected type | System accounts in range |
|---|---|---|
| 1000–1999 | `asset` | 1010, 1020, 1100 |
| 2000–2999 | `liability` | 2010, 2100 |
| 3000–3999 | `equity` | 3020 |
| 4000–4999 | `revenue` | *(user-defined)* |
| 5000–9999 | `expense` | *(user-defined)* |

**Agent rule**: if a user creates account code `1500` with type `revenue`, emit a warning (not a failure — the app allows it, but it's an accounting error).

### Why system accounts must not be deleted
- `1100` (Accounts Receivable) is referenced by every invoice and customer payment
- `2010` (Accounts Payable) is referenced by every bill and vendor payment
- `1010` / `1020` are used for bank and cash transactions
- `3020` (Retained Earnings) receives period-closing entries

Deleting any of these would orphan financial data. The DB trigger and the absence of a DELETE endpoint are both intentional safeguards.

### Sub-account (parent_id) hierarchy
The current implementation stores `parent_id` but does not compute rolled-up balances. When balance reporting is added, the agent should verify:
- A parent account's balance = sum of all its children's balances
- Deactivating a parent does not automatically deactivate children
- Deleting a parent (if ever enabled) should be blocked if it has children

---

## 6. Known Gaps in the Current Implementation

These are defects or missing safeguards the testing agent should actively probe and report as findings:

| # | Gap | Location | Severity | Agent action |
|---|---|---|---|---|
| 1 | **UI accepts blank account code**: the create drawer marks code as optional; submitting without one hits the API's `422` but the UI shows no pre-validation message | `CoaListPage.tsx` (create drawer) | Medium | Probe U-04; expect visible error; flag if none shown |
| 2 | **No parent-child cycle detection**: A→B→A is not caught at the service level (only direct self-reference `parent_id = id` is blocked by DB CHECK) | `chartOfAccountsService.ts` | Medium | Probe: create A, create B with parent=A, PATCH A with parent=B; expect rejection; flag if it succeeds |
| 3 | **No cross-type parent validation**: an asset account can be parent of an equity account | service + schema | Low | Probe; document if it succeeds (it will); note as accounting correctness risk |
| 4 | **No guard on deactivating accounts with transactions**: an account with posted journal entries can be deactivated, which would make those entries unclassifiable in reports | `chartOfAccountsService.ts` | **High** | Probe: post a JE against an account, then PATCH is_active=false; expect `422`; flag if `200` |
| 5 | **No rename UI**: users cannot rename accounts from the frontend (no PATCH exposed via UI) | `CoaListPage.tsx` | Medium | Document as missing feature; the API PATCH works but the UI doesn't expose it |
| 6 | **`include_inactive` is a string param, not boolean**: only the literal string `"true"` works; `"1"`, `"yes"`, or `true` (JSON) do not | route handler | Low | Probe `?include_inactive=1` and `?include_inactive=yes`; expect same as no param (active only) |
| 7 | **No import tests**: the bulk CSV/XLS import runs a batch of `POST /coa` calls but no integration tests cover it | test suite | Medium | Run import with valid and invalid CSV; verify created accounts appear; verify error rows are reported |
| 8 | **Performance gap on inactive listing**: the filtered index `idx_coa_business WHERE is_active = true` does not help `include_inactive=true` queries, which do a full scan | `0005_chart_of_accounts.sql` | Low | At scale, time `GET /coa?include_inactive=true` with 10k+ accounts; flag if > 500ms |

---

## 7. Concrete Test Checklist

Copy-paste this checklist for each agent run. Check off each item or mark it `FAIL(reason)`.

### Functional
- [ ] **F-01** `GET /coa` authenticated → `200`, sorted by code ASC
- [ ] **F-02** `GET /coa` active-only default → no `is_active=false` rows
- [ ] **F-03** `GET /coa?include_inactive=true` → deactivated rows included
- [ ] **F-04** `POST /coa` all fields → `201`, all fields echo'd back
- [ ] **F-05** `POST /coa` no parent_id → `201`, `parent_id: null`
- [ ] **F-06** `PATCH is_active: false` → `200`, `is_active: false`
- [ ] **F-07** `PATCH is_active: true` → `200`, `is_active: true`
- [ ] **F-08** `PATCH parent_id: <id>` → `200`, parent set
- [ ] **F-09** `PATCH parent_id: null` → `200`, parent cleared
- [ ] **F-10** `PATCH name` on non-system account → `200`, name updated
- [ ] **F-11** Audit log `coa.create` written on create
- [ ] **F-12** Audit log `coa.deactivate` written on deactivate
- [ ] **F-13** Audit log `coa.update` written on name change

### Data Integrity
- [ ] **D-01** Duplicate code in same business → error
- [ ] **D-02** Same code in two businesses → both `201`
- [ ] **D-03** Tenant isolation — business A can't see business B's accounts
- [ ] **D-04** All 6 system accounts present after seed
- [ ] **D-05** `account_type` ignored or rejected on PATCH
- [ ] **D-06** `updated_at` advances after PATCH
- [ ] **D-07** `created_at` unchanged after PATCH
- [ ] **D-08** List order is code ASC

### Validation / Edge Cases
- [ ] **V-01** Empty code → `422`
- [ ] **V-02** Code 21 chars → `422`
- [ ] **V-03** Code with space → `422`
- [ ] **V-04** Code with `#` → `422`
- [ ] **V-05** Code with `.` → `201`
- [ ] **V-06** Code with `-` → `201`
- [ ] **V-07** Code with `_` → `201`
- [ ] **V-08** Empty name → `422`
- [ ] **V-09** Name 121 chars → `422`
- [ ] **V-10** Invalid account_type → `422`
- [ ] **V-11** Missing account_type → `422`
- [ ] **V-12** Self-referential parent on create → `422`
- [ ] **V-13** Self-referential parent on PATCH → `422`
- [ ] **V-14** Non-existent parent_id → `422` or `404`
- [ ] **V-15** Rename system account → `422`
- [ ] **V-16** Re-parent system account → `422`
- [ ] **V-17** Deactivate system account → `200` (allowed)
- [ ] **V-18** DELETE any account → `404`
- [ ] **V-19** ⚠️ *Gap probe* — deactivate account with JEs → should be `422` but currently `200`
- [ ] **V-20** ⚠️ *Gap probe* — A→B→A cycle → should be `422` but currently `200`

### Auth / Roles
- [ ] **R-01** No auth GET → `401`
- [ ] **R-02** No auth POST → `401`
- [ ] **R-03** `staff` POST → `403`
- [ ] **R-04** `client` GET → `401` or `403`
- [ ] **R-05** `accountant` POST → `201`
- [ ] **R-06** `firm_admin` POST → `201`
- [ ] **R-07** Wrong businessId in URL → `403` or empty

### UI / State
- [ ] **U-01** Page renders at `/setup/coa`
- [ ] **U-02** Empty name in drawer → error shown
- [ ] **U-03** Empty type in drawer → error shown
- [ ] **U-04** ⚠️ *Gap probe* — Empty code in drawer → error shown in UI (currently absent)
- [ ] **U-05** Successful create → row appears in list
- [ ] **U-06** Cancel drawer → no account created
- [ ] **U-07** Type filter works
- [ ] **U-08** Status filter works
- [ ] **U-09** Search by code works
- [ ] **U-10** Search by name works
- [ ] **U-11** Export downloads Excel file
- [ ] **U-12** Import modal opens
- [ ] **U-13** Import rejects PDF file

---

## 8. Extending This Guide to Other Pages

This guide is the template for all future testing-agent specs. When writing the guide for a new page:

1. **Explore first** — read the migration, route file, service file, and UI component before writing any test.
2. **Copy sections 2–7** from this file as your starting skeleton.
3. **Replace the Quick Reference tables** with the new page's endpoints, schemas, and data model.
4. **Re-run the validation matrix** against the new Zod schemas.
5. **Identify system-owned records** — are there any records that are immutable like system accounts?
6. **Document gaps** — what does the service not guard against that accounting correctness requires?
7. **Add domain rules** — what accounting invariants are specific to this feature (e.g., for AP: bills must match PO quantities; for AR: payments can't exceed invoice total)?

Pages planned for future guides (in priority order):
- [ ] Journal Entries
- [ ] Invoices (AR)
- [ ] Bills (AP)
- [ ] Bank Reconciliation
- [ ] Payroll / Pay Runs
- [ ] Inventory / Purchase Orders
