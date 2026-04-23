import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeVendor, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as billSvc from '../../src/services/ap/billService.js';
import * as paymentSvc from '../../src/services/ap/billPaymentService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000bbb13', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
  await seedYearPeriods(t.db, biz.id, 2026);
  await seedCoa(t.db, biz.id);
  const cash = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '1020').executeTakeFirstOrThrow();
  const ap = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '2010').executeTakeFirstOrThrow();
  const expense = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '5010').executeTakeFirstOrThrow();
  const vendor = await makeVendor(t.db, biz.id, { name: 'Acme' });
  return { firm, biz, ctx, cash, ap, expense, vendor };
}

async function postSimpleBill(t: TestDb, ctx: ServiceCtx, biz_id: string, vendor_id: string, expense_id: string, num: string, amount: string) {
  const draft = await t.db.transaction().execute(trx =>
    billSvc.createDraft(trx, ctx, {
      business_id: biz_id, vendor_id,
      bill_number: num, bill_date: '2026-04-15', due_date: '2026-05-15',
      memo: null, terms: null,
      lines: [{ description: 'Item', quantity: '1', unit_price: amount, expense_account_id: expense_id }],
    }),
  );
  return t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: draft.bill.id }));
}

describe('billPaymentService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('postBillPayment generates JE: DR AP / CR Cash', async () => {
    const { biz, ctx, vendor, cash, ap, expense } = await setup(t);
    const bill = await postSimpleBill(t, ctx, biz.id, vendor.id, expense.id, 'BILL-100', '100.0000');
    const draftPayment = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id, payment_date: '2026-04-20',
        payment_method: 'check', reference: 'check-1234', amount: '100.0000',
        cash_account_id: cash.id, memo: null,
        initial_applications: [{ bill_id: bill.id, applied_amount: '100.0000' }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => paymentSvc.postBillPayment(trx, ctx, { bill_payment_id: draftPayment.bill_payment.id }));
    expect(posted.status).toBe('posted');
    const lines = await t.db.selectFrom('journal_entry_lines').selectAll().where('journal_entry_id', '=', posted.posted_journal_entry_id!).execute();
    const apLine = lines.find(l => l.account_id === ap.id)!;
    expect(apLine.debit).toBe('100.0000');
    const cashLine = lines.find(l => l.account_id === cash.id)!;
    expect(cashLine.credit).toBe('100.0000');
    // bill should now be 'paid'
    const billAfter = await t.db.selectFrom('bills').selectAll().where('id', '=', bill.id).executeTakeFirstOrThrow();
    expect(billAfter.status).toBe('paid');
  });

  it('partial bill payment leaves bill posted (not paid) and unapplied_amount=0', async () => {
    const { biz, ctx, vendor, cash, expense } = await setup(t);
    const bill = await postSimpleBill(t, ctx, biz.id, vendor.id, expense.id, 'BILL-101', '100.0000');
    const dr = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id, payment_date: '2026-04-20',
        payment_method: 'cash', reference: null, amount: '40.0000', cash_account_id: cash.id, memo: null,
        initial_applications: [{ bill_id: bill.id, applied_amount: '40.0000' }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => paymentSvc.postBillPayment(trx, ctx, { bill_payment_id: dr.bill_payment.id }));
    expect(posted.unapplied_amount).toBe('0.0000');
    const billAfter = await t.db.selectFrom('bills').selectAll().where('id', '=', bill.id).executeTakeFirstOrThrow();
    expect(billAfter.status).toBe('posted');
  });

  it('overpayment leaves bill_payment with unapplied_amount > 0', async () => {
    const { biz, ctx, vendor, cash, expense } = await setup(t);
    const bill = await postSimpleBill(t, ctx, biz.id, vendor.id, expense.id, 'BILL-102', '100.0000');
    const dr = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id, payment_date: '2026-04-20',
        payment_method: 'wire', reference: null, amount: '150.0000', cash_account_id: cash.id, memo: null,
        initial_applications: [{ bill_id: bill.id, applied_amount: '100.0000' }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => paymentSvc.postBillPayment(trx, ctx, { bill_payment_id: dr.bill_payment.id }));
    expect(posted.unapplied_amount).toBe('50.0000');
  });

  it('addApplication after posting decrements unapplied_amount and may flip bill to paid', async () => {
    const { biz, ctx, vendor, cash, expense } = await setup(t);
    const bill = await postSimpleBill(t, ctx, biz.id, vendor.id, expense.id, 'BILL-103', '100.0000');
    const dr = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id, payment_date: '2026-04-20',
        payment_method: 'wire', reference: null, amount: '100.0000', cash_account_id: cash.id, memo: null,
      }),
    );
    const posted = await t.db.transaction().execute(trx => paymentSvc.postBillPayment(trx, ctx, { bill_payment_id: dr.bill_payment.id }));
    expect(posted.unapplied_amount).toBe('100.0000');
    await t.db.transaction().execute(trx =>
      paymentSvc.addApplication(trx, ctx, { bill_payment_id: posted.id, bill_id: bill.id, applied_amount: '100.0000' }),
    );
    const after = await t.db.selectFrom('bill_payments').selectAll().where('id', '=', posted.id).executeTakeFirstOrThrow();
    expect(after.unapplied_amount).toBe('0.0000');
    const billAfter = await t.db.selectFrom('bills').selectAll().where('id', '=', bill.id).executeTakeFirstOrThrow();
    expect(billAfter.status).toBe('paid');
  });

  it('over-application is rejected with OVERAPPLICATION', async () => {
    const { biz, ctx, vendor, cash, expense } = await setup(t);
    const bill = await postSimpleBill(t, ctx, biz.id, vendor.id, expense.id, 'BILL-104', '50.0000');
    const dr = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id, payment_date: '2026-04-20',
        payment_method: 'cash', reference: null, amount: '100.0000', cash_account_id: cash.id, memo: null,
      }),
    );
    const posted = await t.db.transaction().execute(trx => paymentSvc.postBillPayment(trx, ctx, { bill_payment_id: dr.bill_payment.id }));
    await expect(
      t.db.transaction().execute(trx =>
        paymentSvc.addApplication(trx, ctx, { bill_payment_id: posted.id, bill_id: bill.id, applied_amount: '60.0000' }),
      ),
    ).rejects.toMatchObject({ code: ERR.OVERAPPLICATION });
  });

  it('voidBillPayment is refused while applications exist', async () => {
    const { biz, ctx, vendor, cash, expense } = await setup(t);
    const bill = await postSimpleBill(t, ctx, biz.id, vendor.id, expense.id, 'BILL-105', '50.0000');
    const dr = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id, payment_date: '2026-04-20',
        payment_method: 'cash', reference: null, amount: '50.0000', cash_account_id: cash.id, memo: null,
        initial_applications: [{ bill_id: bill.id, applied_amount: '50.0000' }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => paymentSvc.postBillPayment(trx, ctx, { bill_payment_id: dr.bill_payment.id }));
    await expect(
      t.db.transaction().execute(trx => paymentSvc.voidBillPayment(trx, ctx, { bill_payment_id: posted.id, void_reason: 'oops' })),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
  });
});
