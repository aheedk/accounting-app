# Slice 10 — Receipts + Integration Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace 2 Accounting ComingSoon stubs (Receipts, Integration Transactions) with real ledger-aware features. Introduce a generic file-storage abstraction (used by both, plus future Compliance docs in slice 13).

**Architecture:**
- **`files` table** with `(id, business_id, original_name, mime_type, byte_size, storage_path, uploaded_by_user_id, created_at)`. Generic — any feature can FK to `files.id`.
- **`fileStorage` interface** in `apps/api/src/lib/fileStorage.ts` with one impl `LocalVolumeStorage` that writes to `process.env.FILE_STORAGE_DIR` (default `./.local-data/files` in dev, `/data/files` in prod). Hashed filenames to avoid collisions.
- **`receipts` table** with `(id, business_id, file_id, uploaded_by_user_id, linked_entity_type enum, linked_entity_id nullable, created_at)`. linked_entity_type: `bank_transaction | bill | expense_transaction | invoice | journal_entry | unlinked`.
- **`integration_inbox` table** with `(id, business_id, source enum: stripe_csv|paypal_csv|shopify_csv|generic, raw_payload jsonb, status enum: pending|matched|categorized|excluded, matched_journal_entry_id, ...)`. UI mirrors Bank Transactions Inbox.

**Tech Stack:** New deps: `multer` (multipart parsing).

---

## Locked decisions

1. **Files stored on disk via `LocalVolumeStorage`.** Storage path comes from `FILE_STORAGE_DIR` env var (default `./.local-data/files` dev, `/data/files` prod). **Deploy prereq:** Railway must mount a volume at `/data` before slice 10 deploys, OR set `FILE_STORAGE_DIR=/tmp/files` to use ephemeral storage (acceptable until first redeploy).
2. **Files hashed by `sha256(content)` for naming** — content-addressed storage. Identical content uploaded twice → one file on disk, two `files` rows. Storage path: `{first 2 chars of hash}/{rest of hash}{ext}`.
3. **No file deletion in slice 10.** Soft-delete via a future column. For now, files are permanent.
4. **Multer in-memory storage** so we get the buffer for hashing before writing. 10MB max upload.
5. **Receipts can be unlinked** — uploaded first, linked to a bank_transaction/bill/etc later via PATCH. Lazy linking is the common workflow (snap a photo today, link to the bank txn next week).
6. **Integration Inbox = Bank Transactions Inbox without the bank_account_id.** Same lifecycle (pending → matched/categorized/excluded). Categorize creates a JE just like banking. Match links existing JE.
7. **CSV parsing client-side** for Stripe/PayPal/Shopify exports. The API receives parsed rows.
8. **Plan-impl sync:** any deviation patches this plan.

---

## Phase A — Infra + DB

### Task 1: Add `multer` dep + `FILE_STORAGE_DIR` env var

```bash
npm install -w apps/api multer@^1.4.5-lts.1 @types/multer@^1.4.11
```

Append to `.env.example`:
```
# Path where uploaded files are stored. /data/files for prod (Railway volume), ./.local-data/files for dev.
FILE_STORAGE_DIR=./.local-data/files
```

Document in README under "Required env vars".

Commit: `chore(api): add multer dep + FILE_STORAGE_DIR env var`.

### Task 2: Migration `0034_files.sql`

```sql
CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  original_name text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  storage_path text NOT NULL,
  uploaded_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_files_business ON files(business_id);
```

Commit: `feat(db): files table`.

### Task 3: Migration `0035_receipts.sql`

```sql
CREATE TYPE receipt_linked_entity_type AS ENUM (
  'bank_transaction', 'bill', 'expense_transaction', 'invoice', 'journal_entry', 'unlinked'
);

CREATE TABLE receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  file_id uuid NOT NULL REFERENCES files(id),
  uploaded_by_user_id uuid NOT NULL REFERENCES users(id),
  linked_entity_type receipt_linked_entity_type NOT NULL DEFAULT 'unlinked',
  linked_entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receipts_link_consistent CHECK (
    (linked_entity_type = 'unlinked') = (linked_entity_id IS NULL)
  )
);
CREATE INDEX idx_receipts_business ON receipts(business_id);
CREATE INDEX idx_receipts_link ON receipts(linked_entity_type, linked_entity_id) WHERE linked_entity_type <> 'unlinked';
CREATE TRIGGER receipts_updated_at BEFORE UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Commit: `feat(db): receipts table`.

### Task 4: Migration `0036_integration_inbox.sql`

```sql
CREATE TYPE integration_source AS ENUM ('stripe_csv', 'paypal_csv', 'shopify_csv', 'generic');
CREATE TYPE integration_inbox_status AS ENUM ('pending', 'matched', 'categorized', 'excluded');

CREATE TABLE integration_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  source integration_source NOT NULL,
  external_id text,
  occurred_at date NOT NULL,
  description text NOT NULL,
  amount numeric(19,4) NOT NULL,
  raw_payload jsonb NOT NULL,
  status integration_inbox_status NOT NULL DEFAULT 'pending',
  matched_journal_entry_id uuid REFERENCES journal_entries(id),
  excluded_reason text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid REFERENCES users(id),
  CONSTRAINT ii_terminal_has_reviewer CHECK (
    (status = 'pending' AND reviewed_at IS NULL)
    OR (status <> 'pending' AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT ii_matched_has_je CHECK (
    (status IN ('matched','categorized')) = (matched_journal_entry_id IS NOT NULL)
  ),
  CONSTRAINT ii_excluded_has_reason CHECK (
    (status = 'excluded') = (excluded_reason IS NOT NULL)
  )
);
CREATE INDEX idx_ii_biz_status ON integration_inbox(business_id, status);
CREATE UNIQUE INDEX uq_ii_external ON integration_inbox(business_id, source, external_id) WHERE external_id IS NOT NULL;
```

Commit: `feat(db): integration_inbox table`.

### Task 5: DB type augmentation + audit actions + zod schemas + factories + truncateAll

Append to `apps/api/src/db/types.ts`:

```ts
export interface FilesTable {
  id: Generated<string>;
  business_id: string;
  original_name: string;
  mime_type: string;
  byte_size: ColumnType<string, string | number, string | number>; // bigint
  storage_path: string;
  uploaded_by_user_id: string;
  created_at: Generated<Timestamp>;
}

export type ReceiptLinkedEntityType = 'bank_transaction' | 'bill' | 'expense_transaction' | 'invoice' | 'journal_entry' | 'unlinked';

export interface ReceiptsTable {
  id: Generated<string>;
  business_id: string;
  file_id: string;
  uploaded_by_user_id: string;
  linked_entity_type: Generated<ReceiptLinkedEntityType>;
  linked_entity_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export type IntegrationSource = 'stripe_csv' | 'paypal_csv' | 'shopify_csv' | 'generic';
export type IntegrationInboxStatus = 'pending' | 'matched' | 'categorized' | 'excluded';

export interface IntegrationInboxTable {
  id: Generated<string>;
  business_id: string;
  source: IntegrationSource;
  external_id: string | null;
  occurred_at: ColumnType<string, string, string>;
  description: string;
  amount: ColumnType<string, string | number, string | number>;
  raw_payload: ColumnType<unknown, unknown, unknown>;
  status: Generated<IntegrationInboxStatus>;
  matched_journal_entry_id: string | null;
  excluded_reason: string | null;
  imported_at: Generated<Timestamp>;
  reviewed_at: Timestamp | null;
  reviewed_by_user_id: string | null;
}
```

Add to `DB`:
```ts
files: FilesTable;
receipts: ReceiptsTable;
integration_inbox: IntegrationInboxTable;
```

Audit actions append:
```ts
FILE_UPLOAD: 'file.upload',
RECEIPT_CREATE: 'receipt.create',
RECEIPT_LINK: 'receipt.link',
RECEIPT_UNLINK: 'receipt.unlink',
INTEGRATION_INBOX_IMPORT: 'integration_inbox.import',
INTEGRATION_INBOX_MATCH: 'integration_inbox.match',
INTEGRATION_INBOX_CATEGORIZE: 'integration_inbox.categorize',
INTEGRATION_INBOX_EXCLUDE: 'integration_inbox.exclude',
```

Zod schemas (`packages/shared/src/schemas/`):

`receipt.ts`:
```ts
import { z } from 'zod';
export const receiptLinkSchema = z.object({
  linked_entity_type: z.enum(['bank_transaction','bill','expense_transaction','invoice','journal_entry','unlinked']),
  linked_entity_id: z.string().uuid().nullable().optional(),
}).refine(v => (v.linked_entity_type === 'unlinked') === (v.linked_entity_id == null), { message: 'unlinked requires null id; linked requires uuid' });
```

`integrationInbox.ts`:
```ts
import { z } from 'zod';
const moneyStr = z.string().regex(/^-?\d+(\.\d+)?$/);
export const integrationInboxImportSchema = z.object({
  source: z.enum(['stripe_csv','paypal_csv','shopify_csv','generic']),
  rows: z.array(z.object({
    occurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    description: z.string().min(1).max(500),
    amount: moneyStr,
    external_id: z.string().max(200).nullable().optional(),
    raw_payload: z.record(z.unknown()).optional(),
  })).min(1).max(5000),
});
export const integrationInboxMatchSchema = z.object({ journal_entry_id: z.string().uuid() });
export const integrationInboxCategorizeSchema = z.object({
  offset_account_id: z.string().uuid(),
  cash_account_id: z.string().uuid(),
  memo: z.string().max(500).nullable().optional(),
});
export const integrationInboxExcludeSchema = z.object({ excluded_reason: z.string().min(1).max(500) });
```

Append `export * from './receipt.js'; export * from './integrationInbox.js';` to schemas/index.ts.

`factories.ts`: add `makeFile`, `makeReceipt`, `makeIntegrationInboxRow`.

`testDb.ts truncateAll`: prepend `'integration_inbox', 'receipts', 'files'`.

Commit: `feat(shared,api): slice 10 audit actions, schemas, factories, truncateAll`.

### Task 6: `fileStorage.ts` interface + LocalVolumeStorage impl + tests

Create `apps/api/src/lib/fileStorage.ts`:

```ts
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export type StoredFile = {
  storage_path: string;  // relative to FILE_STORAGE_DIR
  byte_size: number;
  sha256: string;
};

export interface FileStorage {
  store(buffer: Buffer, mime_type: string): Promise<StoredFile>;
  read(storage_path: string): Promise<Buffer>;
  exists(storage_path: string): Promise<boolean>;
}

function rootDir(): string {
  return process.env['FILE_STORAGE_DIR'] ?? './.local-data/files';
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg',
    'image/gif': '.gif', 'image/webp': '.webp',
    'application/pdf': '.pdf', 'text/csv': '.csv', 'text/plain': '.txt',
  };
  return map[mime] ?? '.bin';
}

export class LocalVolumeStorage implements FileStorage {
  async store(buffer: Buffer, mime_type: string): Promise<StoredFile> {
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const ext = extFromMime(mime_type);
    const storage_path = `${sha256.slice(0, 2)}/${sha256.slice(2)}${ext}`;
    const full = path.join(rootDir(), storage_path);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, buffer);
    return { storage_path, byte_size: buffer.length, sha256 };
  }
  async read(storage_path: string): Promise<Buffer> {
    return readFile(path.join(rootDir(), storage_path));
  }
  async exists(storage_path: string): Promise<boolean> {
    try { await stat(path.join(rootDir(), storage_path)); return true; }
    catch { return false; }
  }
}

export const fileStorage: FileStorage = new LocalVolumeStorage();
```

Tests in `apps/api/tests/unit/fileStorage.test.ts`:
1. `store + read round-trips a buffer`
2. `store dedups by content hash` (storing same content twice → identical storage_path)

Use a temp directory for tests via `process.env.FILE_STORAGE_DIR = mkdtemp(...)` in `beforeAll`.

Commit: `feat(api): fileStorage interface + LocalVolumeStorage impl with TDD`.

---

## Phase B — Services

### Task 7: `fileService.ts` (TDD, 1 test)

`apps/api/src/services/files/fileService.ts`:
- `uploadFile(trx, ctx, { business_id, original_name, mime_type, buffer }) -> FilesRow` — calls `fileStorage.store`, inserts a `files` row, audit-logs FILE_UPLOAD.
- `getFileById(db, business_id, id)` — returns row or throws.
- `streamFile(db, business_id, id) -> { row, buffer }` — returns the row + buffer for download.

Test: `uploadFile stores buffer + creates files row`.

Commit: `feat(api): file service with TDD`.

### Task 8: `receiptService.ts` (TDD, 2 tests)

`apps/api/src/services/accounting/receiptService.ts`:
- `createReceipt(trx, ctx, { business_id, file_id, linked_entity_type?, linked_entity_id? })` — inserts receipt; audit RECEIPT_CREATE.
- `linkReceipt(trx, ctx, { receipt_id, linked_entity_type, linked_entity_id })` — patches link; audit RECEIPT_LINK; if going to 'unlinked', audit RECEIPT_UNLINK.
- `listReceipts(db, business_id, opts: { entity_type?, entity_id? })`.

Tests:
1. `createReceipt unlinked then linkReceipt to a bill works`
2. `linkReceipt to unlinked clears the link and audit-logs UNLINK`

Commit: `feat(api): receipt service with TDD`.

### Task 9: `integrationInboxService.ts` (TDD, 2 tests)

Mirrors `bankTransactionService` structure. Service functions:
- `importRows(trx, ctx, { source, rows[] })` — bulk insert, dedup by `(business_id, source, external_id)` if external_id present.
- `match(trx, ctx, { id, journal_entry_id })` — link.
- `categorize(trx, ctx, { id, cash_account_id, offset_account_id, memo? })` — creates JE: amount > 0 → DR cash / CR offset; amount < 0 → DR offset / CR cash. Uses `postJournalEntry`.
- `exclude(trx, ctx, { id, excluded_reason })`.
- `listInbox(db, business_id, opts: { status?, source? })`.

Tests:
1. `importRows inserts unique rows with status=pending`
2. `categorize on a positive amount creates a JE (DR cash / CR revenue)`

Commit: `feat(api): integration inbox service with TDD`.

---

## Phase C — Routes

### Task 10: `files.ts` route

Mount with multer. Routes:
- `POST /businesses/:businessId/files` — multipart upload, accepts one file, returns row with id.
- `GET /businesses/:businessId/files/:id/download` — streams the file.

Use `multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })`.

### Task 11: `receipts.ts` + `integrationInbox.ts` routes

Standard CRUD + state-transition endpoints.

Wire all 3 in `app.ts`. Commit per file.

---

## Phase D — Web

### Task 12: `ReceiptsPage.tsx`

Upload form (file input, drag-and-drop optional). Grid of uploaded receipts with thumbnail/icon, file name, link target, "Link to..." dropdown (entity type + id picker by listing recent bank txns/bills).

### Task 13: `IntegrationInboxPage.tsx`

Mirror `BankTransactionsInboxPage`. Source dropdown (stripe/paypal/shopify/generic). Status filter. Per-row Match/Categorize/Exclude actions. Categorize dialog: cash account + offset account dropdowns.

### Task 14 (SOLO): Wire routes in App.tsx

Replace 2 stubs:
- `/accounting/receipts` → `<ReceiptsPage />`
- `/accounting/integrations` → `<IntegrationInboxPage />`

Lint + build + commit.

---

## Phase E — Merge + deploy

```bash
git checkout main && git merge --no-ff slice-10-receipts-integrations && git push origin main
```

**Deploy prereq:** Railway mount `/data` volume on the API service, OR set `FILE_STORAGE_DIR=/tmp/files` (ephemeral). Without either, file upload returns 500.

Smoke: upload a receipt, link to a bill; import 3 Stripe-style CSV rows, categorize one to revenue.

---

## Definition of Done

- Migrations 0034-0036 applied (36 total).
- ~7 new tests passing (slice 9 baseline 127 → ≥134).
- 2 ComingSoon stubs in `/accounting/receipts` and `/accounting/integrations` replaced.
- File-storage abstraction reusable by slice 13 (Compliance docs).
