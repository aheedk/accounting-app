# AI Auto-Coding Engine - Design Spec

**Status:** Approved by user 2026-09-24.

## Goal

Turn the existing email-import pipeline into a general **AI** feature area: documents arrive by email *or* direct PDF upload, transactions are auto-coded by a layered classification engine with a confidence score, and the system learns from accountant corrections so it gets more accurate per client over time.

The target workflow: statement arrives -> transactions extracted -> offsetting accounts suggested -> only unusual items routed for review -> accountant approves exceptions. The accountant reviews 10-20 exceptions instead of coding 200 transactions.

## Locked decisions

### Classification is a layered engine, not a single AI call

Layers run in order; the first one that produces a confident answer wins. Every layer records **which layer produced the suggestion** so the UI can explain itself and so we can measure each layer's accuracy.

| # | Layer | Source of truth | Confidence |
|---|-------|-----------------|------------|
| 1 | Learned client rule | `account_coding_memory` exact match | 99 |
| 2 | Deterministic accounting rule | transaction-type detection (below) | 95-99 |
| 3 | Vendor default account | `vendors.default_account_id` | 90 |
| 4 | Client history | prior posted JE lines for same normalized vendor | 70-92, scaled by agreement |
| 5 | AI classification | Claude, constrained to the client's CoA | model-reported, capped at 85 |
| - | None matched | - | 0 -> unclassified |

**Deterministic rules run ahead of vendor/history/AI** because they encode accounting treatment, not preference. Transfers between own accounts, credit-card payments, loan payments (principal/interest split), and payroll withdrawals must not be left to a language model.

### Confidence drives behavior

| Confidence | Behavior |
|-----------|----------|
| 98-100 | Auto-post |
| 90-97 | Review queue, preselected |
| 70-89 | Suggest, require approval |
| < 70 | Leave unclassified |

Thresholds live in one constants module so they can be tuned per firm later without hunting through code. Auto-post is **off by default per business** (`businesses.ai_auto_post_enabled`), because posting to the ledger without a human is a policy decision each firm makes for itself.

### Suggestions carry lines, not one account

A suggestion is a **split template**, always a list of lines, even when there is only one:

```
suggestion { confidence, source_layer, lines: [{ account_id, debit, credit, memo }] }
```

This is required for loan payments (principal + interest), payroll (wages + taxes + clearing), and merchant deposits (gross - fees). Modeling it as a single `offset_account_id` would have to be torn out later. The posting path already supports this: `bank_transactions.matched_journal_entry_id` points at a real JE, and JEs already have lines.

### Account Coding Memory

Keyed on `business_id + normalized_vendor + direction`, with optional narrowing by `bank_account_id`. Stores a split template plus hit/miss counters. Written when an accountant **changes** a suggestion and confirms the "use this next time" prompt, and reinforced when they accept one.

Vendor normalization strips payment-processor noise so `AMZN Mktp US*AB12C`, `AMAZON.COM*2Y4UF`, and `Amazon Marketplace` collapse to `amazon`. Normalization is pure and unit-tested - it is the join key for layers 1, 3, and 4, so it must be deterministic and stable.

### The AI never invents accounts or policy

Claude is given the client's existing chart of accounts and asked to **rank candidates from that list**. It may not create accounts, and its output is validated against the client's CoA before being stored - an account id that is not in the client's active CoA is discarded and the transaction falls to unclassified. Accountants retain control of accounting policy; the model handles repetitive matching.

### Model and API usage

- Model `claude-opus-5` for extraction and classification.
- **Structured outputs** (`output_config.format`) instead of "return ONLY JSON" prose, so malformed output stops being a failure mode.
- **Prompt caching** on the chart-of-accounts + rules block, which is identical across every transaction in a statement and every document for a client.
- Classification is a single call per document, not per transaction: the whole statement is classified in one request so the model sees sibling transactions as context.

## Data model

Migration `0066_ai_auto_coding.sql`:

- `account_coding_memory` - `business_id`, `normalized_vendor`, `direction` (`debit`/`credit`), nullable `bank_account_id`, `lines jsonb`, `times_applied`, `times_corrected`, `last_applied_at`, audit columns. Unique on `(business_id, normalized_vendor, direction, bank_account_id)`.
- `bank_transactions.suggestion jsonb` - the current suggestion (lines + confidence + source layer), null when unclassified.
- `businesses.ai_auto_post_enabled boolean NOT NULL DEFAULT false`.
- `email_import_staging.source` / `invoice_import_staging.source` - `'email' | 'upload'`, default `'email'`; `uploaded_by_user_id`.
- `gmail_message_id` becomes nullable on both staging tables (uploads have no Gmail id), with the existing uniqueness enforced by a partial unique index that ignores nulls.

## API

- `POST /businesses/:businessId/ai/documents` - multipart PDF upload, accountant+. Stores the PDF, runs the same classify-and-extract path the Gmail worker uses, returns the staging row.
- `GET /businesses/:businessId/ai/documents` - review queue, both sources.
- `POST /businesses/:businessId/ai/documents/:id/approve` / `/reject` - existing behavior, plus memory learning on approve.
- `GET/PUT/DELETE /businesses/:businessId/ai/coding-rules` - view and manage learned rules.

All state-changing routes require `requireRole('accountant')`.

## Web

New **top-level** sidebar section `AI` (not nested under Accounting), because this is a primary workflow rather than an accounting sub-tool:

- `/ai/inbox` - document review queue (upload + email), with a drop zone for PDFs.
- `/ai/coding-rules` - learned rules, editable and deletable.

`/accounting/email-imports` and `/accounting/invoice-imports` redirect to `/ai/inbox` so existing links and muscle memory keep working.

## Testing

- Pure unit tests for vendor normalization and confidence banding (no DB).
- Integration tests for each engine layer in priority order, the CoA validation guard, memory learning on correction, and the auto-post gate defaulting to off.
- The AI layer is tested with an injected fake client - no network calls in tests.

## Out of scope for the first slice

Bank-feed live connections, multi-currency, and automatic creation of vendors from statement descriptions.
