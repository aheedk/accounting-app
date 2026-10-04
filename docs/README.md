# Docs

Where to find things. Start with the backlog for what is still to do, or the guide
to run the app.

| Folder / file | What is in it |
|---|---|
| [`backlog.md`](./backlog.md) | Open work that is not tied to a meeting: ops tasks, polish, integrations, plus a ledger of what has shipped from it. |
| [`meetings/`](./meetings/) | Follow-ups from team meetings — what was asked, what is done, what is open. |
| [`guides/`](./guides/) | How-to guides. [`running-locally.md`](./guides/running-locally.md) starts the app and covers developer gotchas. |
| [`specs/`](./specs/) | Design specs: how a feature is meant to work and why. Named `YYYY-MM-DD-<topic>-design.md`. |
| `plans/` | Step-by-step implementation plans for work in progress (created as needed; removed once the work ships — git history keeps them). |
| [`qa/`](./qa/) | Testing: the full-app audit (bugs by priority) and the Chart of Accounts test guide. |

## Specs

| Spec | Covers |
|---|---|
| [Ledger and AR foundation](./specs/2026-04-20-accounting-app-slice-1-ledger-and-ar-design.md) | Core architecture: tenancy, roles, the ledger, invoices and payments. |
| [Filling the Coming Soon tabs](./specs/2026-04-24-fill-coming-soon-tabs-design.md) | The slices 2–13 roadmap and the conventions every feature follows. |
| [Chart of Accounts](./specs/2026-07-20-chart-of-accounts-design.md) | The QuickBooks-style Chart of Accounts: layout, opening balances, locking, batch edit, the register. |
| [Journal entry editing](./specs/2026-08-25-journal-entry-editing-design.md) | In-place editing of posted journal entries. |
| [AI auto-coding](./specs/2026-09-24-ai-auto-coding-design.md) | The AI inbox and the layered coding engine. |
| [General Ledger](./specs/2026-10-04-general-ledger-design.md) | The QuickBooks-style General Ledger report. |
