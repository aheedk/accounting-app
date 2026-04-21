import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError, AuthError } from '../../lib/errors.js';
import { PreconditionError } from '../../lib/ledgerErrors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export async function findPeriodForDate(db: Kysely<DB>, business_id: string, date: string) {
  return db.selectFrom('fiscal_periods')
    .selectAll()
    .where('business_id', '=', business_id)
    .where('starts_on', '<=', date)
    .where('ends_on', '>=', date)
    .executeTakeFirst();
}

export async function listPeriods(db: Kysely<DB>, business_id: string) {
  return db.selectFrom('fiscal_periods').selectAll()
    .where('business_id', '=', business_id)
    .orderBy('starts_on', 'asc').execute();
}

export async function seedCalendarYear(
  trx: Transaction<DB>, ctx: ServiceCtx,
  input: { business_id: string; year: number },
) {
  await sql`SELECT seed_calendar_year_periods(${input.business_id}::uuid, ${input.year}::int)`.execute(trx);
  const created = await trx.selectFrom('fiscal_periods').selectAll()
    .where('business_id', '=', input.business_id)
    .where(sql<boolean>`extract(year from starts_on) = ${input.year}`)
    .execute();
  for (const row of created) {
    await auditRecord(trx, ctx, {
      action: AUDIT.FISCAL_PERIOD_CREATE,
      entity_type: 'fiscal_period',
      entity_id: row.id,
      before: null,
      after: row,
    });
  }
  return created;
}

export async function closePeriod(
  trx: Transaction<DB>, ctx: ServiceCtx, input: { period_id: string },
) {
  const period = await trx.selectFrom('fiscal_periods').selectAll()
    .where('id', '=', input.period_id).executeTakeFirst();
  if (!period) throw new BusinessRuleError(ERR.NOT_FOUND, `Period ${input.period_id} not found`);
  if (period.status === 'closed') throw new PreconditionError('Period is already closed');

  const drafts = await trx.selectFrom('journal_entries')
    .select(['id'])
    .where('period_id', '=', input.period_id)
    .where('status', '=', 'draft')
    .execute();
  if (drafts.length > 0) {
    throw new PreconditionError('Cannot close period with draft journal entries', { draft_journal_entry_ids: drafts.map(d => d.id) });
  }

  const updated = await trx.updateTable('fiscal_periods')
    .set({ status: 'closed', closed_at: sql`now()`, closed_by_user_id: ctx.user_id })
    .where('id', '=', input.period_id)
    .returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.FISCAL_PERIOD_CLOSE,
    entity_type: 'fiscal_period',
    entity_id: input.period_id,
    before: period,
    after: updated,
  });
  return updated;
}

export async function reopenPeriod(
  trx: Transaction<DB>, ctx: ServiceCtx, input: { period_id: string },
) {
  if (ctx.effective_role !== 'firm_admin') {
    throw new AuthError(ERR.FORBIDDEN, 'Only firm_admin can reopen periods');
  }
  const period = await trx.selectFrom('fiscal_periods').selectAll().where('id', '=', input.period_id).executeTakeFirst();
  if (!period) throw new BusinessRuleError(ERR.NOT_FOUND, `Period ${input.period_id} not found`);
  if (period.status === 'open') throw new PreconditionError('Period is already open');

  const updated = await trx.updateTable('fiscal_periods')
    .set({ status: 'open', closed_at: null, closed_by_user_id: null })
    .where('id', '=', input.period_id)
    .returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.FISCAL_PERIOD_REOPEN,
    entity_type: 'fiscal_period',
    entity_id: input.period_id,
    before: period,
    after: updated,
  });
  return updated;
}
