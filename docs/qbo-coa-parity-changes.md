# QBO Chart of Accounts parity — 2026-07-20 (main)

Rebuilds **Chart of Accounts** to mirror the QuickBooks Online CoA list
(user-supplied screenshot as the visual reference) and adds the account
**register** view behind QBO's "View register" action.

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
    drawer (name + number; type immutable; disabled for system accounts).
  - QBO pager (`‹ Previous 1-75 Next ›`), client-side.
  - QBO's "Batch edit" grid was intentionally NOT built — batch actions +
    per-row edit cover the use cases without the inline-grid complexity.
- **`pages/coa/AccountRegisterPage.tsx`** (new) — register view: Date /
  Ref no. / Type / Memo / Debit / Credit / running Balance, newest first,
  ending-balance header, Excel/PDF download, voided rows struck through with
  a pill. Shows a friendly notice if the API deployment predates the
  register endpoint.
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
