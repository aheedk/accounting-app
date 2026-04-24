# Slice 8 — AP Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 3 AP ComingSoon tabs (AP Overview, Expense Transactions, AP Contractors) with real, ledger-posting features, plus introduce the field-encryption helper that slices 8 and 13 both need. Also performs the step-zero eta cleanup across all remaining ComingSoon stubs.

**Architecture:** New `expense_transactions` table backs a quick-capture lane that posts a JE on save. Vendor 1099 fields get an upgrade: `tax_id` text → `tax_id_encrypted bytea` + `tax_id_last_four text` (encryption via new `fieldCrypto` helper using `@noble/ciphers` xchacha20poly1305). AP Overview is a read-only aggregate over existing bills/payments/vendors. AP Contractors is a filtered Vendors view. Service layer follows the `(trx, ctx, args)` pattern; ledger writes only via `core/ledgerService.postJournalEntry`.

**Tech Stack:** New dep: `@noble/ciphers` (pure-JS xchacha20poly1305 — no native build, Railway-safe). Otherwise reuses the existing Postgres + Kysely + Express + React/Vite/shadcn stack.

---

## Locked decisions

> **Plan-impl drift log** (patched after Phase A/B execution):
> - `bill_payment_applications` column is `applied_amount`, not `amount_applied` (verified at `db/migrations/0018_bill_payments.sql:36`). All queries using it have been updated.
> - `PreconditionError` lives in `apps/api/src/lib/ledgerErrors.js`, not `lib/errors.js`. Service files import from there.
> - `voidJournalEntry` signature is `(trx, ctx, { journal_entry_id, void_reason })`. The service supplies `void_reason ?? 'expense voided'`.
> - The original `et_posted_has_je` biconditional CHECK on `expense_transactions` was loosened to two one-way implications so void rows preserve the JE back-link for audit. Migration 0031 reflects the loosened constraints; voidExpense no longer nulls `journal_entry_id`/`posted_at`.
> - Default seeded CoA already includes code `1010 Cash on Hand`. New tests use `1015` for a manually-created cash row to avoid the `(business_id, code)` unique-constraint collision.
> - Vendor existing test file `vendor.test.ts` was updated by Task 7 to use `tax_id_type: 'EIN'` and assert on `tax_id_last_four` / `tax_id_type` / `tax_id_encrypted` instead of the dropped plaintext field.
> - Test runs use `--pool=forks --poolOptions.forks.singleFork=true` to avoid Docker testcontainer resource exhaustion when running in parallel with other workspaces. The default parallel pool spawned 16+ Postgres containers and timed out hooks.

1. **Field encryption uses xchacha20poly1305 from `@noble/ciphers`** (pure JS). Avoids the libsodium native-build risk on Railway. 24-byte nonce stored as the prefix of the bytea blob: `nonce || ciphertext_with_tag`. Key from env `FIELD_ENCRYPTION_KEY` (32 bytes hex).
2. **Vendor `tax_id` migration is destructive of any existing plaintext data.** Slice 7 hasn't shipped real tenant data yet (still demo-only); we drop the old text column outright. `0030` includes a `WARNING` comment.
3. **`tax_id_type` is required when `tax_id_encrypted` is set.** Enforced by CHECK constraint.
4. **Tax-ID reveal endpoint** (`GET /vendors/:id/tax-id-reveal`) returns full plaintext only to `firm_admin`, audit-logs every call.
5. **Expense Transactions are NOT the same as Bills.** A bill has line items, a vendor, a due date, a payment schedule. An expense transaction is a one-shot DR Expense / CR <payment account> JE. No vendor required (free-text payee allowed).
6. **AP Overview is read-only** — no new tables. Pure aggregate query over `bills`, `bill_payments`, `vendors`.
7. **AP Contractors page is a filter view of vendors** where `is_1099 = true`. No new entity. Inline edit of W-9 fields.
8. **Step-zero commit** updates eta labels in `App.tsx` to align with the spec's slice numbering. Done in this slice (not on `main`) so that the only path to `main` is through merging slice 8.
9. **Plan-impl sync:** any deviation patches this plan markdown in the same commit.

---

## Pacing + gotchas (inherited)

- TS: `no-explicit-any: error`; `catch (e: unknown)` + typed narrowing.
- TS: `exactOptionalPropertyTypes: true` — build patches conditionally, never set keys to `undefined`.
- Kysely: `Generated<ColumnType<>>` is a bug. Use `ColumnType<string, string | number | undefined, string | number>` for numeric/date columns.
- PL/pgSQL tenancy: `COALESCE(current_setting('app.X', true), '')`.
- Route mount: `router.use('/businesses/:businessId', requireAuth, resolveBusiness);` — `:businessId` MUST be in the mount path.
- JE writes only via `core/ledgerService.postJournalEntry`.
- Audit recorded in the same transaction as the entity write.
- `vendors` already has `is_1099 boolean` and `tax_id text` columns. Slice 8 migrates the `tax_id` representation.
- `apps/api/src/services/ap/vendorService.ts` already accepts `is_1099` and `tax_id`. We extend, not replace.

---

## Phase A — Infra + DB

### Task 1: Add `@noble/ciphers` dep + `FIELD_ENCRYPTION_KEY` env var

**Files:**
- Modify: `apps/api/package.json`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Add the dep**

```bash
cd apps/api && npm install @noble/ciphers@^1.0.0 && cd ../..
```

Expected: `package.json` and `package-lock.json` updated.

- [ ] **Step 2: Add env var to `.env.example`**

Append to `.env.example`:

```
# 32-byte hex key used to encrypt sensitive fields (vendor tax IDs, employee SSNs).
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
FIELD_ENCRYPTION_KEY=
```

- [ ] **Step 3: Document in README**

Add a new section to `README.md` after "Quickstart":

```markdown
## Required env vars

- `DATABASE_URL` — Postgres connection string.
- `JWT_SECRET` — JWT signing secret.
- `FIELD_ENCRYPTION_KEY` — 32-byte hex key for sensitive-field encryption (vendor tax IDs, employee SSNs). Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Rotating this key invalidates all encrypted fields — back them up first.
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json apps/api/package-lock.json package-lock.json .env.example README.md
git commit -m "chore(api): add @noble/ciphers dep + FIELD_ENCRYPTION_KEY env var"
```

---

### Task 2: `fieldCrypto.ts` helper (TDD)

**Files:**
- Create: `apps/api/src/lib/fieldCrypto.ts`
- Create: `apps/api/tests/unit/fieldCrypto.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/unit/fieldCrypto.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { encryptField, decryptField, lastFour } from '../../src/lib/fieldCrypto.js';

describe('fieldCrypto', () => {
  beforeEach(() => {
    process.env['FIELD_ENCRYPTION_KEY'] =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  it('round-trips an SSN through encrypt+decrypt', () => {
    const plain = '123-45-6789';
    const blob = encryptField(plain);
    expect(blob).toBeInstanceOf(Buffer);
    expect(blob.byteLength).toBeGreaterThan(plain.length);
    expect(decryptField(blob)).toBe(plain);
  });

  it('produces a different ciphertext each call (random nonce)', () => {
    const a = encryptField('123-45-6789');
    const b = encryptField('123-45-6789');
    expect(Buffer.compare(a, b)).not.toBe(0);
    expect(decryptField(a)).toBe(decryptField(b));
  });

  it('lastFour returns the last 4 digits ignoring non-digits', () => {
    expect(lastFour('123-45-6789')).toBe('6789');
    expect(lastFour('EIN: 12-3456789')).toBe('6789');
    expect(lastFour('12')).toBe('12');
  });

  it('throws if FIELD_ENCRYPTION_KEY is missing', () => {
    delete process.env['FIELD_ENCRYPTION_KEY'];
    expect(() => encryptField('x')).toThrow(/FIELD_ENCRYPTION_KEY/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm --workspace apps/api test -- tests/unit/fieldCrypto.test.ts
```

Expected: FAIL — `fieldCrypto` module not found.

- [ ] **Step 3: Implement `fieldCrypto.ts`**

Create `apps/api/src/lib/fieldCrypto.ts`:

```ts
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { randomBytes } from 'node:crypto';

const NONCE_BYTES = 24;

function getKey(): Uint8Array {
  const hex = process.env['FIELD_ENCRYPTION_KEY'];
  if (!hex || hex.length !== 64) {
    throw new Error('FIELD_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

export function encryptField(plaintext: string): Buffer {
  const key = getKey();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = xchacha20poly1305(key, nonce);
  const ct = cipher.encrypt(new TextEncoder().encode(plaintext));
  return Buffer.concat([nonce, Buffer.from(ct)]);
}

export function decryptField(blob: Buffer): string {
  const key = getKey();
  const nonce = blob.subarray(0, NONCE_BYTES);
  const ct = blob.subarray(NONCE_BYTES);
  const cipher = xchacha20poly1305(key, nonce);
  const pt = cipher.decrypt(ct);
  return new TextDecoder().decode(pt);
}

export function lastFour(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.slice(-4);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm --workspace apps/api test -- tests/unit/fieldCrypto.test.ts
```

Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/fieldCrypto.ts apps/api/tests/unit/fieldCrypto.test.ts
git commit -m "feat(api): fieldCrypto helper (xchacha20poly1305) with TDD"
```

---

### Task 3: Migration `0030_vendor_1099_fields.sql`

**Files:**
- Create: `db/migrations/0030_vendor_1099_fields.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0030_vendor_1099_fields.sql
-- Replace plaintext vendors.tax_id with encrypted blob + last-4 + type enum.
-- WARNING: this drops the old plaintext column. The app has no real tenant
-- data yet (demo only), so the loss is acceptable. If real data ever exists,
-- write a one-shot script that encrypts each row before this migration runs.

CREATE TYPE tax_id_type AS ENUM ('SSN', 'EIN');

ALTER TABLE vendors
  DROP COLUMN tax_id;

ALTER TABLE vendors
  ADD COLUMN tax_id_encrypted bytea,
  ADD COLUMN tax_id_last_four text CHECK (tax_id_last_four IS NULL OR tax_id_last_four ~ '^\d{1,4}$'),
  ADD COLUMN tax_id_type tax_id_type;

ALTER TABLE vendors
  ADD CONSTRAINT vendors_tax_id_consistent CHECK (
    (tax_id_encrypted IS NULL AND tax_id_last_four IS NULL AND tax_id_type IS NULL)
    OR (tax_id_encrypted IS NOT NULL AND tax_id_last_four IS NOT NULL AND tax_id_type IS NOT NULL)
  );
```

- [ ] **Step 2: Run migrations against the test container**

```bash
npm --workspace apps/api test -- tests/integration/db.smoke.test.ts 2>/dev/null || npm --workspace apps/api run migrate:up:test 2>/dev/null || true
# If neither helper exists, the testDb.ts auto-migration on first integration test will catch it.
npm --workspace apps/api test -- tests/integration/vendor.test.ts
```

Expected: existing vendor tests still pass (they don't touch `tax_id`).

- [ ] **Step 3: Commit**

```bash
git add db/migrations/0030_vendor_1099_fields.sql
git commit -m "feat(db): replace vendors.tax_id text with encrypted bytea + last_four + type enum"
```

---

### Task 4: Migration `0031_expense_transactions.sql`

**Files:**
- Create: `db/migrations/0031_expense_transactions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0031_expense_transactions.sql
CREATE TYPE expense_transaction_status AS ENUM ('draft', 'posted', 'void');

CREATE TABLE expense_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  transaction_date date NOT NULL,
  payee_text text,
  vendor_id uuid REFERENCES vendors(id),
  expense_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  payment_account_id uuid NOT NULL REFERENCES chart_of_accounts(id),
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  memo text,
  status expense_transaction_status NOT NULL DEFAULT 'draft',
  journal_entry_id uuid REFERENCES journal_entries(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id),
  posted_at timestamptz,
  posted_by_user_id uuid REFERENCES users(id),
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES users(id),
  CONSTRAINT et_payee CHECK (payee_text IS NOT NULL OR vendor_id IS NOT NULL),
  CONSTRAINT et_posted_has_je CHECK (
    (status = 'posted') = (journal_entry_id IS NOT NULL AND posted_at IS NOT NULL)
  ),
  CONSTRAINT et_voided_state CHECK (
    (status = 'void') = (voided_at IS NOT NULL)
  )
);

CREATE INDEX idx_et_biz_date ON expense_transactions(business_id, transaction_date DESC);
CREATE INDEX idx_et_biz_status ON expense_transactions(business_id, status);
CREATE INDEX idx_et_vendor ON expense_transactions(vendor_id) WHERE vendor_id IS NOT NULL;
CREATE TRIGGER expense_transactions_updated_at
  BEFORE UPDATE ON expense_transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

- [ ] **Step 2: Verify with a vendor-table integration test re-run**

```bash
npm --workspace apps/api test -- tests/integration
```

Expected: existing tests still pass; new table exists in test container.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/0031_expense_transactions.sql
git commit -m "feat(db): expense_transactions table"
```

---

### Task 5: Augment `apps/api/src/db/types.ts`

**Files:**
- Modify: `apps/api/src/db/types.ts`

- [ ] **Step 1: Update `VendorsTable` interface**

Replace the existing `tax_id` line with:

```ts
  tax_id_encrypted: Buffer | null;
  tax_id_last_four: string | null;
  tax_id_type: 'SSN' | 'EIN' | null;
```

(Delete the old `tax_id: string | null;` line.)

- [ ] **Step 2: Append `ExpenseTransaction*` types**

Append before the `DB` interface:

```ts
export type ExpenseTransactionStatus = 'draft' | 'posted' | 'void';

export interface ExpenseTransactionsTable {
  id: Generated<string>;
  business_id: string;
  transaction_date: ColumnType<string, string, string>;
  payee_text: string | null;
  vendor_id: string | null;
  expense_account_id: string;
  payment_account_id: string;
  amount: ColumnType<string, string | number, string | number>;
  memo: string | null;
  status: Generated<ExpenseTransactionStatus>;
  journal_entry_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  created_by_user_id: string | null;
  posted_at: Timestamp | null;
  posted_by_user_id: string | null;
  voided_at: Timestamp | null;
  voided_by_user_id: string | null;
}
```

- [ ] **Step 3: Add to `DB` interface**

Inside the `DB` interface, append:

```ts
  expense_transactions: ExpenseTransactionsTable;
```

- [ ] **Step 4: Typecheck**

```bash
npm --workspace apps/api run typecheck
```

Expected: 0 errors. (The vendor service will have type errors from the dropped `tax_id` field — those are fixed in Task 8. If the typecheck fails specifically on `vendorService.ts:tax_id`, that's expected and Task 8 will resolve it. Skip the typecheck pass on those lines for now.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/types.ts
git commit -m "feat(api): augment DB type with expense_transactions + vendor tax_id fields"
```

---

### Task 6: Audit actions + zod schemas + factories + truncateAll

**Files:**
- Modify: `packages/shared/src/auditActions.ts`
- Create: `packages/shared/src/schemas/expenseTransaction.ts`
- Modify: `packages/shared/src/schemas/vendor.ts`
- Modify: `packages/shared/src/schemas/index.ts`
- Modify: `apps/api/tests/helpers/factories.ts`
- Modify: `apps/api/tests/helpers/testDb.ts`

- [ ] **Step 1: Append audit actions**

Append to the `AUDIT` object in `packages/shared/src/auditActions.ts` (before the closing brace):

```ts
  // Slice 8 — AP polish
  EXPENSE_TRANSACTION_CREATE: 'expense_transaction.create',
  EXPENSE_TRANSACTION_UPDATE: 'expense_transaction.update',
  EXPENSE_TRANSACTION_POST: 'expense_transaction.post',
  EXPENSE_TRANSACTION_VOID: 'expense_transaction.void',
  VENDOR_TAX_ID_REVEAL: 'vendor.tax_id_reveal',
```

- [ ] **Step 2: Create expenseTransaction schemas**

Create `packages/shared/src/schemas/expenseTransaction.ts`:

```ts
import { z } from 'zod';
const moneyStr = z.string().regex(/^\d+(\.\d+)?$/);

export const expenseTransactionCreateSchema = z.object({
  transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payee_text: z.string().min(1).max(200).nullable().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  expense_account_id: z.string().uuid(),
  payment_account_id: z.string().uuid(),
  amount: moneyStr,
  memo: z.string().max(500).nullable().optional(),
}).refine(
  v => Boolean(v.payee_text) || Boolean(v.vendor_id),
  { message: 'either payee_text or vendor_id is required' },
);
export type ExpenseTransactionCreate = z.infer<typeof expenseTransactionCreateSchema>;

export const expenseTransactionUpdateSchema = z.object({
  transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  payee_text: z.string().min(1).max(200).nullable().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  expense_account_id: z.string().uuid().optional(),
  payment_account_id: z.string().uuid().optional(),
  amount: moneyStr.optional(),
  memo: z.string().max(500).nullable().optional(),
});
```

- [ ] **Step 3: Update vendor schemas to include `tax_id_type`**

Read `packages/shared/src/schemas/vendor.ts`. Add a `tax_id_type` enum field alongside the existing `tax_id` field on both create and update schemas:

```ts
tax_id: z.string().min(1).max(20).nullable().optional(),
tax_id_type: z.enum(['SSN', 'EIN']).nullable().optional(),
```

Add a `.refine()` on each schema: when `tax_id` is set, `tax_id_type` must also be set, and vice versa.

```ts
.refine(
  v => (v.tax_id == null) === (v.tax_id_type == null),
  { message: 'tax_id and tax_id_type must be set together' },
)
```

- [ ] **Step 4: Re-export the new schema**

Append to `packages/shared/src/schemas/index.ts`:

```ts
export * from './expenseTransaction.js';
```

- [ ] **Step 5: Add factory `makeExpenseTransaction`**

Append to `apps/api/tests/helpers/factories.ts`:

```ts
export async function makeExpenseTransaction(
  db: Kysely<DB>,
  business_id: string,
  expense_account_id: string,
  payment_account_id: string,
  opts: Partial<{ amount: string; payee_text: string; transaction_date: string }> = {},
) {
  return db.insertInto('expense_transactions').values({
    business_id,
    expense_account_id,
    payment_account_id,
    amount: opts.amount ?? '50.00',
    payee_text: opts.payee_text ?? 'Test Payee',
    transaction_date: opts.transaction_date ?? '2026-04-01',
  }).returningAll().executeTakeFirstOrThrow();
}
```

- [ ] **Step 6: Update `truncateAll` in testDb.ts**

Edit `apps/api/tests/helpers/testDb.ts`. Add `expense_transactions,` as the first table in the `TRUNCATE` list (it depends on `vendors`, `chart_of_accounts`, `journal_entries`, `users` — must be truncated first).

- [ ] **Step 7: Build shared + run a quick test**

```bash
npm --workspace packages/shared run build
npm --workspace apps/api test -- tests/integration/vendor.test.ts
```

Expected: PASS (vendor tests don't yet exercise the new tax_id fields).

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/auditActions.ts packages/shared/src/schemas/expenseTransaction.ts packages/shared/src/schemas/vendor.ts packages/shared/src/schemas/index.ts apps/api/tests/helpers/factories.ts apps/api/tests/helpers/testDb.ts
git commit -m "feat(shared,api): slice 8 audit actions, schemas, factories, truncateAll"
```

---

## Phase B — Services (parallel after Phase A; each task in its own subagent)

### Task 7: `vendorService.ts` extension — encrypted tax_id + reveal (TDD, 2 tests)

**Files:**
- Modify: `apps/api/src/services/ap/vendorService.ts`
- Create: `apps/api/tests/integration/vendorTaxId.test.ts`

**Owns (write):** `vendorService.ts`, `vendorTaxId.test.ts`.
**Must NOT modify:** anything outside the two files above.

- [ ] **Step 1: Write failing tests**

Create `apps/api/tests/integration/vendorTaxId.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess } from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as vend from '../../src/services/ap/vendorService.js';

let t: TestDb;
beforeAll(async () => {
  t = await startTestDb();
  process.env['FIELD_ENCRYPTION_KEY'] =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
});
beforeEach(async () => { await truncateAll(t.db); });

describe('vendor tax_id (encrypted)', () => {
  it('createVendor with tax_id stores encrypted blob + last_four + type', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id);
    await grantAccess(t.db, user.id, biz.id);
    const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });

    const v = await t.db.transaction().execute(trx =>
      vend.createVendor(trx, ctx, {
        business_id: biz.id, name: 'Acme', is_1099: true,
        tax_id: '123-45-6789', tax_id_type: 'SSN',
      }),
    );

    expect(v.tax_id_last_four).toBe('6789');
    expect(v.tax_id_type).toBe('SSN');
    expect(v.tax_id_encrypted).toBeInstanceOf(Buffer);

    const revealed = await vend.revealTaxId(t.db, ctx, { vendor_id: v.id });
    expect(revealed).toBe('123-45-6789');
  });

  it('revealTaxId is audit-logged with action vendor.tax_id_reveal', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id);
    await grantAccess(t.db, user.id, biz.id);
    const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });

    const v = await t.db.transaction().execute(trx =>
      vend.createVendor(trx, ctx, {
        business_id: biz.id, name: 'Acme', is_1099: true,
        tax_id: '12-3456789', tax_id_type: 'EIN',
      }),
    );

    await vend.revealTaxId(t.db, ctx, { vendor_id: v.id });

    const logs = await t.db.selectFrom('audit_logs').selectAll()
      .where('action', '=', 'vendor.tax_id_reveal').execute();
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0]?.entity_id).toBe(v.id);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm --workspace apps/api test -- tests/integration/vendorTaxId.test.ts
```

Expected: FAIL — `tax_id_type` not on `CreateVendorInput`, `revealTaxId` not exported.

- [ ] **Step 3: Update `vendorService.ts`**

Modify `CreateVendorInput`:

```ts
export type CreateVendorInput = {
  business_id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  billing_address?: unknown;
  default_terms_days?: number;
  is_1099?: boolean;
  tax_id?: string | null;        // plaintext; service encrypts
  tax_id_type?: 'SSN' | 'EIN' | null;
};
```

Add at the top of the file:

```ts
import { encryptField, decryptField, lastFour } from '../../lib/fieldCrypto.js';
```

Inside `createVendor`, replace the old `tax_id` handling with:

```ts
let tax_id_encrypted: Buffer | null = null;
let tax_id_last_four: string | null = null;
let tax_id_type: 'SSN' | 'EIN' | null = null;
if (input.tax_id) {
  if (!input.tax_id_type) throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'tax_id_type is required when tax_id is set');
  tax_id_encrypted = encryptField(input.tax_id);
  tax_id_last_four = lastFour(input.tax_id);
  tax_id_type = input.tax_id_type;
}
```

Then in the `values` object:

```ts
const values: {
  business_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  billing_address: unknown | null;
  default_terms_days?: number;
  is_1099?: boolean;
  tax_id_encrypted: Buffer | null;
  tax_id_last_four: string | null;
  tax_id_type: 'SSN' | 'EIN' | null;
} = {
  business_id: input.business_id,
  name: input.name,
  email: input.email ?? null,
  phone: input.phone ?? null,
  billing_address: input.billing_address === undefined ? null : (input.billing_address ?? null),
  tax_id_encrypted,
  tax_id_last_four,
  tax_id_type,
};
if (input.default_terms_days !== undefined) values.default_terms_days = input.default_terms_days;
if (input.is_1099 !== undefined) values.is_1099 = input.is_1099;
```

Mirror in `updateVendor`: when `patch.tax_id` is in the patch, encrypt + set the three columns; when explicitly `null`, set all three to null.

```ts
let taxIdPatch: Partial<{
  tax_id_encrypted: Buffer | null;
  tax_id_last_four: string | null;
  tax_id_type: 'SSN' | 'EIN' | null;
}> = {};
if (input.patch.tax_id !== undefined) {
  if (input.patch.tax_id === null) {
    taxIdPatch = { tax_id_encrypted: null, tax_id_last_four: null, tax_id_type: null };
  } else {
    if (!input.patch.tax_id_type) throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'tax_id_type is required when tax_id is set');
    taxIdPatch = {
      tax_id_encrypted: encryptField(input.patch.tax_id),
      tax_id_last_four: lastFour(input.patch.tax_id),
      tax_id_type: input.patch.tax_id_type,
    };
  }
}

const updated = await trx.updateTable('vendors').set({
  ...(input.patch.name !== undefined ? { name: input.patch.name } : {}),
  ...(input.patch.email !== undefined ? { email: input.patch.email ?? null } : {}),
  ...(input.patch.phone !== undefined ? { phone: input.patch.phone ?? null } : {}),
  ...(input.patch.billing_address !== undefined ? { billing_address: input.patch.billing_address ?? null } : {}),
  ...(input.patch.default_terms_days !== undefined ? { default_terms_days: input.patch.default_terms_days } : {}),
  ...(input.patch.is_1099 !== undefined ? { is_1099: input.patch.is_1099 } : {}),
  ...taxIdPatch,
}).where('id', '=', input.vendor_id).returningAll().executeTakeFirstOrThrow();
```

Append a new function `revealTaxId`:

```ts
export async function revealTaxId(db: Kysely<DB>, ctx: ServiceCtx, input: { vendor_id: string }): Promise<string | null> {
  const v = await db.selectFrom('vendors').selectAll()
    .where('id', '=', input.vendor_id).where('business_id', '=', ctx.business_id ?? '').where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!v) throw new NotFoundError('vendor', input.vendor_id);
  await db.transaction().execute(async trx => {
    await auditRecord(trx, ctx, {
      action: AUDIT.VENDOR_TAX_ID_REVEAL,
      entity_type: 'vendor',
      entity_id: v.id,
      before: null,
      after: { revealed_by: ctx.user_id, last_four: v.tax_id_last_four },
    });
  });
  return v.tax_id_encrypted ? decryptField(Buffer.from(v.tax_id_encrypted)) : null;
}
```

Add a new function `listContractors`:

```ts
export async function listContractors(db: Kysely<DB>, business_id: string) {
  return db.selectFrom('vendors').selectAll()
    .where('business_id', '=', business_id).where('deleted_at', 'is', null)
    .where('is_1099', '=', true)
    .orderBy('name').execute();
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npm --workspace apps/api test -- tests/integration/vendorTaxId.test.ts
```

Expected: 2 PASS.

- [ ] **Step 5: Re-run vendor existing tests**

```bash
npm --workspace apps/api test -- tests/integration/vendor.test.ts
```

Expected: still PASS (sanity check existing scenarios still work without `tax_id`).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/ap/vendorService.ts apps/api/tests/integration/vendorTaxId.test.ts
git commit -m "feat(api): vendor tax_id encryption + reveal + listContractors"
```

---

### Task 8: `expenseTransactionService.ts` (TDD, 3 tests)

**Files:**
- Create: `apps/api/src/services/ap/expenseTransactionService.ts`
- Create: `apps/api/tests/integration/expenseTransactionService.test.ts`

**Owns:** the two files above.
**Must NOT modify:** any other file in this slice.

- [ ] **Step 1: Write failing tests**

Create `apps/api/tests/integration/expenseTransactionService.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess, makeAccount, seedCoa, seedYearPeriods } from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as et from '../../src/services/ap/expenseTransactionService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

async function bootstrap() {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id);
  await grantAccess(t.db, user.id, biz.id);
  await seedCoa(t.db, biz.id);
  await seedYearPeriods(t.db, biz.id, 2026);
  const expense = await makeAccount(t.db, biz.id, { code: '6000', name: 'Office Supplies', account_type: 'expense' });
  const cash = await makeAccount(t.db, biz.id, { code: '1010', name: 'Cash', account_type: 'asset' });
  const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });
  return { firm, biz, user, ctx, expense, cash };
}

describe('expenseTransactionService', () => {
  it('createDraft inserts an expense transaction with status=draft and no JE', async () => {
    const { biz, ctx, expense, cash } = await bootstrap();
    const row = await t.db.transaction().execute(trx =>
      et.createDraft(trx, ctx, {
        business_id: biz.id, transaction_date: '2026-04-15',
        payee_text: 'Staples', expense_account_id: expense.id,
        payment_account_id: cash.id, amount: '42.50', memo: 'pens',
      }),
    );
    expect(row.status).toBe('draft');
    expect(row.journal_entry_id).toBeNull();
  });

  it('post creates a JE (DR expense / CR payment account) and links it', async () => {
    const { biz, ctx, expense, cash } = await bootstrap();
    const draft = await t.db.transaction().execute(trx =>
      et.createDraft(trx, ctx, {
        business_id: biz.id, transaction_date: '2026-04-15',
        payee_text: 'Staples', expense_account_id: expense.id,
        payment_account_id: cash.id, amount: '42.50',
      }),
    );
    const posted = await t.db.transaction().execute(trx =>
      et.post(trx, ctx, { expense_transaction_id: draft.id }),
    );
    expect(posted.status).toBe('posted');
    expect(posted.journal_entry_id).not.toBeNull();

    const lines = await t.db.selectFrom('journal_entry_lines').selectAll()
      .where('journal_entry_id', '=', posted.journal_entry_id!).execute();
    expect(lines).toHaveLength(2);
    const dr = lines.find(l => l.account_id === expense.id);
    const cr = lines.find(l => l.account_id === cash.id);
    expect(dr?.debit).toBe('42.5000');
    expect(cr?.credit).toBe('42.5000');
  });

  it('void on a posted transaction reverses the JE and flips status', async () => {
    const { biz, ctx, expense, cash } = await bootstrap();
    const draft = await t.db.transaction().execute(trx =>
      et.createDraft(trx, ctx, {
        business_id: biz.id, transaction_date: '2026-04-15',
        payee_text: 'Staples', expense_account_id: expense.id,
        payment_account_id: cash.id, amount: '42.50',
      }),
    );
    const posted = await t.db.transaction().execute(trx =>
      et.post(trx, ctx, { expense_transaction_id: draft.id }),
    );
    const voided = await t.db.transaction().execute(trx =>
      et.voidExpense(trx, ctx, { expense_transaction_id: posted.id }),
    );
    expect(voided.status).toBe('void');
    expect(voided.voided_at).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm --workspace apps/api test -- tests/integration/expenseTransactionService.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/services/ap/expenseTransactionService.ts`:

```ts
import { sql, type Transaction, type Kysely } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError, NotFoundError, PreconditionError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';
import { postJournalEntry, voidJournalEntry } from '../core/ledgerService.js';

export type CreateDraftInput = {
  business_id: string;
  transaction_date: string;
  payee_text?: string | null;
  vendor_id?: string | null;
  expense_account_id: string;
  payment_account_id: string;
  amount: string;
  memo?: string | null;
};

export async function createDraft(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateDraftInput) {
  if (!input.payee_text && !input.vendor_id) {
    throw new BusinessRuleError(ERR.VALIDATION_FAILED, 'payee_text or vendor_id required');
  }
  const exp = await trx.selectFrom('chart_of_accounts').selectAll()
    .where('id', '=', input.expense_account_id).where('business_id', '=', input.business_id).executeTakeFirst();
  if (!exp) throw new NotFoundError('chart_of_accounts', input.expense_account_id);
  if (exp.account_type !== 'expense') {
    throw new PreconditionError('expense_account_id must be an expense account');
  }
  const pay = await trx.selectFrom('chart_of_accounts').selectAll()
    .where('id', '=', input.payment_account_id).where('business_id', '=', input.business_id).executeTakeFirst();
  if (!pay) throw new NotFoundError('chart_of_accounts', input.payment_account_id);
  if (pay.account_type !== 'asset' && pay.account_type !== 'liability') {
    throw new PreconditionError('payment_account_id must be asset (cash/bank) or liability (credit card)');
  }

  const row = await trx.insertInto('expense_transactions').values({
    business_id: input.business_id,
    transaction_date: input.transaction_date,
    payee_text: input.payee_text ?? null,
    vendor_id: input.vendor_id ?? null,
    expense_account_id: input.expense_account_id,
    payment_account_id: input.payment_account_id,
    amount: input.amount,
    memo: input.memo ?? null,
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.EXPENSE_TRANSACTION_CREATE,
    entity_type: 'expense_transaction', entity_id: row.id,
    before: null, after: row,
  });
  return row;
}

export async function post(trx: Transaction<DB>, ctx: ServiceCtx, input: { expense_transaction_id: string }) {
  const before = await trx.selectFrom('expense_transactions').selectAll()
    .where('id', '=', input.expense_transaction_id).executeTakeFirst();
  if (!before) throw new NotFoundError('expense_transaction', input.expense_transaction_id);
  if (before.status !== 'draft') throw new PreconditionError(`expense transaction is ${before.status}, not draft`);

  const je = await postJournalEntry(trx, ctx, {
    business_id: before.business_id,
    entry_date: before.transaction_date,
    source_type: 'manual',
    memo: before.memo ?? `Expense — ${before.payee_text ?? 'vendor'}`,
    reference: null,
    lines: [
      { account_id: before.expense_account_id, debit: before.amount, credit: '0', memo: null },
      { account_id: before.payment_account_id, debit: '0', credit: before.amount, memo: null },
    ],
  });

  const updated = await trx.updateTable('expense_transactions').set({
    status: 'posted',
    journal_entry_id: je.id,
    posted_at: sql`now()`,
    posted_by_user_id: ctx.user_id,
  }).where('id', '=', input.expense_transaction_id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.EXPENSE_TRANSACTION_POST,
    entity_type: 'expense_transaction', entity_id: updated.id,
    before, after: updated,
  });
  return updated;
}

export async function voidExpense(trx: Transaction<DB>, ctx: ServiceCtx, input: { expense_transaction_id: string }) {
  const before = await trx.selectFrom('expense_transactions').selectAll()
    .where('id', '=', input.expense_transaction_id).executeTakeFirst();
  if (!before) throw new NotFoundError('expense_transaction', input.expense_transaction_id);
  if (before.status === 'void') throw new PreconditionError('already void');

  if (before.status === 'posted' && before.journal_entry_id) {
    await voidJournalEntry(trx, ctx, { journal_entry_id: before.journal_entry_id });
  }

  const updated = await trx.updateTable('expense_transactions').set({
    status: 'void',
    voided_at: sql`now()`,
    voided_by_user_id: ctx.user_id,
  }).where('id', '=', input.expense_transaction_id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.EXPENSE_TRANSACTION_VOID,
    entity_type: 'expense_transaction', entity_id: updated.id,
    before, after: updated,
  });
  return updated;
}

export async function listExpenses(db: Kysely<DB>, business_id: string, opts: { status?: 'draft' | 'posted' | 'void' } = {}) {
  let q = db.selectFrom('expense_transactions').selectAll()
    .where('business_id', '=', business_id);
  if (opts.status) q = q.where('status', '=', opts.status);
  return q.orderBy('transaction_date', 'desc').execute();
}

export async function getExpense(db: Kysely<DB>, business_id: string, id: string) {
  const row = await db.selectFrom('expense_transactions').selectAll()
    .where('id', '=', id).where('business_id', '=', business_id).executeTakeFirst();
  if (!row) throw new NotFoundError('expense_transaction', id);
  return row;
}
```

`voidJournalEntry` is the established pattern (used by invoices, bills) — it inserts a reversing JE and marks the original voided. Confirmed exported from `apps/api/src/services/core/ledgerService.ts:107`.

- [ ] **Step 4: Run tests to verify pass**

```bash
npm --workspace apps/api test -- tests/integration/expenseTransactionService.test.ts
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/ap/expenseTransactionService.ts apps/api/tests/integration/expenseTransactionService.test.ts
git commit -m "feat(api): expense transaction service with TDD (createDraft/post/void)"
```

---

### Task 9: `apOverviewService.ts` (TDD, 1 test)

**Files:**
- Create: `apps/api/src/services/ap/apOverviewService.ts`
- Create: `apps/api/tests/integration/apOverviewService.test.ts`

**Owns:** the two files above.
**Must NOT modify:** any other file.

- [ ] **Step 1: Write failing test**

Create `apps/api/tests/integration/apOverviewService.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess, seedCoa, seedYearPeriods } from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as ap from '../../src/services/ap/apOverviewService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

describe('apOverviewService', () => {
  it('getOverview returns zero counts on an empty business', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id);
    await grantAccess(t.db, user.id, biz.id);
    await seedCoa(t.db, biz.id);
    await seedYearPeriods(t.db, biz.id, 2026);
    const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });

    const overview = await ap.getOverview(t.db, ctx);
    expect(overview.outstanding_bills_total).toBe('0');
    expect(overview.overdue_bills_count).toBe(0);
    expect(overview.upcoming_payments_7d).toBe('0');
    expect(overview.upcoming_payments_30d).toBe('0');
    expect(overview.top_vendors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm --workspace apps/api test -- tests/integration/apOverviewService.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/services/ap/apOverviewService.ts`:

```ts
import { sql, type Kysely } from 'kysely';
import type { DB } from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type ApOverview = {
  outstanding_bills_total: string;
  overdue_bills_count: number;
  upcoming_payments_7d: string;
  upcoming_payments_30d: string;
  top_vendors: { vendor_id: string; vendor_name: string; outstanding: string }[];
};

export async function getOverview(db: Kysely<DB>, ctx: ServiceCtx): Promise<ApOverview> {
  const business_id = ctx.business_id;
  if (!business_id) {
    return {
      outstanding_bills_total: '0.0000',
      overdue_bills_count: 0,
      upcoming_payments_7d: '0.0000',
      upcoming_payments_30d: '0.0000',
      top_vendors: [],
    };
  }

  // Outstanding = bills.total - SUM(bill_payment_applications.amount_applied) per bill,
  // for posted bills only (paid bills have status='paid' so they're excluded).
  const outstandingRow = await db.executeQuery<{ total: string }>(sql<{ total: string }>`
    SELECT COALESCE(SUM(b.total - COALESCE(p.applied, 0)), 0)::text AS total
      FROM bills b
      LEFT JOIN (
        SELECT bill_id, SUM(amount_applied) AS applied
          FROM bill_payment_applications
         GROUP BY bill_id
      ) p ON p.bill_id = b.id
     WHERE b.business_id = ${business_id}
       AND b.status = 'posted'
       AND b.deleted_at IS NULL
  `.compile(db));

  const overdueRow = await db.executeQuery<{ cnt: number }>(sql<{ cnt: number }>`
    SELECT COUNT(*)::int AS cnt
      FROM bills b
      LEFT JOIN (
        SELECT bill_id, SUM(amount_applied) AS applied
          FROM bill_payment_applications
         GROUP BY bill_id
      ) p ON p.bill_id = b.id
     WHERE b.business_id = ${business_id}
       AND b.status = 'posted'
       AND b.deleted_at IS NULL
       AND b.due_date < now()::date
       AND (b.total - COALESCE(p.applied, 0)) > 0
  `.compile(db));

  const upcomingTotal = (days: number) => sql<{ total: string }>`
    SELECT COALESCE(SUM(b.total - COALESCE(p.applied, 0)), 0)::text AS total
      FROM bills b
      LEFT JOIN (
        SELECT bill_id, SUM(amount_applied) AS applied
          FROM bill_payment_applications
         GROUP BY bill_id
      ) p ON p.bill_id = b.id
     WHERE b.business_id = ${business_id}
       AND b.status = 'posted'
       AND b.deleted_at IS NULL
       AND b.due_date BETWEEN now()::date AND (now() + (${days} || ' days')::interval)::date
       AND (b.total - COALESCE(p.applied, 0)) > 0
  `.compile(db);
  const upcoming7Row = await db.executeQuery<{ total: string }>(upcomingTotal(7));
  const upcoming30Row = await db.executeQuery<{ total: string }>(upcomingTotal(30));

  const top = await db.executeQuery<{ vendor_id: string; vendor_name: string; outstanding: string }>(
    sql<{ vendor_id: string; vendor_name: string; outstanding: string }>`
      SELECT v.id AS vendor_id, v.name AS vendor_name,
             SUM(b.total - COALESCE(p.applied, 0))::text AS outstanding
        FROM bills b
        JOIN vendors v ON v.id = b.vendor_id
        LEFT JOIN (
          SELECT bill_id, SUM(amount_applied) AS applied
            FROM bill_payment_applications
           GROUP BY bill_id
        ) p ON p.bill_id = b.id
       WHERE b.business_id = ${business_id}
         AND b.status = 'posted'
         AND b.deleted_at IS NULL
         AND (b.total - COALESCE(p.applied, 0)) > 0
       GROUP BY v.id, v.name
       ORDER BY SUM(b.total - COALESCE(p.applied, 0)) DESC
       LIMIT 5
    `.compile(db),
  );

  return {
    outstanding_bills_total: outstandingRow.rows[0]?.total ?? '0',
    overdue_bills_count: overdueRow.rows[0]?.cnt ?? 0,
    upcoming_payments_7d: upcoming7Row.rows[0]?.total ?? '0',
    upcoming_payments_30d: upcoming30Row.rows[0]?.total ?? '0',
    top_vendors: top.rows.map(r => ({
      vendor_id: r.vendor_id, vendor_name: r.vendor_name, outstanding: r.outstanding,
    })),
  };
}
```

(Note: empty-business test asserts numeric strings `'0'` — adjust the test in Task 9 step 1 if your `COALESCE(SUM(...), 0)::text` returns `'0'` literally rather than `'0.0000'`. The Postgres default for that expression is `'0'`. The test should expect `'0'`.)

- [ ] **Step 4: Run tests to verify pass**

```bash
npm --workspace apps/api test -- tests/integration/apOverviewService.test.ts
```

Expected: 1 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/ap/apOverviewService.ts apps/api/tests/integration/apOverviewService.test.ts
git commit -m "feat(api): AP overview aggregate service with TDD"
```

---

## Phase C — Routes (parallel after Phase B; each task in its own subagent)

### Task 10: Vendors route extension — contractors + tax-id-reveal

**Files:**
- Modify: `apps/api/src/routes/vendors.ts`

**Owns:** `vendors.ts`.
**Must NOT modify:** other route files.

- [ ] **Step 1: Add `/contractors` and `/:id/tax-id-reveal` routes**

Append the following routes to `apps/api/src/routes/vendors.ts` (before the `export default router`):

```ts
router.get('/businesses/:businessId/contractors', async (req, res, next) => {
  try { res.json({ vendors: await vend.listContractors(db, req.tenancy!.business_id) }); }
  catch (e) { next(e); }
});

router.get('/businesses/:businessId/vendors/:id/tax-id-reveal', requireMinRole('firm_admin'), async (req, res, next) => {
  try {
    const tax_id = await vend.revealTaxId(db, ctxFromReq(req), { vendor_id: req.params['id']! });
    res.json({ tax_id });
  } catch (e) { next(e); }
});
```

Update the create/patch route handlers to pass `tax_id_type` through:

```ts
// in POST handler:
if (body.tax_id_type !== undefined) input.tax_id_type = body.tax_id_type ?? null;
// in PATCH handler:
if (parsed.tax_id_type !== undefined) patch.tax_id_type = parsed.tax_id_type ?? null;
```

- [ ] **Step 2: Lint + typecheck**

```bash
npm --workspace apps/api run typecheck
npm --workspace apps/api run lint
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/vendors.ts
git commit -m "feat(api): vendor contractors filter + tax-id-reveal endpoints"
```

---

### Task 11: `expenseTransactions.ts` route + `apOverview.ts` route

**Files:**
- Create: `apps/api/src/routes/expenseTransactions.ts`
- Create: `apps/api/src/routes/apOverview.ts`
- Modify: `apps/api/src/app.ts`

**Owns:** the three files above.
**Must NOT modify:** any service file or other route.

- [ ] **Step 1: Create `expenseTransactions.ts`**

Create `apps/api/src/routes/expenseTransactions.ts`:

```ts
import { Router, type Request } from 'express';
import { schemas } from '@accounting/shared';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import { requireMinRole } from '../middleware/rbac.js';
import * as et from '../services/ap/expenseTransactionService.js';
import type { ServiceCtx } from '../lib/ctx.js';

const router = Router({ mergeParams: true });

function ctxFromReq(req: Request): ServiceCtx {
  return {
    user_id: req.auth!.user_id, firm_id: req.auth!.firm_id,
    business_id: req.tenancy!.business_id, effective_role: req.tenancy!.effective_role,
    request_id: req.request_id, ip_address: req.ip ?? '0.0.0.0',
    user_agent: req.header('user-agent') ?? '',
  };
}

router.use('/businesses/:businessId', requireAuth, resolveBusiness);

router.get('/businesses/:businessId/expense-transactions', async (req, res, next) => {
  try {
    const status = req.query['status'];
    const opts: { status?: 'draft' | 'posted' | 'void' } = {};
    if (status === 'draft' || status === 'posted' || status === 'void') opts.status = status;
    res.json({ expense_transactions: await et.listExpenses(db, req.tenancy!.business_id, opts) });
  } catch (e) { next(e); }
});

router.get('/businesses/:businessId/expense-transactions/:id', async (req, res, next) => {
  try { res.json(await et.getExpense(db, req.tenancy!.business_id, req.params['id']!)); }
  catch (e) { next(e); }
});

router.post('/businesses/:businessId/expense-transactions', requireMinRole('staff'), async (req, res, next) => {
  try {
    const body = schemas.expenseTransactionCreateSchema.parse(req.body);
    const created = await db.transaction().execute(trx =>
      et.createDraft(trx, ctxFromReq(req), {
        business_id: req.tenancy!.business_id,
        transaction_date: body.transaction_date,
        payee_text: body.payee_text ?? null,
        vendor_id: body.vendor_id ?? null,
        expense_account_id: body.expense_account_id,
        payment_account_id: body.payment_account_id,
        amount: body.amount,
        memo: body.memo ?? null,
      }),
    );
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/expense-transactions/:id/post', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const updated = await db.transaction().execute(trx =>
      et.post(trx, ctxFromReq(req), { expense_transaction_id: req.params['id']! }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

router.post('/businesses/:businessId/expense-transactions/:id/void', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const updated = await db.transaction().execute(trx =>
      et.voidExpense(trx, ctxFromReq(req), { expense_transaction_id: req.params['id']! }),
    );
    res.json(updated);
  } catch (e) { next(e); }
});

export default router;
```

- [ ] **Step 2: Create `apOverview.ts`**

Create `apps/api/src/routes/apOverview.ts`:

```ts
import { Router, type Request } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveBusiness } from '../middleware/tenancy.js';
import * as ap from '../services/ap/apOverviewService.js';
import type { ServiceCtx } from '../lib/ctx.js';

const router = Router({ mergeParams: true });

function ctxFromReq(req: Request): ServiceCtx {
  return {
    user_id: req.auth!.user_id, firm_id: req.auth!.firm_id,
    business_id: req.tenancy!.business_id, effective_role: req.tenancy!.effective_role,
    request_id: req.request_id, ip_address: req.ip ?? '0.0.0.0',
    user_agent: req.header('user-agent') ?? '',
  };
}

router.use('/businesses/:businessId', requireAuth, resolveBusiness);

router.get('/businesses/:businessId/ap-overview', async (req, res, next) => {
  try { res.json(await ap.getOverview(db, ctxFromReq(req))); }
  catch (e) { next(e); }
});

export default router;
```

- [ ] **Step 3: Wire both routes in `app.ts`**

Add imports and `app.use(...)` calls in `apps/api/src/app.ts` next to the other route registrations:

```ts
import expenseTransactionsRouter from './routes/expenseTransactions.js';
import apOverviewRouter from './routes/apOverview.js';
// ...
app.use('/api/v1', expenseTransactionsRouter);
app.use('/api/v1', apOverviewRouter);
```

- [ ] **Step 4: Lint + typecheck**

```bash
npm --workspace apps/api run typecheck && npm --workspace apps/api run lint
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/expenseTransactions.ts apps/api/src/routes/apOverview.ts apps/api/src/app.ts
git commit -m "feat(api): expense transactions + AP overview routes"
```

---

## Phase D — Web (parallel after Phase C; final wiring task runs solo last)

### Task 12: `ApOverviewPage.tsx`

**Files:**
- Create: `apps/web/src/pages/ap/ApOverviewPage.tsx`

**Owns:** the file above.
**Must NOT modify:** App.tsx, Sidebar.tsx, or any other web file.

- [ ] **Step 1: Create the page**

Pattern from `apps/web/src/pages/banking/BankAccountListPage.tsx`. Component renders 4 KPI cards (outstanding bills, overdue count, upcoming 7d, upcoming 30d) and a table of top-5 vendors. Use `react-query` if it's already in the project, else manual `useEffect + fetch`. Use the `useCurrentBusiness` / API client conventions used by existing pages.

```tsx
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { useCurrentBusiness } from '@/auth/AuthContext';
import { api } from '@/lib/apiClient';

type Overview = {
  outstanding_bills_total: string;
  overdue_bills_count: number;
  upcoming_payments_7d: string;
  upcoming_payments_30d: string;
  top_vendors: { vendor_id: string; vendor_name: string; outstanding: string }[];
};

export default function ApOverviewPage() {
  const business = useCurrentBusiness();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!business?.id) return;
    api.get<Overview>(`/businesses/${business.id}/ap-overview`)
      .then(r => setData(r.data))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'load failed'));
  }, [business?.id]);

  if (error) return <div className="p-6 text-destructive">{error}</div>;
  if (!data) return <div className="p-6 text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">AP Overview</h1>
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4"><div className="text-sm text-muted-foreground">Outstanding</div><div className="text-2xl font-bold">${data.outstanding_bills_total}</div></Card>
        <Card className="p-4"><div className="text-sm text-muted-foreground">Overdue bills</div><div className="text-2xl font-bold">{data.overdue_bills_count}</div></Card>
        <Card className="p-4"><div className="text-sm text-muted-foreground">Due next 7 days</div><div className="text-2xl font-bold">${data.upcoming_payments_7d}</div></Card>
        <Card className="p-4"><div className="text-sm text-muted-foreground">Due next 30 days</div><div className="text-2xl font-bold">${data.upcoming_payments_30d}</div></Card>
      </div>
      <Card className="p-4">
        <h2 className="mb-2 text-lg font-medium">Top vendors by outstanding balance</h2>
        {data.top_vendors.length === 0 ? <div className="text-sm text-muted-foreground">No outstanding bills.</div> : (
          <table className="w-full text-sm">
            <thead><tr><th className="text-left">Vendor</th><th className="text-right">Outstanding</th></tr></thead>
            <tbody>{data.top_vendors.map(v => (
              <tr key={v.vendor_id}><td>{v.vendor_name}</td><td className="text-right">${v.outstanding}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
```

Confirmed: `api` is an axios instance exported from `@/lib/apiClient` (see `apps/web/src/lib/apiClient.ts:56`). Use `api.get/post/patch/delete` and read `r.data` from the response. Verify `useCurrentBusiness` is the correct hook name in `@/auth/AuthContext` (read the file before importing).

- [ ] **Step 2: Lint**

```bash
npm --workspace apps/web run lint
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/ap/ApOverviewPage.tsx
git commit -m "feat(web): AP overview page with KPI cards + top vendors"
```

---

### Task 13: Expense Transaction pages (list + new + detail)

**Files:**
- Create: `apps/web/src/pages/ap/ExpenseTransactionListPage.tsx`
- Create: `apps/web/src/pages/ap/ExpenseTransactionNewPage.tsx`
- Create: `apps/web/src/pages/ap/ExpenseTransactionDetailPage.tsx`

**Owns:** the three files above.
**Must NOT modify:** App.tsx, Sidebar.tsx, or any other web file.

- [ ] **Step 1: List page**

Mirror `apps/web/src/pages/banking/BankTransactionsInboxPage.tsx`. Status filter (all / draft / posted / void), table with date / payee / amount / status / actions (View, Post if draft, Void if draft/posted). Include a "+ New Expense" button → `/ap/expenses/new`.

- [ ] **Step 2: New page**

Form: date input, payee text OR vendor dropdown, expense account dropdown (CoA filtered to `account_type = 'expense'`), payment account dropdown (CoA filtered to `account_type IN ('asset','liability')`, code starts with '10' or '20'), amount input, memo textarea, "Save draft" + "Save & Post" buttons.

- [ ] **Step 3: Detail page**

Read-only summary with Post / Void actions if applicable. Show linked JE id with a deep link to `/journal/:id`.

- [ ] **Step 4: Lint**

```bash
npm --workspace apps/web run lint
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ap/ExpenseTransaction*.tsx
git commit -m "feat(web): expense transaction list/new/detail pages"
```

---

### Task 14: `ContractorsPage.tsx`

**Files:**
- Create: `apps/web/src/pages/ap/ContractorsPage.tsx`

**Owns:** the file above.
**Must NOT modify:** App.tsx, Sidebar.tsx, or any other web file.

- [ ] **Step 1: Create the page**

Filtered Vendors view. Fetches `/businesses/:id/contractors`. Table columns: name, email, tax_id_type (badge), tax_id_last_four (display only — `***-**-1234`), is_1099 toggle. "Edit W-9" inline form opens a dialog with: tax_id (text input, sensitive), tax_id_type (SSN | EIN), is_1099 checkbox. "Reveal" button (firm_admin only) calls `/vendors/:id/tax-id-reveal` and shows the value in a modal for 30 seconds.

Sketch:

```tsx
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { useCurrentBusiness, useCurrentUser } from '@/auth/AuthContext';
import { api } from '@/lib/apiClient';

type Contractor = {
  id: string;
  name: string;
  email: string | null;
  is_1099: boolean;
  tax_id_type: 'SSN' | 'EIN' | null;
  tax_id_last_four: string | null;
};

export default function ContractorsPage() {
  const business = useCurrentBusiness();
  const user = useCurrentUser();
  const [rows, setRows] = useState<Contractor[]>([]);
  // ... fetch via api.get(`/businesses/${business.id}/contractors`), render table,
  // edit dialog, reveal action gated on user.role === 'firm_admin'
  // Reveal: api.get(`/businesses/${business.id}/vendors/${id}/tax-id-reveal`).then(r => r.data.tax_id)
}
```

Read `@/auth/AuthContext` to confirm the actual hook names (`useCurrentBusiness`, `useCurrentUser`) and the user shape — adjust if they differ.

- [ ] **Step 2: Lint**

```bash
npm --workspace apps/web run lint
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/ap/ContractorsPage.tsx
git commit -m "feat(web): contractors filter view with W-9 fields + tax_id reveal"
```

---

### Task 15 (SOLO): Wire routes in App.tsx + Sidebar.tsx + remove ComingSoon stubs + step-zero eta cleanup

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx`

**Owns:** the two files above.
**MUST run after** Tasks 12, 13, 14 are complete.
**Must NOT modify:** any service, route, or page file.

- [ ] **Step 1: Replace the 3 AP ComingSoon stubs in App.tsx**

In `apps/web/src/App.tsx`:
- Add imports for `ApOverviewPage`, `ExpenseTransactionListPage`, `ExpenseTransactionNewPage`, `ExpenseTransactionDetailPage`, `ContractorsPage`.
- Replace `/ap/overview` ComingSoon route with `<Route path="/ap/overview" element={<ApOverviewPage />} />`.
- Replace `/ap/expenses` ComingSoon route. Add `/ap/expenses/new` and `/ap/expenses/:id` routes.
- Replace `/ap/contractors` ComingSoon route with `<Route path="/ap/contractors" element={<ContractorsPage />} />`.

- [ ] **Step 2: Update remaining stubs' eta labels (step-zero cleanup)**

For every remaining `<Route ... element={<ComingSoonPage ... eta="Slice X" />} />` in `App.tsx`, update `eta` to match the spec catalog in `docs/superpowers/specs/2026-04-24-fill-coming-soon-tabs-design.md`:

| Route | Old eta | New eta |
|--|--|--|
| `/reports/custom` | Slice 3 | Slice 12 |
| `/reports/management` | Slice 3 | Slice 12 |
| `/reports/performance` | Slice 4 | Slice 12 |
| `/reports/financial-planning` | Slice 4 | Slice 12 |
| `/reports/spreadsheet-sync` | Slice 4 | Slice 12 |
| `/accounting/client-overview` | Slice 3 | Slice 9 |
| `/accounting/books-review` | Slice 3 | Slice 9 |
| `/accounting/integrations` | Slice 4 | Slice 10 |
| `/accounting/receipts` | Slice 4 | Slice 10 |
| `/accounting/recurring` | Slice 3 | Slice 9 |
| `/payroll/overview` | Slice 5 | Slice 13 |
| `/payroll/employees` | Slice 5 | Slice 13 |
| `/payroll/contractors` | Slice 5 | Slice 13 |
| `/payroll/taxes` | Slice 5 | Slice 13 |
| `/payroll/compliance` | Slice 5 | Slice 13 |
| `/inventory/overview` | Slice 8 | Slice 11 |
| `/inventory/purchase-orders` | Slice 8 | Slice 11 |
| `/inventory/item-receipts` | Slice 8 | Slice 11 |
| `/inventory/sales-orders` | Slice 8 | Slice 11 |
| `/inventory/shipping-labels` | Slice 8 | Slice 11 |

- [ ] **Step 3: Sidebar — no changes needed for AP group**

The sidebar already has `Overview`, `Expense Transactions`, `Contractors` under AP. Just verify they all link to the routes that now exist. No edits required if the Sidebar.tsx links match what was added.

- [ ] **Step 4: Manual smoke + lint**

```bash
npm --workspace apps/web run lint
npm --workspace apps/web run build
```

Expected: 0 errors. Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/layout/Sidebar.tsx
git commit -m "feat(web): wire AP overview/expenses/contractors + align ComingSoon eta labels with slices 9-13"
```

---

## Phase E — Deploy + smoke

### Task 16: Merge slice-8 into main, deploy, smoke

From `/Users/aheedkamil/projects/accounting-app` (main clone):

- [ ] **Step 1: Verify branch state**

```bash
git checkout slice-8-ap-polish
npm test
```

Expected: full integration suite passes; new tests counted (8 added).

- [ ] **Step 2: Rebase + merge to main**

```bash
git checkout main && git pull
git merge --no-ff slice-8-ap-polish -m "merge: slice 8 AP polish"
git push origin main
```

- [ ] **Step 3: Deploy prereq — set FIELD_ENCRYPTION_KEY on Railway**

Generate a key locally:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

In Railway dashboard for the API service: **Variables** → Add `FIELD_ENCRYPTION_KEY=<value>`. Trigger a redeploy.

- [ ] **Step 4: Wait for migrations 0030–0031 to run, then HTTP smoke**

```bash
# Replace TOKEN, BIZ, BASE accordingly.
BASE=https://<railway-url>
TOKEN=<jwt>
BIZ=<business-uuid>

# Create a contractor
curl -s -X POST $BASE/api/v1/businesses/$BIZ/vendors \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Contractor","is_1099":true,"tax_id":"123456789","tax_id_type":"EIN"}' | jq

# List contractors
curl -s $BASE/api/v1/businesses/$BIZ/contractors -H "Authorization: Bearer $TOKEN" | jq

# Create + post an expense transaction (use real CoA UUIDs from /chart-of-accounts)
EXP=<expense-account-id>
CASH=<cash-account-id>
DRAFT=$(curl -s -X POST $BASE/api/v1/businesses/$BIZ/expense-transactions \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"transaction_date\":\"2026-04-24\",\"payee_text\":\"Smoke\",\"expense_account_id\":\"$EXP\",\"payment_account_id\":\"$CASH\",\"amount\":\"12.34\"}" | jq -r .id)
curl -s -X POST $BASE/api/v1/businesses/$BIZ/expense-transactions/$DRAFT/post -H "Authorization: Bearer $TOKEN" | jq

# AP overview
curl -s $BASE/api/v1/businesses/$BIZ/ap-overview -H "Authorization: Bearer $TOKEN" | jq

# Browser walk: /ap/overview, /ap/expenses, /ap/expenses/new, /ap/contractors. Zero console errors.
```

- [ ] **Step 5: Verify audit logs**

```bash
psql $DATABASE_PUBLIC_URL -c "SELECT action, COUNT(*) FROM audit_logs WHERE action LIKE 'expense_transaction%' OR action = 'vendor.tax_id_reveal' GROUP BY 1;"
```

Expected: rows for `expense_transaction.create`, `expense_transaction.post`. (`vendor.tax_id_reveal` requires hitting that endpoint manually.)

---

## Definition of Done

- Migrations 0030–0031 applied on prod.
- `FIELD_ENCRYPTION_KEY` set on Railway.
- 10 new tests passing on top of the prior baseline (4 fieldCrypto + 2 vendor tax_id + 3 expense + 1 ap overview; existing suite ~92 → ≥102).
- 3 ComingSoon stubs replaced; `grep "ComingSoonPage.*ap/" apps/web/src/App.tsx` returns 0 hits.
- All remaining ComingSoon eta labels match the catalog (slices 9–13).
- AP Overview page renders zero errors against an empty business.
- An expense transaction can be created and posted via UI; the linked JE balances.
- A vendor can be marked 1099 with an SSN; tax_id_last_four displays in the contractors list; full SSN is only revealed via the firm_admin endpoint and audit-logged.
- Spec patched in same commits if anything deviated.
