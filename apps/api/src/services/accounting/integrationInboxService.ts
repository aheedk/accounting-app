import { type Kysely, sql, type Transaction } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB, IntegrationInboxStatus, IntegrationSource } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { InvalidStateTransitionError, PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { postJournalEntry } from '../core/ledgerService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type ImportRowInput = {
  occurred_at: string;
  description: string;
  amount: string;
  external_id?: string | null;
  raw_payload?: Record<string, unknown>;
};

export type ImportRowsInput = {
  business_id: string;
  source: IntegrationSource;
  rows: ImportRowInput[];
};

export async function importRows(
  trx: Transaction<DB>, ctx: ServiceCtx, input: ImportRowsInput,
): Promise<{ inserted: number; deduped: number }> {
  if (input.rows.length === 0) {
    await auditRecord(trx, ctx, {
      action: AUDIT.INTEGRATION_INBOX_IMPORT,
      entity_type: 'integration_inbox',
      entity_id: null,
      before: null,
      after: { source: input.source, inserted: 0, deduped: 0 },
    });
    return { inserted: 0, deduped: 0 };
  }

  // The unique index uq_ii_external is partial (WHERE external_id IS NOT NULL).
  // Postgres requires the predicate replicated in ON CONFLICT for arbiter inference.
  // Rows without external_id always insert (no dedup possible) — by design.
  const result = await trx.insertInto('integration_inbox')
    .values(input.rows.map(r => ({
      business_id: input.business_id,
      source: input.source,
      external_id: r.external_id ?? null,
      occurred_at: r.occurred_at,
      description: r.description,
      amount: r.amount,
      raw_payload: (r.raw_payload ?? {}) as object,
    })))
    .onConflict(oc =>
      oc.columns(['business_id', 'source', 'external_id'])
        .where('external_id', 'is not', null)
        .doNothing(),
    )
    .returningAll()
    .execute();

  const inserted = result.length;
  const deduped = input.rows.length - inserted;

  await auditRecord(trx, ctx, {
    action: AUDIT.INTEGRATION_INBOX_IMPORT,
    entity_type: 'integration_inbox',
    entity_id: null,
    before: null,
    after: { source: input.source, inserted, deduped },
  });

  return { inserted, deduped };
}

async function fetchPending(trx: Transaction<DB>, id: string) {
  const row = await trx.selectFrom('integration_inbox').selectAll()
    .where('id', '=', id).executeTakeFirst();
  if (!row) throw new NotFoundError('integration_inbox', id);
  if (row.status !== 'pending') {
    throw new InvalidStateTransitionError('integration_inbox', row.id, row.status, 'reviewed');
  }
  return row;
}

export async function match(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { id: string; journal_entry_id: string },
) {
  const row = await fetchPending(trx, input.id);

  const je = await trx.selectFrom('journal_entries').selectAll()
    .where('id', '=', input.journal_entry_id).executeTakeFirst();
  if (!je) throw new NotFoundError('journal_entry', input.journal_entry_id);
  if (je.business_id !== row.business_id) {
    throw new PreconditionError('journal_entry does not belong to this business');
  }
  if (je.status !== 'posted' && je.status !== 'draft') {
    throw new PreconditionError('journal_entry must be draft or posted');
  }

  const updated = await trx.updateTable('integration_inbox').set({
    status: 'matched',
    matched_journal_entry_id: je.id,
    reviewed_at: sql`now()`,
    reviewed_by_user_id: ctx.user_id,
  }).where('id', '=', row.id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.INTEGRATION_INBOX_MATCH,
    entity_type: 'integration_inbox',
    entity_id: row.id,
    before: row,
    after: updated,
  });
  return updated;
}

export async function categorize(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { id: string; cash_account_id: string; offset_account_id: string; memo?: string | null },
) {
  const row = await fetchPending(trx, input.id);

  const cash = await trx.selectFrom('chart_of_accounts').selectAll()
    .where('id', '=', input.cash_account_id).executeTakeFirst();
  if (!cash) throw new NotFoundError('chart_of_accounts', input.cash_account_id);
  if (cash.business_id !== row.business_id) {
    throw new PreconditionError('cash_account does not belong to this business');
  }

  const offset = await trx.selectFrom('chart_of_accounts').selectAll()
    .where('id', '=', input.offset_account_id).executeTakeFirst();
  if (!offset) throw new NotFoundError('chart_of_accounts', input.offset_account_id);
  if (offset.business_id !== row.business_id) {
    throw new PreconditionError('offset_account does not belong to this business');
  }

  const amountNum = parseFloat(row.amount);
  if (amountNum === 0) throw new PreconditionError('Cannot categorize a zero-amount row');
  const absAmount = Math.abs(amountNum).toFixed(4);

  const lines = amountNum > 0
    ? [
        { account_id: cash.id,   debit: absAmount, credit: '0.0000', memo: null },
        { account_id: offset.id, debit: '0.0000',  credit: absAmount, memo: null },
      ]
    : [
        { account_id: offset.id, debit: absAmount, credit: '0.0000', memo: null },
        { account_id: cash.id,   debit: '0.0000',  credit: absAmount, memo: null },
      ];

  const je = await postJournalEntry(trx, ctx, {
    business_id: row.business_id,
    entry_date: row.occurred_at,
    source_type: 'manual',
    memo: input.memo ?? row.description,
    reference: null,
    lines,
  });

  const updated = await trx.updateTable('integration_inbox').set({
    status: 'categorized',
    matched_journal_entry_id: je.id,
    reviewed_at: sql`now()`,
    reviewed_by_user_id: ctx.user_id,
  }).where('id', '=', row.id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.INTEGRATION_INBOX_CATEGORIZE,
    entity_type: 'integration_inbox',
    entity_id: row.id,
    before: row,
    after: updated,
  });
  return updated;
}

export async function exclude(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { id: string; excluded_reason: string },
) {
  const row = await fetchPending(trx, input.id);

  const updated = await trx.updateTable('integration_inbox').set({
    status: 'excluded',
    excluded_reason: input.excluded_reason,
    reviewed_at: sql`now()`,
    reviewed_by_user_id: ctx.user_id,
  }).where('id', '=', row.id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.INTEGRATION_INBOX_EXCLUDE,
    entity_type: 'integration_inbox',
    entity_id: row.id,
    before: row,
    after: updated,
  });
  return updated;
}

export async function listInbox(
  db: Kysely<DB>, business_id: string,
  opts: { status?: IntegrationInboxStatus; source?: IntegrationSource } = {},
) {
  let qb = db.selectFrom('integration_inbox').selectAll().where('business_id', '=', business_id);
  if (opts.status) qb = qb.where('status', '=', opts.status);
  if (opts.source) qb = qb.where('source', '=', opts.source);
  return qb.orderBy('occurred_at', 'desc').orderBy('imported_at', 'desc').execute();
}
