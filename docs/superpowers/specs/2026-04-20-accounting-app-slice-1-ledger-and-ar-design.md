# Slice 1 — Ledger + AR — Design Spec

**Status:** Approved by user 2026-04-20. Ready for implementation planning.
**Slice:** 1 of N. This is the foundational vertical slice.
**Source prompt:** Build a production-grade, full-stack accounting system for an accounting firm managing multiple client businesses. Non-negotiables: financial correctness, no silent mutation, full auditability, immutable posted records, separation of operational data from accounting entries.

---

## 0. Locked context (from brainstorming Q&A)

| Decision | Choice |
|---|---|
| Approach | Vertical slices. Slice 1 = Ledger + AR end-to-end. Future slices add AP, banking, reports, close. |
| Tenancy | Single firm now, schema designed for multi-firm later. `firm_id` columns and constraints in place from day 1. |
| Use posture | Built to production standards. Deployed to Railway (backend + Postgres) + Netlify (frontend). No email or password reset in Slice 1 (admin resets in DB). |
| Money | `numeric(19, 4)` everywhere. USD only. JS-side decimal handling via decimal.js — never `Number`. |
| Frontend stack | Vite + React + TypeScript + Tailwind + shadcn/ui (Radix-based). |
| Testing posture | Full pyramid: unit + Postgres-backed integration (Testcontainers) + a small set of Playwright E2E. TDD discipline mandatory for `core/ledgerService`. |
| Architecture | Monorepo (`apps/api`, `apps/web`, `packages/shared`). Express + Kysely (typed query builder, no ORM). **Belt-and-suspenders invariants: enforced at both service and database layers.** |
| Auth | JWT access (15-min TTL) + refresh token (180-day rolling, hashed in DB), pattern matching the existing Workout-app. |

---

## 1. Repo layout & deployment topology

### Repo

```
accounting-app/
├── apps/
│   ├── api/                Express + TS + Kysely
│   └── web/                Vite + React + TS + Tailwind + shadcn/ui
├── packages/
│   └── shared/             TS types, decimal helpers, role + audit-event + error-code constants, zod schemas
├── db/
│   ├── migrations/         Plain SQL files, ordered (e.g. 0001_init.sql)
│   └── seeds/              SQL seeds (one firm, default COA, demo businesses)
├── docs/superpowers/specs/ Design docs (this file)
└── .github/workflows/      CI: typecheck + unit + integration (ephemeral Postgres via service container)
```

npm workspaces. One root `package.json` orchestrates with `concurrently` for `npm run dev` (no turborepo in Slice 1 — caching benefits don't materialize at this scale yet).

### Deployment

- `apps/api` → Railway service (Node)
- Postgres → Railway managed instance
- `apps/web` → Netlify, static build, calls API via `VITE_API_URL`
- CI: GitHub Actions runs typecheck + unit + integration on every PR

### Cross-origin auth note (known constraint)

Netlify (frontend) and Railway (API) are on different origins. Refresh-token cookies must be `httpOnly + Secure + SameSite=None` and the API must allowlist the Netlify origin in CORS with `credentials: true`. Verify this works end-to-end early in implementation.

---

## 2. Slice 1 scope — IN / OUT

### IN (Slice 1)

- Auth: JWT access + refresh (180-day rolling), login/logout/protected routes
- RBAC: 4 roles (firm_admin, accountant, staff, client), enforced server-side
- Multi-tenant scaffolding: `firms`, `businesses`, `users`, `user_business_access` (one firm seeded)
- Audit log: every state-changing action captured atomically with the mutation
- Chart of accounts (per business, default COA seeded on business creation)
- Fiscal periods (open/close, posting gated to open periods, admin override audit-logged)
- Manual journal entries (draft → posted → voided; reversing entries supported)
- Customers (CRUD)
- Invoices (draft → posted → voided; posting auto-generates `DR AR / CR Revenue (+ Tax Payable)` JE)
- Invoice lines with tax codes
- Tax codes & rates (basic: rate × line subtotal, line-level)
- Payments (record, apply across multiple invoices, post → `DR Cash / CR AR` JE)
- Payment applications (split a payment across invoices and credit memos)
- Credit memos — *customer-return type only* (creates own JE)
- Trial balance report (period-scoped, sourced from journal entries only)
- AR aging report (current / 30 / 60 / 90+)
- Customer balance view

### OUT (defer to Slice 2+)

- AP (vendors, bills, vendor payments)
- Banking + reconciliation + CSV import
- P&L, Balance Sheet, Cash Flow Statement reports
- Month-end close formal workflow + retained earnings rollover
- Email + password reset
- Attachments
- Multi-currency
- Multi-firm UI (schema is ready, only one firm seeded)
- Recurring invoices
- Customer-facing portal
- Tax filings / 1099 reports
- Convert overpayment to credit memo

---

## 3. Database schema

### 3.1 Conventions

- **Primary keys:** `uuid` (`gen_random_uuid()`). No sequential ints.
- **Money:** `numeric(19, 4) NOT NULL`. Default `0.0000` where applicable. Never nullable.
- **Timestamps:** `timestamptz NOT NULL DEFAULT now()` for `created_at`. `updated_at` likewise, bumped via row trigger.
- **Soft delete:** `deleted_at timestamptz NULL` on business-level entities (customers, draft invoices). Posted journal entries and audit logs are NEVER deletable (trigger-enforced).
- **Tenancy:** every business-scoped table carries `business_id uuid NOT NULL REFERENCES businesses(id)`. Every query goes through a service that asserts caller's `user_business_access`.
- **Naming:** snake_case columns, plural table names, FKs named `<entity>_id`.

### 3.2 Core / tenancy tables

```
firms                     id, name, created_at, updated_at
businesses                id, firm_id (FK), name, legal_name,
                          fiscal_year_start_month (1-12),
                          created_at, updated_at, deleted_at
users                     id, firm_id (FK), email (unique within firm), password_hash,
                          full_name, role (enum: firm_admin, accountant, staff, client),
                          last_login_at,
                          created_at, updated_at, deleted_at
user_business_access      id, user_id (FK), business_id (FK),
                          role_override (nullable enum, same enum as users.role),
                          created_at;
                          UNIQUE(user_id, business_id)
refresh_tokens            id, user_id (FK), token_hash, expires_at, revoked_at,
                          created_at, last_used_at
```

`role` on `users` is the firm-wide default. `user_business_access.role_override` allows a firm_admin to grant a different effective role on a specific client business (e.g., grant a `client` role to one staff member for read-only access).

### 3.3 Accounting engine tables

```
chart_of_accounts         id, business_id (FK), code text, name text,
                          account_type (enum: asset, liability, equity, revenue, expense),
                          parent_id (nullable, self-FK for sub-accounts),
                          is_system bool,        -- true for AR, AP, Cash, Tax-Payable,
                                                 --   Retained Earnings (system can't delete)
                          is_active bool,
                          created_at, updated_at;
                          UNIQUE(business_id, code)

fiscal_periods            id, business_id (FK), starts_on date, ends_on date,
                          status (enum: open, closed),
                          closed_at timestamptz, closed_by_user_id (FK users),
                          created_at, updated_at;
                          UNIQUE(business_id, starts_on),
                          CHECK(starts_on <= ends_on),
                          EXCLUDE constraint: no overlapping ranges per business

journal_entries           id, business_id (FK), period_id (FK fiscal_periods),
                          entry_date date NOT NULL,
                          memo text, reference text,
                          status (enum: draft, posted, voided),
                          source_type (enum: manual, invoice, payment, credit_memo,
                                              reversal, adjustment),
                          source_id uuid (polymorphic — invoices/payments/etc.),
                          reversed_entry_id (FK self, nullable — set on the new
                                             reversing entry, points back to original),
                          posted_at timestamptz, posted_by_user_id (FK users),
                          voided_at timestamptz, voided_by_user_id (FK users),
                          void_reason text,
                          created_at, created_by_user_id, updated_at

journal_entry_lines       id, journal_entry_id (FK), line_number int,
                          account_id (FK chart_of_accounts),
                          debit numeric(19,4) NOT NULL DEFAULT 0,
                          credit numeric(19,4) NOT NULL DEFAULT 0,
                          memo text,
                          CHECK(debit >= 0 AND credit >= 0),
                          CHECK(NOT (debit > 0 AND credit > 0)),
                          CHECK(debit > 0 OR credit > 0),
                          UNIQUE(journal_entry_id, line_number)
```

### 3.4 Accounts Receivable tables

```
customers                 id, business_id (FK), name, email, phone,
                          billing_address jsonb, default_terms_days int DEFAULT 30,
                          created_at, updated_at, deleted_at;
                          UNIQUE(business_id, name) WHERE deleted_at IS NULL

invoices                  id, business_id (FK), customer_id (FK),
                          invoice_number text NOT NULL,
                          issue_date date, due_date date,
                          status (enum: draft, posted, voided, paid),
                          subtotal numeric(19,4),
                          tax_total numeric(19,4),
                          total numeric(19,4),
                          ar_account_id (FK chart_of_accounts — defaults to system AR),
                          posted_journal_entry_id (FK journal_entries, nullable),
                          memo text, terms text,
                          posted_at, posted_by_user_id,
                          voided_at, voided_by_user_id,
                          created_at, created_by_user_id, updated_at, deleted_at;
                          UNIQUE(business_id, invoice_number)

invoice_lines             id, invoice_id (FK), line_number int,
                          description text NOT NULL,
                          quantity numeric(19,4) NOT NULL,
                          unit_price numeric(19,4) NOT NULL,
                          revenue_account_id (FK chart_of_accounts),
                          tax_code_id (FK tax_codes, nullable),
                          line_subtotal numeric(19,4),
                          tax_amount numeric(19,4),
                          line_total numeric(19,4),
                          UNIQUE(invoice_id, line_number)

payments                  id, business_id (FK), customer_id (FK),
                          payment_date date,
                          payment_method (enum: cash, check, ach, wire, card, other),
                          reference text,
                          amount numeric(19,4) NOT NULL,
                          unapplied_amount numeric(19,4) NOT NULL,
                          cash_account_id (FK chart_of_accounts),
                          status (enum: draft, posted, voided),
                          posted_journal_entry_id (FK journal_entries, nullable),
                          memo text,
                          posted_at, posted_by_user_id,
                          voided_at, voided_by_user_id,
                          created_at, created_by_user_id, updated_at

payment_applications      id, payment_id (FK), invoice_id (FK, nullable),
                          credit_memo_id (FK credit_memos, nullable),
                          applied_amount numeric(19,4) NOT NULL,
                          applied_at timestamptz, applied_by_user_id,
                          CHECK(applied_amount > 0),
                          CHECK((invoice_id IS NOT NULL) <> (credit_memo_id IS NOT NULL))

credit_memos              id, business_id (FK), customer_id (FK),
                          memo_date date,
                          status (enum: draft, posted, voided, applied),
                          amount numeric(19,4) NOT NULL,
                          remaining_amount numeric(19,4) NOT NULL,
                          source_payment_id (FK payments, nullable),
                          ar_account_id (FK chart_of_accounts),
                          posted_journal_entry_id (FK journal_entries, nullable),
                          memo text,
                          posted_at, posted_by_user_id,
                          voided_at, voided_by_user_id,
                          created_at, created_by_user_id, updated_at
```

### 3.5 Tax tables

```
tax_codes                 id, business_id (FK), code text, name text,
                          tax_payable_account_id (FK chart_of_accounts),
                          is_active bool, created_at, updated_at;
                          UNIQUE(business_id, code)

tax_rates                 id, tax_code_id (FK),
                          rate numeric(9,6) NOT NULL,
                          effective_from date NOT NULL,
                          effective_to date,
                          created_at;
                          CHECK(rate >= 0 AND rate <= 1),
                          CHECK(effective_to IS NULL OR effective_from <= effective_to)
```

### 3.6 Audit log table

```
audit_logs                id, firm_id, business_id (nullable for firm-level events),
                          user_id (FK), request_id uuid,
                          action text (e.g. "invoice.post"),
                          entity_type text, entity_id uuid,
                          before_state jsonb, after_state jsonb,
                          ip_address inet, user_agent text,
                          created_at timestamptz NOT NULL DEFAULT now();
                          INDEX (business_id, entity_type, entity_id, created_at)
```

`audit_logs` is append-only — UPDATE and DELETE both raise via trigger.

### 3.7 DB-layer invariants (triggers and constraints)

These are the "suspenders" half of belt-and-suspenders. They protect the books even if the service layer is bypassed (a one-off SQL script, a future careless migration, etc.).

1. **Double-entry balance** — `CONSTRAINT TRIGGER` on `journal_entry_lines`, `DEFERRABLE INITIALLY DEFERRED`, fires at `COMMIT`. Computes `SUM(debit) - SUM(credit)` per parent entry; raises if non-zero. Deferred so we can insert lines incrementally inside a single transaction.

2. **Posted entries are immutable** — `BEFORE UPDATE OR DELETE` trigger on `journal_entries` and `journal_entry_lines`. If `OLD.status = 'posted'` (or parent is posted) → raise. Voiding flips status to `voided` via a controlled service path that the trigger allows only when `current_setting('app.allow_void', true) = 'on'` is set inside the void-service transaction.

3. **No posting into closed periods** — `BEFORE INSERT OR UPDATE` trigger on `journal_entries`. If `NEW.status = 'posted'` and the referenced `fiscal_periods.status = 'closed'`, raise — unless `current_setting('app.admin_override', true) = 'on'`. The override flag is set only inside the admin-override service path, which writes its audit row in the same transaction.

4. **Audit logs are append-only** — `BEFORE UPDATE OR DELETE` on `audit_logs` raises unconditionally.

5. **Period date sanity** — `BEFORE INSERT OR UPDATE` on `journal_entries` ensuring `entry_date BETWEEN period.starts_on AND period.ends_on`.

6. **Polymorphic source sanity** — `BEFORE INSERT OR UPDATE` on `journal_entries` ensuring `source_id` actually points at a row of the correct table for the given `source_type`.

7. **Posted-invoice/payment/credit-memo immutability** — same pattern as #2 on `invoices`, `payments`, `credit_memos`. Once `status = 'posted'`, only the controlled void path can mutate.

### Known risk

The session-flag pattern (`SET LOCAL app.allow_void = 'on'`) is a known PostgreSQL idiom but has gotchas: pgbouncer in transaction mode would break it because settings don't persist across pooled connections. Mitigation: use session-pooling mode or no pooler for the API connection in production. Verify Railway's default Postgres connection topology before deploy.

---

## 4. Service layer

### 4.1 Layered architecture rules

```
HTTP request
   ↓
middleware       auth (JWT) → tenancy (verify user_business_access) → audit ctx
   ↓
routes/          parse + validate input (zod), call ONE service method, format response
   ↓
services/        business logic, owns the DB transaction, writes audit log atomically
   ↓
repositories/    thin Kysely query helpers, only place that imports `db`
```

**Two non-negotiable rules:**

1. **Routes do not compose business logic.** A route handler calls exactly one service method. Multi-step orchestration lives in services. Enforced via code review and a custom ESLint rule that forbids more than one `await`-to-services call per route handler.

2. **Only `core/ledgerService` writes to `journal_entries` / `journal_entry_lines`.** AR services that need to record a journal entry call `ledgerService.postJournalEntry(...)`. They never touch ledger tables directly. This is the spec's "separation of concerns" made structural.

### 4.2 Service inventory

```
core/
  ledgerService           postJournalEntry, voidJournalEntry, reverseJournalEntry,
                          computeAccountBalance, computeTrialBalance
  fiscalPeriodService     create, openPeriod, closePeriod, reopenPeriod,
                          findPeriodForDate
  chartOfAccountsService  CRUD + seedDefaultCoa(business_id)
ar/
  customerService         CRUD
  invoiceService          createDraft, updateDraft, addLine, removeLine,
                          postInvoice, voidInvoice
  paymentService          createDraft, addApplication, removeApplication,
                          postPayment, voidPayment
  creditMemoService       createDraft, postCreditMemo, applyToInvoice, voidCreditMemo
  reports/
    agingReport           customerAging(business_id, asOf)
    customerBalance       customerBalance(business_id, customer_id, asOf)
tax/
  taxCodeService          CRUD + getEffectiveRate(tax_code_id, asOf)
audit/
  auditService            record({ action, entityType, entityId, before, after }, ctx)
auth/
  authService             login, refresh, logout, hashPassword, verifyPassword
admin/
  adminOverrideService    runWithClosedPeriodOverride(fn, ctx)
```

### 4.3 AR → ledger mapping rules

The contract for the implementation. Every business action that affects books has exactly one canonical journal entry.

**Post invoice** (`invoiceService.postInvoice`)
- Preconditions: invoice is `draft`, has ≥1 line, all lines have valid `revenue_account_id`, fiscal period for `issue_date` is `open`.
- JE:
  - `DR  ar_account_id              total`
  - `CR  revenue_account_id         line_subtotal` (one CR line per distinct `revenue_account_id`)
  - `CR  tax_payable_account_id     tax_amount`   (one CR line per distinct tax code's payable account)
- Side effects: `invoice.status = 'posted'`, `posted_journal_entry_id = JE.id`, audit `invoice.post`.

**Void invoice** (`invoiceService.voidInvoice`)
- Preconditions: invoice is `posted`; no `payment_applications` currently applied (caller unapplies first); fiscal period is `open` (or admin override).
- Action: create reversing JE (`source_type='reversal', reversed_entry_id=original.id`) with debits/credits flipped, dated today.
- Side effects: `invoice.status = 'voided'`, audit `invoice.void`.

**Post payment** (`paymentService.postPayment`)
- Preconditions: payment is `draft`, fiscal period for `payment_date` is `open`.
- JE:
  - `DR  cash_account_id    amount`
  - `CR  ar_account_id      amount`
- Side effects: `payment.status = 'posted'`, `unapplied_amount = amount - SUM(applications.applied_amount)`, audit `payment.post`.

**Apply payment to invoice** (`paymentService.addApplication`)
- Allowed both before and after posting.
- **No journal entry generated** — sub-ledger linkage only. The GL already moved AR when the payment posted.
- Preconditions: `applied_amount > 0`, `<= payment.unapplied_amount`, `<= invoice.amount_due` (where `amount_due = invoice.total - SUM(payment_applications.applied_amount where invoice_id=this and payment.status='posted') - SUM(equivalent for credit_memo applications where credit_memo.status='posted')` — computed at read time, not stored).
- Side effects: insert `payment_applications` row, decrement `payment.unapplied_amount`. If recomputed `amount_due` reaches 0, set `invoice.status = 'paid'` in the same transaction. Audit `payment.apply`.

**Void payment** (`paymentService.voidPayment`)
- Preconditions: payment is `posted`, no active applications (caller unapplies first).
- Action: reversing JE.
- Audit `payment.void`.

**Post credit memo** (`creditMemoService.postCreditMemo`) — Slice 1 supports only customer-return/refund credit memos
- Preconditions: status `draft`, period open.
- JE:
  - `DR  revenue_account_id (contra-revenue/sales-returns)   amount`
  - `CR  ar_account_id                                       amount`
- Side effects: `status='posted'`, `remaining_amount = amount`, audit `credit_memo.post`.

**Apply credit memo to invoice** — same shape as payment-application: no JE, sub-ledger only.

**Manual journal entry post** (`ledgerService.postJournalEntry`)
- Preconditions: balanced (DR = CR), period open (or admin override), all referenced accounts active.
- Action: insert lines, set `status='posted'`, `posted_at`, audit `journal_entry.post`.

**Reverse / adjusting entry** (`ledgerService.reverseJournalEntry`)
- Inverts an existing posted entry. Allowed in closed periods only via admin-override path (separate audit action).

---

## 5. Auth (JWT) + RBAC

**JWT pattern (matches existing Workout-app):**
- Access token: HS256-signed, 15-min TTL, contains `user_id`, `firm_id`, `role`, `iat`, `exp`. Sent as `Authorization: Bearer …`.
- Refresh token: opaque random string, hashed (bcrypt) and stored in `refresh_tokens`. 180-day rolling expiry, rotated on every `/auth/refresh`. Stored client-side in an `httpOnly + Secure + SameSite=None` cookie (cross-origin, with strict CORS allowlist).
- Endpoints: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` (revokes refresh).
- No password reset in Slice 1 (admin resets `password_hash` directly).

**Role hierarchy and Slice 1 capabilities:**

| Role | Post JEs | Void | Close period | Admin-override closed period | Read |
|---|---|---|---|---|---|
| firm_admin | yes | yes | yes | yes | all |
| accountant | yes | yes | no | no | all |
| staff | drafts only | no | no | no | all |
| client | no | no | no | no | scoped: own business only, financial reports + own invoices |

**Two-layer enforcement:**
1. Route middleware — `requireMinRole('accountant')` on every mutating endpoint.
2. Service-layer check — every mutating service takes `ctx = { user_id, business_id, effective_role, ... }` and re-checks. A route that forgets the middleware still fails at the service.

Effective role on a business = `user_business_access.role_override ?? user.role`.

---

## 6. Audit log

- Every mutating service method calls `auditService.record(...)` **inside the same DB transaction** as the mutation. If the mutation rolls back, so does the audit row.
- `ctx` object is built by middleware and passed explicitly through service signatures: `{ user_id, business_id, request_id, ip_address, user_agent }`. No async-local-storage — explicit passing keeps data flow visible and testable.
- Action names are typed string constants in `packages/shared/auditActions.ts`. Initial set:
  - `invoice.post`, `invoice.void`
  - `payment.post`, `payment.void`, `payment.apply`, `payment.unapply`
  - `credit_memo.post`, `credit_memo.apply`, `credit_memo.void`
  - `journal_entry.post`, `journal_entry.void`, `journal_entry.reverse`
  - `fiscal_period.close`, `fiscal_period.reopen`
  - `fiscal_period.admin_override_post` (always written before any closed-period override)
  - `customer.create`, `customer.update`, `customer.delete`
  - `auth.login`, `auth.login_failed`, `auth.logout`, `auth.refresh`
- `before_state` / `after_state`: `jsonb`. For create, `before=null`; for update, both populated with full row snapshot; for soft-delete, `after=null`.
- Audit table is append-only at the DB layer.

---

## 7. Fiscal period lifecycle

**State machine:**

```
open  ──close──▶  closed  ──reopen──▶  open
                    │
                    └──admin-override-post──▶  (still closed; allows one posting; audit-logged)
```

**Periods are pre-created.** When a business is created, 12 monthly periods for the current calendar year are seeded as `open`. `firm_admin` can create future-year periods via settings UI.

**Closing** (`fiscalPeriodService.closePeriod`):
- Preconditions: zero `draft` journal entries, invoices, payments, or credit memos in this period. Service returns structured 409 listing offending records — UI shows them as "resolve before closing."
- Action: `status='closed'`, `closed_at=now()`, `closed_by_user_id=ctx.user_id`. Audit `fiscal_period.close`.

**Reopening** (`fiscalPeriodService.reopenPeriod`) — `firm_admin` only, audit `fiscal_period.reopen`.

**Posting into closed periods** — only via `adminOverrideService.runWithClosedPeriodOverride(fn, ctx)`. Wrapper:
1. Asserts caller is `firm_admin`.
2. Opens a transaction.
3. Writes `audit_logs` row with action `fiscal_period.admin_override_post` *first* (with required `reason`).
4. Sets `SET LOCAL app.admin_override = 'on'` so the trigger lets the JE through.
5. Calls `fn()` (which internally calls `ledgerService.postJournalEntry`).
6. Commits or rolls back atomically.

A closed-period post **cannot happen without an audit row in the same transaction.**

**Entity state machines:**

| Entity | States | Notes |
|---|---|---|
| `journal_entries` | `draft → posted → voided` | reverse creates a NEW entry |
| `invoices` | `draft → posted → voided`; `posted → paid` (auto, via applications) | `paid` is denormalized convenience flag on top of `posted` |
| `payments` | `draft → posted → voided` | applications can be added/removed in either state |
| `credit_memos` | `draft → posted → voided`; `posted → applied` (auto) | |
| `fiscal_periods` | `open → closed → open` | reopen is admin-only |

---

## 8. Validation and error model

**Two-place validation:**
1. **Input shape** — zod schemas in `packages/shared/schemas/`, used by both frontend forms and API routes. Failure → 400 with field-level errors.
2. **Business rules** — inside services (status transitions, balance, period gating, role checks). Failure → typed `BusinessRuleError` with `code` field. Express error middleware translates to HTTP.

**Standard error response shape:**

```json
{
  "error": {
    "code": "CLOSED_PERIOD",
    "message": "Cannot post to closed period 2026-Q1 (closed 2026-04-15).",
    "details": { "period_id": "...", "closed_at": "..." },
    "field_errors": null
  },
  "request_id": "01HXY..."
}
```

**Status code guide:**

| Status | When |
|---|---|
| 400 | input shape failed zod (`field_errors` populated) |
| 401 | token missing / expired / invalid |
| 403 | role insufficient OR no `user_business_access` for this business |
| 404 | entity not found OR exists but not visible to this user (don't leak) |
| 409 | business rule violation (closed period, unbalanced JE, voiding invoice with applied payments, etc.) |
| 500 | unexpected; logged with `request_id`; client sees `{code: "INTERNAL", request_id}` |

**Error codes** are typed string constants in `packages/shared/errorCodes.ts`. Initial set includes: `VALIDATION_FAILED`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CLOSED_PERIOD`, `UNBALANCED_ENTRY`, `INVALID_STATE_TRANSITION`, `IMMUTABLE_RECORD`, `OVERAPPLICATION`, `INTERNAL`.

---

## 9. Testing strategy

**Three layers, explicit coverage targets.**

### Unit (vitest) — pure functions, no I/O
- Decimal helpers (add/subtract/multiply/round-half-even)
- Journal entry balance check (the function the trigger duplicates in JS)
- Tax calculation rounding
- Aging bucket math (current / 30 / 60 / 90+ given a date)
- Period membership for a date
- **Target:** 100% coverage on `packages/shared/` and on every helper in `services/*/lib/`.

### Integration (vitest + Testcontainers Postgres) — real DB
- Every public service method: ≥1 happy-path and ≥1 failure-path test.
- Every DB trigger / constraint exercised by a test that tries to violate it (unbalanced JE, UPDATE of posted JE, INSERT into closed period, override path with audit assertion, etc.).
- Multi-step flows: invoice draft → add lines → post → verify JE shape → record payment → apply → verify invoice flips to `paid` → verify customer balance.
- Concurrent posting (two transactions race to post the same draft → exactly one wins).
- **TDD discipline mandatory for `core/ledgerService`** — every method written test-first. Other services use TDD where convenient.

### E2E (Playwright) — 5-10 scenarios max, "wires connected" only
- Login → dashboard loads.
- Customer → invoice → post → payment → trial balance reflects it.
- Closed period: attempt post → UI surfaces 409 with the right message.
- Logout → access token rejected.
- Refresh token rotation works silently.

### CI policy
- Unit + integration on every PR.
- E2E nightly + on `main`.

---

## 10. Frontend page inventory

Layout shell: top bar (business switcher + user menu), left sidebar nav, main content. shadcn/ui patterns: `Sidebar`, `DataTable`, `Form`, `Dialog`.

| Route | Purpose |
|---|---|
| `/login` | login form |
| `/dashboard` | this-period totals: AR balance, invoice count, payment total, top open invoices |
| `/customers`, `/customers/:id`, `/customers/new` | CRUD |
| `/invoices`, `/invoices/:id`, `/invoices/new` | list with filters; detail shows lines + linked JE + payments applied; actions: post, void |
| `/payments`, `/payments/:id`, `/payments/new` | list; detail shows applications; actions: post, void, apply, unapply |
| `/credit-memos`, `/credit-memos/:id`, `/credit-memos/new` | similar to invoices |
| `/journal-entries`, `/journal-entries/:id`, `/journal-entries/new` | manual JE creation; detail shows lines and source linkage |
| `/reports/trial-balance` | period-scoped trial balance |
| `/reports/aging` | AR aging report |
| `/settings/coa` | chart-of-accounts admin |
| `/settings/tax-codes` | tax code + rate management |
| `/settings/fiscal-periods` | open/close periods |
| `/settings/users` | firm_admin only — user list, roles, business access matrix |

Total: 13 page roots, ~25-30 distinct screens including create/detail variants.

---

## 11. Seed data

Single `npm run db:seed` script produces:
- 1 firm: "Acme Accounting LLC"
- 1 firm_admin user: `admin@example.com` — password handling differs by env:
  - Local dev (`db:seed`): random password printed to stdout once
  - Production (separate `bin/create-admin.ts` script): admin email + password supplied via env vars; no stdout print
- 2 demo client businesses: "Blue Widget Co.", "Green Gadgets Inc."
- Default COA per business (~30 accounts, standard small-business layout: 1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx revenue, 5xxx expenses)
- 12 monthly fiscal periods for current calendar year, all `open`
- 2-3 sample customers per business
- 1-2 sample tax codes per business (e.g., "CA Sales Tax 8.75%")

---

## 12. Dev workflow

```bash
git clone <repo> && cd accounting-app
npm install
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev          # api + web in parallel
```

Tests:
```bash
npm test                    # unit, fast
npm run test:integration    # spins up Postgres via Testcontainers
npm run test:e2e            # Playwright
```

---

## 13. Out of scope (Slice 2+) — locked

- AP (vendors, bills, vendor payments)
- Banking + reconciliation + CSV import
- P&L, Balance Sheet, Cash Flow Statement reports
- Month-end close formal workflow + retained earnings rollover
- Email + password reset
- Attachments
- Multi-currency
- Multi-firm UI
- Recurring invoices
- Customer-facing portal
- Tax filings / 1099 reports
- Convert overpayment to credit memo

---

## 14. Known risks and open implementation questions

1. **pgbouncer interaction with `SET LOCAL`.** The session-flag pattern for admin override and controlled void only works under session pooling. Verify Railway's default Postgres connection mode early. If transaction pooling, switch to a dedicated DB role for the override path instead.
2. **Cross-origin cookies (Netlify ↔ Railway).** Refresh-token cookie needs `SameSite=None + Secure + httpOnly` and the API needs CORS `credentials: true` with strict origin allowlist. Test end-to-end before building real flows on top.
3. **Decimal serialization across the wire.** `numeric(19,4)` → JSON: serialize as string in API responses, parse with decimal.js on the client. Never ship as `Number` (would lose precision on large amounts).
4. **Concurrent posting.** Two staff members posting the same draft invoice simultaneously must result in exactly one success. Use optimistic concurrency (`status='draft'` in the WHERE clause of the UPDATE that flips to `posted` — one of them gets `0 rows updated` and we return 409).
5. **Polymorphic source_id on `journal_entries`.** No FK constraint enforces type-correct linkage; the trigger does. Keep an integration test that intentionally violates this to confirm the trigger catches it.
6. **Seed admin password.** Print once to stdout during `db:seed`. Document that you must change it before any real use.

---

## 15. Definition of done for Slice 1

- All schema migrations applied, all triggers active, all integration tests green.
- All Slice 1 service methods have ≥1 happy and ≥1 failure integration test.
- All `core/ledgerService` methods have unit tests written before implementation (verifiable via git log).
- Every audit action constant has a service that emits it AND a test that asserts the audit row appears in the same transaction.
- Frontend reaches all 13 page roots, can complete the E2E scenarios listed in §9.
- App is deployed: API on Railway, Postgres on Railway, web on Netlify, login works end-to-end, refresh token rotation works.
- Seed data loads cleanly into a fresh DB.
- README documents setup, deploy, and the hard out-of-scope list.

This spec is the contract. Anything not listed here is out of scope for Slice 1 and is a candidate for Slice 2's brainstorming.
