import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import * as paymentSvc from '../../src/services/ar/paymentService.js';
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
    const row = r.find(x => x.name === 'AcmeAged')!;
    expect(row.id).toBe(customer.id);
    expect(row.current).toBe('100.0000');
    expect(row.days_1_30).toBe('50.0000');
    expect(row.days_31_60).toBe('20.0000');
    expect(row.total).toBe('170.0000');

    // 61-90 and 91+ are separate buckets (QuickBooks splits them).
    const later = await aging.customerAging(t.db, { business_id: biz.id, as_of: '2026-06-20' });
    expect(later[0]).toMatchObject({
      current: '0.0000', days_1_30: '0.0000', days_31_60: '100.0000', days_61_90: '50.0000', days_over_90: '20.0000',
    });

    // 2026-09-28 audit: money on account was left out, so aging did not tie to
    // the ledger. An unapplied payment shows as a negative and lowers the total.
    const cash = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '1020').executeTakeFirstOrThrow();
    const pay = await t.db.transaction().execute(trx => paymentSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, payment_date: '2026-04-15', payment_method: 'check',
      reference: null, amount: '30.00', cash_account_id: cash.id, memo: null,
    }));
    await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: pay.payment.id }));

    const withCredit = await aging.customerAging(t.db, { business_id: biz.id, as_of: '2026-04-20' });
    expect(withCredit[0]!.total).toBe('140.0000');
    expect(withCredit[0]!.days_1_30).toBe('20.0000');   // 50 owed, less the 30 on account dated 5 days back

    // It now agrees with Accounts Receivable in the ledger.
    const ar = await t.db.selectFrom('journal_entry_lines as l')
      .innerJoin('journal_entries as je', 'je.id', 'l.journal_entry_id')
      .innerJoin('chart_of_accounts as a', 'a.id', 'l.account_id')
      .select(({ fn }) => [fn.sum<string>('l.debit').as('debit'), fn.sum<string>('l.credit').as('credit')])
      .where('je.business_id', '=', biz.id).where('je.status', '=', 'posted').where('a.code', '=', '1100')
      .executeTakeFirstOrThrow();
    expect(Number(ar.debit) - Number(ar.credit)).toBe(140);
  });
});
