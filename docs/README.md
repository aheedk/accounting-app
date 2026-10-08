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
| [`qa/`](./qa/) | Testing: the full-app audit (bugs by priority), the role audit (what a client, staff, an accountant and a firm admin can each see and do), and the Chart of Accounts test guide. |

## Specs

| Spec | Covers |
|---|---|
| [Ledger and AR foundation](./specs/2026-04-20-accounting-app-slice-1-ledger-and-ar-design.md) | Core architecture: tenancy, roles, the ledger, invoices and payments. |
| [Filling the Coming Soon tabs](./specs/2026-04-24-fill-coming-soon-tabs-design.md) | The slices 2–13 roadmap and the conventions every feature follows. |
| [Chart of Accounts](./specs/2026-07-20-chart-of-accounts-design.md) | The QuickBooks-style Chart of Accounts: layout, opening balances, locking, batch edit, the register. |
| [Journal entry editing](./specs/2026-08-25-journal-entry-editing-design.md) | In-place editing of posted journal entries. |
| [AI auto-coding](./specs/2026-09-24-ai-auto-coding-design.md) | The AI inbox and the layered coding engine. |
| [General Ledger](./specs/2026-10-04-general-ledger-design.md) | The QuickBooks-style General Ledger report. |
| [Card statements and check stubs](./specs/2026-10-04-card-statements-and-check-stubs-design.md) | Credit card statements in the AI inbox, card payments on bank statements, check stubs, long multi-account PDFs. |
| [Suspense](./specs/2026-10-04-suspense-account-design.md) | Where the AI parks what it cannot categorize, and clearing it. |
| [Report set](./specs/2026-10-07-report-set-design.md) | A/R and A/P aging that tie to the ledger, and the Statement of Cash Flows. |
| [Inventory in the ledger](./specs/2026-10-07-inventory-ledger-design.md) | How stock reaches the books: cost of goods sold on a sale, opening stock, adjustments. Built; three choices in it are marked "to confirm" for the firm. |
