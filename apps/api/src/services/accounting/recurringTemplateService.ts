import { sql, type Transaction, type Kysely } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { BusinessRuleError, NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import { postJournalEntry } from '../core/ledgerService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type CreateTemplateInput = {
  business_id: string;
  name: string;
  template_type: 'journal_entry' | 'invoice' | 'bill';
  payload: unknown;
  recurrence: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  next_run_date: string;
  end_date?: string | null;
};

export async function create(trx: Transaction<DB>, ctx: ServiceCtx, input: CreateTemplateInput) {
  // Build conditional patch (no undefined values; exactOptionalPropertyTypes-safe).
  const values: {
    business_id: string;
    name: string;
    template_type: 'journal_entry' | 'invoice' | 'bill';
    payload: object;
    recurrence: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
    next_run_date: string;
    end_date?: string | null;
    created_by_user_id: string;
  } = {
    business_id: input.business_id,
    name: input.name,
    template_type: input.template_type,
    payload: input.payload as object,
    recurrence: input.recurrence,
    next_run_date: input.next_run_date,
    created_by_user_id: ctx.user_id,
  };
  if (input.end_date !== undefined) values.end_date = input.end_date;

  const row = await trx.insertInto('recurring_templates').values(values).returningAll().executeTakeFirstOrThrow();
  await auditRecord(trx, ctx, {
    action: AUDIT.RECURRING_TEMPLATE_CREATE,
    entity_type: 'recurring_template',
    entity_id: row.id,
    before: null,
    after: row,
  });
  return row;
}

export async function listTemplates(db: Kysely<DB>, business_id: string) {
  return db.selectFrom('recurring_templates').selectAll()
    .where('business_id', '=', business_id)
    .orderBy('next_run_date').execute();
}

function advanceDate(date: string, recurrence: 'weekly' | 'monthly' | 'quarterly' | 'yearly'): string {
  const d = new Date(date + 'T00:00:00Z');
  switch (recurrence) {
    case 'weekly':    d.setUTCDate(d.getUTCDate() + 7); break;
    case 'monthly':   d.setUTCMonth(d.getUTCMonth() + 1); break;
    case 'quarterly': d.setUTCMonth(d.getUTCMonth() + 3); break;
    case 'yearly':    d.setUTCFullYear(d.getUTCFullYear() + 1); break;
  }
  return d.toISOString().slice(0, 10);
}

export async function runDue(
  trx: Transaction<DB>, ctx: ServiceCtx, business_id: string,
): Promise<{ template_id: string; runs_created: number }[]> {
  const today = new Date().toISOString().slice(0, 10);
  const due = await trx.selectFrom('recurring_templates').selectAll()
    .where('business_id', '=', business_id)
    .where('is_active', '=', true)
    .where('next_run_date', '<=', today)
    .execute();

  const results: { template_id: string; runs_created: number }[] = [];
  for (const t of due) {
    let runs = 0;
    let nextDate = t.next_run_date;
    while (nextDate <= today && (t.end_date == null || nextDate <= t.end_date)) {
      if (t.template_type === 'journal_entry') {
        const payload = t.payload as {
          lines: Array<{ account_id: string; debit: string; credit: string; memo?: string | null }>;
          memo?: string | null;
          reference?: string | null;
        };
        await postJournalEntry(trx, ctx, {
          business_id: t.business_id,
          entry_date: nextDate,
          source_type: 'manual',
          memo: payload.memo ?? `Recurring: ${t.name}`,
          reference: payload.reference ?? null,
          lines: payload.lines.map(l => ({
            account_id: l.account_id,
            debit: l.debit,
            credit: l.credit,
            memo: l.memo ?? null,
          })),
        });
      } else {
        // Slice 9 ships JE only. Invoice + Bill recurrence ships in a future polish slice.
        throw new BusinessRuleError(ERR.PRECONDITION_FAILED, `recurring ${t.template_type} not yet implemented`);
      }
      runs++;
      nextDate = advanceDate(nextDate, t.recurrence);
    }
    await trx.updateTable('recurring_templates')
      .set({ next_run_date: nextDate, last_run_at: sql`now()` })
      .where('id', '=', t.id).execute();
    await auditRecord(trx, ctx, {
      action: AUDIT.RECURRING_TEMPLATE_RUN,
      entity_type: 'recurring_template',
      entity_id: t.id,
      before: t,
      after: { runs_created: runs, advanced_to: nextDate },
    });
    results.push({ template_id: t.id, runs_created: runs });
  }
  return results;
}

export async function deleteTemplate(
  trx: Transaction<DB>, ctx: ServiceCtx, input: { template_id: string },
) {
  const before = await trx.selectFrom('recurring_templates').selectAll()
    .where('id', '=', input.template_id).executeTakeFirst();
  if (!before) throw new NotFoundError('recurring_template', input.template_id);
  await trx.deleteFrom('recurring_templates').where('id', '=', input.template_id).execute();
  await auditRecord(trx, ctx, {
    action: AUDIT.RECURRING_TEMPLATE_DELETE,
    entity_type: 'recurring_template',
    entity_id: input.template_id,
    before,
    after: null,
  });
}
