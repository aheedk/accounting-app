import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeVendor, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as billSvc from '../../src/services/ap/billService.js';
import * as payment from '../../src/services/ap/billPaymentService.js';
import * as rpt from '../../src/services/ap/reports/tenNinetyNineReportService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000bbb09', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('1099 report', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('aggregates posted bill payments by 1099 vendor for the year', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const cash = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id','=',biz.id).where('code','=','1020').executeTakeFirstOrThrow();
    const expense = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id','=',biz.id).where('code','=','5010').executeTakeFirstOrThrow();
    const v1099 = await makeVendor(t.db, biz.id, { name: 'Contractor Co', is_1099: true });
    const vNot = await makeVendor(t.db, biz.id, { name: 'Staples', is_1099: false });

    const makeBill = async (vendor_id: string, num: string, amount: string) => {
      const d = await t.db.transaction().execute(trx => billSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id, bill_number: num, bill_date: '2026-03-01', due_date: '2026-04-01',
        memo: null, terms: null,
        lines: [{ description: 'Services', quantity: '1', unit_price: amount, expense_account_id: expense.id }],
      }));
      return t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: d.bill.id }));
    };
    const payBill = async (vendor_id: string, bill_id: string, amount: string, date: string) => {
      const dr = await t.db.transaction().execute(trx => payment.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id, payment_date: date, payment_method: 'check',
        reference: null, amount, cash_account_id: cash.id, memo: null,
        initial_applications: [{ bill_id, applied_amount: amount }],
      }));
      return t.db.transaction().execute(trx => payment.postBillPayment(trx, ctx, { bill_payment_id: dr.bill_payment.id }));
    };

    const b1 = await makeBill(v1099.id, 'B-1099-A', '600.0000');
    const b2 = await makeBill(vNot.id, 'B-NOT', '500.0000');
    const b3 = await makeBill(v1099.id, 'B-1099-B', '200.0000');
    await payBill(v1099.id, b1.id, '600.0000', '2026-04-01');
    await payBill(vNot.id, b2.id, '500.0000', '2026-04-01');
    await payBill(v1099.id, b3.id, '200.0000', '2026-06-15');

    const rows = await rpt.tenNinetyNine(t.db, { business_id: biz.id, year: 2026 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.vendor_name).toBe('Contractor Co');
    expect(rows[0]!.total_paid).toBe('800.0000');
  });
});
