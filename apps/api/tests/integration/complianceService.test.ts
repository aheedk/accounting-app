import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess } from '../helpers/factories.js';
import { listForBusiness } from '../../src/services/payroll/complianceService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

describe('complianceService', () => {
  it('listForBusiness returns 4 default items auto-seeded by the trigger', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id);
    await grantAccess(t.db, user.id, biz.id);

    const items = await listForBusiness(t.db, biz.id);
    expect(items).toHaveLength(4);
    const keys = items.map(i => i.item_key).sort();
    expect(keys).toEqual(['annual_filing', 'labor_law_poster', 'new_hire_report', 'state_registration']);
    expect(items.every(i => i.status === 'open')).toBe(true);
  });
});
