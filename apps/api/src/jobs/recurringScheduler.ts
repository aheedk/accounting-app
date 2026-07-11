import type { Kysely } from 'kysely';
import type { DB } from '../db/types.js';
import { systemCtx } from '../lib/ctx.js';
import {
  materializeDueTemplate,
  type RecurringTemplateRow,
} from '../services/accounting/recurringTemplateService.js';

/**
 * Materialize every active due template across all businesses. Each template
 * runs in its own transaction and is attributed (JE created_by, audit) to the
 * template's creator — there is no request ctx on the scheduler path.
 */
export async function materializeAllDue(db: Kysely<DB>): Promise<{ processed: number; failed: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const due = await db.selectFrom('recurring_templates as t')
    .innerJoin('businesses as b', 'b.id', 't.business_id')
    .selectAll('t')
    .select('b.firm_id as firm_id')
    .where('t.is_active', '=', true)
    .where('t.next_run_date', '<=', today)
    .execute();

  let processed = 0;
  let failed = 0;
  for (const row of due) {
    const { firm_id, ...template } = row;
    if (!template.created_by_user_id) {
      // journal_entries.created_by_user_id is a users FK — without a creator
      // there is nobody to attribute the run to on the system path.
      console.warn(`[recurring] skipping template ${template.id} (${template.name}): no creator user`);
      failed++;
      continue;
    }
    const ctx = systemCtx({
      firm_id,
      business_id: template.business_id,
      user_id: template.created_by_user_id,
    });
    try {
      await db.transaction().execute(trx =>
        materializeDueTemplate(trx, ctx, template as RecurringTemplateRow, today),
      );
      processed++;
    } catch (e: unknown) {
      failed++;
      console.error(`[recurring] template ${template.id} (${template.name}) failed:`, e instanceof Error ? e.message : e);
    }
  }
  return { processed, failed };
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * In-process scheduler (CLAUDE.md rule 3: simplest option, no new infra or
 * env vars). Hourly tick is idempotent — next_run_date advances on success,
 * so a tick with nothing due is a no-op. The manual "Run all due" route stays.
 */
export function startRecurringScheduler(db: Kysely<DB>): void {
  const tick = async (): Promise<void> => {
    try {
      const r = await materializeAllDue(db);
      if (r.processed > 0 || r.failed > 0) {
        console.log(`[recurring] scheduler: ${r.processed} template(s) materialized, ${r.failed} failed`);
      }
    } catch (e: unknown) {
      console.error('[recurring] scheduler tick crashed:', e instanceof Error ? e.message : e);
    }
  };
  setTimeout(() => { void tick(); }, 15_000).unref();
  setInterval(() => { void tick(); }, HOUR_MS).unref();
}
