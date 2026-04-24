import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess, seedCoa, seedYearPeriods } from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as ap from '../../src/services/ap/apOverviewService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

describe('apOverviewService', () => {
  it('getOverview returns zero counts on an empty business', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id);
    await grantAccess(t.db, user.id, biz.id);
    await seedCoa(t.db, biz.id);
    await seedYearPeriods(t.db, biz.id, 2026);
    const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });

    const overview = await ap.getOverview(t.db, ctx);
    expect(overview.outstanding_bills_total).toBe('0');
    expect(overview.overdue_bills_count).toBe(0);
    expect(overview.upcoming_payments_7d).toBe('0');
    expect(overview.upcoming_payments_30d).toBe('0');
    expect(overview.top_vendors).toEqual([]);
  });
});
