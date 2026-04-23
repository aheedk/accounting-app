import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeVendor, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as billSvc from '../../src/services/ap/billService.js';
import * as vc from '../../src/services/ap/vendorCreditService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000bbb14', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
  await seedYearPeriods(t.db, biz.id, 2026);
  await seedCoa(t.db, biz.id);
  const ap = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '2010').executeTakeFirstOrThrow();
  const offset = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '5010').executeTakeFirstOrThrow();
  const expense = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '5010').executeTakeFirstOrThrow();
  const vendor = await makeVendor(t.db, biz.id, { name: 'Acme' });
  return { firm, biz, ctx, ap, offset, expense, vendor };
}

describe('vendorCreditService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('post creates JE: DR AP / CR Offset', async () => {
    const { biz, ctx, vendor, offset, ap } = await setup(t);
    const c = await t.db.transaction().execute(trx =>
      vc.createDraft(trx, ctx, { business_id: biz.id, vendor_id: vendor.id, credit_date: '2026-04-15', amount: '20.0000', offset_account_id: offset.id, memo: null }),
    );
    const posted = await t.db.transaction().execute(trx => vc.postVendorCredit(trx, ctx, { vendor_credit_id: c.id }));
    expect(posted.status).toBe('posted');
    const lines = await t.db.selectFrom('journal_entry_lines').selectAll().where('journal_entry_id', '=', posted.posted_journal_entry_id!).execute();
    const drLine = lines.find(l => l.account_id === ap.id)!;
    expect(drLine.debit).toBe('20.0000');
    const crLine = lines.find(l => l.account_id === offset.id)!;
    expect(crLine.credit).toBe('20.0000');
  });

  it('apply vendor credit to bill reduces remaining_amount, no JE generated', async () => {
    const { biz, ctx, vendor, offset, expense } = await setup(t);
    const draftBill = await t.db.transaction().execute(trx =>
      billSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id,
        bill_number: 'BILL-200', bill_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'X', quantity: '1', unit_price: '50.0000', expense_account_id: expense.id }],
      }),
    );
    await t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: draftBill.bill.id }));

    const c = await t.db.transaction().execute(trx =>
      vc.createDraft(trx, ctx, { business_id: biz.id, vendor_id: vendor.id, credit_date: '2026-04-16', amount: '50.0000', offset_account_id: offset.id, memo: null }),
    );
    const postedVc = await t.db.transaction().execute(trx => vc.postVendorCredit(trx, ctx, { vendor_credit_id: c.id }));

    const jeCountBefore = await t.db.selectFrom('journal_entries').select(({ fn }) => fn.count<string>('id').as('n')).executeTakeFirst();
    await t.db.transaction().execute(trx => vc.applyToBill(trx, ctx, { vendor_credit_id: postedVc.id, bill_id: draftBill.bill.id, applied_amount: '50.0000' }));
    const jeCountAfter = await t.db.selectFrom('journal_entries').select(({ fn }) => fn.count<string>('id').as('n')).executeTakeFirst();
    expect(jeCountAfter!.n).toBe(jeCountBefore!.n);  // no new JE

    const after = await t.db.selectFrom('vendor_credits').selectAll().where('id', '=', postedVc.id).executeTakeFirstOrThrow();
    expect(after.remaining_amount).toBe('0.0000');
    expect(after.status).toBe('applied');
    const billAfter = await t.db.selectFrom('bills').selectAll().where('id', '=', draftBill.bill.id).executeTakeFirstOrThrow();
    expect(billAfter.status).toBe('paid');
  });

  it('over-application is rejected', async () => {
    const { biz, ctx, vendor, offset, expense } = await setup(t);
    const draftBill = await t.db.transaction().execute(trx =>
      billSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id,
        bill_number: 'BILL-201', bill_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'X', quantity: '1', unit_price: '50.0000', expense_account_id: expense.id }],
      }),
    );
    await t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: draftBill.bill.id }));
    const c = await t.db.transaction().execute(trx =>
      vc.createDraft(trx, ctx, { business_id: biz.id, vendor_id: vendor.id, credit_date: '2026-04-16', amount: '100.0000', offset_account_id: offset.id, memo: null }),
    );
    const postedVc = await t.db.transaction().execute(trx => vc.postVendorCredit(trx, ctx, { vendor_credit_id: c.id }));
    await expect(
      t.db.transaction().execute(trx => vc.applyToBill(trx, ctx, { vendor_credit_id: postedVc.id, bill_id: draftBill.bill.id, applied_amount: '60.0000' })),
    ).rejects.toMatchObject({ code: ERR.OVERAPPLICATION });
  });
});
