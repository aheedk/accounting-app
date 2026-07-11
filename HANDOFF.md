# Session handoff — follow-ups batch (2026-07-10/11)

Continuation notes for the next Claude session (user is switching accounts;
same machine, same checkout). **Read this, then continue the plan.**

## Where to pick up

1. Plan: `docs/superpowers/plans/2026-07-10-follow-ups-batch.md` — Tasks A–E are DONE, continue at **Task F** (checkboxes in the plan are current).
2. Work inline on `main` (matches repo convention; user handles pushes). Use superpowers `executing-plans` + `test-driven-development` skills. Commit after every task (user preference).
3. Deliberately out of scope: Railway volume mount (user must do in dashboard), prod "QBO Style Test Co" vendor deletion (needs explicit user go-ahead), tax engine / Plaid / OCR.

## Completed this session (all committed to local `main`, not pushed)

| Commit | What |
|---|---|
| `6f1d4c0` | plan doc for the batch |
| `58a0412` | Task A — `numbering_counters` table + atomic upsert `nextNumber()`; 4 helpers swapped; migration `0051` |
| `4544383` | Task B — recurring invoice/bill materialization (payload zod schemas in shared, posted docs via invoice/bill services) |
| `bbf7e5b` | Task C — pause/resume (`update`), audit-backed `listRuns`, PATCH + `/runs` routes, full page rework (type-aware form, preview, history) |
| `46dd1be` | web lint hygiene (dead apply-rules residue, `<\/script>` escapes) |
| `5d3679a` | fmtDate local-date fix on recurring page; seed templates now store materializable payloads (`account_id` + money strings) |
| `7fe8415` | Task D — in-process hourly scheduler (`jobs/recurringScheduler.ts`, started from `index.ts`); run-due now per-template transactions with per-template errors |
| `e4d483d` | Task E — migration `0052` + `voidPayRun` keeps JE link |

## Environment state (as left)

- **Dev servers**: `npm run dev` running in background (API :4001, web :5173).
- **`apps/web/.env.local`** (gitignored) now points `VITE_DEV_PROXY_TARGET` at `http://localhost:4001` (was prod Railway). Original value is in the file comment — flip back for prod-data work.
- **Local Postgres** (docker compose, :5433): migrated through `0052`, demo-seeded (additive `npx tsx bin/seed.ts` — do NOT `db:reset`, the permission classifier blocks it), seeded recurring templates repaired in-place to the new payload shape.
- **Local login fixture**: `admin@example.com` / `bcCSmzUUCQfp` (throwaway generated this session, local docker DB only). To rotate: `node -e` bcrypt hash + `psql ... UPDATE users SET password_hash=...`.
- **Docker Desktop must be running** for integration tests (testcontainers). Test command: `npx vitest run tests/integration/<file> --pool=forks --poolOptions.forks.singleFork=true` from `apps/api`.
- **After editing anything in `packages/shared`**: run `npm -w @accounting/shared run build` — the API/web resolve the compiled `dist/`, and a stale dist breaks typecheck in confusing ways (bit us this session).
- Typecheck (api + web) clean; web lint 0 errors / 16 pre-existing warnings.
- **Prod deploy pending**: migrations 0051–0052 + all the above are local-only until user pushes + deploys Railway.

## Gotchas discovered (already encoded in code/plan, listed to save re-derivation)

- `invoiceService.createDraft` returns `{ invoice, lines }`; `billService.createDraft` returns `{ bill, lines }` (not bare rows).
- `fmtDate`-style helpers must not pass date-only strings through `new Date()` (UTC midnight rolls back a day locally). Use `todayLocal()` / `fmtLongDate()` / string splits.
- The scheduler attributes system runs to `template.created_by_user_id` (JE FK needs a real user; `systemCtx` zero-UUID would violate it). Null-creator templates are skipped with a warning.
- Browser verification: Chrome autofills the user's saved prod credentials on the login form — replace BOTH fields with the fixture account; never submit the autofilled ones.
- `runDueForBusiness(db, ctx, bizId)` replaced trx-scoped `runDue` (route + tests updated).

## Remaining tasks (F–L in the plan)

- **F** Performance Center Recharts swap (`npm install -w apps/web recharts` is pre-approved by follow-ups.md).
- **G** Banking: import history, rule dry-run with match counts, undo recent import, EmptyStates. (Recon first: check for an import-batch concept; RulesPage's apply-rules UI was removed in a restyle — rebuild apply UX with dry-run here.)
- **H** shadcn Dialog wrapper + swap 5 ad-hoc modals (Receipts, IntegrationInbox, Contractors, EmployeeDetail, PayrollTaxes).
- **I** Custom Reports regression tests (lifecycle + account filters).
- **J** Field-level validation surfacing (zod issues in 400s) + Saving/Saved states.
- **K** A11y labels/ids pass on flagged form controls.
- **L** Env-gated S3/R2 `FileStorage` adapter + `@aws-sdk/client-s3`.
- Wrap-up: full integration suite with fork flags, refresh `docs/qbo-revamp-handoff.md` (stale: says second wave unmerged — it IS merged), final `docs/follow-ups.md` sweep.
