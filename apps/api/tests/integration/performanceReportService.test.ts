import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';
import { getPerformanceReport } from '../../src/services/reports/performanceReportService.js';

const meta = { request_id: '00000000-0000-0000-0000-000000004102', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('performanceReportService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('getPerformanceReport returns 12 months of zero entries on empty business', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);

    const report = await getPerformanceReport(t.db, ctx);

    expect(report.revenue_trend).toHaveLength(12);
    expect(report.expense_trend).toHaveLength(12);
    expect(report.net_income_trend).toHaveLength(12);

    // All months follow YYYY-MM format and align across the three trends
    for (let i = 0; i < 12; i++) {
      const month = report.revenue_trend[i]!.month;
      expect(month).toMatch(/^\d{4}-\d{2}$/);
      expect(report.expense_trend[i]!.month).toBe(month);
      expect(report.net_income_trend[i]!.month).toBe(month);
      expect(Number(report.revenue_trend[i]!.amount)).toBe(0);
      expect(Number(report.expense_trend[i]!.amount)).toBe(0);
      expect(Number(report.net_income_trend[i]!.amount)).toBe(0);
    }
  });
});
