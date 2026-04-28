// Full AP roundtrip: bill -> payment -> apply -> verify trial balance balances; AP nets to 0
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeVendor, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as billSvc from '../../src/services/ap/billService.js';
import * as paymentSvc from '../../src/services/ap/billPaymentService.js';
import * as ledger from '../../src/services/core/ledgerService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000bbb16', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('AP roundtrip', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('bill + payment + apply produces balanced trial balance, bill paid, AP=0', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const cash = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '1020').executeTakeFirstOrThrow();
    const expense = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '5010').executeTakeFirstOrThrow();
    const vendor = await makeVendor(t.db, biz.id);

    const draft = await t.db.transaction().execute(trx =>
      billSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id,
        bill_number: 'RT-AP-1', bill_date: '2026-06-01', due_date: '2026-06-30',
        memo: null, terms: null,
        lines: [{ description: 'Services', quantity: '1', unit_price: '500.0000', expense_account_id: expense.id }],
      }),
    );
    const bill = await t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: draft.bill.id }));

    const dr = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id, payment_date: '2026-06-15',
        payment_method: 'check', reference: 'check-9000', amount: '500.0000',
        cash_account_id: cash.id, memo: null,
        initial_applications: [{ bill_id: bill.id, applied_amount: '500.0000' }],
      }),
    );
    await t.db.transaction().execute(trx => paymentSvc.postBillPayment(trx, ctx, { bill_payment_id: dr.bill_payment.id }));

    // Bill should be paid
    const billAfter = await t.db.selectFrom('bills').selectAll().where('id', '=', bill.id).executeTakeFirstOrThrow();
    expect(billAfter.status).toBe('paid');

    const tb = await ledger.computeTrialBalance(t.db, { business_id: biz.id, as_of: '2026-12-31' });
    expect(tb.totals.total_debit).toBe(tb.totals.total_credit);

    // AP account net should be zero (DR 500 from payment = CR 500 from bill)
    const apRow = tb.rows.find(r => r.code === '2010')!;
    expect(parseFloat(apRow.net)).toBe(0);

    // Cash should be -500 (credited out) — net = debit - credit = 0 - 500 = -500
    const cashRow = tb.rows.find(r => r.code === '1020')!;
    expect(cashRow.net).toBe('-500.0000');

    // Expense should be +500 (debit balance)
    const expRow = tb.rows.find(r => r.code === '5010')!;
    expect(expRow.net).toBe('500.0000');
  });
});
