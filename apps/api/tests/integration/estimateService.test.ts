// Estimates (item 17): quotes that become a draft invoice.
// Spec: docs/specs/2026-10-20-estimates-design.md
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess, makeCustomer, makeTaxCode, seedCoa, seedYearPeriods } from '../helpers/factories.js';
import { makeApp } from '../../src/app.js';
import { destroyDbSingleton } from '../../src/db/index.js';
import * as est from '../../src/services/ar/estimateService.js';
import { updateBusiness } from '../../src/services/core/businessService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';
import type { Transaction } from 'kysely';
import type { DB } from '../../src/db/types.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000e5717', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('estimates', () => {
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

  async function setup(name = 'Estimates Co') {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id, name);
    const user = await makeUser(t.db, firm.id, { role: 'staff' });
    await grantAccess(t.db, user.id, biz.id);
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'staff', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const account = (code: string) => t.db.selectFrom('chart_of_accounts').select('id')
      .where('business_id', '=', biz.id).where('code', '=', code).executeTakeFirstOrThrow();
    const revenue = await account('4010');
    const tax = await makeTaxCode(t.db, biz.id, (await account('2100')).id, { code: 'CA', rate: 0.1 });
    const customer = await makeCustomer(t.db, biz.id, { name: 'Harbor View Cafe' });
    await t.db.updateTable('customers').set({ default_terms_days: 15 }).where('id', '=', customer.id).execute();
    const input = (patch: Partial<est.SaveEstimateInput> = {}): est.SaveEstimateInput => ({
      business_id: biz.id, customer_id: customer.id,
      estimate_date: '2026-03-01', expiration_date: '2026-03-31', memo: 'Thanks for asking us.',
      lines: [
        { inventory_item_id: null, description: 'Espresso grinder', quantity: '2', unit_price: '349.00', revenue_account_id: revenue.id, tax_code_id: tax.id },
        { inventory_item_id: null, description: 'Training session', quantity: '1', unit_price: '250.00', revenue_account_id: revenue.id, tax_code_id: null },
      ],
      ...patch,
    });
    const run = <T>(fn: (trx: Transaction<DB>) => Promise<T>) => t.db.transaction().execute(fn);
    return { firm, biz, user, ctx, revenue, tax, customer, input, run };
  }

  it('numbers estimates on their own and works out the tax and totals', async () => {
    const { ctx, input, run } = await setup();
    const first = await run(trx => est.createEstimate(trx, ctx, input()));
    const second = await run(trx => est.createEstimate(trx, ctx, input()));
    expect([first.estimate.estimate_number, second.estimate.estimate_number]).toEqual(['EST-0001', 'EST-0002']);
    expect(first.estimate.status).toBe('pending');
    // 698.00 + 250.00, with 10% tax on the grinders only.
    expect([first.estimate.subtotal, first.estimate.tax_total, first.estimate.total]).toEqual(['948.0000', '69.8000', '1017.8000']);
    expect(first.lines.map(l => [l.line_number, l.quantity, l.line_total])).toEqual([[1, '2.0000', '767.8000'], [2, '1.0000', '250.0000']]);
  });

  it("refuses another company's customer, account or tax code", async () => {
    const { ctx, input, run } = await setup();
    const other = await setup('Other Co');
    await expect(run(trx => est.createEstimate(trx, ctx, input({ customer_id: other.customer.id })))).rejects.toThrow(/customer/);
    const foreignLine = { ...input().lines[0]!, revenue_account_id: other.revenue.id };
    await expect(run(trx => est.createEstimate(trx, ctx, input({ lines: [foreignLine] })))).rejects.toThrow(/account/);
    const foreignTax = { ...input().lines[0]!, tax_code_id: other.tax.id };
    await expect(run(trx => est.createEstimate(trx, ctx, input({ lines: [foreignTax] })))).rejects.toThrow(/tax_code/);
  });

  it('edits the whole estimate and marks it accepted, then back to pending', async () => {
    const { ctx, input, run } = await setup();
    const { estimate } = await run(trx => est.createEstimate(trx, ctx, input()));
    const edited = await run(trx => est.updateEstimate(trx, ctx, {
      ...input({ memo: 'Revised', lines: [input().lines[1]!] }), estimate_id: estimate.id,
    }));
    expect([edited.estimate.estimate_number, edited.estimate.memo, edited.estimate.total, edited.lines.length])
      .toEqual(['EST-0001', 'Revised', '250.0000', 1]);

    const accepted = await run(trx => est.setEstimateStatus(trx, ctx, { estimate_id: estimate.id, status: 'accepted', accepted_by: 'Dana Ruiz', accepted_date: '2026-03-05' }));
    expect([accepted.status, accepted.accepted_by, accepted.accepted_date]).toEqual(['accepted', 'Dana Ruiz', '2026-03-05']);
    const pending = await run(trx => est.setEstimateStatus(trx, ctx, { estimate_id: estimate.id, status: 'pending' }));
    expect([pending.status, pending.accepted_by, pending.accepted_date]).toEqual(['pending', null, null]);
  });

  it('becomes a draft invoice with the next invoice number, the lines and the customer terms, and is then closed', async () => {
    const { biz, ctx, input, run } = await setup();
    // Numbered by Company Settings, like every invoice.
    await run(trx => updateBusiness(trx, { ...ctx, effective_role: 'firm_admin' }, { business_id: biz.id, patch: { invoice_number_prefix: 'INV-', invoice_next_number: 5000 } }));
    const { estimate } = await run(trx => est.createEstimate(trx, ctx, input()));

    const { estimate: closed, invoice } = await run(trx => est.convertToInvoice(trx, ctx, { estimate_id: estimate.id, issue_date: '2026-04-01' }));
    expect([closed.status, closed.invoice_id]).toEqual(['closed', invoice.id]);
    expect([invoice.status, invoice.invoice_number, invoice.issue_date, invoice.due_date, invoice.terms, invoice.memo, invoice.total])
      .toEqual(['draft', 'INV-5000', '2026-04-01', '2026-04-16', 'Net 15', 'Thanks for asking us.', '1017.8000']);
    const lines = await t.db.selectFrom('invoice_lines').select(['description', 'quantity', 'unit_price', 'tax_code_id'])
      .where('invoice_id', '=', invoice.id).orderBy('line_number').execute();
    expect(lines.map(l => [l.description, l.quantity, l.unit_price])).toEqual([
      ['Espresso grinder', '2.0000', '349.0000'], ['Training session', '1.0000', '250.0000'],
    ]);
    expect(await est.estimateForInvoice(t.db, biz.id, invoice.id)).toEqual({ id: estimate.id, estimate_number: 'EST-0001' });

    // Closed is final: no second invoice, no edits, no status change, no delete.
    await expect(run(trx => est.convertToInvoice(trx, ctx, { estimate_id: estimate.id }))).rejects.toThrow(/closed/);
    await expect(run(trx => est.updateEstimate(trx, ctx, { ...input(), estimate_id: estimate.id }))).rejects.toThrow(/closed/);
    await expect(run(trx => est.setEstimateStatus(trx, ctx, { estimate_id: estimate.id, status: 'pending' }))).rejects.toThrow(/closed/);
    await expect(run(trx => est.deleteEstimate(trx, ctx, { estimate_id: estimate.id }))).rejects.toThrow(/closed/);
  });

  it('does not invoice a rejected estimate until it is set back', async () => {
    const { ctx, input, run } = await setup();
    const { estimate } = await run(trx => est.createEstimate(trx, ctx, input()));
    await run(trx => est.setEstimateStatus(trx, ctx, { estimate_id: estimate.id, status: 'rejected' }));
    await expect(run(trx => est.convertToInvoice(trx, ctx, { estimate_id: estimate.id }))).rejects.toThrow(/rejected/);
    await run(trx => est.setEstimateStatus(trx, ctx, { estimate_id: estimate.id, status: 'pending' }));
    const { invoice } = await run(trx => est.convertToInvoice(trx, ctx, { estimate_id: estimate.id }));
    expect(invoice.status).toBe('draft');
  });

  it("deletes an open estimate, and never finds another company's", async () => {
    const { ctx, input, run } = await setup();
    const other = await setup('Other Co');
    const { estimate } = await run(trx => est.createEstimate(trx, ctx, input()));
    await expect(run(trx => est.deleteEstimate(trx, other.ctx, { estimate_id: estimate.id }))).rejects.toThrow(/not found/i);
    await run(trx => est.deleteEstimate(trx, ctx, { estimate_id: estimate.id }));
    expect(await t.db.selectFrom('estimate_lines').select('id').where('estimate_id', '=', estimate.id).execute()).toEqual([]);
    const audit = await t.db.selectFrom('audit_logs').select('action').where('entity_id', '=', estimate.id).orderBy('created_at').execute();
    expect(audit.map(a => a.action)).toEqual(['estimate.create', 'estimate.delete']);
  });

  it('over HTTP: staff make, list and convert one; bad input is a 400; the invoice names its estimate', async () => {
    const { biz, user, customer, revenue } = await setup();
    const app = makeApp();
    const login = await request(app).post('/auth/login').send({ email: user.email, password: user.plaintext_password });
    const auth = { Authorization: `Bearer ${login.body.access_token as string}` };
    const base = `/businesses/${biz.id}/estimates`;
    const body = {
      customer_id: customer.id, estimate_date: '2026-03-01', expiration_date: '2026-03-31',
      lines: [{ description: 'Grinder', quantity: '1', unit_price: '349.00', revenue_account_id: revenue.id }],
    };

    expect((await request(app).post(base).set(auth).send({ ...body, expiration_date: '2026-02-01' })).status).toBe(400);
    expect((await request(app).post(base).set(auth).send({ ...body, lines: [{ ...body.lines[0], quantity: '0' }] })).status).toBe(400);
    const created = await request(app).post(base).set(auth).send(body);
    expect(created.status).toBe(201);
    const id = created.body.estimate.id as string;

    const list = await request(app).get(base).set(auth);
    expect(list.body.estimates.map((e: { estimate_number: string; customer_name: string }) => [e.estimate_number, e.customer_name]))
      .toEqual([['EST-0001', 'Harbor View Cafe']]);

    const converted = await request(app).post(`${base}/${id}/convert`).set(auth).send({});
    expect(converted.status).toBe(201);
    const detail = await request(app).get(`${base}/${id}`).set(auth);
    expect([detail.body.estimate.status, detail.body.invoice_number]).toEqual(['closed', converted.body.invoice.invoice_number]);
    const invoice = await request(app).get(`/businesses/${biz.id}/invoices/${converted.body.invoice.id as string}`).set(auth);
    expect(invoice.body.estimate).toEqual({ id, estimate_number: 'EST-0001' });
  });
});
