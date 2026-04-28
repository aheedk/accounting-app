import { sql, type Transaction } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { InvalidStateTransitionError, PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export async function closePeriod(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { period_id: string; memo: string | null },
) {
  const p = await trx.selectFrom('fiscal_periods').selectAll().where('id', '=', input.period_id).executeTakeFirst();
  if (!p) throw new NotFoundError('fiscal_period', input.period_id);
  if (p.status !== 'open') throw new InvalidStateTransitionError('fiscal_period', p.id, p.status, 'closed');

  // Reject if any draft JEs exist in the period
  const drafts = await trx.selectFrom('journal_entries').select('id')
    .where('business_id', '=', p.business_id)
    .where('status', '=', 'draft')
    .where('entry_date', '>=', p.starts_on)
    .where('entry_date', '<=', p.ends_on)
    .execute();
  if (drafts.length > 0) {
    throw new PreconditionError(
      `Cannot close period with ${drafts.length} draft journal entr${drafts.length === 1 ? 'y' : 'ies'} in the date range`,
      { draft_journal_entry_ids: drafts.map(d => d.id) },
    );
  }

  const updated = await trx.updateTable('fiscal_periods')
    .set({ status: 'closed', closed_at: sql`now()`, closed_by_user_id: ctx.user_id, close_memo: input.memo ?? null })
    .where('id', '=', p.id)
    .returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.FISCAL_PERIOD_CLOSE,
    entity_type: 'fiscal_period',
    entity_id: p.id,
    before: p,
    after: updated,
  });
  return updated;
}

export async function reopenPeriod(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { period_id: string; reason: string },
) {
  const p = await trx.selectFrom('fiscal_periods').selectAll().where('id', '=', input.period_id).executeTakeFirst();
  if (!p) throw new NotFoundError('fiscal_period', input.period_id);
  if (p.status !== 'closed') throw new InvalidStateTransitionError('fiscal_period', p.id, p.status, 'open');

  const updated = await trx.updateTable('fiscal_periods')
    .set({ status: 'open', closed_at: null, closed_by_user_id: null, close_memo: null })
    .where('id', '=', p.id)
    .returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.FISCAL_PERIOD_REOPEN,
    entity_type: 'fiscal_period',
    entity_id: p.id,
    before: p,
    after: { ...updated, reopen_reason: input.reason },
  });
  return updated;
}
