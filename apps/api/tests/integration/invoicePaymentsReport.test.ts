import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { grantAccess, makeBusiness, makeCustomer, makeFirm, makeUser, seedCoa, seedYearPeriods } from '../helpers/factories.js';
import { makeApp } from '../../src/app.js';
import { destroyDbSingleton } from '../../src/db/index.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import * as paymentSvc from '../../src/services/ar/paymentService.js';
import * as creditMemoSvc from '../../src/services/ar/creditMemoService.js';
import { openInvoices } from '../../src/services/ar/reports/agingReportService.js';
import { invoicesAndPayments } from '../../src/services/ar/reports/invoicePaymentsService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000001018', ip_address: '127.0.0.1', user_agent: 'vitest' };

// Invoices and Received Payments (item 18): the period's invoices with the
// payments and credit memos applied to each.
describe('invoicesAndPayments', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await startTestDb();
    process.env.DATABASE_URL = t.url;
  });
  afterAll(async () => {
    await destroyDbSingleton();
    await stopTestDb();
  });
  beforeEach(async () => { await truncateAll(t.db); });

  async function setup() {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const account = (code: string) => t.db.selectFrom('chart_of_accounts').selectAll()
      .where('business_id', '=', biz.id).where('code', '=', code).executeTakeFirstOrThrow();
    const [revenue, returns, cash] = await Promise.all([account('4010'), account('4910'), account('1020')]);
    const acme = await makeCustomer(t.db, biz.id, { name: 'Acme' });
    const birch = await makeCustomer(t.db, biz.id, { name: 'Birch' });

    const invoice = async (customer_id: string, invoice_number: string, issue_date: string, amount: string, post = true) => {
      const draft = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id, invoice_number, issue_date, due_date: '2026-05-31', memo: null, terms: null,
        lines: [{ description: 'Work', quantity: '1', unit_price: amount, revenue_account_id: revenue.id, tax_code_id: null }],
      }));
      if (post) await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id }));
      return draft.invoice;
    };
    const payment = async (customer_id: string, payment_date: string, reference: string, amount: string, invoice_id: string, post = true) => {
      const draft = await t.db.transaction().execute(trx => paymentSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id, payment_date, payment_method: 'check', reference, amount, cash_account_id: cash.id, memo: null,
        initial_applications: [{ invoice_id, applied_amount: amount }],
      }));
      if (post) await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: draft.payment.id }));
      return draft.payment;
    };

    const a1 = await invoice(acme.id, 'A-1', '2026-04-01', '100.0000');
    const a2 = await invoice(acme.id, 'A-2', '2026-04-05', '50.0000');
    const b1 = await invoice(birch.id, 'B-1', '2026-04-03', '80.0000');
    await invoice(acme.id, 'A-0', '2026-03-20', '10.0000');
    await invoice(acme.id, 'A-3', '2026-04-06', '30.0000', false);

    const p1 = await payment(acme.id, '2026-04-10', '1234', '60.0000', a1.id);
    await payment(birch.id, '2026-04-11', '777', '80.0000', b1.id);
    await payment(acme.id, '2026-04-12', '999', '20.0000', a2.id, false);   // a draft: not applied yet
    const credit = await t.db.transaction().execute(trx => creditMemoSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: acme.id, memo_date: '2026-04-12', amount: '15.0000', revenue_account_id: returns.id, memo: null,
    }));
    await t.db.transaction().execute(trx => creditMemoSvc.postCreditMemo(trx, ctx, { credit_memo_id: credit.id }));
    await t.db.transaction().execute(trx => creditMemoSvc.applyToInvoice(trx, ctx, { credit_memo_id: credit.id, invoice_id: a1.id, applied_amount: '15.0000' }));

    return { firm, biz, a1, a2, b1, p1, credit };
  }

  it('lists the period\'s posted invoices by customer, each with the payments and credits applied to it', async () => {
    const s = await setup();
    const invoices = await invoicesAndPayments(t.db, { business_id: s.biz.id, period_start: '2026-04-01', period_end: '2026-04-30' });
    expect(invoices.map(i => [i.customer_name, i.invoice_number, i.total, i.open])).toEqual([
      ['Acme', 'A-1', '100.0000', '25.0000'],
      ['Acme', 'A-2', '50.0000', '50.0000'],
      ['Birch', 'B-1', '80.0000', '0.0000'],
    ]);
    expect(invoices[0]!.applications).toEqual([
      { id: expect.any(String), kind: 'payment', source_id: s.p1.id, date: '2026-04-10', number: '1234', method: 'check', amount: '60.0000' },
      { id: expect.any(String), kind: 'credit_memo', source_id: s.credit.id, date: '2026-04-12', number: s.credit.credit_memo_number, method: null, amount: '15.0000' },
    ]);
    expect(invoices[1]!.applications).toEqual([]);
  });

  it('leaves open what the Open Invoices report does', async () => {
    const s = await setup();
    const invoices = await invoicesAndPayments(t.db, { business_id: s.biz.id, period_start: '2026-04-01', period_end: '2026-04-30' });
    const open = new Map((await openInvoices(t.db, { business_id: s.biz.id, as_of: '2026-04-30' })).map(i => [i.id, i.open]));
    for (const invoice of invoices) expect(invoice.open).toBe(open.get(invoice.id) ?? '0.0000');
  });

  it('over HTTP: staff read it; dates are required; it keeps to the one business', async () => {
    const s = await setup();
    const user = await makeUser(t.db, s.firm.id, { role: 'staff' });
    await grantAccess(t.db, user.id, s.biz.id);
    const app = makeApp();
    const login = await request(app).post('/auth/login').send({ email: user.email, password: user.plaintext_password });
    const auth = { Authorization: `Bearer ${login.body.access_token as string}` };
    const url = `/businesses/${s.biz.id}/reports/invoices-and-payments`;

    const res = await request(app).get(url).query({ period_start: '2026-04-01', period_end: '2026-04-30' }).set(auth);
    expect(res.status).toBe(200);
    expect((res.body.invoices as { invoice_number: string }[]).map(i => i.invoice_number)).toEqual(['A-1', 'A-2', 'B-1']);
    expect((await request(app).get(url).set(auth)).status).toBe(400);

    const other = await makeBusiness(t.db, s.firm.id);
    expect(await invoicesAndPayments(t.db, { business_id: other.id, period_start: '2026-01-01', period_end: '2026-12-31' })).toEqual([]);
  });
});
