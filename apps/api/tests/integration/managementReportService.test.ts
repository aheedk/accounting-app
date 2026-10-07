import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';
import { getManagementReport } from '../../src/services/reports/managementReportService.js';

const meta = { request_id: '00000000-0000-0000-0000-000000004101', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('managementReportService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('getManagementReport returns zero values on empty business', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    // Seed periods + COA so the business has structure but no JE activity.
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);

    const report = await getManagementReport(t.db, ctx);

    // 12 months scaffolded via generate_series, all zero
    expect(report.revenue_by_month).toHaveLength(12);
    expect(report.revenue_by_month.every(r => Number(r.amount) === 0)).toBe(true);
    // Each entry should be a YYYY-MM string
    expect(report.revenue_by_month.every(r => /^\d{4}-\d{2}$/.test(r.month))).toBe(true);
    // No expense activity -> empty breakdown (HAVING <> 0 filters zero-only rows)
    expect(report.expense_breakdown).toEqual([]);
    expect(Number(report.total_revenue_last_12)).toBe(0);
    expect(Number(report.total_expense_last_12)).toBe(0);
  });

  // 2026-09-28 audit: every month read $0.00 while the header showed the real total.
  it('shows this month\'s revenue in the monthly breakdown', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    const now = new Date();
    await seedYearPeriods(t.db, biz.id, now.getUTCFullYear());
    await seedCoa(t.db, biz.id);
    const customer = await makeCustomer(t.db, biz.id);
    const revenue = await t.db.selectFrom('chart_of_accounts').selectAll()
      .where('business_id', '=', biz.id).where('code', '=', '4010').executeTakeFirstOrThrow();
    const today = now.toISOString().slice(0, 10);
    const inv = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, invoice_number: 'INV-MGMT',
      issue_date: today, due_date: today, memo: null, terms: null,
      lines: [{ description: 'X', quantity: '1', unit_price: '1000.00', revenue_account_id: revenue.id, tax_code_id: null }],
    }));
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: inv.invoice.id }));

    const report = await getManagementReport(t.db, ctx);
    const thisMonth = report.revenue_by_month.find(r => r.month === today.slice(0, 7));
    expect(Number(thisMonth?.amount)).toBe(1000);
    expect(report.revenue_by_month.reduce((sum, r) => sum + Number(r.amount), 0)).toBe(1000);
    expect(Number(report.total_revenue_last_12)).toBe(1000);
  });
});
