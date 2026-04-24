import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess } from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import { getFirmOverview } from '../../src/services/firm/firmDashboardService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

describe('firmDashboardService', () => {
  it('getFirmOverview returns one row per business with zero balances on empty firm', async () => {
    const firm = await makeFirm(t.db);
    const biz1 = await makeBusiness(t.db, firm.id, 'Biz One');
    const biz2 = await makeBusiness(t.db, firm.id, 'Biz Two');
    const user = await makeUser(t.db, firm.id, { role: 'firm_admin' });
    await grantAccess(t.db, user.id, biz1.id);
    await grantAccess(t.db, user.id, biz2.id);
    const ctx = systemCtx({ firm_id: firm.id, business_id: null, user_id: user.id, effective_role: 'firm_admin' });

    const rows = await getFirmOverview(t.db, ctx);
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.business_name).sort()).toEqual(['Biz One', 'Biz Two']);
    rows.forEach(r => {
      expect(r.ar_balance).toBe('0');
      expect(r.ap_balance).toBe('0');
      expect(r.unreviewed_bank_txn_count).toBe(0);
      expect(r.open_period_count).toBe(0);
      expect(r.last_reconciliation_date).toBeNull();
    });
  });

  it('throws FORBIDDEN if effective_role is not firm_admin', async () => {
    const firm = await makeFirm(t.db);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx = systemCtx({ firm_id: firm.id, business_id: null, user_id: user.id, effective_role: 'accountant' });
    await expect(getFirmOverview(t.db, ctx)).rejects.toThrow(/firm_admin only/);
  });
});
