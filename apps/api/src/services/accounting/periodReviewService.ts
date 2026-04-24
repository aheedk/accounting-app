import { sql, type Transaction, type Kysely } from 'kysely';
import { AUDIT } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { NotFoundError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export async function listForPeriod(db: Kysely<DB>, business_id: string, period_id: string) {
  return db.selectFrom('period_review_tasks').selectAll()
    .where('business_id', '=', business_id).where('period_id', '=', period_id)
    .orderBy('task_key').execute();
}

export type UpdateTaskInput = {
  task_id: string;
  patch: {
    status?: 'todo' | 'in_progress' | 'done';
    assignee_user_id?: string | null;
    notes?: string | null;
  };
};

export async function update(trx: Transaction<DB>, ctx: ServiceCtx, input: UpdateTaskInput) {
  const before = await trx.selectFrom('period_review_tasks').selectAll()
    .where('id', '=', input.task_id).executeTakeFirst();
  if (!before) throw new NotFoundError('period_review_task', input.task_id);

  const isSigningOff = input.patch.status === 'done' && before.status !== 'done';
  const isUnSigningOff = input.patch.status !== undefined && input.patch.status !== 'done' && before.status === 'done';

  // Use Kysely's set() builder so the sql`now()` value typechecks via the column-aware
  // expression context. Construct conditional spreads to honor exactOptionalPropertyTypes.
  const updated = await trx.updateTable('period_review_tasks').set({
    ...(input.patch.status !== undefined ? { status: input.patch.status } : {}),
    ...(input.patch.assignee_user_id !== undefined ? { assignee_user_id: input.patch.assignee_user_id } : {}),
    ...(input.patch.notes !== undefined ? { notes: input.patch.notes } : {}),
    ...(isSigningOff ? { signed_off_at: sql`now()`, signed_off_by_user_id: ctx.user_id } : {}),
    ...(isUnSigningOff ? { signed_off_at: null, signed_off_by_user_id: null } : {}),
  }).where('id', '=', input.task_id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: isSigningOff ? AUDIT.PERIOD_REVIEW_TASK_SIGN_OFF : AUDIT.PERIOD_REVIEW_TASK_UPDATE,
    entity_type: 'period_review_task',
    entity_id: updated.id,
    before, after: updated,
  });
  return updated;
}
