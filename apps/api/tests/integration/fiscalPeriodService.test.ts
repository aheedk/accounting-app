import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeAccount, seedYearPeriods } from '../helpers/factories.js';
import * as periods from '../../src/services/core/fiscalPeriodService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-00000000aaaa', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb, role: 'firm_admin' | 'accountant' = 'firm_admin') {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id, 'Biz');
  const user = await makeUser(t.db, firm.id, { role });
  const ctx: ServiceCtx = {
    user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: role,
    ...meta,
  };
  return { firm, biz, user, ctx };
}

describe('fiscalPeriodService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('seedCalendarYear creates 12 monthly periods, all open', async () => {
    const { biz, ctx } = await setup(t);
    await t.db.transaction().execute(trx => periods.seedCalendarYear(trx, ctx, { business_id: biz.id, year: 2026 }));
    const rows = await t.db.selectFrom('fiscal_periods').selectAll().where('business_id', '=', biz.id).execute();
    expect(rows).toHaveLength(12);
    expect(rows.every(r => r.status === 'open')).toBe(true);
  });

  it('findPeriodForDate returns the matching period', async () => {
    const { biz } = await setup(t);
    await seedYearPeriods(t.db, biz.id, 2026);
    const found = await periods.findPeriodForDate(t.db, biz.id, '2026-04-15');
    expect(found?.starts_on).toBe('2026-04-01');
    expect(found?.ends_on).toBe('2026-04-30');
  });

  it('closePeriod refuses if there are draft JEs in the period', async () => {
    const { biz, ctx } = await setup(t);
    await seedYearPeriods(t.db, biz.id, 2026);
    const period = (await periods.findPeriodForDate(t.db, biz.id, '2026-01-15'))!;
    const acct = await makeAccount(t.db, biz.id);
    await t.db.insertInto('journal_entries').values({
      business_id: biz.id, period_id: period.id, entry_date: '2026-01-15', source_type: 'manual', status: 'draft',
    }).execute();
    await expect(
      t.db.transaction().execute(trx => periods.closePeriod(trx, ctx, { period_id: period.id })),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
    void acct;
  });

  it('closePeriod succeeds when no drafts; audit row written', async () => {
    const { biz, ctx } = await setup(t);
    await seedYearPeriods(t.db, biz.id, 2026);
    const period = (await periods.findPeriodForDate(t.db, biz.id, '2026-01-15'))!;
    await t.db.transaction().execute(trx => periods.closePeriod(trx, ctx, { period_id: period.id }));
    const after = await t.db.selectFrom('fiscal_periods').selectAll().where('id', '=', period.id).executeTakeFirstOrThrow();
    expect(after.status).toBe('closed');
    expect(after.closed_at).toBeTruthy();
    const audit = await t.db.selectFrom('audit_logs').selectAll().where('action', '=', 'fiscal_period.close').execute();
    expect(audit).toHaveLength(1);
  });

  it('reopenPeriod requires firm_admin', async () => {
    const acctSetup = await setup(t, 'accountant');
    await seedYearPeriods(t.db, acctSetup.biz.id, 2026);
    const period = (await periods.findPeriodForDate(t.db, acctSetup.biz.id, '2026-01-15'))!;
    const adminSetup = await setup(t);
    await t.db.transaction().execute(trx => periods.closePeriod(trx, adminSetup.ctx, { period_id: period.id }));
    await expect(
      t.db.transaction().execute(trx => periods.reopenPeriod(trx, acctSetup.ctx, { period_id: period.id })),
    ).rejects.toMatchObject({ code: ERR.FORBIDDEN });
  });
});
