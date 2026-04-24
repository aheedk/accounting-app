import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess } from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import { getOverview } from '../../src/services/payroll/payrollOverviewService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

describe('payrollOverviewService', () => {
  it('getOverview returns zero values on empty business', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id);
    await grantAccess(t.db, user.id, biz.id);
    const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });

    const ov = await getOverview(t.db, ctx);
    expect(ov.next_pay_date).toBeNull();
    expect(ov.total_liabilities_outstanding).toBe('0');
    expect(ov.last_pay_run_total).toBe('0');
    expect(ov.employee_count).toBe(0);
  });
});
