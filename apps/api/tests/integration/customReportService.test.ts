import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import {
  makeFirm,
  makeBusiness,
  makeUser,
  grantAccess,
  seedCoa,
  seedYearPeriods,
} from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as cr from '../../src/services/reports/customReportService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

describe('customReportService', () => {
  it('createReport + getReport roundtrips the definition', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id);
    await grantAccess(t.db, user.id, biz.id);
    const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });

    const def = {
      account_ids: [],
      date_range: { from: '2026-01-01', to: '2026-12-31' },
      group_by: 'account' as const,
      columns: ['debit', 'credit', 'net'] as const,
    };
    const created = await t.db.transaction().execute(trx =>
      cr.createReport(trx, ctx, { business_id: biz.id, name: 'My Report', definition: def }),
    );
    const fetched = await cr.getReport(t.db, biz.id, created.id);
    expect(fetched.name).toBe('My Report');
    expect((fetched.definition as Record<string, unknown>).group_by).toBe('account');
  });

  it('runReport on empty business returns empty rows', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id);
    await grantAccess(t.db, user.id, biz.id);
    await seedCoa(t.db, biz.id);
    await seedYearPeriods(t.db, biz.id, 2026);

    const rows = await cr.runReport(t.db, biz.id, {
      account_ids: [],
      date_range: { from: '2026-01-01', to: '2026-12-31' },
      group_by: 'account',
      columns: ['debit', 'credit', 'net'],
    });
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(0);
  });
});
