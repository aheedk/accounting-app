// Full AR roundtrip: invoice -> payment -> apply -> verify trial balance balances and customer balance is zero
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import * as paymentSvc from '../../src/services/ar/paymentService.js';
import * as ledger from '../../src/services/core/ledgerService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000000017', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('AR roundtrip', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('invoice + payment + apply produces balanced trial balance and zero customer balance', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const cash = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '1020').executeTakeFirstOrThrow();
    const revenue = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '4010').executeTakeFirstOrThrow();
    const customer = await makeCustomer(t.db, biz.id);

    const draft = await t.db.transaction().execute(trx =>
      invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id,
        invoice_number: 'RT-1', issue_date: '2026-06-01', due_date: '2026-06-30',
        memo: null, terms: null,
        lines: [{ description: 'Service', quantity: '1', unit_price: '500.0000', revenue_account_id: revenue.id, tax_code_id: null }],
      }),
    );
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id }));

    const dr = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, payment_date: '2026-06-15',
        payment_method: 'check', reference: 'check-9000', amount: '500.0000',
        cash_account_id: cash.id, memo: null,
        initial_applications: [{ invoice_id: draft.invoice.id, applied_amount: '500.0000' }],
      }),
    );
    await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: dr.payment.id }));

    const tb = await ledger.computeTrialBalance(t.db, { business_id: biz.id, as_of: '2026-12-31' });
    expect(tb.totals.total_debit).toBe(tb.totals.total_credit);

    // AR account net should be zero
    const arRow = tb.rows.find(r => r.code === '1100')!;
    expect(parseFloat(arRow.net)).toBe(0);

    // Cash should be 500 debit, Revenue 500 credit
    const cashRow = tb.rows.find(r => r.code === '1020')!;
    expect(cashRow.net).toBe('500.0000');
    const revRow = tb.rows.find(r => r.code === '4010')!;
    expect(revRow.net).toBe('-500.0000');
  });
});
