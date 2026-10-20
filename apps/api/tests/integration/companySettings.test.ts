import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, makeTaxCode, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import { updateBusiness } from '../../src/services/core/businessService.js';
import { createCustomer } from '../../src/services/ar/customerService.js';
import { createVendor } from '../../src/services/ap/vendorService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

// Spec: docs/specs/2026-10-20-company-settings-design.md
const meta = { request_id: '00000000-0000-0000-0000-0000000ddd20', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('company settings', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  async function setup() {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'firm_admin' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'firm_admin', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const revenue = await t.db.selectFrom('chart_of_accounts').select('id')
      .where('business_id', '=', biz.id).where('code', '=', '4010').executeTakeFirstOrThrow();
    const customer = await makeCustomer(t.db, biz.id);
    const invoice = (invoice_number: string) => t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, invoice_number,
      issue_date: '2026-03-01', due_date: '2026-03-31', memo: null, terms: null,
      lines: [{ description: 'Work', quantity: '1', unit_price: '10', revenue_account_id: revenue.id, tax_code_id: null }],
    }));
    const settings = (patch: Parameters<typeof updateBusiness>[2]['patch']) =>
      t.db.transaction().execute(trx => updateBusiness(trx, ctx, { business_id: biz.id, patch }));
    return { firm, biz, ctx, invoice, settings };
  }

  it('numbers invoices from 1001, and leaves corrections and other styles out of the count', async () => {
    const { biz, invoice } = await setup();
    expect(await invoiceSvc.getNextInvoiceNumber(t.db, biz.id)).toBe('1001');
    await invoice('1001');
    await invoice('1042');
    await invoice('1042-R1');   // a corrected invoice; the old rule read it as 10421
    await invoice('INV-0003');
    expect(await invoiceSvc.getNextInvoiceNumber(t.db, biz.id)).toBe('1043');
  });

  it('uses the prefix and the start number, and never goes below the start', async () => {
    const { biz, invoice, settings } = await setup();
    await invoice('INV-0003');
    await settings({ invoice_number_prefix: 'INV-' });
    expect(await invoiceSvc.getNextInvoiceNumber(t.db, biz.id)).toBe('INV-1001');
    await settings({ invoice_next_number: 2 });
    expect(await invoiceSvc.getNextInvoiceNumber(t.db, biz.id)).toBe('INV-4');
    await settings({ invoice_next_number: 5000 });
    expect(await invoiceSvc.getNextInvoiceNumber(t.db, biz.id)).toBe('INV-5000');
  });

  it('gives new customers and vendors the company default terms, unless they have their own', async () => {
    const { biz, ctx, settings } = await setup();
    await settings({ default_invoice_terms_days: 15, default_bill_terms_days: 45 });
    const customer = await t.db.transaction().execute(trx => createCustomer(trx, ctx, { business_id: biz.id, name: 'New Customer' }));
    const own = await t.db.transaction().execute(trx => createCustomer(trx, ctx, { business_id: biz.id, name: 'Own Terms', default_terms_days: 60 }));
    const vendor = await t.db.transaction().execute(trx => createVendor(trx, ctx, { business_id: biz.id, name: 'New Vendor' }));
    expect([customer.default_terms_days, own.default_terms_days, vendor.default_terms_days]).toEqual([15, 60, 45]);
  });

  it("takes this company's own tax code as the default, and refuses another company's", async () => {
    const { firm, biz, settings } = await setup();
    const taxAcct = await t.db.selectFrom('chart_of_accounts').select('id')
      .where('business_id', '=', biz.id).where('code', '=', '2100').executeTakeFirstOrThrow();
    const own = await makeTaxCode(t.db, biz.id, taxAcct.id, { code: 'CA' });
    const other = await makeBusiness(t.db, firm.id, 'Other');
    await seedCoa(t.db, other.id);
    const otherAcct = await t.db.selectFrom('chart_of_accounts').select('id')
      .where('business_id', '=', other.id).where('code', '=', '2100').executeTakeFirstOrThrow();
    const theirs = await makeTaxCode(t.db, other.id, otherAcct.id, { code: 'NY' });

    const saved = await settings({ default_sales_tax_code_id: own.id, default_expense_payment_method: 'check' });
    expect([saved.default_sales_tax_code_id, saved.default_expense_payment_method]).toEqual([own.id, 'check']);
    await expect(settings({ default_sales_tax_code_id: theirs.id })).rejects.toThrow(/not found/i);
  });
});
