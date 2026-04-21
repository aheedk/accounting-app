import { Kysely, sql, type Transaction } from 'kysely';
import { AUDIT, ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import { AuthError } from '../../lib/errors.js';
import { record as auditRecord } from '../audit/auditService.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export async function runWithClosedPeriodOverride<T>(
  db: Kysely<DB>, ctx: ServiceCtx, reason: string,
  fn: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  if (ctx.effective_role !== 'firm_admin') {
    throw new AuthError(ERR.FORBIDDEN, 'Only firm_admin may override closed periods');
  }
  if (!reason || reason.length < 10) {
    throw new AuthError(ERR.FORBIDDEN, 'Override reason must be at least 10 characters');
  }
  return db.transaction().execute(async (trx) => {
    await auditRecord(trx, ctx, {
      action: AUDIT.FISCAL_PERIOD_ADMIN_OVERRIDE_POST,
      entity_type: 'fiscal_period',
      entity_id: null,
      before: null,
      after: { reason },
    });
    await sql`SELECT set_config('app.admin_override', 'on', true)`.execute(trx);
    return fn(trx);
  });
}
