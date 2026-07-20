# QBO Chart of Accounts parity — 2026-07-20 (main)

Rebuilds **Chart of Accounts** to mirror the QuickBooks Online CoA list
(user-supplied screenshot as the visual reference) and adds the account
**register** view behind QBO's "View register" action.

## Final direction (user decision, 2026-07-20 evening)

The deployed (`origin/main`) **web pages are the base, verbatim** — their
header, toolbar, settings panel (density, page size, report badges), drawers,
row menu, and register page. The earlier union that used this branch's pages
as the base was reverted. On top of their base, the **chart format** was
re-added as data, not layout:

- Columns **Number · Account Type (+ bank-link icon) · Detail Type · Balance ·
  Bank Balance · Status** — wired into their existing column-toggle settings
  panel (new Number/Status toggles added), all ON by default except
  Description. Balance = trial-balance net in natural sign; Bank balance =
  non-excluded bank-transaction sum for linked accounts; both degrade to
  em-dash/blank if a source endpoint is unavailable.
- Their stacked name-cell sub-line (code · detail type) now only shows data a
  hidden column would otherwise carry; the inline Inactive pill shows only
  when the Status column is off.
- Excel/print export gained Number + Balance columns.
- Their register page kept verbatim, plus: an adapter that renders BOTH
  register payload shapes (deployed `{entries, balance}` and unified
  `{rows, ending_balance}`), a catch on fetch failure, and voided-row
  strike-through + badge. This also fixes the white-screen crash class in
  either pairing of web and API generations.

## QBO New-account panel parity (2026-07-20, after final direction)

The create drawer now carries the full QBO field set (user screenshot):
name* + number* row, type* + detail-type row, **Make this a subaccount** +
parent-account select (same-type active accounts; type snaps to the parent's),
**Opening balance + As of** (balance-sheet types only), description, **Lock
account** (🔓/🔒 → locked accounts are created inactive via a follow-up
PATCH), a **new-account preview** panel (report section + active same-type
accounts sorted by code with the pending account highlighted), and a **Save
split button** (Save / Save and new).

API: `accountCreateSchema` gains `opening_balance` / `opening_balance_as_of`;
`createAccount` posts the opening JE **in the same transaction** via
`ledgerService.postJournalEntry` (source `adjustment` — the enum has no
`opening_balance` value; the memo carries intent), against an
**auto-created "Opening Balance Equity"** equity account (first free 39xx
code, QBO behavior). Income-statement accounts reject opening balances.
3 new integration tests. Note: opening balances need the API deploy; the old
prod schema strips the fields (account still created, no JE).

## Unification with the parallel `origin/main` implementation (API layer — still current)

A parallel CoA/register implementation (`4ccd007`, `284836b`) had been pushed
and deployed to Railway while this work was in flight. The merge unifies them:

- **Kept from theirs:** migration `0054` (`detail_type`, `description` on
  `chart_of_accounts`), QBO detail-type picklists in create/edit, description
  fields, "Create sub-account" row action, edit-drawer current-balance header,
  `GET /coa/:accountId` (single account + balance), the register's
  **counter-account** ("Payee/Account") column and Payment/Deposit split, and
  the legacy `/coa/:accountId/register` web route.
- **Kept from ours:** service-layer register (`listAccountRegister`, now with
  `counter_account`) with money-string math, natural-sign running balance,
  void-pair visibility, and tenancy tests; `code` renumbering; `bank_balance`;
  the TB/account-balance void fix; DataTable selection + pagination; the CoA
  toolbar (batch actions, gear, pager) and register toolbar (account switcher,
  date/search filters, journal-entry deep links).
- `GET /coa/:accountId` is reimplemented over `ledger.computeAccountBalance`
  (the deployed inline SQL counted drafts and mishandled voids).
- The web register **adapts the legacy `{account, entries, balance}` payload**
  served by older API deploys, so the page works against production before the
  unified API ships (fixes a white-screen crash: the page previously read
  `data.rows` from the legacy payload and crashed on `undefined`).

---

## Web

- **`pages/coa/CoaListPage.tsx`** — QBO layout:
  - Columns: **Number · Name · Account type · Balance · Bank balance · Action**.
    Bank-linked accounts (a `bank_accounts.cash_account_id` match) get a
    Landmark icon next to the type. Inactive rows get a pill next to the name.
  - **Balance** = trial-balance net in the account's *natural sign*
    (debit-normal for asset/expense, credit-normal for the rest), from the
    existing `/reports/trial-balance` endpoint. **Bank balance** = sum of
    non-excluded imported bank transactions for linked bank accounts.
  - Toolbar: **Batch actions ▾** (make selected accounts active/inactive),
    "Filter by name or number" search, account-type dropdown (**All**),
    status dropdown, export/print icons, **gear** popover (column show/hide +
    rows-per-page 75/150/300, persisted in `localStorage` under
    `coa.list.prefs`).
  - Row actions: **View register** + chevron menu (**Edit**, **Make
    inactive/active**, **Run report** → register). Edit opens a right-side
    drawer (name, number, **sub-account-of** picker — same type, self and
    descendants excluded to stay acyclic — and an **Active** checkbox; type
    immutable; disabled for system accounts).
  - **Status** column (Active/Inactive badges) is a gear option, on by
    default; names indent by sub-account depth.
  - QBO pager (`‹ Previous 1-75 Next ›`), client-side.
  - QBO's "Batch edit" grid was intentionally NOT built — batch actions +
    per-row edit cover the use cases without the inline-grid complexity.
- **`pages/coa/AccountRegisterPage.tsx`** (new) — register view: Date /
  Ref no. / Type / Memo / Debit / Credit / running Balance, newest first,
  ending-balance header, Excel/PDF download, voided rows struck through with
  a pill. Shows a friendly notice if the API deployment predates the
  register endpoint. Toolbar: **account switcher** (jump straight to another
  account's register), From/To date filters, and memo/ref/type search with a
  clear-filters chip; the **Type** cell deep-links to `/journal/:id`. Rows
  keep their true running balance even when neighbors are filtered out.
- **`components/ui/DataTable.tsx`** — two opt-in, backward-compatible
  extensions: controlled selection (`selectedIds`/`onSelectedIdsChange`) and
  `pagination={{ pageSize }}` (slices after sorting; header checkbox operates
  on the visible page).
- **`App.tsx`** — routes `/settings/coa/:accountId/register` and
  `/setup/coa/:accountId/register`.

## API

- **`GET /businesses/:id/coa/:accountId/register`** (new, staff+ read) —
  `chartOfAccountsService.listAccountRegister`: all posted+voided JE lines
  for the account, ascending, with running balance in natural sign;
  tenancy-checked (404 for foreign accounts).
- **`PATCH /businesses/:id/coa/:accountId`** now accepts **`code`**
  (renumbering): duplicate-code check per business, blocked for system
  accounts. `accountUpdateSchema` extended in `packages/shared`.
- **`listBankAccounts`** now returns **`bank_balance`** per bank account
  (sum of `bank_transactions.amount` where status ≠ `excluded`).

## Ledger correctness fix (pre-existing bug)

Voids are reversal-based: the original flips to `voided` and a **posted**
reversal cancels it. `computeTrialBalance` / `computeAccountBalance`
previously counted only `posted` entries, so a void *flipped the sign* of the
entry's effect (excluded the original, kept the reversal). Both now count
`posted` + `voided` — the pair nets to zero and as-of-date math stays
period-correct. The register shows both legs (voided leg badged "Voided").

## Tests (integration, all passing)

- `chartOfAccountsService.test.ts`: renumber happy path + audit, duplicate
  code, system-account code block, same-code no-op, register running
  balance/natural sign/void pair, cross-business 404.
- `ledgerService.test.ts`: void nets to zero in TB + account balance.
- `bankAccountService.test.ts`: `bank_balance` sum excludes excluded rows
  (terminal statuses need reviewer stamps — `bt_terminal_has_reviewer`).

## Deploy checklist

1. Deploy API to Railway (no migration). Until then the web page degrades
   gracefully against an older API: register shows a "deploy the latest API"
   notice, bank balances show an em-dash, code edits are ignored by the old
   schema.
2. After deploy: verify View register on an active account, renumber a
   non-system account, and check Bank balance appears for linked accounts.
