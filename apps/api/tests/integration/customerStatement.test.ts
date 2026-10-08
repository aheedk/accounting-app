import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, makeAccount, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import * as paymentSvc from '../../src/services/ar/paymentService.js';
import { customerStatement } from '../../src/services/ar/reports/customerStatementService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-00000057a7e0', ip_address: '127.0.0.1', user_agent: 'vitest' };

// Role audit 2026-10-08: a business had no statement to send its customer.
describe('customer statement', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('lists what was billed and paid in the period, with the balance at each step', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const revenue = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '4010').executeTakeFirstOrThrow();
    const cash = await makeAccount(t.db, biz.id, { code: '1099', name: 'Cash on Hand', account_type: 'asset' });
    const acme = await makeCustomer(t.db, biz.id, { name: 'Acme' });
    const other = await makeCustomer(t.db, biz.id, { name: 'Someone Else' });

    const invoice = async (customer_id: string, number: string, date: string, amount: string, post = true) => {
      const draft = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id, invoice_number: number, issue_date: date, due_date: date, memo: null, terms: null,
        lines: [{ description: 'Work', quantity: '1', unit_price: amount, revenue_account_id: revenue.id, tax_code_id: null }],
      }));
      if (post) await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id }));
      return draft.invoice;
    };
    const january = await invoice(acme.id, 'INV-1', '2026-01-10', '100');
    await invoice(acme.id, 'INV-2', '2026-04-02', '50');
    await invoice(acme.id, 'INV-DRAFT', '2026-02-20', '999', false);   // not in the books, so not on the statement
    await invoice(other.id, 'INV-X', '2026-02-01', '70');              // another customer

    const payment = await t.db.transaction().execute(trx => paymentSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: acme.id, payment_date: '2026-02-05', payment_method: 'check',
      reference: 'CHK 881', amount: '40', cash_account_id: cash.id, memo: null,
      initial_applications: [{ invoice_id: january.id, applied_amount: '40' }],
    }));
    await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: payment.payment.id }));

    const statement = await customerStatement(t.db, { business_id: biz.id, customer_id: acme.id, period_start: '2026-02-01', period_end: '2026-04-30' });
    expect(statement.customer.name).toBe('Acme');
    expect(statement.opening_balance).toBe('100.0000');      // January's invoice, from before the period
    expect(statement.lines.map(l => [l.date, l.type, l.number, l.charge, l.credit, l.balance])).toEqual([
      ['2026-02-05', 'payment', 'CHK 881', '0.0000', '40.0000', '60.0000'],
      ['2026-04-02', 'invoice', 'INV-2', '50.0000', '0.0000', '110.0000'],
    ]);
    expect(statement.closing_balance).toBe('110.0000');

    // A period that ends earlier stops there.
    const toFebruary = await customerStatement(t.db, { business_id: biz.id, customer_id: acme.id, period_start: '2026-01-01', period_end: '2026-02-28' });
    expect(toFebruary.opening_balance).toBe('0.0000');
    expect(toFebruary.closing_balance).toBe('60.0000');

    // Another company's customer is not found.
    const elsewhere = await makeBusiness(t.db, firm.id, 'Elsewhere');
    await expect(customerStatement(t.db, { business_id: elsewhere.id, customer_id: acme.id, period_start: '2026-01-01', period_end: '2026-12-31' }))
      .rejects.toThrow(/not found/);
  });
});
