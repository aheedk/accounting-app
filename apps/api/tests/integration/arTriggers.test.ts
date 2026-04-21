// Adversarial: try direct UPDATE/DELETE on posted invoices/payments/credit_memos
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import * as paymentSvc from '../../src/services/ar/paymentService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000aaa17', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('AR DB triggers (adversarial)', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('cannot UPDATE memo on a posted invoice', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const customer = await makeCustomer(t.db, biz.id);
    const revenue = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '4010').executeTakeFirstOrThrow();
    const draft = await t.db.transaction().execute(trx =>
      invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id,
        invoice_number: 'INV-T1', issue_date: '2026-04-15', due_date: '2026-05-15',
        memo: 'orig', terms: null,
        lines: [{ description: 'X', quantity: '1', unit_price: '10', revenue_account_id: revenue.id, tax_code_id: null }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id }));
    await expect(
      t.db.updateTable('invoices').set({ subtotal: '999.0000' }).where('id', '=', posted.id).execute(),
    ).rejects.toThrow(/cannot mutate posted invoice/);
  });

  it('cannot DELETE a posted payment', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const customer = await makeCustomer(t.db, biz.id);
    const cash = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '1020').executeTakeFirstOrThrow();
    const draft = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, payment_date: '2026-04-15',
        payment_method: 'cash', reference: null, amount: '10.0000',
        cash_account_id: cash.id, memo: null,
      }),
    );
    const posted = await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: draft.payment.id }));
    await expect(
      t.db.deleteFrom('payments').where('id', '=', posted.id).execute(),
    ).rejects.toThrow(/cannot delete posted payment/);
  });
});
