import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import * as aging from '../../src/services/ar/reports/agingReportService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000000a18', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('aging report', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('buckets invoices by days overdue from due_date', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const revenue = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '4010').executeTakeFirstOrThrow();
    const customer = await makeCustomer(t.db, biz.id, { name: 'AcmeAged' });

    // current (due in future)
    const i1 = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, invoice_number: 'A-1',
      issue_date: '2026-04-01', due_date: '2026-05-01', memo: null, terms: null,
      lines: [{ description: 'X', quantity: '1', unit_price: '100', revenue_account_id: revenue.id, tax_code_id: null }],
    }));
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: i1.invoice.id }));

    // 30-bucket: due 20 days before as_of
    const i2 = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, invoice_number: 'A-2',
      issue_date: '2026-03-01', due_date: '2026-04-01', memo: null, terms: null,
      lines: [{ description: 'X', quantity: '1', unit_price: '50', revenue_account_id: revenue.id, tax_code_id: null }],
    }));
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: i2.invoice.id }));

    // 60-bucket: due 45 days before as_of (as_of=2026-04-20, due=2026-03-06 -> 45 days)
    const i3 = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, invoice_number: 'A-3',
      issue_date: '2026-02-01', due_date: '2026-03-06', memo: null, terms: null,
      lines: [{ description: 'X', quantity: '1', unit_price: '20', revenue_account_id: revenue.id, tax_code_id: null }],
    }));
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: i3.invoice.id }));

    const r = await aging.customerAging(t.db, { business_id: biz.id, as_of: '2026-04-20' });
    const row = r.find(x => x.customer_name === 'AcmeAged')!;
    expect(row.current).toBe('100.0000');
    expect(row.over_30).toBe('50.0000');
    expect(row.over_60).toBe('20.0000');
    expect(row.total).toBe('170.0000');
  });
});
