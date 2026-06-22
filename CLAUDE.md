# CLAUDE.md — accounting-app

## Working mode (read first)

**Do not ask the user clarifying questions.** Make decisions and proceed. The user has explicitly delegated all design and implementation choices.

When something is genuinely ambiguous:
1. Pick the option that most closely matches existing patterns in this repo.
2. If still ambiguous, pick the option closest to the recommendations in `docs/superpowers/specs/2026-04-24-fill-coming-soon-tabs-design.md`.
3. If still ambiguous, pick the simplest option that does not require external integrations, new infra, or new env vars.
4. Document the decision in a one-line comment in the relevant code or in the slice plan.

The only acceptable reason to interrupt the user is: a destructive irreversible action is required (e.g., dropping a prod table, force-pushing main), or a real-world prerequisite is missing that the user must provide (e.g., setting an env var, provisioning a Railway volume).

## Project context

Production-grade accounting system for an accounting firm.

- **Slices 1–13 shipped.** All 23 originally-stubbed ComingSoon tabs replaced. 47 migrations, 157 integration tests, full sidebar coverage. See per-slice plans under `docs/superpowers/plans/`.
- **QBO-style revamp.** Every sidebar tab restyled to match QuickBooks Online (shared `MoneyBar` / `ReportCard` / `EmptyState` / `DataTable`, status pills, local dates, `fmtMoney` with no `$`). First wave is on `main`; the second wave (Accounting/Reports/Payroll/Inventory/Setup + QBO company switcher + Add-client flow) is on branch `accounting-qbo-revamp`. Living status in `docs/qbo-revamp-handoff.md`; changelogs in `docs/qbo-style-revamp-changes.md` and `docs/accounting-qbo-revamp-changes.md`.
- Design specs live in `docs/superpowers/specs/`. Implementation plans live in `docs/superpowers/plans/`.
- New features beyond the 23 tabs: write a fresh spec → plan → impl following the same pattern documented here.

## Architecture conventions (DO follow these)

### Service layer
- Signature: `(trx: Transaction<DB>, ctx: ServiceCtx, args: ...)`.
- `ServiceCtx` shape: see `apps/api/src/lib/ctx.ts`.
- Audit recorded inside the same transaction as the entity write — use `auditRecord(trx, ctx, { action, entity_type, entity_id, before, after })`.
- **Ledger writes ONLY via `core/ledgerService.postJournalEntry`.** Never `INSERT INTO journal_entries` directly from another service.

### Routes
- Mount: `router.use('/businesses/:businessId', requireAuth, resolveBusiness);` — `:businessId` MUST be in the mount path so the param is captured before middleware runs.
- Use `requireRole('accountant')` or `requireRole('firm_admin')` for state-changing endpoints; reads usually allow `staff+`.

### TypeScript
- `no-explicit-any: error`. Use `catch (e: unknown)` with typed narrowing.
- `exactOptionalPropertyTypes: true`. Build patch objects conditionally — never set a key to `undefined`.

### DB / Kysely
- Numeric/date columns: `ColumnType<string, string | number | undefined, string | number>`. **Never `Generated<ColumnType<>>`** — that double-wrap is a bug.
- Generated columns (defaults, sequences): `Generated<T>`.
- PL/pgSQL tenant filters: `COALESCE(current_setting('app.X', true), '')`.

### Postgres
- Migrations are sequentially numbered: `db/migrations/00NN_<name>.sql`.
- Triggers `set_updated_at` and `protect_posted` patterns are reused — see existing migrations for examples.
- Posted-period guard: services that mutate JE-bearing entities check the period is not closed before posting.

### RBAC
- Roles in `packages/shared/src/roles.ts`: `firm_admin` (40) > `accountant` (30) > `staff` (20) > `client` (10).
- Use `hasMinRole(actual, min)` from `@accounting/shared`.

### Audit + schemas
- Audit actions live in `packages/shared/src/auditActions.ts` — append, never reorder.
- Zod schemas live in `packages/shared/src/schemas/`. Re-export from `index.ts`.
- Test factories in `apps/api/tests/helpers/factories.ts`. `truncateAll` in `testDb.ts` lists tables in reverse-dependency order — append new tables to the front.

### Web
- Pages under `apps/web/src/pages/<group>/`. Use existing shadcn/ui patterns (see `pages/customers/`, `pages/banking/` for templates).
- Routes registered in `apps/web/src/App.tsx`. Sidebar in `apps/web/src/components/layout/Sidebar.tsx`.
- No `any`. Declare concrete types for API responses.
- Match existing styling — don't introduce new design tokens or component libraries.

## Working pattern (parallel agents)

For multi-phase work:

- **Each slice gets its own worktree under `.claude/worktrees/slice-N-<topic>/`** with branch `slice-N-<topic>` cut from `main`. Slices merge into `main` sequentially in the priority order from the spec.
- **Within a slice**, parallelize sub-agents only by file ownership. Each sub-agent prompt MUST list:
  - Files it owns (whitelist).
  - Files it MUST NOT modify (blacklist of files owned by sibling agents in the same phase).
- **Hot-spot files** (cross-slice merge magnets):
  - `apps/web/src/App.tsx`
  - `apps/web/src/components/layout/Sidebar.tsx`
  - `apps/api/src/db/types.ts`
  - `apps/api/src/app.ts`
  - `packages/shared/src/auditActions.ts`
  - `packages/shared/src/schemas/index.ts`
  - On merge conflict in any of these: re-apply both slices' append blocks. Never delete the other slice's lines.

## Plan-impl sync

If you deviate from the spec or a plan, **patch the spec/plan markdown in the same commit.** The plan and the code stay in sync — drift is treated as a bug.

## Don'ts

- Don't add `--no-verify` to git commits.
- Don't introduce a new dependency to "make it nicer" — match the existing toolchain.
- Don't write `protect_posted`-style triggers on tables where they aren't needed (e.g., bank_transactions are mutable until reconciled).
- Don't mock the database in service tests. Use the real test DB via `testDb.ts`.
- Don't rebuild a feature that already exists — `grep` first. Banking already imports CSVs; AR/AP already creates JEs via the ledger; etc.
- Don't ship a feature without:
  - Migration + DB type augmentation
  - Zod schemas + audit actions
  - Service + integration tests
  - Routes + role guards
  - Web pages + sidebar wiring
  - Updated seed (if business-scoped)
