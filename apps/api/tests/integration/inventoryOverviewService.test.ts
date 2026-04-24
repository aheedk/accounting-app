import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess } from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import { getOverview } from '../../src/services/inventory/inventoryOverviewService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

describe('inventoryOverviewService', () => {
  it('getOverview returns zero counts on empty business', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id);
    await grantAccess(t.db, user.id, biz.id);
    const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });

    const ov = await getOverview(t.db, ctx);
    expect(ov.total_items_count).toBe(0);
    expect(ov.total_stock_value).toBe('0');
    expect(ov.recent_receipts).toEqual([]);
    expect(ov.recent_sales).toEqual([]);
  });
});
