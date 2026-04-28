import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, makeVendor, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import * as billSvc from '../../src/services/ap/billService.js';
import * as rpt from '../../src/services/reports/profitLossService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000004001', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('P&L report', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  async function setup() {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const revenue = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id','=',biz.id).where('code','=','4010').executeTakeFirstOrThrow();
    const expense = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id','=',biz.id).where('code','=','5010').executeTakeFirstOrThrow();
    const customer = await makeCustomer(t.db, biz.id, { name: 'Acme' });
    const vendor = await makeVendor(t.db, biz.id, { name: 'Office Supplies' });
    return { biz, ctx, revenue, expense, customer, vendor };
  }

  it('aggregates revenue minus expense for a period', async () => {
    const { biz, ctx, revenue, expense, customer, vendor } = await setup();
    // Post an invoice $1000 (revenue)
    const inv = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, invoice_number: 'INV-A',
      issue_date: '2026-04-10', due_date: '2026-05-10', memo: null, terms: null,
      lines: [{ description: 'X', quantity: '1', unit_price: '1000.00', revenue_account_id: revenue.id, tax_code_id: null }],
    }));
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: inv.invoice.id }));
    // Post a bill $250 (expense)
    const bill = await t.db.transaction().execute(trx => billSvc.createDraft(trx, ctx, {
      business_id: biz.id, vendor_id: vendor.id, bill_number: 'B-A',
      bill_date: '2026-04-12', due_date: '2026-05-12', memo: null, terms: null,
      lines: [{ description: 'Y', quantity: '1', unit_price: '250.00', expense_account_id: expense.id }],
    }));
    await t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: bill.bill.id }));

    const r = await rpt.profitLoss(t.db, { business_id: biz.id, period_start: '2026-04-01', period_end: '2026-04-30' });
    expect(r.revenue_total).toBe('1000.0000');
    expect(r.expense_total).toBe('250.0000');
    expect(r.net_income).toBe('750.0000');
    expect(r.revenue_lines.find(l => l.account_code === '4010')?.amount).toBe('1000.0000');
    expect(r.expense_lines.find(l => l.account_code === '5010')?.amount).toBe('250.0000');
  });

  it('excludes voided JEs and honors the period window', async () => {
    const { biz, ctx, revenue, customer } = await setup();
    const inv1 = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, invoice_number: 'INV-B1',
      issue_date: '2026-03-31', due_date: '2026-04-30', memo: null, terms: null,
      lines: [{ description: 'Pre-period', quantity: '1', unit_price: '100.00', revenue_account_id: revenue.id, tax_code_id: null }],
    }));
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: inv1.invoice.id }));

    const inv2 = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, invoice_number: 'INV-B2',
      issue_date: '2026-04-15', due_date: '2026-05-15', memo: null, terms: null,
      lines: [{ description: 'Will-void', quantity: '1', unit_price: '500.00', revenue_account_id: revenue.id, tax_code_id: null }],
    }));
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: inv2.invoice.id }));
    await t.db.transaction().execute(trx => invoiceSvc.voidInvoice(trx, ctx, { invoice_id: inv2.invoice.id, void_reason: 'test' }));

    const r = await rpt.profitLoss(t.db, { business_id: biz.id, period_start: '2026-04-01', period_end: '2026-04-30' });
    expect(r.revenue_total).toBe('0.0000');  // pre-period excluded, voided excluded
  });
});
