import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeAccount, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';
import { postJournalEntry } from '../../src/services/core/ledgerService.js';
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

  it('reports posted revenue and expense activity in the month it happened', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, new Date().getUTCFullYear());
    await seedCoa(t.db, biz.id);
    const revenue = await makeAccount(t.db, biz.id, { code: '4005', name: 'Fees', account_type: 'revenue' });
    const expense = await makeAccount(t.db, biz.id, { code: '6005', name: 'Rent', account_type: 'expense' });
    const cash = await makeAccount(t.db, biz.id, { code: '1005', name: 'Cash', account_type: 'asset' });

    const today = new Date().toISOString().slice(0, 10);
    await t.db.transaction().execute(trx => postJournalEntry(trx, ctx, {
      business_id: biz.id,
      entry_date: today,
      source_type: 'manual',
      memo: 'Revenue event',
      lines: [
        { account_id: cash.id, debit: '500.0000', credit: '0.0000', memo: null },
        { account_id: revenue.id, debit: '0.0000', credit: '500.0000', memo: null },
      ],
    }));
    await t.db.transaction().execute(trx => postJournalEntry(trx, ctx, {
      business_id: biz.id,
      entry_date: today,
      source_type: 'manual',
      memo: 'Expense event',
      lines: [
        { account_id: expense.id, debit: '200.0000', credit: '0.0000', memo: null },
        { account_id: cash.id, debit: '0.0000', credit: '200.0000', memo: null },
      ],
    }));

    const report = await getPerformanceReport(t.db, ctx);
    const thisMonth = today.slice(0, 7);
    const rev = report.revenue_trend.find(r => r.month === thisMonth);
    const exp = report.expense_trend.find(r => r.month === thisMonth);
    const net = report.net_income_trend.find(r => r.month === thisMonth);
    expect(Number(rev?.amount)).toBe(500);
    expect(Number(exp?.amount)).toBe(200);
    expect(Number(net?.amount)).toBe(300);
  });
});
