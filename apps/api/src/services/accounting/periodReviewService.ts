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

  // Build conditional patch (no undefined values; exactOptionalPropertyTypes-safe).
  const patch: {
    status?: 'todo' | 'in_progress' | 'done';
    assignee_user_id?: string | null;
    notes?: string | null;
    signed_off_at?: ReturnType<typeof sql> | null;
    signed_off_by_user_id?: string | null;
  } = {};
  if (input.patch.status !== undefined) patch.status = input.patch.status;
  if (input.patch.assignee_user_id !== undefined) patch.assignee_user_id = input.patch.assignee_user_id;
  if (input.patch.notes !== undefined) patch.notes = input.patch.notes;
  if (isSigningOff) {
    patch.signed_off_at = sql`now()`;
    patch.signed_off_by_user_id = ctx.user_id;
  }
  // If status is moving AWAY from 'done', null out signoff to keep the CHECK constraint happy.
  if (input.patch.status !== undefined && input.patch.status !== 'done' && before.status === 'done') {
    patch.signed_off_at = null;
    patch.signed_off_by_user_id = null;
  }

  const updated = await trx.updateTable('period_review_tasks')
    .set(patch).where('id', '=', input.task_id).returningAll().executeTakeFirstOrThrow();

  await auditRecord(trx, ctx, {
    action: isSigningOff ? AUDIT.PERIOD_REVIEW_TASK_SIGN_OFF : AUDIT.PERIOD_REVIEW_TASK_UPDATE,
    entity_type: 'period_review_task',
    entity_id: updated.id,
    before, after: updated,
  });
  return updated;
}
