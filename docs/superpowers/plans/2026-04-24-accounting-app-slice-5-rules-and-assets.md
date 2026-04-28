# Slice 5 — Rules Engine + Fixed Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Two complementary features: (1) a **rules engine** that auto-categorizes unreviewed bank transactions by description+amount patterns, and (2) a **fixed assets** register with straight-line monthly depreciation that posts JEs via the ledger.

**Architecture:** Mirrors Slice 3/4 patterns. Two new data domains:
- `bank_transaction_rules` — per-business rules that match on description pattern + amount criteria and apply an offset account.
- `fixed_assets` + `depreciation_entries` — register + ledger-emitting depreciation runs.

Rules apply in priority order when invoked; depreciation posts a manual JE via `core/ledgerService.postJournalEntry` with `source_type: 'manual'`.

**Tech Stack:** No new deps.

---

## Locked decisions

1. **Rule match criteria (v1):** substring match on `description` (case-insensitive), optional amount range (`min_amount`, `max_amount`), optional sign filter (`inflow_only`, `outflow_only`, `any`). Regex support deferred to 5.5+.
2. **Rule action:** sets `offset_account_id` — when applied, runs the existing `categorize()` service path (which creates a JE + updates bank_transaction). No separate "rule action" types.
3. **Apply rules** is manual (user clicks "Apply rules" on the inbox). Auto-apply on import is deferred.
4. **Fixed asset depreciation:** straight-line only. Monthly depreciation = `(cost - salvage) / (useful_life_years * 12)`.
5. **Depreciation accounts:** user picks per-asset `depreciation_expense_account_id` (any expense CoA row) and `accumulated_depreciation_account_id` (any asset contra — user picks; for simplicity any asset account is allowed and we don't enforce contra-asset). CoA doesn't have a contra flag in current model.
6. **Depreciation entries are idempotent by (asset_id, period_end):** re-running for a period that already posted is a no-op (PreconditionError on duplicate).
7. **Dispose an asset:** future slice; out of scope here.
8. Plan-impl sync: any deviation → patch the plan markdown in the same commit.

---

## Pacing + gotchas (inherits)

- `no-explicit-any: error`
- `exactOptionalPropertyTypes: true`
- `Generated<ColumnType<>>` double-wrap — avoid (use `ColumnType<string, string | number | undefined, string | number>`)
- Service signature: `(trx, ctx, args)`; audit in same tx
- Only `core/ledgerService.postJournalEntry` writes JEs
- Router mount: `router.use('/businesses/:businessId', requireAuth, resolveBusiness);`
- `no-explicit-any` forbids `catch (e: any)` — use `catch (e: unknown)` + typed narrowing

---

## Phase A — Data + shared

### Task 1: bank_transaction_rules table

**File:** Create `db/migrations/0025_bank_transaction_rules.sql`

```sql
CREATE TYPE bank_rule_sign_filter AS ENUM ('any', 'inflow_only', 'outflow_only');

CREATE TABLE bank_transaction_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description_contains text NOT NULL CHECK (length(description_contains) BETWEEN 1 AND 500),
  min_amount numeric(19,4),
  max_amount numeric(19,4),
  sign_filter bank_rule_sign_filter NOT NULL DEFAULT 'any',
  offset_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  priority int NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT btr_amount_range CHECK (min_amount IS NULL OR max_amount IS NULL OR min_amount <= max_amount)
);
CREATE INDEX idx_btr_biz_active ON bank_transaction_rules(business_id, priority) WHERE is_active AND deleted_at IS NULL;
CREATE TRIGGER btr_updated_at BEFORE UPDATE ON bank_transaction_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Apply + commit: `feat(db): bank_transaction_rules table`

---

### Task 2: fixed_assets + depreciation_entries tables

**File:** Create `db/migrations/0026_fixed_assets.sql`

```sql
CREATE TYPE fixed_asset_status AS ENUM ('active', 'disposed');
CREATE TYPE depreciation_method AS ENUM ('straight_line');

CREATE TABLE fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  asset_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  depreciation_expense_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  accumulated_depreciation_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  purchase_date date NOT NULL,
  cost numeric(19,4) NOT NULL CHECK (cost > 0),
  salvage_value numeric(19,4) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0),
  useful_life_years int NOT NULL CHECK (useful_life_years BETWEEN 1 AND 100),
  depreciation_method depreciation_method NOT NULL DEFAULT 'straight_line',
  status fixed_asset_status NOT NULL DEFAULT 'active',
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT fa_salvage_lt_cost CHECK (salvage_value < cost)
);
CREATE INDEX idx_fa_biz ON fixed_assets(business_id) WHERE deleted_at IS NULL;
CREATE TRIGGER fa_updated_at BEFORE UPDATE ON fixed_assets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE depreciation_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixed_asset_id uuid NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  period_end date NOT NULL,
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  journal_entry_id uuid NOT NULL REFERENCES journal_entries(id),
  posted_at timestamptz NOT NULL DEFAULT now(),
  posted_by_user_id uuid REFERENCES users(id),
  CONSTRAINT de_unique_period UNIQUE (fixed_asset_id, period_end)
);
CREATE INDEX idx_de_asset ON depreciation_entries(fixed_asset_id);
```

Apply + commit: `feat(db): fixed_assets + depreciation_entries tables`

---

### Task 3: DB types + audit + schemas + factories

**Files:**
- Modify: `apps/api/src/db/types.ts`
- Modify: `packages/shared/src/auditActions.ts`
- Create: `packages/shared/src/schemas/bankTransactionRule.ts`, `fixedAsset.ts`
- Modify: `packages/shared/src/schemas/index.ts`
- Modify: `apps/api/tests/helpers/factories.ts`, `testDb.ts`

**DB types** — add:
```ts
export type BankRuleSignFilter = 'any' | 'inflow_only' | 'outflow_only';
export type FixedAssetStatus = 'active' | 'disposed';
export type DepreciationMethod = 'straight_line';

export interface BankTransactionRulesTable {
  id: Generated<string>;
  business_id: string;
  name: string;
  description_contains: string;
  min_amount: ColumnType<string | null, string | number | null | undefined, string | number | null>;
  max_amount: ColumnType<string | null, string | number | null | undefined, string | number | null>;
  sign_filter: Generated<BankRuleSignFilter>;
  offset_account_id: string;
  priority: Generated<number>;
  is_active: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface FixedAssetsTable {
  id: Generated<string>;
  business_id: string;
  name: string;
  asset_account_id: string;
  depreciation_expense_account_id: string;
  accumulated_depreciation_account_id: string;
  purchase_date: ColumnType<string, string, string>;
  cost: ColumnType<string, string | number, string | number>;
  salvage_value: ColumnType<string, string | number | undefined, string | number>;
  useful_life_years: number;
  depreciation_method: Generated<DepreciationMethod>;
  status: Generated<FixedAssetStatus>;
  memo: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface DepreciationEntriesTable {
  id: Generated<string>;
  fixed_asset_id: string;
  period_end: ColumnType<string, string, string>;
  amount: ColumnType<string, string | number, string | number>;
  journal_entry_id: string;
  posted_at: Generated<Timestamp>;
  posted_by_user_id: string | null;
}
```

Append to `DB`:
```ts
  bank_transaction_rules: BankTransactionRulesTable;
  fixed_assets: FixedAssetsTable;
  depreciation_entries: DepreciationEntriesTable;
```

**Audit actions** — append to AUDIT:
```ts
  BANK_RULE_CREATE: 'bank_rule.create',
  BANK_RULE_UPDATE: 'bank_rule.update',
  BANK_RULE_DELETE: 'bank_rule.delete',
  BANK_RULE_APPLY: 'bank_rule.apply',
  FIXED_ASSET_CREATE: 'fixed_asset.create',
  FIXED_ASSET_UPDATE: 'fixed_asset.update',
  FIXED_ASSET_DEPRECIATE: 'fixed_asset.depreciate',
```

**Zod schemas** — create the two files:

`bankTransactionRule.ts`:
```ts
import { z } from 'zod';
const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);

export const bankRuleCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description_contains: z.string().min(1).max(500),
  min_amount: moneyStr.nullable().optional(),
  max_amount: moneyStr.nullable().optional(),
  sign_filter: z.enum(['any','inflow_only','outflow_only']).optional(),
  offset_account_id: z.string().uuid(),
  priority: z.number().int().min(0).max(10000).optional(),
});
export const bankRuleUpdateSchema = bankRuleCreateSchema.partial().extend({ is_active: z.boolean().optional() });
export const bankRuleApplySchema = z.object({
  bank_account_id: z.string().uuid(),
});
```

`fixedAsset.ts`:
```ts
import { z } from 'zod';
const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const fixedAssetCreateSchema = z.object({
  name: z.string().min(1).max(200),
  asset_account_id: z.string().uuid(),
  depreciation_expense_account_id: z.string().uuid(),
  accumulated_depreciation_account_id: z.string().uuid(),
  purchase_date: dateStr,
  cost: moneyStr,
  salvage_value: moneyStr.optional(),
  useful_life_years: z.number().int().min(1).max(100),
  memo: z.string().max(500).nullable().optional(),
});
export const fixedAssetUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  memo: z.string().max(500).nullable().optional(),
});

export const depreciationRunSchema = z.object({
  period_end: dateStr,
});
```

**index.ts:** append `export * from './bankTransactionRule.js'; export * from './fixedAsset.js';`

**Factories:**
```ts
export async function makeBankRule(db: Kysely<DB>, business_id: string, offset_account_id: string, opts: Partial<{ name: string; description_contains: string; sign_filter: 'any'|'inflow_only'|'outflow_only' }> = {}) {
  return db.insertInto('bank_transaction_rules').values({
    business_id, offset_account_id,
    name: opts.name ?? 'Test Rule',
    description_contains: opts.description_contains ?? 'stripe',
    sign_filter: opts.sign_filter ?? 'any',
  }).returningAll().executeTakeFirstOrThrow();
}

export async function makeFixedAsset(db: Kysely<DB>, business_id: string, accounts: { asset: string; dep_expense: string; accumulated: string }, opts: Partial<{ name: string; cost: string; salvage_value: string; useful_life_years: number; purchase_date: string }> = {}) {
  return db.insertInto('fixed_assets').values({
    business_id,
    name: opts.name ?? 'Laptop',
    asset_account_id: accounts.asset,
    depreciation_expense_account_id: accounts.dep_expense,
    accumulated_depreciation_account_id: accounts.accumulated,
    purchase_date: opts.purchase_date ?? '2026-01-01',
    cost: opts.cost ?? '2400.00',
    salvage_value: opts.salvage_value ?? '0',
    useful_life_years: opts.useful_life_years ?? 2,
  }).returningAll().executeTakeFirstOrThrow();
}
```

**testDb.ts truncateAll:** add `'depreciation_entries', 'fixed_assets', 'bank_transaction_rules'` BEFORE the banking tables.

Build shared + commit: `feat(shared,api): Slice 5 DB types, audit actions, schemas, factories`

---

## Phase B — Services (parallel)

### Task 4: Bank rule CRUD service (TDD, 3 tests)

**Files:**
- Create: `apps/api/src/services/banking/bankRuleService.ts`
- Create: `apps/api/tests/integration/bankRuleService.test.ts`

**Functions:**
```ts
export type CreateRuleInput = {
  business_id: string; name: string; description_contains: string;
  min_amount: string | null; max_amount: string | null;
  sign_filter: 'any' | 'inflow_only' | 'outflow_only';
  offset_account_id: string; priority: number;
};
export async function createRule(trx, ctx, input): BankTransactionRule
export async function updateRule(trx, ctx, { rule_id, patch })
export async function deleteRule(trx, ctx, { rule_id })  // soft-delete
export async function listRules(db, business_id): BankTransactionRule[]
```

**Tests:** createRule happy path; updateRule patches; listRules returns active rules sorted by priority.

Commit: `feat(api): bank rule CRUD service with TDD`

---

### Task 5: Rule-apply service (TDD, 2 tests)

**Files:**
- Create: `apps/api/src/services/banking/ruleApplyService.ts`
- Create: `apps/api/tests/integration/ruleApply.test.ts`

**Function:**
```ts
export async function applyRules(trx: Transaction<DB>, ctx: ServiceCtx, input: { business_id: string; bank_account_id: string }): Promise<{ applied: number; rules_tried: number }>
```

Behavior:
1. Fetch active rules for business, ordered by priority ASC.
2. Fetch unreviewed bank_transactions for the bank_account_id.
3. For each txn, iterate rules in order:
   - Sign filter: `inflow_only` requires amount > 0; `outflow_only` requires amount < 0; `any` matches either.
   - Description: lowercase(txn.description) must contain lowercase(rule.description_contains).
   - Amount range: if `min_amount`/`max_amount` set, `abs(amount)` must fall within.
   - First match wins.
4. If a matching rule is found, call the existing `bankTransactionService.categorize(trx, ctx, { bank_transaction_id, offset_account_id, memo: null })`.
5. Record `AUDIT.BANK_RULE_APPLY` at the end with `{ applied, rules_tried }`.

**Tests:**
1. `applyRules categorizes unreviewed txns that match a rule's description` — import 3 txns (1 matches "STRIPE", 2 don't); create rule with `description_contains='stripe'`; run applyRules; verify 1 txn categorized, 2 still unreviewed.
2. `applyRules respects priority order (first match wins)` — 2 rules match same txn; verify lower-priority rule applied.

Commit: `feat(api): bank rule apply service (auto-categorize unreviewed txns)`

---

### Task 6: Fixed asset CRUD service (TDD, 2 tests)

**Files:**
- Create: `apps/api/src/services/assets/fixedAssetService.ts`
- Create: `apps/api/tests/integration/fixedAssetService.test.ts`

**Functions:**
```ts
export async function createFixedAsset(trx, ctx, input): FixedAsset
export async function updateFixedAsset(trx, ctx, { fixed_asset_id, patch })
export async function listFixedAssets(db, business_id): FixedAsset[] // with accumulated_depreciation sum
export async function getFixedAsset(db, business_id, id)
```

Validate in createFixedAsset:
- `asset_account_id` exists & business matches & account_type === 'asset'
- `depreciation_expense_account_id` exists & account_type === 'expense'
- `accumulated_depreciation_account_id` exists & account_type === 'asset'
- `salvage_value < cost` (already a DB CHECK, but pre-validate for nice error)

Tests: create happy path; list returns active assets with `accumulated_depreciation` subquery sum from depreciation_entries.

Commit: `feat(api): fixed asset CRUD service with TDD`

---

### Task 7: Depreciation posting service (TDD, 2 tests)

**Files:**
- Create: `apps/api/src/services/assets/depreciationService.ts`
- Create: `apps/api/tests/integration/depreciation.test.ts`

**Function:**
```ts
export async function runDepreciation(trx, ctx, input: { fixed_asset_id: string; period_end: string }): DepreciationEntry
```

Logic:
1. Fetch asset. Must be status='active'.
2. Compute monthly depreciation: `(cost - salvage) / (useful_life_years * 12)`.
3. Check uniqueness via `(fixed_asset_id, period_end)` — if already posted, throw PreconditionError.
4. Call `postJournalEntry` with:
   - `source_type: 'manual'`, `source_id: null`, `entry_date: period_end`, `memo: "Depreciation: {asset.name} {period_end}"`
   - Lines: `{ DR dep_expense amount }`, `{ CR accumulated_depreciation amount }`
5. Insert `depreciation_entries` row with the JE id.
6. Audit `AUDIT.FIXED_ASSET_DEPRECIATE`.

**Tests:**
1. `runDepreciation posts a JE and records the entry` — $2400 asset, 2-year life, monthly = $100. Run for period_end='2026-01-31'. Verify JE has DR dep_expense $100, CR accumulated_dep $100. Verify depreciation_entries row.
2. `runDepreciation rejects duplicate period` — run for same period twice → PreconditionError.

Commit: `feat(api): depreciation posting service with TDD`

---

## Phase C — Routes

### Task 8: Rule + fixed asset + depreciation routes

**Files:**
- Create: `apps/api/src/routes/bankRules.ts`, `fixedAssets.ts`
- Modify: `apps/api/src/app.ts`

**bankRules.ts endpoints:**
- GET `/businesses/:businessId/bank-rules`
- POST `/businesses/:businessId/bank-rules` (staff+) — body `bankRuleCreateSchema`
- PATCH `/businesses/:businessId/bank-rules/:id` (staff+)
- DELETE `/businesses/:businessId/bank-rules/:id` (accountant+)
- POST `/businesses/:businessId/bank-rules/apply` (staff+) — body `bankRuleApplySchema`, returns `{ applied, rules_tried }`

**fixedAssets.ts endpoints:**
- GET `/businesses/:businessId/fixed-assets`
- GET `/businesses/:businessId/fixed-assets/:id`
- POST `/businesses/:businessId/fixed-assets` (staff+) — body `fixedAssetCreateSchema`
- PATCH `/businesses/:businessId/fixed-assets/:id` (staff+)
- POST `/businesses/:businessId/fixed-assets/:id/depreciate` (accountant+) — body `depreciationRunSchema`

Both use `router.use('/businesses/:businessId', requireAuth, resolveBusiness);`. `req: Request` — no `any`. exactOptional patterns for patch construction.

Wire both in app.ts.

Commit: `feat(api): bank rule + fixed asset + depreciation routes`

---

## Phase D — Web (parallel)

### Task 9: Rules page

**File:** Create `apps/web/src/pages/accounting/RulesPage.tsx`

Features:
- Table of rules: Name, Description contains, Amount range, Sign filter, Offset account (code — name), Priority, Active (toggle).
- Inline "New rule" form above the table: name, description_contains, min/max amount (optional), sign filter dropdown, offset account dropdown (any CoA account), priority (default 100).
- Per-row actions: Edit (inline), Delete (confirm).
- "Apply rules to inbox" section at top: select a bank account, click "Apply to unreviewed", show result `"Categorized N of M unreviewed txns"`.

Route: `/accounting/rules`.

Concrete types. No `any`. `catch (e: unknown)` narrowing.

Commit: `feat(web): rules page with CRUD + apply-to-inbox action`

---

### Task 10: Fixed assets pages

**Files:**
- Create: `apps/web/src/pages/accounting/FixedAssetListPage.tsx`
- Create: `apps/web/src/pages/accounting/FixedAssetNewPage.tsx`
- Create: `apps/web/src/pages/accounting/FixedAssetDetailPage.tsx`

**List:** Table — Name, Cost, Salvage, Life (yrs), Purchase Date, Status, Accumulated Dep, Book Value (cost - accumulated), View action.

**New:** Form — name, asset account, depreciation expense account, accumulated depreciation account, purchase date, cost, salvage, useful life years, memo. Submit → detail page.

**Detail:** Shows asset fields + accumulated depreciation + book value. Section: "Depreciation history" (list of depreciation_entries with period_end + amount + linked JE). Section: "Run depreciation" — period_end date input (default = last day of current month) + button. On success, appends to history.

Routes: `/accounting/fixed-assets`, `/accounting/fixed-assets/new`, `/accounting/fixed-assets/:id`.

Concrete types. No `any`.

Commit: `feat(web): fixed assets list/new/detail pages with depreciation run`

---

### Task 11 (consolidated): Wire routes + sidebar

**Files:**
- Modify: `apps/web/src/App.tsx` — 4 new routes (rules + 3 fixed-assets)
- Modify: `apps/web/src/components/layout/Sidebar.tsx` — Accounting group: swap `/accounting/rules` (ComingSoon → real) and `/accounting/fixed-assets` (ComingSoon → real). Add `/accounting/fixed-assets` if not present as a sidebar entry (check — the prior plan had "Fixed Assets" already in Sidebar children array).

Commit: `feat(web): wire rules + fixed assets pages into routes + sidebar`

---

## Phase E — Deploy

### Task 12: Merge, deploy, smoke

- Merge slice-5 to main, push
- Wait Railway redeploy (applies 0025, 0026 migrations)
- HTTP smoke:
  1. Create a rule (description_contains="stripe", offset=revenue 4010)
  2. Import 2 bank transactions ("Stripe payout $1000", "Unknown $50")
  3. POST /bank-rules/apply → verify `applied: 1`
  4. Create a fixed asset (name="Laptop", cost=$2400, life=2yr, salvage=$0; asset=1500, dep_expense=6020, accum_dep=1510 — pick any valid CoA codes per type)
  5. POST /fixed-assets/:id/depreciate for 2026-01-31 → JE posted for $100
  6. GET /fixed-assets/:id → accumulated_depreciation = $100, book value = $2300
  7. Re-run depreciation for 2026-01-31 → rejected with PreconditionError

## Definition of Done

- ≥105 (prior) + 9 new (3+2+2+2) = **≥114 tests passing**
- Web sidebar Accounting > Rules and > Fixed Assets link to real pages
- Railway deployed, migrations 0025-0026 applied
- Browser smoke works: create a rule, apply to inbox, create an asset, run depreciation
