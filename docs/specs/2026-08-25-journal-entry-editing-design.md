# Journal Entry Editing - Design Spec

**Status:** Approved by user 2026-08-25.

## Goal

Make journal entries work like the supplied QuickBooks references: users can create entries in a familiar journal-entry grid and correct eligible manual entries from the same grid without mutating posted ledger history. General Ledger remains the line-level report and drill-down surface, avoiding a duplicate Journal Entries report.

## Locked accounting decisions

> **Revised 2026-09-24 (QBO parity).** Editing a posted entry originally voided
> the original and posted a reversal plus a replacement. Users found the
> resulting reversal pair confusing in the General Ledger, and it diverged from
> QuickBooks Online, which edits a posted journal entry in place and records the
> change in audit history. The decisions below reflect the in-place model. An
> explicit reversal remains available as its own action.

- Posted journal rows and lines are immutable by default. The database protections stay in force; the in-place edit path opens a transaction-scoped `app.allow_edit` escape hatch (migration `0065_journal_entry_in_place_edit.sql`), mirroring the existing `app.allow_void` pattern. Even under `app.allow_edit` the row's ledger identity is frozen: status, business, source linkage, and reversal/correction links cannot change.
- Saving an edit to an eligible posted entry performs one atomic update transaction:
  1. lock and revalidate the original entry;
  2. revalidate balance, account eligibility, and both the current and target fiscal periods;
  3. update the entry's date, period, number, memo, and reference in place, and replace its lines;
  4. record `journal_entry.update` with full before/after state in the same transaction.
- The entry keeps its id and journal number, so existing links and drill-downs stay valid. No reversal and no replacement entry are created.
- If validation, period checks, or the deferred balance constraint fails, the whole edit rolls back and the entry keeps its previous values.
- Only posted entries whose source type is `manual` or `adjustment` are editable. An entry that already has a posted reversal is not editable.
- Draft, voided, reversal, and source-generated entries open in the same grid but are read-only with a reason. Source-generated entries must be corrected from their source transaction so the subledger and general ledger cannot diverge.
- The entry's current period and the period it moves to must both be open for the normal UI flow. Existing firm-admin override behavior remains available at the API boundary, but this feature adds no new closed-period override UI.
- Concurrent edits are serialized with a row lock. Repeated edits of the same entry are allowed; each one appends another `journal_entry.update` audit row.

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

### Update

`PUT /businesses/:businessId/journal-entries/:id`

- Requires accountant-or-higher access.
- Accepts the same editable fields as Create.
- Calls one `ledgerService.updateJournalEntry(trx, ctx, input)` orchestration method.
- Returns `{ entry, lines }` for the same entry id; the client stays on the entry it edited.
- Supports the route's existing `admin_override=true` and `admin_override_reason` convention for authorized callers.

`updateJournalEntry` accepts the target ID plus the replacement post input, validates tenancy and editability, revalidates balance/accounts/periods, then mutates the row and its lines under a transaction-scoped `app.allow_edit`.

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

For eligible existing entries, Save calls the update endpoint and stays on the same entry ID. A visible notice explains that saving updates the entry in place and records the change in audit history. Read-only entries use the same visual structure with disabled controls and a specific reason.

The existing unimplemented attachment drop zone and recurring-entry action are outside this feature. They remain visually unchanged; this work does not claim or add attachment/recurring behavior.

## Journal navigation

The Accounting navigation destination is labeled **New Journal Entry**. Both `/journal` and the compatibility alias `/journal/new` open a blank `JournalEntryEditor` directly.

There is no separate Journal Entries report page. General Ledger already provides the line-level account report, customization, export, print, and native-link drill-down behavior. Its journal links continue to open `/journal/:id`, which uses the shared editor for editable manual entries and the same grid in read-only mode for generated or locked entries.

This keeps the workflow focused:

- Accounting → New Journal Entry records a new manual or adjusting entry.
- General Ledger and other source pages are the places to find posted entries.
- `/journal/:id` displays or edits the selected entry without changing the source report route.

## Error handling

- Unbalanced or invalid replacement data returns the existing typed ledger errors and leaves the original untouched.
- A closed original or replacement period returns `CLOSED_PERIOD`.
- Attempting to edit a non-manual source, reversal, draft, voided, or already-reversed entry returns `IMMUTABLE_RECORD` or `INVALID_STATE_TRANSITION` with a specific message.
- A missing or cross-business target returns `NOT_FOUND` without leaking another business's data.
- The editor keeps entered data visible when Save fails and renders the API message near the sticky action bar.

## Testing

- Shared-schema tests cover adjusting, line Name/Class, and invalid edit payloads.
- Postgres-backed ledger integration tests cover a successful in-place edit that creates no reversal, repeated edits of one entry, line metadata persistence, before/after audit rows, non-manual rejection, already-reversed rejection, closed-period rejection, cross-business rejection, and rollback on unbalanced edit data.
- Pure web helper tests cover API-to-form mapping, eight-row padding, adjusting-source mapping, balanced totals, correction payload serialization, and the journal landing/navigation contract.
- Typecheck, unit tests, integration tests, lint, and production build must pass.
- Browser verification covers the New Journal Entry landing page, a native General Ledger link to an editable manual entry, a read-only generated entry, and redirect to the corrected replacement after Save.

## Out of scope

- Direct mutation of posted journal rows or lines
- Editing invoices, payments, bills, bill payments, vendor credits, or other source transactions from the journal screen
- Draft journal workflow
- New attachment storage behavior
- Recurring journal-entry scheduling
- New accounting Class or Name master-data systems; these remain optional line text fields in this slice
