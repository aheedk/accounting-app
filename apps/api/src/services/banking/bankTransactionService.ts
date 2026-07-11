import { type Kysely, sql, type Transaction } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB, BankTransactionStatus } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { InvalidStateTransitionError, PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { postJournalEntry } from '../core/ledgerService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type ImportRowInput = {
  transaction_date: string;
  description: string;
  amount: string;
  external_id: string | null;
};

export type ImportTransactionsInput = {
  business_id: string;
  bank_account_id: string;
  filename?: string | null;
  rows: ImportRowInput[];
};

export async function importTransactions(
  trx: Transaction<DB>, ctx: ServiceCtx, input: ImportTransactionsInput,
): Promise<{ imported: number; deduped: number; batch_id: string }> {
  const bankAcct = await trx.selectFrom('bank_accounts').selectAll()
    .where('id', '=', input.bank_account_id).executeTakeFirst();
  if (!bankAcct || bankAcct.deleted_at) throw new NotFoundError('bank_account', input.bank_account_id);
  if (bankAcct.business_id !== input.business_id) {
    throw new PreconditionError('bank_account does not belong to this business');
  }

  const externalIds = input.rows.map(r => r.external_id).filter((x): x is string => !!x);
  const existingIds = new Set<string>();
  if (externalIds.length > 0) {
    const existing = await trx.selectFrom('bank_transactions').select('external_id')
      .where('bank_account_id', '=', input.bank_account_id)
      .where('external_id', 'in', externalIds)
      .execute();
    for (const r of existing) {
      if (r.external_id) existingIds.add(r.external_id);
    }
  }

  const batch = await trx.insertInto('bank_import_batches').values({
    business_id: input.business_id,
    bank_account_id: input.bank_account_id,
    filename: input.filename ?? null,
    rows_submitted: input.rows.length,
    imported: 0,
    deduped: 0,
    created_by_user_id: ctx.user_id,
  }).returningAll().executeTakeFirstOrThrow();

  let imported = 0;
  let deduped = 0;
  for (const row of input.rows) {
    if (row.external_id && existingIds.has(row.external_id)) {
      deduped += 1;
      continue;
    }
    await trx.insertInto('bank_transactions').values({
      business_id: input.business_id,
      bank_account_id: input.bank_account_id,
      transaction_date: row.transaction_date,
      description: row.description,
      amount: row.amount,
      external_id: row.external_id,
      import_batch_id: batch.id,
    }).execute();
    imported += 1;
  }

  await trx.updateTable('bank_import_batches')
    .set({ imported, deduped })
    .where('id', '=', batch.id).execute();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_TRANSACTION_IMPORT,
    entity_type: 'bank_transaction',
    entity_id: null,
    before: null,
    after: {
      bank_account_id: input.bank_account_id,
      import_batch_id: batch.id,
      rows_submitted: input.rows.length,
      imported,
      deduped,
    },
  });
  return { imported, deduped, batch_id: batch.id };
}

/**
 * Undo an import: delete rows from the batch that are still unreviewed and
 * unreconciled (mutable-until-reconciled invariant); anything the user already
 * matched/categorized/excluded is kept and reported.
 */
export async function undoImport(
  trx: Transaction<DB>, ctx: ServiceCtx, input: { batch_id: string },
): Promise<{ deleted: number; kept: number }> {
  const batch = await trx.selectFrom('bank_import_batches').selectAll()
    .where('id', '=', input.batch_id).executeTakeFirst();
  if (!batch) throw new NotFoundError('bank_import_batch', input.batch_id);
  if (batch.undone_at) throw new PreconditionError('import batch already undone');

  const deletedRows = await trx.deleteFrom('bank_transactions')
    .where('import_batch_id', '=', input.batch_id)
    .where('status', '=', 'unreviewed')
    .where('is_reconciled', '=', false)
    .returning('id')
    .execute();
  const keptRows = await trx.selectFrom('bank_transactions')
    .select(eb => eb.fn.count<string>('id').as('cnt'))
    .where('import_batch_id', '=', input.batch_id)
    .executeTakeFirstOrThrow();

  const updated = await trx.updateTable('bank_import_batches')
    .set({ undone_at: sql`now()` })
    .where('id', '=', input.batch_id)
    .returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_IMPORT_UNDO,
    entity_type: 'bank_import_batch',
    entity_id: input.batch_id,
    before: batch,
    after: { ...updated, deleted: deletedRows.length, kept: Number(keptRows.cnt) },
  });
  return { deleted: deletedRows.length, kept: Number(keptRows.cnt) };
}

export async function listImportBatches(
  db: Kysely<DB>, business_id: string, bank_account_id?: string,
) {
  let q = db.selectFrom('bank_import_batches as b')
    .leftJoin('bank_accounts as ba', 'ba.id', 'b.bank_account_id')
    .selectAll('b')
    .select('ba.name as bank_account_name')
    .select(eb => eb.selectFrom('bank_transactions as bt')
      .select(eb2 => eb2.fn.count<string>('bt.id').as('cnt'))
      .whereRef('bt.import_batch_id', '=', 'b.id')
      .as('remaining_rows'))
    .where('b.business_id', '=', business_id)
    .orderBy('b.created_at', 'desc')
    .limit(100);
  if (bank_account_id) q = q.where('b.bank_account_id', '=', bank_account_id);
  return q.execute();
}

async function fetchUnreviewed(trx: Transaction<DB>, bank_transaction_id: string) {
  const bt = await trx.selectFrom('bank_transactions').selectAll()
    .where('id', '=', bank_transaction_id).executeTakeFirst();
  if (!bt) throw new NotFoundError('bank_transaction', bank_transaction_id);
  if (bt.status !== 'unreviewed') {
    throw new InvalidStateTransitionError('bank_transaction', bt.id, bt.status, 'reviewed');
  }
  if (bt.is_reconciled) {
    throw new PreconditionError('Cannot modify a reconciled bank transaction');
  }
  return bt;
}

export async function match(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { bank_transaction_id: string; journal_entry_id: string },
) {
  const bt = await fetchUnreviewed(trx, input.bank_transaction_id);

  const je = await trx.selectFrom('journal_entries').selectAll()
    .where('id', '=', input.journal_entry_id).executeTakeFirst();
  if (!je) throw new NotFoundError('journal_entry', input.journal_entry_id);
  if (je.business_id !== bt.business_id) {
    throw new PreconditionError('journal_entry does not belong to this business');
  }
  if (je.status !== 'posted' && je.status !== 'draft') {
    throw new PreconditionError('journal_entry must be draft or posted');
  }

  const updated = await trx.updateTable('bank_transactions').set({
    status: 'matched',
    matched_journal_entry_id: je.id,
    reviewed_at: sql`now()`,
    reviewed_by_user_id: ctx.user_id,
  }).where('id', '=', bt.id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_TRANSACTION_MATCH,
    entity_type: 'bank_transaction',
    entity_id: bt.id,
    before: bt,
    after: updated,
  });
  return updated;
}

export async function categorize(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { bank_transaction_id: string; offset_account_id: string; memo: string | null },
) {
  const bt = await fetchUnreviewed(trx, input.bank_transaction_id);

  const bankAcct = await trx.selectFrom('bank_accounts').selectAll()
    .where('id', '=', bt.bank_account_id).executeTakeFirst();
  if (!bankAcct || bankAcct.deleted_at) throw new NotFoundError('bank_account', bt.bank_account_id);

  const offset = await trx.selectFrom('chart_of_accounts').selectAll()
    .where('id', '=', input.offset_account_id).executeTakeFirst();
  if (!offset) throw new NotFoundError('chart_of_accounts', input.offset_account_id);
  if (offset.business_id !== bt.business_id) {
    throw new PreconditionError('offset_account does not belong to this business');
  }

  const amountNum = parseFloat(bt.amount);
  if (amountNum === 0) throw new PreconditionError('Cannot categorize a zero-amount transaction');
  const absAmount = Math.abs(amountNum).toFixed(4);

  const lines = amountNum > 0
    ? [
        { account_id: bankAcct.cash_account_id, debit: absAmount, credit: '0.0000', memo: null },
        { account_id: offset.id,                debit: '0.0000',  credit: absAmount, memo: null },
      ]
    : [
        { account_id: offset.id,                debit: absAmount, credit: '0.0000', memo: null },
        { account_id: bankAcct.cash_account_id, debit: '0.0000',  credit: absAmount, memo: null },
      ];

  const je = await postJournalEntry(trx, ctx, {
    business_id: bt.business_id,
    entry_date: bt.transaction_date,
    source_type: 'manual',
    memo: input.memo ?? bt.description,
    reference: null,
    lines,
  });

  const updated = await trx.updateTable('bank_transactions').set({
    status: 'categorized',
    matched_journal_entry_id: je.id,
    reviewed_at: sql`now()`,
    reviewed_by_user_id: ctx.user_id,
  }).where('id', '=', bt.id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_TRANSACTION_CATEGORIZE,
    entity_type: 'bank_transaction',
    entity_id: bt.id,
    before: bt,
    after: updated,
  });
  return updated;
}

export async function exclude(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { bank_transaction_id: string; excluded_reason: string },
) {
  const bt = await fetchUnreviewed(trx, input.bank_transaction_id);

  const updated = await trx.updateTable('bank_transactions').set({
    status: 'excluded',
    excluded_reason: input.excluded_reason,
    reviewed_at: sql`now()`,
    reviewed_by_user_id: ctx.user_id,
  }).where('id', '=', bt.id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_TRANSACTION_EXCLUDE,
    entity_type: 'bank_transaction',
    entity_id: bt.id,
    before: bt,
    after: updated,
  });
  return updated;
}

export async function unreview(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { bank_transaction_id: string },
) {
  const bt = await trx.selectFrom('bank_transactions').selectAll()
    .where('id', '=', input.bank_transaction_id).executeTakeFirst();
  if (!bt) throw new NotFoundError('bank_transaction', input.bank_transaction_id);
  if (bt.is_reconciled) {
    throw new PreconditionError('Cannot unreview a reconciled bank transaction');
  }
  if (bt.status === 'unreviewed') return bt;

  const updated = await trx.updateTable('bank_transactions').set({
    status: 'unreviewed',
    matched_journal_entry_id: null,
    excluded_reason: null,
    reviewed_at: null,
    reviewed_by_user_id: null,
  }).where('id', '=', bt.id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: AUDIT.BANK_TRANSACTION_UNREVIEW,
    entity_type: 'bank_transaction',
    entity_id: bt.id,
    before: bt,
    after: updated,
  });
  return updated;
}

export async function listTransactions(
  db: Kysely<DB>, q: {
    business_id: string;
    bank_account_id?: string;
    status?: BankTransactionStatus;
    is_reconciled?: boolean;
    limit?: number;
    offset?: number;
  },
) {
  let qb = db.selectFrom('bank_transactions').selectAll().where('business_id', '=', q.business_id);
  if (q.bank_account_id) qb = qb.where('bank_account_id', '=', q.bank_account_id);
  if (q.status) qb = qb.where('status', '=', q.status);
  if (q.is_reconciled !== undefined) qb = qb.where('is_reconciled', '=', q.is_reconciled);
  return qb.orderBy('transaction_date', 'desc').orderBy('imported_at', 'desc')
    .limit(q.limit ?? 200).offset(q.offset ?? 0).execute();
}

export async function getTransaction(db: Kysely<DB>, business_id: string, id: string) {
  const row = await db.selectFrom('bank_transactions').selectAll()
    .where('id', '=', id).where('business_id', '=', business_id).executeTakeFirst();
  if (!row) throw new NotFoundError('bank_transaction', id);
  return row;
}
