# Docs

Where to find things. Start with the backlog for what is still to do, or the guide
to run the app.

| Folder / file | What is in it |
|---|---|
| [`backlog.md`](./backlog.md) | Open work that is not tied to a meeting: ops tasks, polish, integrations, plus a ledger of what has shipped from it. |
| [`meetings/`](./meetings/) | Follow-ups from team meetings — what was asked, what is done, what is open. |
| [`demos/`](./demos/) | What to click to show the work at a meeting, one file per meeting and presenter (`YYYY-MM-DD-<who>.md`, dated by the meeting it is shown at). |
| [`guides/`](./guides/) | How-to guides. [`running-locally.md`](./guides/running-locally.md) starts the app and covers developer gotchas; [`backups.md`](./guides/backups.md) takes a copy of the database and proves it restores; [`recovery-plan.md`](./guides/recovery-plan.md) is what to do when production breaks. |
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
| [Account types](./specs/2026-10-12-account-types-design.md) | QuickBooks' account types and detail types: one shared list, worked out from the detail type, and how the Chart of Accounts and the Balance Sheet group by it. |
| [Printing checks from Pay Bills](./specs/2026-10-13-pay-bills-print-checks-design.md) | Paying bills by check: one numbered check per vendor, printed on check stock or plain paper, and how check numbers are kept in one sequence. |
| [Year end and Retained Earnings](./specs/2026-10-13-year-end-retained-earnings-design.md) | Nothing is posted at year end: income and expense start each fiscal year at zero and earlier years are carried in Retained Earnings, the same on the Balance Sheet, Trial Balance and General Ledger. |
| [Accounts and roles](./specs/2026-10-08-accounts-and-roles-design.md) | Signing in (switching a login off, passwords, two-step, sessions), the five roles, payroll access, the approval step, the activity log, and what a client login can do. |
| [Report set](./specs/2026-10-07-report-set-design.md) | A/R and A/P aging that tie to the ledger, and the Statement of Cash Flows. |
| [Company settings](./specs/2026-10-20-company-settings-design.md) | Setup → Company Settings: invoice numbering (one rule for every invoice), default terms, sales tax and expense payment method. |
| [Inventory in the ledger](./specs/2026-10-07-inventory-ledger-design.md) | How stock reaches the books: cost of goods sold on a sale, opening stock, adjustments. Built; three choices in it are marked "to confirm" for the firm. |
