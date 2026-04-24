import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess, makePeriod } from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as pr from '../../src/services/accounting/periodReviewService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

async function bootstrap() {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id);
  await grantAccess(t.db, user.id, biz.id);
  const period = await makePeriod(t.db, biz.id, '2026-01-01', '2026-01-31');
  const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });
  return { firm, biz, user, period, ctx };
}

describe('periodReviewService', () => {
  it('listForPeriod returns the 4 default tasks seeded by the trigger', async () => {
    const { biz, period } = await bootstrap();
    const tasks = await pr.listForPeriod(t.db, biz.id, period.id);
    expect(tasks).toHaveLength(4);
    const keys = tasks.map(t => t.task_key).sort();
    expect(keys).toEqual(['close_period', 'post_adjustments', 'reconcile_bank', 'review_unreviewed_txns']);
    expect(tasks.every(t => t.status === 'todo')).toBe(true);
  });

  it('update flipping status to done sets signed_off_at + audit-logs sign_off', async () => {
    const { biz, period, ctx } = await bootstrap();
    const tasks = await pr.listForPeriod(t.db, biz.id, period.id);
    const first = tasks[0]!;

    const updated = await t.db.transaction().execute(trx =>
      pr.update(trx, ctx, { task_id: first.id, patch: { status: 'done', notes: 'all good' } }),
    );

    expect(updated.status).toBe('done');
    expect(updated.signed_off_at).not.toBeNull();
    expect(updated.signed_off_by_user_id).toBe(ctx.user_id);
    expect(updated.notes).toBe('all good');

    const logs = await t.db.selectFrom('audit_logs').selectAll()
      .where('action', '=', 'period_review_task.sign_off').execute();
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });
});
