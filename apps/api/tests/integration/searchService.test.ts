import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import {
  makeFirm, makeBusiness, makeUser, makeCustomer, makeVendor, makeBankAccount, seedYearPeriods, seedCoa,
} from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import * as billSvc from '../../src/services/ap/billService.js';
import * as checkSvc from '../../src/services/ap/checkService.js';
import * as expenseSvc from '../../src/services/ap/expenseTransactionService.js';
import { searchRecords } from '../../src/services/core/searchService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000004010', ip_address: '127.0.0.1', user_agent: 'vitest' };

// 2026-09-28 audit: search found pages only; "contoso" returned nothing.
describe('searchRecords', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  async function client(name: string) {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id, name);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const account = (code: string) => t.db.selectFrom('chart_of_accounts').selectAll()
      .where('business_id', '=', biz.id).where('code', '=', code).executeTakeFirstOrThrow();
    const cash = await account('1020');
    return {
      biz, ctx, revenue: await account('4010'), expense: await account('5010'), cash,
      bankAccount: await makeBankAccount(t.db, biz.id, cash.id),
    };
  }

  it('finds customers, vendors, invoices and bills by name or number, inside one company', async () => {
    const { biz, ctx, revenue, expense } = await client('Search Co');
    const contoso = await makeCustomer(t.db, biz.id, { name: 'Contoso Ltd' });
    await makeCustomer(t.db, biz.id, { name: 'Fabrikam Inc' });
    const supplier = await makeVendor(t.db, biz.id, { name: 'Contoso Supplies' });
    const inv = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: contoso.id, invoice_number: 'INV-7781',
      issue_date: '2026-04-10', due_date: '2026-05-10', memo: null, terms: null,
      lines: [{ description: 'X', quantity: '1', unit_price: '100.00', revenue_account_id: revenue.id, tax_code_id: null }],
    }));
    const bill = await t.db.transaction().execute(trx => billSvc.createDraft(trx, ctx, {
      business_id: biz.id, vendor_id: supplier.id, bill_number: 'B-4410', bill_date: '2026-04-12', due_date: '2026-05-12',
      memo: null, terms: null,
      lines: [{ description: 'Y', quantity: '1', unit_price: '50.00', expense_account_id: expense.id }],
    }));

    // By name, any capitals: the customer, the vendor, and their invoice and bill.
    const byName = await searchRecords(t.db, { business_id: biz.id, query: 'contoso' });
    expect(byName.map(r => [r.type, r.label, r.detail])).toEqual([
      ['customer', 'Contoso Ltd', null],
      ['vendor', 'Contoso Supplies', null],
      ['invoice', 'Invoice INV-7781', 'Contoso Ltd'],
      ['bill', 'Bill B-4410', 'Contoso Supplies'],
    ]);
    expect(byName[2]!.id).toBe(inv.invoice.id);
    expect(byName[3]!.id).toBe(bill.bill.id);

    // By number.
    expect((await searchRecords(t.db, { business_id: biz.id, query: '7781' })).map(r => r.label)).toEqual(['Invoice INV-7781']);

    // Too short to search, and wildcards are taken literally.
    expect(await searchRecords(t.db, { business_id: biz.id, query: 'c' })).toEqual([]);
    expect(await searchRecords(t.db, { business_id: biz.id, query: '%%' })).toEqual([]);

    // Another company sees none of it.
    const other = await client('Other Co');
    expect(await searchRecords(t.db, { business_id: other.biz.id, query: 'contoso' })).toEqual([]);
  });

  it('finds both real checks and legacy checks-as-expenses, each pointing at its own page', async () => {
    const { biz, ctx, expense, bankAccount } = await client('Search Co');
    const payee = await makeVendor(t.db, biz.id, { name: 'Contoso Plumbing' });

    const realCheck = await t.db.transaction().execute(trx => checkSvc.createCheck(trx, ctx, {
      payment_date: '2026-04-15', payee_id: payee.id, payee_type: 'vendor',
      bank_account_id: bankAccount.id, lines: [{ account_id: expense.id, amount: '120.00' }],
    }));
    // From before the Write Check feature existed — an expense paid by check.
    const legacyCheck = await t.db.transaction().execute(trx => expenseSvc.createExpense(trx, ctx, {
      transaction_date: '2026-03-01', vendor_id: payee.id, payment_account_id: bankAccount.cash_account_id,
      payment_method: 'check', reference: '9042',
      lines: [{ category_account_id: expense.id, amount: '80.00' }],
    }));

    const byVendor = await searchRecords(t.db, { business_id: biz.id, query: 'contoso plumbing' });
    expect(byVendor.map(r => [r.type, r.label, r.detail, r.path])).toEqual(expect.arrayContaining([
      ['check', `Check ${realCheck.check_number}`, 'Contoso Plumbing', `/accounting/checks/${realCheck.id}`],
      ['check', 'Check 9042', 'Contoso Plumbing', `/accounting/expenses/${legacyCheck.id}`],
    ]));

    // By check number too.
    const byNumber = await searchRecords(t.db, { business_id: biz.id, query: '9042' });
    expect(byNumber.map(r => r.path)).toEqual([`/accounting/expenses/${legacyCheck.id}`]);
  });
});
