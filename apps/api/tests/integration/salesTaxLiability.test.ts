import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import {
  grantAccess, makeAccount, makeBusiness, makeCustomer, makeFirm, makeTaxCode, makeUser, seedCoa, seedYearPeriods,
} from '../helpers/factories.js';
import { makeApp } from '../../src/app.js';
import { destroyDbSingleton } from '../../src/db/index.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import { salesTaxLiability } from '../../src/services/tax/salesTaxLiabilityService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000002018', ip_address: '127.0.0.1', user_agent: 'vitest' };

// Sales Tax Liability (item 18): the tax charged on the period's invoices, by tax code.
describe('salesTaxLiability', () => {
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
    const [revenue, caPayable] = await Promise.all([account('4010'), account('2100')]);
    const nvPayable = await makeAccount(t.db, biz.id, { code: '2110', name: 'NV Sales Tax Payable', account_type: 'liability' });
    const ca = await makeTaxCode(t.db, biz.id, caPayable.id, { code: 'CA', name: 'California', rate: 0.0875 });
    const nv = await makeTaxCode(t.db, biz.id, nvPayable.id, { code: 'NV', name: 'Nevada', rate: 0.06 });
    const customer = await makeCustomer(t.db, biz.id, { name: 'Acme' });

    type Line = { unit_price: string; quantity?: string; tax_code_id: string | null };
    const invoice = async (invoice_number: string, issue_date: string, lines: Line[], post = true) => {
      const draft = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, invoice_number, issue_date, due_date: '2026-06-30', memo: null, terms: null,
        lines: lines.map(l => ({ description: 'Goods', quantity: l.quantity ?? '1', unit_price: l.unit_price, revenue_account_id: revenue.id, tax_code_id: l.tax_code_id })),
      }));
      if (post) await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id }));
      return draft.invoice;
    };

    await invoice('S-1', '2026-04-15', [{ unit_price: '50.0000', quantity: '2', tax_code_id: ca.id }, { unit_price: '20.0000', tax_code_id: null }]);
    await invoice('S-2', '2026-04-20', [{ unit_price: '200.0000', tax_code_id: nv.id }]);
    const voided = await invoice('S-3', '2026-04-22', [{ unit_price: '1000.0000', tax_code_id: ca.id }]);
    await t.db.transaction().execute(trx => invoiceSvc.voidInvoice(trx, ctx, { invoice_id: voided.id, void_reason: 'Entered twice' }));
    await invoice('S-4', '2026-05-02', [{ unit_price: '500.0000', tax_code_id: ca.id }]);
    await invoice('S-5', '2026-04-25', [{ unit_price: '300.0000', tax_code_id: ca.id }], false);
    return { firm, biz, ca, nv, caPayable, nvPayable };
  }

  it('gives the sales and the tax charged on them under each code, leaving out drafts, voided invoices and other dates', async () => {
    const s = await setup();
    const report = await salesTaxLiability(t.db, { business_id: s.biz.id, period_start: '2026-04-01', period_end: '2026-04-30' });
    expect(report).toMatchObject({ gross_sales: '320.0000', non_taxable_sales: '20.0000' });
    expect(report.codes.map(c => [c.code, c.name, Number(c.rate), c.payable_account_code, c.taxable_amount, c.tax_amount])).toEqual([
      ['CA', 'California', 0.0875, '2100', '100.0000', '8.7500'],
      ['NV', 'Nevada', 0.06, '2110', '200.0000', '12.0000'],
    ]);
  });

  it('ties each code\'s tax to what its invoices posted to its tax payable account', async () => {
    const s = await setup();
    const report = await salesTaxLiability(t.db, { business_id: s.biz.id, period_start: '2026-04-01', period_end: '2026-04-30' });
    for (const code of report.codes) {
      const posted = await t.db.selectFrom('journal_entry_lines as l')
        .innerJoin('invoices as i', 'i.posted_journal_entry_id', 'l.journal_entry_id')
        .select(({ fn }) => fn.sum<string>('l.credit').as('credit'))
        .where('i.business_id', '=', s.biz.id).where('i.status', 'in', ['posted', 'paid'])
        .where('i.issue_date', '>=', '2026-04-01').where('i.issue_date', '<=', '2026-04-30')
        .where('l.account_id', '=', code.payable_account_id)
        .executeTakeFirstOrThrow();
      expect(Number(posted.credit)).toBe(Number(code.tax_amount));
    }
  });

  it('over HTTP: staff read it; dates are required; an empty period is all zeros', async () => {
    const s = await setup();
    const user = await makeUser(t.db, s.firm.id, { role: 'staff' });
    await grantAccess(t.db, user.id, s.biz.id);
    const app = makeApp();
    const login = await request(app).post('/auth/login').send({ email: user.email, password: user.plaintext_password });
    const auth = { Authorization: `Bearer ${login.body.access_token as string}` };
    const url = `/businesses/${s.biz.id}/reports/sales-tax-liability`;

    const res = await request(app).get(url).query({ period_start: '2026-04-01', period_end: '2026-04-30' }).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ period_start: '2026-04-01', gross_sales: '320.0000', codes: [{ code: 'CA' }, { code: 'NV' }] });
    expect((await request(app).get(url).set(auth)).status).toBe(400);
    const empty = await request(app).get(url).query({ period_start: '2026-01-01', period_end: '2026-01-31' }).set(auth);
    expect(empty.body).toMatchObject({ gross_sales: '0.0000', non_taxable_sales: '0.0000', codes: [] });
  });
});
