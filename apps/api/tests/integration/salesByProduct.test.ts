import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { grantAccess, makeBusiness, makeCustomer, makeFirm, makeUser, seedCoa, seedYearPeriods } from '../helpers/factories.js';
import { makeApp } from '../../src/app.js';
import { destroyDbSingleton } from '../../src/db/index.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import { salesByProduct } from '../../src/services/ar/reports/salesByProductService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000002019', ip_address: '127.0.0.1', user_agent: 'vitest' };

// Sales by Product/Service (item 18): income from invoice lines, dated in the
// period, under the product/service each was for.
describe('salesByProduct', () => {
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
    const revenue = await account('4010');
    const customer = await makeCustomer(t.db, biz.id, { name: 'Acme' });
    const widget = await t.db.insertInto('inventory_items')
      .values({ business_id: biz.id, sku: 'W-1', name: 'Widget', purchase_cost: '5.00' })
      .returningAll().executeTakeFirstOrThrow();

    type Line = { unit_price: string; quantity?: string; inventory_item_id?: string | null };
    const invoice = async (invoice_number: string, issue_date: string, lines: Line[], post = true) => {
      const draft = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, invoice_number, issue_date, due_date: '2026-06-30', memo: null, terms: null,
        lines: lines.map(l => ({
          description: 'Goods', quantity: l.quantity ?? '1', unit_price: l.unit_price, revenue_account_id: revenue.id, tax_code_id: null,
          inventory_item_id: l.inventory_item_id ?? null,
        })),
      }));
      if (post) await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id }));
      return draft.invoice;
    };

    await invoice('S-1', '2026-04-15', [{ unit_price: '50.0000', quantity: '2', inventory_item_id: widget.id }, { unit_price: '20.0000', inventory_item_id: null }]);
    const voided = await invoice('S-2', '2026-04-20', [{ unit_price: '1000.0000', inventory_item_id: widget.id }]);
    await t.db.transaction().execute(trx => invoiceSvc.voidInvoice(trx, ctx, { invoice_id: voided.id, void_reason: 'Entered twice' }));
    await invoice('S-3', '2026-05-02', [{ unit_price: '500.0000', inventory_item_id: widget.id }]);
    await invoice('S-4', '2026-04-25', [{ unit_price: '300.0000', inventory_item_id: widget.id }], false);
    return { firm, biz, widget };
  }

  it('sums quantity and amount for each item, leaving lines with no item under "Not Specified"', async () => {
    const s = await setup();
    const rows = await salesByProduct(t.db, { business_id: s.biz.id, period_start: '2026-04-01', period_end: '2026-04-30' });
    expect(rows).toEqual([
      { item_id: s.widget.id, sku: 'W-1', name: 'Widget', quantity: '2.0000', amount: '100.0000' },
      { item_id: null, sku: null, name: 'Not Specified', quantity: '1.0000', amount: '20.0000' },
    ]);
  });

  it('leaves out drafts, voided invoices and other dates', async () => {
    const s = await setup();
    const rows = await salesByProduct(t.db, { business_id: s.biz.id, period_start: '2026-01-01', period_end: '2026-01-31' });
    expect(rows).toEqual([]);
  });

  it('over HTTP: staff read it, under its own item', async () => {
    const s = await setup();
    const user = await makeUser(t.db, s.firm.id, { role: 'staff' });
    await grantAccess(t.db, user.id, s.biz.id);
    const app = makeApp();
    const login = await request(app).post('/auth/login').send({ email: user.email, password: user.plaintext_password });
    const auth = { Authorization: `Bearer ${login.body.access_token as string}` };
    const res = await request(app).get(`/businesses/${s.biz.id}/reports/sales-by-product`)
      .query({ period_start: '2026-04-01', period_end: '2026-04-30' }).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.rows).toMatchObject([{ name: 'Widget', amount: '100.0000' }, { name: 'Not Specified', amount: '20.0000' }]);
  });
});
