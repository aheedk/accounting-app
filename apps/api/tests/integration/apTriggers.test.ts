// Adversarial: try direct UPDATE/DELETE on posted bills/bill_payments/vendor_credits
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeVendor, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as billSvc from '../../src/services/ap/billService.js';
import * as paymentSvc from '../../src/services/ap/billPaymentService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000bbb15', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('AP DB triggers (adversarial)', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('cannot UPDATE subtotal on a posted bill', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const vendor = await makeVendor(t.db, biz.id);
    const expense = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '5010').executeTakeFirstOrThrow();
    const draft = await t.db.transaction().execute(trx =>
      billSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id,
        bill_number: 'BILL-T1', bill_date: '2026-04-15', due_date: '2026-05-15',
        memo: 'orig', terms: null,
        lines: [{ description: 'X', quantity: '1', unit_price: '10', expense_account_id: expense.id }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: draft.bill.id }));
    await expect(
      t.db.updateTable('bills').set({ subtotal: '999.0000' }).where('id', '=', posted.id).execute(),
    ).rejects.toThrow(/cannot mutate posted bill/);
  });

  it('cannot DELETE a posted bill_payment', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const vendor = await makeVendor(t.db, biz.id);
    const cash = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '1020').executeTakeFirstOrThrow();
    const draft = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id, payment_date: '2026-04-15',
        payment_method: 'cash', reference: null, amount: '10.0000',
        cash_account_id: cash.id, memo: null,
      }),
    );
    const posted = await t.db.transaction().execute(trx => paymentSvc.postBillPayment(trx, ctx, { bill_payment_id: draft.bill_payment.id }));
    await expect(
      t.db.deleteFrom('bill_payments').where('id', '=', posted.id).execute(),
    ).rejects.toThrow(/cannot delete posted bill_payment/);
  });
});
