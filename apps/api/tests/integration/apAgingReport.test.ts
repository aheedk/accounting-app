import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeVendor, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as billSvc from '../../src/services/ap/billService.js';
import * as payment from '../../src/services/ap/billPaymentService.js';
import * as apAging from '../../src/services/ap/reports/apAgingReportService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000000a19', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('A/P aging report', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('buckets unpaid bills by days past due, nets vendor credit, and ties to Accounts Payable', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const cash = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '1020').executeTakeFirstOrThrow();
    const expense = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '5010').executeTakeFirstOrThrow();
    const supplier = await makeVendor(t.db, biz.id, { name: 'Paper Supply Co' });
    const landlord = await makeVendor(t.db, biz.id, { name: 'Oak Street Properties' });

    const postBill = async (vendor_id: string, num: string, amount: string, due_date: string) => {
      const d = await t.db.transaction().execute(trx => billSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id, bill_number: num, bill_date: '2026-01-05', due_date,
        memo: null, terms: null,
        lines: [{ description: 'Services', quantity: '1', unit_price: amount, expense_account_id: expense.id }],
      }));
      return t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: d.bill.id }));
    };
    // as of 2026-06-20: due 07-01 current, 06-01 is 19 days, 05-01 is 50, 04-01 is 80, 02-01 is 139.
    await postBill(supplier.id, 'P-1', '100.00', '2026-07-01');
    await postBill(supplier.id, 'P-2', '200.00', '2026-06-01');
    await postBill(supplier.id, 'P-3', '300.00', '2026-05-01');
    await postBill(supplier.id, 'P-4', '400.00', '2026-04-01');
    const old = await postBill(supplier.id, 'P-5', '500.00', '2026-02-01');
    const rent = await postBill(landlord.id, 'R-1', '1000.00', '2026-06-10');

    // Pay the oldest bill in part, and overpay the landlord so 250 sits unapplied.
    const pay = async (vendor_id: string, bill_id: string, amount: string, applied: string, date: string) => {
      const dr = await t.db.transaction().execute(trx => payment.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id, payment_date: date, payment_method: 'check',
        reference: null, amount, cash_account_id: cash.id, memo: null,
        initial_applications: [{ bill_id, applied_amount: applied }],
      }));
      return t.db.transaction().execute(trx => payment.postBillPayment(trx, ctx, { bill_payment_id: dr.bill_payment.id }));
    };
    await pay(supplier.id, old.id, '120.00', '120.00', '2026-03-01');
    await pay(landlord.id, rent.id, '1250.00', '1000.00', '2026-06-15');

    const rows = await apAging.vendorAging(t.db, { business_id: biz.id, as_of: '2026-06-20' });
    expect(rows.map(r => r.name)).toEqual(['Oak Street Properties', 'Paper Supply Co']);

    const paper = rows.find(r => r.id === supplier.id)!;
    expect(paper).toMatchObject({
      current: '100.0000', days_1_30: '200.0000', days_31_60: '300.0000', days_61_90: '400.0000', days_over_90: '380.0000',
      total: '1380.0000',
    });
    // The bill is paid; the 250 overpayment is credit with the vendor, shown as a negative.
    expect(rows.find(r => r.id === landlord.id)).toMatchObject({ days_1_30: '-250.0000', total: '-250.0000' });

    const ap = await t.db.selectFrom('journal_entry_lines as l')
      .innerJoin('journal_entries as je', 'je.id', 'l.journal_entry_id')
      .innerJoin('chart_of_accounts as a', 'a.id', 'l.account_id')
      .select(({ fn }) => [fn.sum<string>('l.debit').as('debit'), fn.sum<string>('l.credit').as('credit')])
      .where('je.business_id', '=', biz.id).where('je.status', '=', 'posted').where('a.system_key', '=', 'accounts_payable')
      .executeTakeFirstOrThrow();
    const total = rows.reduce((sum, r) => sum + Number(r.total), 0);
    expect(total).toBe(1130);
    expect(Number(ap.credit) - Number(ap.debit)).toBe(total);
  });
});
