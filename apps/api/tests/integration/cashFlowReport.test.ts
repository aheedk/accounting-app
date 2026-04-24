import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import * as paymentSvc from '../../src/services/ar/paymentService.js';
import * as rpt from '../../src/services/reports/cashFlowService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000004003', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('Cash Flow report', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('enumerates cash movements with a running balance', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const cash = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id','=',biz.id).where('code','=','1020').executeTakeFirstOrThrow();
    const revenue = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id','=',biz.id).where('code','=','4010').executeTakeFirstOrThrow();
    const customer = await makeCustomer(t.db, biz.id, { name: 'Acme' });

    // Create and pay an invoice → cash inflow
    const inv = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, invoice_number: 'I-CFS',
      issue_date: '2026-04-10', due_date: '2026-05-10', memo: null, terms: null,
      lines: [{ description: 'Svc', quantity: '1', unit_price: '750.00', revenue_account_id: revenue.id, tax_code_id: null }],
    }));
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: inv.invoice.id }));
    const pay = await t.db.transaction().execute(trx => paymentSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, payment_date: '2026-04-20',
      payment_method: 'check', reference: null, amount: '750.00', cash_account_id: cash.id, memo: null,
      initial_applications: [{ invoice_id: inv.invoice.id, applied_amount: '750.00' }],
    }));
    await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: pay.payment.id }));

    const r = await rpt.cashFlow(t.db, { business_id: biz.id, period_start: '2026-04-01', period_end: '2026-04-30' });
    expect(r.beginning_balance).toBe('0.0000');
    expect(r.ending_balance).toBe('750.0000');
    expect(r.net_change).toBe('750.0000');
    expect(r.lines.length).toBe(1);
    expect(r.lines[0]!.net_amount).toBe('750.0000');
    expect(r.lines[0]!.running_balance).toBe('750.0000');
  });
});
