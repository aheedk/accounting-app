# Journal Entry Editing and Journal Report - Design Spec

**Status:** Approved by user 2026-08-25.

## Goal

Make Journal Entries work like the supplied QuickBooks references: the main page is a line-level journal report whose transaction values drill into a familiar journal-entry grid, and eligible manual entries can be corrected from that grid without mutating posted ledger history.

## Locked accounting decisions

- Posted journal rows and lines remain immutable. The existing database protections are not weakened.
- Saving an edit to an eligible posted entry performs one atomic correction transaction:
  1. lock and revalidate the original entry;
  2. void the original and post an equal reversal dated on the original accounting date;
  3. post the replacement entry with the edited values;
  4. link the replacement to the original and record `journal_entry.update` in the same transaction.
- If validation, period checks, or posting fails, the whole correction rolls back. The original remains posted and no reversal or replacement survives.
- Only posted entries whose source type is `manual` or `adjustment` are editable.
- Draft, voided, reversal, and source-generated entries open in the same grid but are read-only with a reason. Source-generated entries must be corrected from their source transaction so the subledger and general ledger cannot diverge.
- The original accounting period and the replacement entry's selected period must be open for the normal UI flow. Existing firm-admin override behavior remains available at the API boundary, but this feature adds no new closed-period override UI.
- Concurrent corrections are serialized with a row lock. Once the first correction voids the original, a second request fails the posted-state precondition.

## Data model

Migration `0057_journal_entry_corrections.sql` adds:

- `journal_entries.corrected_from_entry_id`, a nullable self-reference on the new replacement entry;
- a unique partial index on `corrected_from_entry_id`, preventing multiple direct replacements for one original;
- `journal_entry_lines.name`, nullable text;
- `journal_entry_lines.class_name`, nullable text.

The existing "Is Adjusting Journal Entry?" control is represented by the existing source types rather than a duplicate boolean column:

- unchecked creates or corrects to `source_type = 'manual'`;
- checked creates or corrects to `source_type = 'adjustment'`.

The Name and Class inputs already shown by the create screen become real persisted fields. Existing entries receive null values and remain fully readable.

## API and service contracts

### Create

`POST /businesses/:businessId/journal-entries`

The shared create schema adds optional `is_adjusting`, `name`, and `class_name` fields. The route maps the adjusting flag to `manual` or `adjustment`; line metadata is passed through the ledger service.

### Correct

`POST /businesses/:businessId/journal-entries/:id/correct`

- Requires accountant-or-higher access.
- Accepts the same editable fields as Create.
- Calls one `ledgerService.correctJournalEntry(trx, ctx, input)` orchestration method.
- Returns `{ original, reversal, corrected_entry }` so the client can navigate to the replacement.
- Supports the route's existing `admin_override=true` and `admin_override_reason` convention for authorized callers.

`correctJournalEntry` accepts the target ID plus the replacement post input, validates tenancy and editability, uses `voidJournalEntry` with an explicit original-date reversal, then calls `postJournalEntry` with `corrected_from_entry_id`.

### Read

`GET /businesses/:businessId/journal-entries/:id` adds:

- period status;
- persisted line Name and Class values;
- correction linkage;
- `can_correct` and `correction_block_reason` derived from entry state, source, period, and effective role.

`GET /businesses/:businessId/journal-entries` keeps its existing envelope and entry fields while adding nested account-enriched lines. It accepts optional date boundaries in addition to status, limit, and offset. This remains backward-compatible with existing callers that only consume entry-level fields.

## Shared journal-entry editor

The existing New Journal Entry layout becomes a reusable `JournalEntryEditor` component used by both `/journal/new` and `/journal/:id`.

Editable controls:

- Journal date
- Journal number/reference
- Is Adjusting Journal Entry
- Account
- Debit
- Credit
- Description
- Name
- Class
- Memo
- copy line, delete line, add lines, and clear lines

The editor pads loaded entries to at least eight visible rows, keeps the current balanced-state feedback, and uses the project's decimal money helpers when creating request payloads.

For eligible existing entries, Save calls the correction endpoint and navigates to the returned replacement ID. A visible notice explains that saving preserves history by reversing the original and posting a correction. Read-only entries use the same visual structure with disabled controls and a specific reason.

The existing unimplemented attachment drop zone and recurring-entry action are outside this feature. They remain visually unchanged; this work does not claim or add attachment/recurring behavior.

## Journal main page

`/journal` changes from one summary row per entry to a grouped, line-level journal report.

Columns follow the supplied reference:

- Transaction date
- Transaction type
- Number
- Name
- Description
- Account number
- Account name
- Debit
- Credit

Each journal entry renders as one group, followed by its line rows and a per-entry debit/credit total. The bottom of the table shows total debits and credits for the visible result set. Voided originals and their posted reversals remain visible so the report reflects the audit trail rather than silently rewriting history.

All non-empty transaction values and transaction amount totals are native React Router links to `/journal/:id`. This gives normal click, Ctrl/Cmd-click, and right-click/open-in-new-tab behavior. A generated or otherwise locked entry still opens the shared editor in read-only mode.

The page keeps New Entry, Excel export, Print, status filtering, search, and Excel import. It adds an All Dates / This Month / This Year / Custom period control, defaulting to All Dates to preserve the current page's coverage. Export and print use the same expanded line rows currently displayed.

Dates render in the app's locale-aware American-style journal format (`M/D/YY`); API and form values remain ISO `YYYY-MM-DD`.

## Error handling

- Unbalanced or invalid replacement data returns the existing typed ledger errors and leaves the original untouched.
- A closed original or replacement period returns `CLOSED_PERIOD`.
- Attempting to correct a non-manual source, reversal, draft, or voided entry returns `IMMUTABLE_RECORD` or `INVALID_STATE_TRANSITION` with a specific message.
- A missing or cross-business target returns `NOT_FOUND` without leaking another business's data.
- The editor keeps entered data visible when Save fails and renders the API message near the sticky action bar.

## Testing

- Shared-schema tests cover adjusting, line Name/Class, and invalid correction payloads.
- Postgres-backed ledger integration tests cover successful atomic correction, exact reversal/replacement links and lines, line metadata persistence, audit rows, non-manual rejection, closed-period rejection, cross-business rejection, and rollback on invalid replacement data.
- Pure web helper tests cover API-to-form mapping, eight-row padding, adjusting-source mapping, balanced totals, correction payload serialization, and expanded report/export rows.
- Typecheck, unit tests, integration tests, lint, and production build must pass.
- Browser verification covers the expanded journal report, native-link open-in-new-tab behavior, editable manual entry, read-only generated entry, and redirect to the corrected replacement after Save.

## Out of scope

- Direct mutation of posted journal rows or lines
- Editing invoices, payments, bills, bill payments, vendor credits, or other source transactions from the journal screen
- Draft journal workflow
- New attachment storage behavior
- Recurring journal-entry scheduling
- New accounting Class or Name master-data systems; these remain optional line text fields in this slice

