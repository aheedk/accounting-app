# Slice 1 — Resume Document

**Purpose:** This document is a self-contained handoff for a fresh Claude Code session to continue executing Slice 1 of the accounting-app from where the prior session was interrupted (context window saturation + Anthropic API overload errors).

**Last updated:** 2026-04-21, after Plan 1.2 Task 12.

---

## Quick orientation

You are continuing execution of **Slice 1 (Ledger + AR)** of the accounting-app. The project lives at `/Users/aheedkamil/projects/accounting-app/`. All work is happening in a git worktree at:

```
/Users/aheedkamil/projects/accounting-app/.worktrees/slice-1/
```

on branch `slice-1`. **All shell, git, and file operations should target that worktree path** — the parent shell CWD is `/Users/aheedkamil/projects/Workout-app/` (a different project), so always use `git -C /Users/aheedkamil/projects/accounting-app/.worktrees/slice-1` for git commands and absolute paths for file operations.

**Read first:**
1. `docs/superpowers/specs/2026-04-20-accounting-app-slice-1-ledger-and-ar-design.md` — the design spec (locked, do not modify scope)
2. `docs/superpowers/plans/2026-04-20-accounting-app-slice-1-plan-1.0-foundation.md` — Plan 1.0 (DONE)
3. `docs/superpowers/plans/2026-04-20-accounting-app-slice-1-plan-1.1-ledger.md` — Plan 1.1 (DONE)
4. `docs/superpowers/plans/2026-04-20-accounting-app-slice-1-plan-1.2-ar.md` — Plan 1.2 (IN PROGRESS — resume here)

---

## Current status

| Plan | Status | Tasks done |
|---|---|---|
| 1.0 Foundation | ✅ Dispatchable complete | 38/38 (Tasks 37-38 = manual user action for Railway/Netlify deploys) |
| 1.1 Ledger Engine | ✅ Complete | 25/25 |
| 1.2 AR Module | 🔄 In progress | **12/30** — resume at Task 13 |

**Branch state:** `slice-1` is **80+ commits ahead of `main`**, all pushed to GitHub at https://github.com/aheedk/accounting-app/tree/slice-1.

**Test count:** 43 integration tests passing (10 unit tests in `@accounting/shared`).

---

## Resume here: Plan 1.2 Task 13

**Last commit landed:** `f5cffb1 feat(api): customer service with TDD` (Plan 1.2 Task 12)

**Next task:** **Plan 1.2 Task 13** — Invoice service createDraft / addLine / update / void (TDD). This is the BIG one — implements the spec's verbatim "post invoice" rule (DR AR / CR Revenue / CR Tax Payable).

Plan file location: `docs/superpowers/plans/2026-04-20-accounting-app-slice-1-plan-1.2-ar.md` lines 1349-1733.

The plan markdown contains the verbatim test code + service implementation. Read those lines and dispatch to a general-purpose subagent.

---

## How to dispatch the next subagent

The pattern that has worked throughout this session:

1. Read the relevant section of the plan markdown.
2. Use the `Agent` tool with `subagent_type: "general-purpose"`.
3. **Always include this in the prompt:**
   ```
   WORKING DIRECTORY: /Users/aheedkamil/projects/accounting-app/.worktrees/slice-1/ — use absolute paths and `git -C ...` for git.
   ```
4. Paste the verbatim spec from the plan into the prompt (don't make the subagent read the plan file — too token-expensive).
5. Specify ONE commit per plan-task with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
6. Ask for a structured report.

When the subagent reports back:
- If it raises real defects in the plan (which has happened ~10 times), update the plan markdown to match the implementation, commit as `fix(plan): ...`, and push. **Plan + impl drift is the #1 thing to keep on top of.**
- For trivial mechanical tasks (constants files, byte-exact migrations), a combined spec+quality review is fine. For substantial code (services with logic, triggers, integration test logic), do separate spec + quality review subagents.

---

## Locked architectural decisions (do NOT propose changing without explicit user approval)

These are load-bearing — many were learned the hard way during execution:

1. **Single firm now, multi-firm-ready schema.** `firm_id` columns everywhere, only one firm seeded.
2. **Monorepo (`apps/api`, `apps/web`, `packages/shared`)** with npm workspaces.
3. **Backend:** Express + Kysely (typed query builder, **no ORM**) + plain `.sql` migrations applied by `bin/migrate.ts`.
4. **Frontend:** Vite + React + TS + Tailwind + shadcn/ui (components copied into repo, not a runtime dep).
5. **Money:** `numeric(19,4)` everywhere, USD only, serialized as **strings** over the wire, parsed with `decimal.js`.
6. **Belt-and-suspenders invariants:** business rules enforced at BOTH service layer AND DB layer (CHECK constraints + triggers).
7. **Service signature is universal:** `(trx: Transaction<DB>, ctx: ServiceCtx, args: X)`. Routes own `db.transaction().execute(...)`. Audit log row is always written in the SAME transaction as the mutation.
8. **Only `core/ledgerService` writes to `journal_entries` / `journal_entry_lines`.** AR services call `ledgerService.postJournalEntry({ source_type: 'invoice'|'payment'|'credit_memo', source_id, ... })`.
9. **Auth:** JWT access (15-min) + refresh token (180-day rolling, HMAC-hashed in DB). Refresh cookie `httpOnly + Secure + SameSite=None` for cross-origin Netlify→Railway.
10. **Deployment:** API + Postgres on Railway, web on Netlify (manual dashboard config — Tasks 37-38 of Plan 1.0).
11. **Testing:** vitest unit + Testcontainers Postgres integration. TDD discipline mandatory for `core/ledgerService`.

---

## Critical gotchas learned during execution (document them or you'll re-learn them)

These are NOT in the plan — they were discovered by adversarial tests or by the implementer subagents hitting them. The plans have been patched, but you should be aware:

### 1. `current_setting('app.X', true)` returns NULL when unset — must wrap with COALESCE

```sql
-- BROKEN (silently no-ops because NULL <> 'on' evaluates to NULL not TRUE):
IF current_setting('app.allow_void', true) <> 'on' THEN ...

-- CORRECT:
IF COALESCE(current_setting('app.allow_void', true), '') <> 'on' THEN ...
```

This was a **critical** bug caught by Plan 1.1 Task 14 adversarial tests — the immutability/period-gate guards were silently no-op. Anyone with raw SQL access could mutate posted entries. **Apply this pattern to ALL `current_setting()` calls in trigger functions.**

### 2. Postgres `CONSTRAINT TRIGGER` does NOT support `REFERENCING NEW TABLE` (transition tables)

The original Plan 1.1 Task 4 spec used `CREATE CONSTRAINT TRIGGER ... REFERENCING NEW TABLE AS new_table FOR EACH STATEMENT`. Postgres rejects this combination — `CONSTRAINT TRIGGER` requires `FOR EACH ROW` and does not support transition tables.

**Fix already applied** to migration `0008_journal_entry_triggers.sql`: per-row constraint trigger that derives `journal_entry_id` from NEW/OLD and re-aggregates the touched JE at commit time. Behavior is preserved.

### 3. `pg` driver returns `date` (OID 1082) as JS Date, not string

This breaks the Kysely DB type contract that declares `ColumnType<string, ...>` for date columns. **Fix already applied** in `apps/api/src/db/index.ts`:
```ts
pg.types.setTypeParser(1082, (val) => val);
```

### 4. Lazy db singleton via Proxy (not eager `export const db = makeDb()`)

The original eager singleton `export const db = makeDb()` froze to whatever `DATABASE_URL` was set at module load — broke testcontainer rebinding. **Fix already applied** in `apps/api/src/db/index.ts`: lazy via Proxy, reads `process.env.DATABASE_URL` at first access. Plus a `destroyDbSingleton()` helper for clean test teardown.

### 5. Audit row written inside throwing transaction gets rolled back

The original Plan 1.0 Task 21 spec had `auth.login_failed` audit inside the same transaction as the AuthError throw. The throw rolls back the audit, breaking the test. **Fix already applied** in `apps/api/src/services/auth/authService.ts`: pre-check user/password OUTSIDE the success transaction; on failure, write the audit in its own committed transaction, THEN throw.

### 6. ESLint `no-explicit-any` is set to error — never use `catch (e: any)`

Project lint forbids `any`. Use the typed-unknown pattern:
```ts
function pickErr(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Failed';
}
```

### 7. `exactOptionalPropertyTypes: true` — zod's `.optional()` produces `T | undefined`

When passing zod-parsed objects to service methods that declare `{ name?: string }`, build patches conditionally:
```ts
const patch: { name?: string; ... } = {};
if (parsed.name !== undefined) patch.name = parsed.name;
// ...
```

### 8. `decimal.js` requires NAMED import under NodeNext + esModuleInterop

```ts
import { Decimal } from 'decimal.js';   // ← required
// NOT: import Decimal from 'decimal.js';
```

### 9. apiClient.ts needs `vite/client` reference for `import.meta.env`

```ts
/// <reference types="vite/client" />
import axios, ...
```

### 10. Web ESLint config required `--no-error-on-unmatched-pattern` and an `apps/web/.eslintrc.cjs`

ESLint v8 hard-errors on no-config and on no-matched-files. Both fixes already applied.

---

## Local environment state

### Docker

Docker Desktop is running (server v28.3.3). Postgres container is via docker-compose at `docker-compose.yml`. **Important:** the user's Homebrew Postgres was **stopped** during this session (`brew services stop postgresql@16`) to free port 5432 for the Docker container. To restart: `brew services start postgresql@16`.

### Local seeded admin

Last `npm run db:seed` produced:
- email: `admin@example.com`
- password: `yz0bpwLkAkUBKXaT` (random per-run; rotates if `db:reset` is run again)

Visit http://localhost:5173 (after `npm run dev`) to log in.

### Worktree state

```bash
git -C /Users/aheedkamil/projects/accounting-app/.worktrees/slice-1 log --oneline -5
# f5cffb1 feat(api): customer service with TDD
# b98dca4 feat(api): tax code service
# dccfdbd test(api): factories for customers + tax codes; extended truncate
# 056521e feat(shared): zod schemas for customers, invoices, payments, credit memos, aging
# 38e0e30 feat(shared,api): AR audit actions + AR error classes
```

Untracked file `packages/shared/tsconfig.tsbuildinfo` is a TS incremental build artifact — should probably be added to `.gitignore` in a future task (`*.tsbuildinfo` pattern). Not blocking.

### Verification commands

```bash
cd /Users/aheedkamil/projects/accounting-app/.worktrees/slice-1

# Run integration tests (requires docker compose postgres up)
docker compose up -d postgres --wait
npm -w @accounting/api run test:integration  # 43 tests

# Typecheck
npm -w @accounting/api run typecheck
npm -w @accounting/web run typecheck
npm -w @accounting/shared run build

# Web build
npm -w @accounting/web run build

# Lint
npm run lint
```

---

## Plan 1.2 task ledger (where you are + what's left)

| Task | Status | Notes |
|---|---|---|
| 1 — customers table | ✅ commit `5b8435b` | |
| 2 — tax_codes + tax_rates | ✅ commit `0423c42` | |
| 3 — invoices + invoice_lines | ✅ commit `26e0d9b` | |
| 4 — payments + payment_applications | ✅ commit `569b42a` | |
| 5 — credit_memos + close FK loop | ✅ commit `043c638` | |
| 6 — AR triggers (immutability + JE source extension) | ✅ commit `d151bec` | COALESCE fix applied; 3 protect_posted triggers + extended `je_check_source` |
| 7 — Augment DB type with AR tables | ✅ commit `3ec4c35` | |
| 8 — Audit actions + AR error classes | ✅ commit `38e0e30` | |
| 9 — AR zod schemas (6 files) | ✅ commit `056521e` | |
| 10 — Extend factories + truncateAll | ✅ commit `dccfdbd` | |
| 11 — Tax code service (TDD, 2 tests) | ✅ commit `b98dca4` | |
| 12 — Customer service (TDD, 3 tests) | ✅ commit `f5cffb1` | **just landed** |
| **13 — Invoice service (TDD, 5 tests)** | 🔄 **NEXT** | Plan lines 1349-1733; the BIG AR-to-ledger mapping; `core/ledgerService.postJournalEntry` from invoice |
| 14 — Invoice update + addLine/removeLine | ⏳ | Plan lines 1734-1835 |
| 15 — Payment service (TDD, 6 tests) | ⏳ | Plan lines 1836-2251; partial-payment, overpayment, post-apply behavior |
| 16 — Credit memo service (TDD, 3 tests) | ⏳ | Plan lines 2252-2511 |
| 17 — AR adversarial trigger tests + AR roundtrip | ⏳ | Plan lines 2512-2665 |
| 18 — Aging report service (TDD, 1 test) | ⏳ | Plan lines 2666-2808 |
| 19 — Customer + tax code routes | ⏳ | Plan lines 2809-2931 |
| 20 — Invoice + payment + credit memo routes | ⏳ | Plan lines 2932-3153 |
| 21 — Aging report route | ⏳ | Plan lines 3154-3193 |
| 22 — Updated seed: sample customers + tax codes | ⏳ | Plan lines 3194-3239 |
| 23 — Customers pages (web) | ⏳ | Plan lines 3240-3387 |
| 24 — Invoice list + detail pages | ⏳ | Plan lines 3388-3536 |
| 25 — Invoice creation page | ⏳ | Plan lines 3537-3649 |
| 26 — Payment list/detail/new pages | ⏳ | Plan lines 3650-3861 |
| 27 — Credit memo pages | ⏳ | Plan lines 3862-4052 |
| 28 — Aging report page + tax codes settings | ⏳ | Plan lines 4053-4204 |
| 29 — Wire all AR routes + extend sidebar | ⏳ | Plan lines 4205-4320 |
| 30 — Full-stack manual smoke test | ⏳ | Plan lines 4321-end; user action |

---

## Pacing guidance

- Each Plan 1.2 task averages 5-15 minutes of subagent runtime (longer for 13/15: ~20-30 min each because they have many tests and AR-to-ledger logic).
- Realistic estimate for the rest of Plan 1.2: ~6-10 hours of subagent runtime.
- The Anthropic API has been hitting `overloaded_error` periodically. When it does, often the subagent's commits land before the error reaches you. **Always check `git log` on slice-1 after an error before re-dispatching.**
- For trivial single-file tasks, write directly using `Write` + `Bash` tools instead of dispatching a subagent — faster and avoids overload.
- Push to GitHub after every 3-5 commits so progress is durable on the remote.

---

## What's still manual (Plan 1.0 Tasks 37-38 — user action)

These are not blockers for continuing Plan 1.2, but they're the only tasks that actually deploy the app:

1. **Railway:** create Postgres plugin + api service, set env vars (DATABASE_URL, JWT_*_SECRET, CORS_ALLOWED_ORIGINS, NODE_ENV=production), run `npm run migrate:prod` + `bin/create-admin.ts` once.
2. **Netlify:** connect repo, set `VITE_API_URL` env var, deploy.

See `docs/superpowers/plans/2026-04-20-accounting-app-slice-1-plan-1.0-foundation.md` Task 37 for the dashboard click-through.

---

## What's been deferred to Slice 2+ (do NOT add scope-creep)

Per the spec §13:
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
- `/settings/users` UI page (spec lists this but no plan covers it — gap acknowledged; defer to Slice 1.3 or Slice 2)

---

## Standard subagent prompt template (copy-paste)

```
Plan 1.2 Task <N>: <name>.

WORKING DIRECTORY: /Users/aheedkamil/projects/accounting-app/.worktrees/slice-1/ — use absolute paths and `git -C ...` for git.

## Spec (verbatim from plan lines <X>-<Y>)

[paste verbatim spec including all code blocks]

## Context

Worktree on `slice-1`, last commit `<sha>`. <Brief context about what landed before this task and what depends on it.>

## Apply lessons learned (already-known plan defects to pre-empt)

- catch (e: any) → catch (e: unknown) + typed cast (lint forbids any)
- COALESCE all current_setting() calls in PL/pgSQL trigger functions
- Use lazy patch construction with `if (parsed.X !== undefined)` instead of passing zod-parsed object directly when service expects optional props (exactOptionalPropertyTypes)
- Audit rows in their own committed transaction when the parent throws

## Your Job

<Steps 1-N>. ONE commit per task with Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com> trailer.

## Report Format

- Status (DONE | DONE_WITH_CONCERNS | BLOCKED)
- Commit SHA
- Test results
- Concerns
```

---

## How to handle API overload

When you see `API Error: overloaded_error`:

1. Check `git log` on slice-1 — the failed dispatch may have committed before erroring.
2. If commits landed: continue with the next task in the sequence.
3. If commits didn't land: retry with the same prompt (the API often recovers in seconds).
4. For trivial 1-file tasks: write directly with `Write` + `Bash` instead of dispatching.
5. After 3 consecutive overloads: surface to user — they may want to pause.

---

## When in doubt

The spec (`docs/superpowers/specs/2026-04-20-accounting-app-slice-1-ledger-and-ar-design.md`) is the contract. The plans are detailed implementations of the spec. If a plan task and the spec disagree, the spec wins. If a plan defect is caught (which has happened ~10x during this session), patch the plan markdown to match the corrected implementation and commit as `fix(plan): ...` so plan and code stay in sync forever.

---

**End of resume document. Start with Plan 1.2 Task 13 (Invoice service).**
