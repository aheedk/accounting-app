import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeVendor, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as billSvc from '../../src/services/ap/billService.js';
import * as pay from '../../src/services/ap/billPaymentService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000004012', ip_address: '127.0.0.1', user_agent: 'vitest' };

// 2026-09-28 audit: Pay Bills handled one vendor at a time.
describe('pay bills', () => {
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
    const account = (code: string) => t.db.selectFrom('chart_of_accounts').selectAll()
      .where('business_id', '=', biz.id).where('code', '=', code).executeTakeFirstOrThrow();
    const [cash, expense] = await Promise.all([account('1020'), account('5200')]);
    const paper = await makeVendor(t.db, biz.id, { name: 'Paper Supply Co' });
    const landlord = await makeVendor(t.db, biz.id, { name: 'Oak Street Properties' });
    const postBill = async (vendor_id: string, num: string, amount: string, due_date: string) => {
      const d = await t.db.transaction().execute(trx => billSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id, bill_number: num, bill_date: '2026-04-01', due_date, memo: null, terms: null,
        lines: [{ description: 'Services', quantity: '1', unit_price: amount, expense_account_id: expense!.id }],
      }));
      return t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: d.bill.id }));
    };
    const p1 = await postBill(paper.id, 'P-1', '100.00', '2026-05-01');
    const p2 = await postBill(paper.id, 'P-2', '250.00', '2026-05-15');
    const rent = await postBill(landlord.id, 'R-1', '1000.00', '2026-04-20');
    return { biz, ctx, cash: cash!, paper, landlord, p1, p2, rent };
  }

  it('lists what is owed across vendors, then pays several vendors with one payment each', async () => {
    const { biz, ctx, cash, paper, landlord, p1, p2, rent } = await setup();
    const before = await pay.listUnpaidBills(t.db, biz.id);
    expect(before.map(b => [b.vendor_name, b.bill_number, b.open_balance])).toEqual([
      ['Oak Street Properties', 'R-1', '1000.0000'],   // earliest due date first
      ['Paper Supply Co', 'P-1', '100.0000'],
      ['Paper Supply Co', 'P-2', '250.0000'],
    ]);

    const result = await t.db.transaction().execute(trx => pay.payBills(trx, ctx, {
      payment_date: '2026-05-02', payment_method: 'check', cash_account_id: cash.id,
      items: [
        { bill_id: p1.id, amount: '100.00' },
        { bill_id: p2.id, amount: '50.00' },      // part of it
        { bill_id: rent.id, amount: '1000.00' },
      ],
    }));

    // One posted payment per vendor.
    expect(result.bill_payments.map(p => [p.vendor_id, p.amount, p.bill_count]).sort()).toEqual([
      [landlord.id, '1000.0000', 1],
      [paper.id, '150.0000', 2],
    ].sort());
    const payments = await t.db.selectFrom('bill_payments').select(['vendor_id', 'status', 'amount', 'unapplied_amount'])
      .where('business_id', '=', biz.id).execute();
    expect(payments).toHaveLength(2);
    expect(payments.every(p => p.status === 'posted' && Number(p.unapplied_amount) === 0)).toBe(true);

    // Only the part-paid bill is still owed.
    const after = await pay.listUnpaidBills(t.db, biz.id);
    expect(after.map(b => [b.bill_number, b.open_balance])).toEqual([['P-2', '200.0000']]);
    const paidBill = await t.db.selectFrom('bills').select('status').where('id', '=', rent.id).executeTakeFirstOrThrow();
    expect(paidBill.status).toBe('paid');
  });

  it('pays nothing if one of the bills cannot be paid', async () => {
    const { biz, ctx, cash, p1, rent } = await setup();
    await expect(t.db.transaction().execute(trx => pay.payBills(trx, ctx, {
      payment_date: '2026-05-02', payment_method: 'check', cash_account_id: cash.id,
      items: [
        { bill_id: rent.id, amount: '1000.00' },
        { bill_id: p1.id, amount: '999.00' },     // more than the bill
      ],
    }))).rejects.toThrow();
    const payments = await t.db.selectFrom('bill_payments').select('id').where('business_id', '=', biz.id).execute();
    expect(payments).toEqual([]);
    expect(await pay.listUnpaidBills(t.db, biz.id)).toHaveLength(3);

    await expect(t.db.transaction().execute(trx => pay.payBills(trx, ctx, {
      payment_date: '2026-05-02', payment_method: 'check', cash_account_id: cash.id, items: [],
    }))).rejects.toThrow(/at least one bill/);
  });
});
