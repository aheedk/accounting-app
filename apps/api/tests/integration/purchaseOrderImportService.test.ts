import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import { createInvoiceFromPurchaseOrder, purchaseOrderInvoiceLines } from '../../src/services/ai/purchaseOrderImportService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000ddd23', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('purchaseOrderInvoiceLines', () => {
  const included = [{ index: 0, account_id: 'rev' }, { index: 1, account_id: 'rev' }];

  it('keeps the quantity and unit price the order has', () => {
    const lines = purchaseOrderInvoiceLines([
      { description: 'Widgets', quantity: '12', unit_price: '2.50', amount: '30.00' },
      { description: 'Setup', quantity: '1', unit_price: '$1,200.00', amount: '1,200.00' },
    ], included, { subtotal: '1230.00', tax_amount: '0.00' });
    expect(lines.map(l => [l.quantity, l.unit_price])).toEqual([['12', '2.5000'], ['1', '1200.0000']]);
  });

  it('falls back to one unit when the numbers do not multiply out, or the order carries tax', () => {
    const odd = purchaseOrderInvoiceLines([{ description: 'Lot', quantity: '3', unit_price: '10', amount: '25' }],
      [{ index: 0, account_id: 'rev' }], { subtotal: null, tax_amount: null });
    expect([odd[0]!.quantity, odd[0]!.unit_price]).toEqual(['1', '25.00']);

    const taxed = purchaseOrderInvoiceLines([
      { description: 'A', quantity: '2', unit_price: '50', amount: '100' },
      { description: 'B', quantity: '1', unit_price: '100', amount: '100' },
    ], included, { subtotal: '200', tax_amount: '16' });
    expect(taxed.map(l => [l.quantity, l.unit_price])).toEqual([['1', '108.00'], ['1', '108.00']]);
  });
});

describe('createInvoiceFromPurchaseOrder', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('posts a sales invoice with the next number, the PO number in the memo and the customer terms', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const revenue = await t.db.selectFrom('chart_of_accounts').select('id')
      .where('business_id', '=', biz.id).where('code', '=', '4010').executeTakeFirstOrThrow();
    const customer = await makeCustomer(t.db, biz.id, { name: 'Blue Widget' });
    await t.db.updateTable('customers').set({ default_terms_days: 15 }).where('id', '=', customer.id).execute();

    const invoice = await t.db.transaction().execute(trx => createInvoiceFromPurchaseOrder(trx, ctx, {
      business_id: biz.id,
      customer_id: customer.id,
      po_number: 'PO-7781',
      issue_date: '2026-03-10',
      lines: purchaseOrderInvoiceLines([{ description: 'Widgets', quantity: '12', unit_price: '2.50', amount: '30.00' }],
        [{ index: 0, account_id: revenue.id }], { subtotal: '30.00', tax_amount: '0' }),
    }));

    const saved = await t.db.selectFrom('invoices').selectAll().where('id', '=', invoice.id).executeTakeFirstOrThrow();
    expect(saved).toMatchObject({ invoice_number: '1001', status: 'posted', memo: 'Customer PO #PO-7781', terms: 'Net 15' });
    expect(String(saved.due_date).slice(0, 10)).toBe('2026-03-25');
    expect(Number(saved.total)).toBe(30);
    const [line] = await t.db.selectFrom('invoice_lines').selectAll().where('invoice_id', '=', invoice.id).execute();
    expect([Number(line!.quantity), Number(line!.unit_price)]).toEqual([12, 2.5]);
  });
});
