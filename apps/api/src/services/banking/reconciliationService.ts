import { type Kysely, type Transaction } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateReconciliationInput = {
  business_id: string;
  bank_account_id: string;
  period_start: string;
  period_end: string;
  statement_ending_balance: string;
  memo: string | null;
};

export async function createReconciliation(
  trx: Transaction<DB>, ctx: ServiceCtx, input: CreateReconciliationInput,
) {
  if (input.period_end < input.period_start) {
    throw new PreconditionError('period_end must be on or after period_start');
  }

  const bankAcct = await trx.selectFrom('bank_accounts').selectAll()
    .where('id', '=', input.bank_account_id).executeTakeFirst();
  if (!bankAcct || bankAcct.deleted_at) throw new NotFoundError('bank_account', input.bank_account_id);
  if (bankAcct.business_id !== input.business_id) {
    throw new PreconditionError('bank_account does not belong to this business');
  }

  const unreviewed = await trx.selectFrom('bank_transactions').select('id')
    .where('business_id', '=', input.business_id)
    .where('bank_account_id', '=', input.bank_account_id)
    .where('transaction_date', '>=', input.period_start)
    .where('transaction_date', '<=', input.period_end)
    .where('status', '=', 'unreviewed')
    .execute();
  if (unreviewed.length > 0) {
    throw new PreconditionError(
      `${unreviewed.length} unreviewed transaction(s) remain in this period`,
      { unreviewed_ids: unreviewed.map(r => r.id) },
    );
  }

  const recon = await trx.insertInto('bank_reconciliations').values({
    business_id: input.business_id,
    bank_account_id: input.bank_account_id,
    period_start: input.period_start,
    period_end: input.period_end,
    statement_ending_balance: input.statement_ending_balance,
    reconciled_by_user_id: ctx.user_id,
    memo: input.memo,
  }).returningAll().executeTakeFirstOrThrow();

  await trx.updateTable('bank_transactions')
    .set({ is_reconciled: true, reconciliation_id: recon.id })
    .where('bank_account_id', '=', input.bank_account_id)
    .where('transaction_date', '>=', input.period_start)
    .where('transaction_date', '<=', input.period_end)
    .where('status', 'in', ['matched', 'categorized', 'excluded'])
    .where('is_reconciled', '=', false)
    .execute();

  await auditRecord(trx, ctx, {
    action: AUDIT.RECONCILIATION_CREATE,
    entity_type: 'reconciliation',
    entity_id: recon.id,
    before: null,
    after: recon,
  });
  return recon;
}

export async function listReconciliations(
  db: Kysely<DB>, q: { business_id: string; bank_account_id?: string },
) {
  let qb = db.selectFrom('bank_reconciliations').selectAll()
    .where('business_id', '=', q.business_id);
  if (q.bank_account_id) qb = qb.where('bank_account_id', '=', q.bank_account_id);
  return qb.orderBy('period_end', 'desc').execute();
}

export async function getReconciliation(db: Kysely<DB>, business_id: string, id: string) {
  const row = await db.selectFrom('bank_reconciliations').selectAll()
    .where('id', '=', id).where('business_id', '=', business_id).executeTakeFirst();
  if (!row) throw new NotFoundError('reconciliation', id);
  return row;
}
