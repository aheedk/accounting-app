import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as close from '../../src/services/core/periodCloseService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000004004', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('period close', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  async function setup() {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    return { biz, ctx };
  }

  it('closePeriod flips status open → closed and emits audit', async () => {
    const { biz, ctx } = await setup();
    const period = await t.db.selectFrom('fiscal_periods').selectAll()
      .where('business_id','=',biz.id).where('starts_on','=','2026-04-01').executeTakeFirstOrThrow();
    const result = await t.db.transaction().execute(trx => close.closePeriod(trx, ctx, { period_id: period.id, memo: 'April close' }));
    expect(result.status).toBe('closed');
    const audit = await t.db.selectFrom('audit_logs').selectAll().where('action', '=', 'fiscal_period.close').execute();
    expect(audit).toHaveLength(1);
  });

  it('closePeriod rejects an already-closed period with INVALID_STATE_TRANSITION', async () => {
    const { biz, ctx } = await setup();
    const period = await t.db.selectFrom('fiscal_periods').selectAll()
      .where('business_id','=',biz.id).where('starts_on','=','2026-04-01').executeTakeFirstOrThrow();
    await t.db.transaction().execute(trx => close.closePeriod(trx, ctx, { period_id: period.id, memo: null }));
    await expect(
      t.db.transaction().execute(trx => close.closePeriod(trx, ctx, { period_id: period.id, memo: null })),
    ).rejects.toMatchObject({ code: ERR.INVALID_STATE_TRANSITION });
  });
});
