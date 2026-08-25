# Journal Entry Editing and Journal Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add audit-safe journal-entry correction in the existing grid editor and replace the journal summary list with a clickable line-level journal report.

**Architecture:** Keep posted ledger rows immutable. A new ledger orchestration method atomically voids and reverses an eligible manual entry, posts its replacement, and links the correction chain. Read queries return account-enriched lines and explicit editability metadata; the React create and detail routes share one editor, while the journal index renders the same data as a grouped report.

**Tech Stack:** PostgreSQL migrations, Kysely, Express, Zod, React 18, React Router, Tailwind/shadcn, Decimal.js, Vitest, Testcontainers.

**Spec:** `docs/superpowers/specs/2026-08-25-journal-entry-editing-design.md`

## Global Constraints

- Posted journal rows and lines remain immutable; never weaken `trg_je_protect_posted` or `trg_jel_protect_posted`.
- Every correction, reversal, replacement, and audit row commits or rolls back in one PostgreSQL transaction.
- Only `apps/api/src/services/core/ledgerService.ts` may write `journal_entries` or `journal_entry_lines`.
- Only posted `manual` and `adjustment` entries in open periods are editable in the normal UI.
- Generated entries use the shared editor in read-only mode and must be corrected at their source.
- Money remains a decimal string through the API; do not use JavaScript `Number` for request serialization or balance equality.
- Dates remain ISO `YYYY-MM-DD` in state and APIs and render as American `M/D/YY` in journal reports.
- Do not add dependencies, infrastructure, or environment variables.
- Preserve native `<Link>` behavior for click, Ctrl/Cmd-click, and right-click/open-in-new-tab.
- Keep the spec and this plan in sync with implementation changes.

---

### Task 1: Correction schema and persisted line metadata

**Files:**
- Create: `db/migrations/0057_journal_entry_corrections.sql`
- Create: `packages/shared/src/schemas/journalEntry.test.ts`
- Modify: `packages/shared/src/schemas/journalEntry.ts`
- Modify: `apps/api/src/db/types.ts`

**Interfaces:**
- Produces: `journal_entries.corrected_from_entry_id: string | null`
- Produces: `journal_entry_lines.name: string | null`
- Produces: `journal_entry_lines.class_name: string | null`
- Produces: `journalEntryCreateSchema` with `is_adjusting`, line `name`, and line `class_name`
- Produces: `journalEntryCorrectionSchema` and `JournalEntryCorrection`

- [ ] **Step 1: Write a failing shared-schema test for real editor fields**

```ts
import { describe, expect, it } from 'vitest';
import { journalEntryCreateSchema } from './journalEntry.js';

describe('journalEntryCreateSchema', () => {
  it('preserves the adjusting flag and optional line Name and Class', () => {
    const parsed = journalEntryCreateSchema.parse({
      entry_date: '2026-08-25',
      is_adjusting: true,
      lines: [
        { account_id: '00000000-0000-0000-0000-000000000001', debit: '25.0000', credit: '0', name: 'Patient A', class_name: 'Clinic' },
        { account_id: '00000000-0000-0000-0000-000000000002', debit: '0', credit: '25.0000' },
      ],
    });

    expect(parsed.is_adjusting).toBe(true);
    expect(parsed.lines[0]).toMatchObject({ name: 'Patient A', class_name: 'Clinic' });
  });
});
```

- [ ] **Step 2: Run the schema test and verify RED**

Run: `npm -w @accounting/shared test -- src/schemas/journalEntry.test.ts`

Expected: FAIL because Zod strips `is_adjusting`, `name`, and `class_name`.

- [ ] **Step 3: Extend the schemas minimally**

```ts
const optionalLineText = z.string().max(255).nullable().optional();

export const journalLineInputSchema = z.object({
  account_id: z.string().uuid(),
  debit: moneyString,
  credit: moneyString,
  memo: z.string().max(500).nullable().optional(),
  name: optionalLineText,
  class_name: optionalLineText,
});

export const journalEntryCreateSchema = z.object({
  entry_date: dateString,
  memo: z.string().max(1000).nullable().optional(),
  reference: z.string().max(100).nullable().optional(),
  is_adjusting: z.boolean().optional().default(false),
  lines: z.array(journalLineInputSchema).min(2, 'at least two lines required'),
});

export const journalEntryCorrectionSchema = journalEntryCreateSchema;
export type JournalEntryCorrection = z.infer<typeof journalEntryCorrectionSchema>;
```

Retain the existing debit/credit refinements around the extended object.

- [ ] **Step 4: Run the schema test and verify GREEN**

Run: `npm -w @accounting/shared test -- src/schemas/journalEntry.test.ts`

Expected: PASS.

- [ ] **Step 5: Add the migration and Kysely fields**

```sql
ALTER TABLE journal_entries
  ADD COLUMN corrected_from_entry_id uuid NULL REFERENCES journal_entries(id);

CREATE UNIQUE INDEX uq_journal_entries_corrected_from
  ON journal_entries(corrected_from_entry_id)
  WHERE corrected_from_entry_id IS NOT NULL;

ALTER TABLE journal_entry_lines
  ADD COLUMN name text NULL,
  ADD COLUMN class_name text NULL;
```

Add matching `string | null` properties to `JournalEntriesTable` and `JournalEntryLinesTable`. Do not wrap them in `Generated<>`.

- [ ] **Step 6: Typecheck schema and API consumers**

Run: `npm run typecheck`

Expected: PASS; optional insert fields do not break existing callers.

- [ ] **Step 7: Commit**

```bash
git add db/migrations/0057_journal_entry_corrections.sql packages/shared/src/schemas/journalEntry.ts packages/shared/src/schemas/journalEntry.test.ts apps/api/src/db/types.ts
git commit -m "feat(journal): add correction and line metadata schema"
```

### Task 2: Persist line metadata through the ledger choke point

**Files:**
- Modify: `apps/api/tests/integration/ledgerService.test.ts`
- Modify: `apps/api/src/services/core/ledgerService.ts`

**Interfaces:**
- Consumes: nullable line `name` and `class_name` columns from Task 1
- Produces: `LineInput` optional `name` and `class_name`
- Produces: `PostJournalEntryInput.corrected_from_entry_id?: string | null`

- [ ] **Step 1: Extend the real post test to require metadata persistence**

Change the first balanced-post fixture's cash line to include `name: 'Patient A'` and `class_name: 'Clinic'`, then assert literal persisted values:

```ts
expect(lines[0]).toMatchObject({
  debit: '100.0000',
  name: 'Patient A',
  class_name: 'Clinic',
});
```

- [ ] **Step 2: Run the single integration test and verify RED**

Run: `npm -w @accounting/api run test:integration -- tests/integration/ledgerService.test.ts -t "posts a balanced manual JE"`

Expected: FAIL because the service input or inserted row does not carry the new fields.

- [ ] **Step 3: Pass metadata and correction linkage through `postJournalEntry`**

Extend the input types:

```ts
export type LineInput = {
  account_id: string;
  debit: string;
  credit: string;
  memo: string | null;
  name?: string | null;
  class_name?: string | null;
};

export type PostJournalEntryInput = {
  // existing fields
  corrected_from_entry_id?: string | null;
};
```

Set `corrected_from_entry_id` on the entry insert and `name` / `class_name` on each line insert, defaulting omitted values to null.

- [ ] **Step 4: Run the targeted integration test and verify GREEN**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Add a failing tenant-integrity test for posting accounts**

Create a second business and account, then attempt to post that account under the first business:

```ts
await expect(t.db.transaction().execute(trx => ledger.postJournalEntry(trx, ctx, {
  business_id: biz.id,
  entry_date: '2026-04-15',
  source_type: 'manual',
  memo: null,
  lines: [
    { account_id: cash.id, debit: '10.0000', credit: '0.0000', memo: null },
    { account_id: otherBusinessRevenue.id, debit: '0.0000', credit: '10.0000', memo: null },
  ],
}))).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
```

- [ ] **Step 6: Run the tenant-integrity test and verify RED**

Run: `npm -w @accounting/api run test:integration -- tests/integration/ledgerService.test.ts -t "rejects accounts from another business"`

Expected: FAIL because current posting only checks locked accounts by ID.

- [ ] **Step 7: Validate all unique posting accounts belong to the business and are active**

Select unique IDs from `chart_of_accounts` with both `business_id = input.business_id` and `is_active = true`. If the selected count differs from the unique input count, throw `PreconditionError('Every journal line must use an active account from this business')`. Reuse those selected rows for the locked-account check.

- [ ] **Step 8: Run ledger integration tests and commit**

Run: `npm -w @accounting/api run test:integration -- tests/integration/ledgerService.test.ts`

Expected: all ledger service tests PASS.

```bash
git add apps/api/src/services/core/ledgerService.ts apps/api/tests/integration/ledgerService.test.ts
git commit -m "feat(journal): persist journal line metadata"
```

### Task 3: Atomic correction service

**Files:**
- Modify: `apps/api/tests/integration/ledgerService.test.ts`
- Modify: `apps/api/src/services/core/ledgerService.ts`

**Interfaces:**
- Consumes: `PostJournalEntryInput.corrected_from_entry_id`
- Produces: `CorrectJournalEntryInput`
- Produces: `correctJournalEntry(trx, ctx, input): Promise<{ original; reversal; corrected_entry }>`
- Modifies: `voidJournalEntry` input with optional `reversal_date`

- [ ] **Step 1: Write the successful-correction integration test**

Post a manual entry dated `2026-04-15`, then call the wished-for API with changed date, reference, memo, adjusting status, accounts, amounts, Name, and Class. Assert independently derived outcomes:

```ts
const result = await t.db.transaction().execute(trx => ledger.correctJournalEntry(trx, ctx, {
  journal_entry_id: original.id,
  replacement: {
    business_id: biz.id,
    entry_date: '2026-05-02',
    source_type: 'adjustment',
    memo: 'Corrected cash sale',
    reference: 'AJE-22',
    lines: [
      { account_id: cash.id, debit: '125.0000', credit: '0.0000', memo: 'Correct debit', name: 'Patient A', class_name: 'Clinic' },
      { account_id: revenue.id, debit: '0.0000', credit: '125.0000', memo: 'Correct credit', name: null, class_name: null },
    ],
  },
}));

expect(result.original.status).toBe('voided');
expect(result.reversal).toMatchObject({ entry_date: '2026-04-15', reversed_entry_id: original.id, source_type: 'reversal' });
expect(result.corrected_entry).toMatchObject({
  entry_date: '2026-05-02',
  source_type: 'adjustment',
  corrected_from_entry_id: original.id,
  status: 'posted',
});
```

Also query lines and assert the reversal is exactly flipped, the replacement values are exact, and one `journal_entry.update` audit row links the three IDs.

- [ ] **Step 2: Run the correction test and verify RED**

Run: `npm -w @accounting/api run test:integration -- tests/integration/ledgerService.test.ts -t "atomically corrects"`

Expected: FAIL because `correctJournalEntry` does not exist.

- [ ] **Step 3: Implement the minimal atomic orchestration**

Add:

```ts
export type CorrectJournalEntryInput = {
  journal_entry_id: string;
  replacement: PostJournalEntryInput;
};
```

`correctJournalEntry` must:

1. reject roles below accountant with `ERR.FORBIDDEN`;
2. select the target with `FOR UPDATE`, scoped to `ctx.business_id`;
3. require `status === 'posted'` and source `manual` or `adjustment`;
4. snapshot original lines for the update audit;
5. call `voidJournalEntry` with `reversal_date: original.entry_date` and reason `Corrected through journal entry editor`;
6. call `postJournalEntry` with the replacement and `corrected_from_entry_id: original.id`;
7. record `AUDIT.JOURNAL_ENTRY_UPDATE` with the before snapshot and the original/reversal/replacement IDs;
8. return all three rows.

Make `voidJournalEntry` select `input.reversal_date ?? today` while preserving current void behavior for callers that omit it.

- [ ] **Step 4: Run the happy-path correction test and verify GREEN**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Add failure and rollback tests**

Add separate tests proving:

- invoice-source and reversal entries reject correction;
- a target from another business returns `ERR.NOT_FOUND`;
- a closed original period returns `ERR.CLOSED_PERIOD`;
- an unbalanced replacement rolls back the void, leaving one posted original and no reversal/replacement;
- correcting the same original twice rejects the second request after the first transaction commits.

Each test must query the database after rejection and assert ledger state, not only the thrown error.

- [ ] **Step 6: Run failure tests and implement only missing guards**

Run: `npm -w @accounting/api run test:integration -- tests/integration/ledgerService.test.ts`

Expected before guards: at least the non-manual or tenancy test FAILS for the intended missing branch. Add the explicit checks and rerun until all tests PASS.

- [ ] **Step 7: Re-run ledger trigger protections**

Run: `npm -w @accounting/api run test:integration -- tests/integration/ledgerTriggers.test.ts`

Expected: PASS, proving direct mutation remains blocked.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/core/ledgerService.ts apps/api/tests/integration/ledgerService.test.ts
git commit -m "feat(journal): correct posted entries atomically"
```

### Task 4: Account-enriched journal queries and correction route

**Files:**
- Create: `apps/api/src/services/core/journalEntryQueryService.ts`
- Create: `apps/api/tests/integration/journalEntryQueryService.test.ts`
- Modify: `apps/api/src/routes/journalEntries.ts`

**Interfaces:**
- Produces: `JournalEntryDetail` with `entry.period_status`, `lines`, `can_correct`, and `correction_block_reason`
- Produces: `listJournalEntries(db, ctx, query)` returning `{ entries, limit, offset }`
- Produces: `getJournalEntryDetail(db, ctx, id)`
- Produces: `POST /businesses/:businessId/journal-entries/:id/correct`

- [ ] **Step 1: Write failing query-service integration tests**

Use real posted entries and assert:

```ts
const result = await listJournalEntries(t.db, ctx, {
  period_start: '2026-04-01',
  period_end: '2026-04-30',
  limit: 50,
  offset: 0,
});
expect(result.entries).toHaveLength(1);
expect(result.entries[0]!.lines[0]).toMatchObject({ account_code: '1010', account_name: 'Cash' });
```

For detail, assert an accountant sees `can_correct: true` for a posted manual entry, while a generated entry, closed-period entry, and staff viewer each receive `can_correct: false` with a non-empty reason.

- [ ] **Step 2: Run query-service tests and verify RED**

Run: `npm -w @accounting/api run test:integration -- tests/integration/journalEntryQueryService.test.ts`

Expected: FAIL because the query service does not exist.

- [ ] **Step 3: Implement the read service**

Define concrete response types. `listJournalEntries` selects business-scoped entries with optional status and date predicates, stable ordering, limit/offset, then performs one joined line/account query for all returned entry IDs and groups lines by `journal_entry_id`. `getJournalEntryDetail` joins the fiscal period and returns line/account data plus editability derived in this order:

1. role below accountant;
2. state not posted;
3. source not manual/adjustment;
4. period closed;
5. otherwise editable.

Use `hasMinRole` from `@accounting/shared`; do not duplicate role ranking.

- [ ] **Step 4: Run query tests and verify GREEN**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Route all journal reads and corrections through one service call**

Replace direct GET queries with the query-service methods. On create, pass `is_adjusting ? 'adjustment' : 'manual'` and line Name/Class values. Add the correction route:

```ts
router.post('/businesses/:businessId/journal-entries/:id/correct', requireMinRole('accountant'), async (req, res, next) => {
  try {
    const body = schemas.journalEntryCorrectionSchema.parse(req.body);
    const ctx = ctxFromReq(req);
    const work = (trx: Transaction<DB>) => ledger.correctJournalEntry(trx, ctx, {
      journal_entry_id: req.params['id']!,
      replacement: {
        business_id: req.tenancy!.business_id,
        entry_date: body.entry_date,
        source_type: body.is_adjusting ? 'adjustment' : 'manual',
        memo: body.memo ?? null,
        reference: body.reference ?? null,
        lines: body.lines.map(line => ({
          account_id: line.account_id,
          debit: line.debit,
          credit: line.credit,
          memo: line.memo ?? null,
          name: line.name ?? null,
          class_name: line.class_name ?? null,
        })),
      },
    });
    const result = force
      ? await runWithClosedPeriodOverride(db, ctx, reason, work)
      : await db.transaction().execute(work);
    res.json(result);
  } catch (error: unknown) { next(error); }
});
```

Build `force` and `reason` exactly like the existing create/void routes.

- [ ] **Step 6: Run API typecheck, query tests, and commit**

Run: `npm -w @accounting/api run typecheck`

Run: `npm -w @accounting/api run test:integration -- tests/integration/journalEntryQueryService.test.ts tests/integration/ledgerService.test.ts`

Expected: PASS.

```bash
git add apps/api/src/services/core/journalEntryQueryService.ts apps/api/tests/integration/journalEntryQueryService.test.ts apps/api/src/routes/journalEntries.ts
git commit -m "feat(journal): expose correction and line-level reads"
```

### Task 5: Shared journal editor data model

**Files:**
- Create: `apps/web/src/pages/journal/journalEntryForm.ts`
- Create: `apps/web/src/pages/journal/journalEntryForm.test.ts`
- Create: `apps/web/src/pages/journal/journalEntryTypes.ts`

**Interfaces:**
- Produces: `JournalEntryDetail`, `JournalEntryListItem`, and `JournalEntryLine` API types
- Produces: `JournalEntryFormValues` and `JournalEntryFormLine`
- Produces: `blankJournalLine()`, `journalEntryToForm(detail)`, `journalEntryPayload(form)`, and `journalEntryTotals(lines)`

- [ ] **Step 1: Write failing pure mapping tests**

Use a complete literal API fixture and assert:

```ts
const form = journalEntryToForm(detail);
expect(form).toMatchObject({
  date: '2026-08-20',
  journalNo: 'JE-22',
  isAdjusting: true,
  memo: 'Adjustment',
});
expect(form.lines).toHaveLength(8);
expect(form.lines[0]).toMatchObject({
  account_id: CASH_ID,
  debit: '50.0000',
  description: 'Debit line',
  name: 'Patient A',
  class_name: 'Clinic',
});
```

Add a serialization test with literal expected decimal strings and a totals test that expects `{ debit: '50.0000', credit: '50.0000', balanced: true }`.

- [ ] **Step 2: Run helper tests and verify RED**

Run: `npm -w @accounting/web test -- src/pages/journal/journalEntryForm.test.ts`

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement the pure types and mappings**

Use `Decimal` for totals and `parseMoneyInput` for payload values. Loaded lines preserve exact API strings and append blank rows until there are at least eight; never truncate an entry with more than eight lines. Filter payload lines by `account_id`, and map `description` to API `memo`.

- [ ] **Step 4: Run helper tests and verify GREEN**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/journal/journalEntryTypes.ts apps/web/src/pages/journal/journalEntryForm.ts apps/web/src/pages/journal/journalEntryForm.test.ts
git commit -m "feat(journal): add shared editor data model"
```

### Task 6: Reuse the journal-entry grid for create and correction

**Files:**
- Create: `apps/web/src/pages/journal/JournalEntryEditor.tsx`
- Modify: `apps/web/src/pages/journal/JournalNewPage.tsx`
- Modify: `apps/web/src/pages/journal/JournalDetailPage.tsx`

**Interfaces:**
- Consumes: Task 5 form helpers and `JournalEntryDetail`
- Produces: `JournalEntryEditor({ existing?: JournalEntryDetail })`
- Create Save: `POST /journal-entries`
- Edit Save: `POST /journal-entries/:id/correct`, navigate to `corrected_entry.id`

- [ ] **Step 1: Extract the current grid into `JournalEntryEditor` without changing behavior**

Move the current New page state, account loading, table, totals, row copy/delete/add/clear, memo, error, and sticky actions into the component. Initialize state from `existing ? journalEntryToForm(existing) : newJournalEntryForm()`. Keep native date inputs and existing styling.

- [ ] **Step 2: Make all controls honor server editability**

Set `readOnly = existing !== undefined && !existing.can_correct`. Disable input/select/checkbox and row-mutating controls when read-only. Render `existing.correction_block_reason` in a visible neutral banner. For editable existing entries, render:

```tsx
<div className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
  Saving creates a reversing entry and posts the corrected replacement so your audit history stays intact.
</div>
```

- [ ] **Step 3: Wire create and correction saves**

Build the body only through `journalEntryPayload`. For existing entries call `/journal-entries/${existing.entry.id}/correct`, then navigate to `/journal/${response.data.corrected_entry.id}`. For create keep Save, Save and new, and Save and close behavior. Keep entered state and display `pickErr(error)` if either request fails.

- [ ] **Step 4: Preserve manual voiding without enabling source-ledger divergence**

Show `Void entry` only for posted manual/adjustment entries. Use the existing void endpoint and prompt. Do not show it for generated or reversal entries.

- [ ] **Step 5: Replace route pages with thin wrappers**

`JournalNewPage` returns `<JournalEntryEditor />`. `JournalDetailPage` fetches `JournalEntryDetail`, renders loading/error states, then returns `<JournalEntryEditor existing={data} />`. Do not change the `/journal/new` or `/journal/:id` routes.

- [ ] **Step 6: Run web tests, typecheck, and build**

Run: `npm -w @accounting/web test -- src/pages/journal/journalEntryForm.test.ts`

Run: `npm -w @accounting/web run typecheck`

Run: `npm -w @accounting/web run build`

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/journal/JournalEntryEditor.tsx apps/web/src/pages/journal/JournalNewPage.tsx apps/web/src/pages/journal/JournalDetailPage.tsx
git commit -m "feat(journal): reuse entry grid for corrections"
```

### Task 7: Grouped, fully clickable journal report page

**Files:**
- Create: `apps/web/src/pages/journal/journalReport.ts`
- Create: `apps/web/src/pages/journal/journalReport.test.ts`
- Modify: `apps/web/src/pages/journal/JournalListPage.tsx`

**Interfaces:**
- Consumes: `JournalEntryListItem[]`
- Produces: `JournalPeriodPreset = 'all' | 'month' | 'year' | 'custom'`
- Produces: `journalPeriodParams(preset, today, customStart, customEnd)`
- Produces: `filterJournalEntries(entries, status, search)`
- Produces: `journalExportRows(entries)` matching the visible line-level columns

- [ ] **Step 1: Write failing report-helper tests**

Use two entries with three literal lines and assert:

- `month` on 2026-08-25 produces `{ period_start: '2026-08-01', period_end: '2026-08-31' }`;
- `all` produces no date params;
- account-number, account-name, line Name, reference, and amount searches keep the matching parent entry;
- export rows contain one row per journal line plus per-entry totals and a report total;
- literal totals equal debit `150.0000` and credit `150.0000`.

- [ ] **Step 2: Run report-helper tests and verify RED**

Run: `npm -w @accounting/web test -- src/pages/journal/journalReport.test.ts`

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement pure period, filter, and export helpers**

Use local calendar constructors plus `dateToLocalIso` for date boundaries and Decimal for debit/credit totals. Search one normalized string containing entry reference, memo, source, status, and every line's account code/name, memo, Name, and Class.

- [ ] **Step 4: Run report-helper tests and verify GREEN**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Replace the summary DataTable with grouped line rows**

Retain the existing page header, New Entry split button, import modal, Excel export, and print. Add Date period preset plus custom `DateInput` controls. Request nested entries with the selected period params and a limit of 200.

Render columns in this order:

```ts
const JOURNAL_HEADERS = [
  'Transaction date', 'Transaction type', 'Num', 'Name', 'Description',
  'Account number', 'Account name', 'Debit', 'Credit',
];
```

Each group renders a linked header, linked line values, linked non-zero debit/credit amounts, and linked per-entry amount totals. Use `<Link to={`/journal/${entry.id}`}>` for every non-empty transaction value rather than click handlers. Add the report total row and visible-entry count. Render voided groups muted but present.

- [ ] **Step 6: Make export and print mirror visible rows**

Feed `journalExportRows(filteredEntries)` to Excel and print. HTML-escape every printed cell using the existing local escape pattern; preserve numeric right alignment.

- [ ] **Step 7: Run web verification and commit**

Run: `npm -w @accounting/web test`

Run: `npm -w @accounting/web run typecheck`

Run: `npm -w @accounting/web run lint`

Run: `npm -w @accounting/web run build`

Expected: all PASS with no new warnings.

```bash
git add apps/web/src/pages/journal/journalReport.ts apps/web/src/pages/journal/journalReport.test.ts apps/web/src/pages/journal/JournalListPage.tsx
git commit -m "feat(journal): add clickable line-level journal report"
```

### Task 8: Full-system verification and handoff

**Files:**
- Modify if behavior changed: `docs/superpowers/specs/2026-08-25-journal-entry-editing-design.md`
- Modify if execution changed: `docs/superpowers/plans/2026-08-25-journal-entry-editing.md`

**Interfaces:**
- Consumes: all prior tasks
- Produces: verified branch ready to merge into local `main`; no push

- [ ] **Step 1: Run complete automated verification**

Run: `npm run typecheck`

Run: `npm test`

Run: `npm run test:integration`

Run: `npm run lint`

Run: `npm run build`

Expected: all commands exit 0. Record exact test counts in the final handoff.

- [ ] **Step 2: Run browser verification against local app**

Verify:

1. `/journal` shows grouped line rows, American dates, per-entry totals, and report totals.
2. Date and search filters update visible groups.
3. A value and amount link can be opened in a new tab.
4. `/journal/new` creates both manual and adjusting entries and retains Name/Class.
5. Opening a posted manual entry shows the same grid enabled.
6. Saving a change lands on the replacement; the old entry is voided, reversal-linked, and read-only.
7. Opening a generated entry shows the same grid disabled with a source-edit explanation.

- [ ] **Step 3: Review the commit range and working tree**

Run: `git diff main...HEAD --check`

Run: `git status --short`

Run: `git log --oneline main..HEAD`

Expected: no whitespace errors, no uncommitted feature files, and focused commits matching the task sequence.

- [ ] **Step 4: Commit any evidence-driven cleanup**

If verification reveals a defect, first add a failing regression test, verify RED, implement the smallest fix, verify GREEN, then commit only the touched files with a specific `fix(journal): ...` message. If no defect exists, make no empty commit.

- [ ] **Step 5: Merge locally without pushing**

Use the finishing-development-branch workflow to merge `slice-14-journal-entry-editing` into local `main`, rerun the fast verification on `main`, and leave pushing to the user as requested.

