import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, makeVendor, makePeriod, makeAccount, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import { createExpense } from '../../src/services/ap/expenseTransactionService.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import { updateVendor } from '../../src/services/ap/vendorService.js';
import { closePeriod } from '../../src/services/core/periodCloseService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

// A route takes the record's id from the URL and the client from the path. The
// service has to look the record up within that client, or someone who can open
// one client could post, change or close another client's records by its id.
const meta = { request_id: '00000000-0000-0000-0000-0000000ddd28', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('records are only found within the client of the request', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  async function twoClients() {
    const firm = await makeFirm(t.db);
    const mine = await makeBusiness(t.db, firm.id, 'Mine');
    const theirs = await makeBusiness(t.db, firm.id, 'Theirs');
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctxFor = (business_id: string): ServiceCtx =>
      ({ user_id: user.id, firm_id: firm.id, business_id, effective_role: 'accountant', ...meta });
    return { mine, theirs, ctxFor };
  }

  it("will not post another client's draft invoice", async () => {
    const { mine, theirs, ctxFor } = await twoClients();
    await seedYearPeriods(t.db, theirs.id, 2026);
    await seedCoa(t.db, theirs.id);
    const revenue = await t.db.selectFrom('chart_of_accounts').select('id')
      .where('business_id', '=', theirs.id).where('code', '=', '4010').executeTakeFirstOrThrow();
    const customer = await makeCustomer(t.db, theirs.id);
    const { invoice } = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctxFor(theirs.id), {
      business_id: theirs.id, customer_id: customer.id, invoice_number: '1001',
      issue_date: '2026-03-01', due_date: '2026-03-31', memo: null, terms: null,
      lines: [{ description: 'Work', quantity: '1', unit_price: '100', revenue_account_id: revenue.id, tax_code_id: null }],
    }));

    await expect(t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctxFor(mine.id), { invoice_id: invoice.id })))
      .rejects.toThrow(/not found/i);
    const still = await t.db.selectFrom('invoices').select('status').where('id', '=', invoice.id).executeTakeFirstOrThrow();
    expect(still.status).toBe('draft');
  });

  it("will not rename another client's vendor or close its period", async () => {
    const { mine, theirs, ctxFor } = await twoClients();
    const vendor = await makeVendor(t.db, theirs.id, { name: 'Their Vendor' });
    const period = await makePeriod(t.db, theirs.id, '2026-01-01', '2026-01-31');

    await expect(t.db.transaction().execute(trx => updateVendor(trx, ctxFor(mine.id), { vendor_id: vendor.id, patch: { name: 'Renamed' } })))
      .rejects.toThrow();
    await expect(t.db.transaction().execute(trx => closePeriod(trx, ctxFor(mine.id), { period_id: period.id, memo: null })))
      .rejects.toThrow();

    const v = await t.db.selectFrom('vendors').select('name').where('id', '=', vendor.id).executeTakeFirstOrThrow();
    const p = await t.db.selectFrom('fiscal_periods').select('status').where('id', '=', period.id).executeTakeFirstOrThrow();
    expect([v.name, p.status]).toEqual(['Their Vendor', 'open']);
  });

  it("will not put another client's vendor on an expense", async () => {
    const { mine, theirs, ctxFor } = await twoClients();
    await seedCoa(t.db, mine.id);
    await seedYearPeriods(t.db, mine.id, 2026);
    const cash = await makeAccount(t.db, mine.id, { code: '1015', name: 'Cash', account_type: 'asset' });
    const supplies = await makeAccount(t.db, mine.id, { code: '6000', name: 'Office Supplies', account_type: 'expense' });
    const theirVendor = await makeVendor(t.db, theirs.id, { name: 'Their Vendor' });

    await expect(t.db.transaction().execute(trx => createExpense(trx, ctxFor(mine.id), {
      transaction_date: '2026-04-15', vendor_id: theirVendor.id,
      payment_account_id: cash.id, payment_method: 'check',
      lines: [{ category_account_id: supplies.id, amount: '10.00' }],
    }))).rejects.toThrow(/not found/i);
    const saved = await t.db.selectFrom('expense_transactions').select('id').where('business_id', '=', mine.id).execute();
    expect(saved).toHaveLength(0);
  });
});
