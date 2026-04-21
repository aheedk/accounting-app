import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import * as paymentSvc from '../../src/services/ar/paymentService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000ddd04', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
  await seedYearPeriods(t.db, biz.id, 2026);
  await seedCoa(t.db, biz.id);
  const cash = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '1020').executeTakeFirstOrThrow();
  const ar = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '1100').executeTakeFirstOrThrow();
  const revenue = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '4010').executeTakeFirstOrThrow();
  const customer = await makeCustomer(t.db, biz.id, { name: 'Acme' });
  return { firm, biz, ctx, cash, ar, revenue, customer };
}

async function postSimpleInvoice(t: TestDb, ctx: ServiceCtx, biz_id: string, customer_id: string, revenue_id: string, num: string, amount: string) {
  const draft = await t.db.transaction().execute(trx =>
    invoiceSvc.createDraft(trx, ctx, {
      business_id: biz_id, customer_id,
      invoice_number: num, issue_date: '2026-04-15', due_date: '2026-05-15',
      memo: null, terms: null,
      lines: [{ description: 'Item', quantity: '1', unit_price: amount, revenue_account_id: revenue_id, tax_code_id: null }],
    }),
  );
  return t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id }));
}

describe('paymentService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('postPayment generates JE: DR Cash / CR AR', async () => {
    const { biz, ctx, customer, cash, ar, revenue } = await setup(t);
    const inv = await postSimpleInvoice(t, ctx, biz.id, customer.id, revenue.id, 'INV-100', '100.0000');
    const draftPayment = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, payment_date: '2026-04-20',
        payment_method: 'check', reference: 'check-1234', amount: '100.0000',
        cash_account_id: cash.id, memo: null,
        initial_applications: [{ invoice_id: inv.id, applied_amount: '100.0000' }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: draftPayment.payment.id }));
    expect(posted.status).toBe('posted');
    const lines = await t.db.selectFrom('journal_entry_lines').selectAll().where('journal_entry_id', '=', posted.posted_journal_entry_id!).execute();
    const cashLine = lines.find(l => l.account_id === cash.id)!;
    expect(cashLine.debit).toBe('100.0000');
    const arLine = lines.find(l => l.account_id === ar.id)!;
    expect(arLine.credit).toBe('100.0000');
    // invoice should now be 'paid'
    const invAfter = await t.db.selectFrom('invoices').selectAll().where('id', '=', inv.id).executeTakeFirstOrThrow();
    expect(invAfter.status).toBe('paid');
  });

  it('partial payment leaves invoice posted (not paid) and unapplied_amount=0', async () => {
    const { biz, ctx, customer, cash, revenue } = await setup(t);
    const inv = await postSimpleInvoice(t, ctx, biz.id, customer.id, revenue.id, 'INV-101', '100.0000');
    const dr = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, payment_date: '2026-04-20',
        payment_method: 'cash', reference: null, amount: '40.0000', cash_account_id: cash.id, memo: null,
        initial_applications: [{ invoice_id: inv.id, applied_amount: '40.0000' }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: dr.payment.id }));
    expect(posted.unapplied_amount).toBe('0.0000');
    const invAfter = await t.db.selectFrom('invoices').selectAll().where('id', '=', inv.id).executeTakeFirstOrThrow();
    expect(invAfter.status).toBe('posted');
  });

  it('overpayment leaves payment with unapplied_amount > 0', async () => {
    const { biz, ctx, customer, cash, revenue } = await setup(t);
    const inv = await postSimpleInvoice(t, ctx, biz.id, customer.id, revenue.id, 'INV-102', '100.0000');
    const dr = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, payment_date: '2026-04-20',
        payment_method: 'wire', reference: null, amount: '150.0000', cash_account_id: cash.id, memo: null,
        initial_applications: [{ invoice_id: inv.id, applied_amount: '100.0000' }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: dr.payment.id }));
    expect(posted.unapplied_amount).toBe('50.0000');
  });

  it('addApplication after posting decrements unapplied_amount and may flip invoice to paid', async () => {
    const { biz, ctx, customer, cash, revenue } = await setup(t);
    const inv = await postSimpleInvoice(t, ctx, biz.id, customer.id, revenue.id, 'INV-103', '100.0000');
    const dr = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, payment_date: '2026-04-20',
        payment_method: 'wire', reference: null, amount: '100.0000', cash_account_id: cash.id, memo: null,
      }),
    );
    const posted = await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: dr.payment.id }));
    expect(posted.unapplied_amount).toBe('100.0000');
    await t.db.transaction().execute(trx =>
      paymentSvc.addApplication(trx, ctx, { payment_id: posted.id, invoice_id: inv.id, applied_amount: '100.0000' }),
    );
    const after = await t.db.selectFrom('payments').selectAll().where('id', '=', posted.id).executeTakeFirstOrThrow();
    expect(after.unapplied_amount).toBe('0.0000');
    const invAfter = await t.db.selectFrom('invoices').selectAll().where('id', '=', inv.id).executeTakeFirstOrThrow();
    expect(invAfter.status).toBe('paid');
  });

  it('over-application is rejected with OVERAPPLICATION', async () => {
    const { biz, ctx, customer, cash, revenue } = await setup(t);
    const inv = await postSimpleInvoice(t, ctx, biz.id, customer.id, revenue.id, 'INV-104', '50.0000');
    const dr = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, payment_date: '2026-04-20',
        payment_method: 'cash', reference: null, amount: '100.0000', cash_account_id: cash.id, memo: null,
      }),
    );
    const posted = await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: dr.payment.id }));
    await expect(
      t.db.transaction().execute(trx =>
        paymentSvc.addApplication(trx, ctx, { payment_id: posted.id, invoice_id: inv.id, applied_amount: '60.0000' }),
      ),
    ).rejects.toMatchObject({ code: ERR.OVERAPPLICATION });
  });

  it('voidPayment is refused while applications exist', async () => {
    const { biz, ctx, customer, cash, revenue } = await setup(t);
    const inv = await postSimpleInvoice(t, ctx, biz.id, customer.id, revenue.id, 'INV-105', '50.0000');
    const dr = await t.db.transaction().execute(trx =>
      paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, payment_date: '2026-04-20',
        payment_method: 'cash', reference: null, amount: '50.0000', cash_account_id: cash.id, memo: null,
        initial_applications: [{ invoice_id: inv.id, applied_amount: '50.0000' }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: dr.payment.id }));
    await expect(
      t.db.transaction().execute(trx => paymentSvc.voidPayment(trx, ctx, { payment_id: posted.id, void_reason: 'oops' })),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
  });
});
