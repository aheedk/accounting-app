import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeVendor, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as billSvc from '../../src/services/ap/billService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000bbb11', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
  await seedYearPeriods(t.db, biz.id, 2026);
  await seedCoa(t.db, biz.id);
  const ap = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '2010').executeTakeFirstOrThrow();
  const expense = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '5010').executeTakeFirstOrThrow();
  const vendor = await makeVendor(t.db, biz.id, { name: 'Acme Supply' });
  return { firm, biz, user, ctx, ap, expense, vendor };
}

describe('billService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('createDraft creates a bill with computed totals', async () => {
    const { biz, ctx, vendor, expense } = await setup(t);
    const bill = await t.db.transaction().execute(trx =>
      billSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id,
        bill_number: 'BILL-001', bill_date: '2026-04-15', due_date: '2026-05-15',
        memo: 'Office supplies', terms: null,
        lines: [
          { description: 'Printer ink', quantity: '2', unit_price: '50.0000', expense_account_id: expense.id },
          { description: 'Paper', quantity: '5', unit_price: '10.0000', expense_account_id: expense.id },
        ],
      }),
    );
    expect(bill.bill.subtotal).toBe('150.0000');
    expect(bill.bill.total).toBe('150.0000');
    expect(bill.lines).toHaveLength(2);
  });

  it('postBill generates JE: DR Expense / CR AP', async () => {
    const { biz, ctx, vendor, expense, ap } = await setup(t);
    const draft = await t.db.transaction().execute(trx =>
      billSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id,
        bill_number: 'BILL-002', bill_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'Services', quantity: '1', unit_price: '500.0000', expense_account_id: expense.id }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: draft.bill.id }));
    expect(posted.status).toBe('posted');
    expect(posted.posted_journal_entry_id).toBeTruthy();

    const je = await t.db.selectFrom('journal_entries').selectAll().where('id', '=', posted.posted_journal_entry_id!).executeTakeFirstOrThrow();
    expect(je.source_type).toBe('bill');
    expect(je.source_id).toBe(draft.bill.id);

    const lines = await t.db.selectFrom('journal_entry_lines').selectAll()
      .where('journal_entry_id', '=', je.id).orderBy('line_number').execute();
    const expLine = lines.find(l => l.account_id === expense.id)!;
    expect(expLine.debit).toBe('500.0000');
    const apLine = lines.find(l => l.account_id === ap.id)!;
    expect(apLine.credit).toBe('500.0000');

    const audit = await t.db.selectFrom('audit_logs').selectAll().where('action', '=', 'bill.post').execute();
    expect(audit).toHaveLength(1);
  });

  it('postBill rejects empty bill', async () => {
    const { biz, ctx, vendor, expense } = await setup(t);
    const draft = await t.db.transaction().execute(trx =>
      billSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id,
        bill_number: 'BILL-003', bill_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'X', quantity: '1', unit_price: '10', expense_account_id: expense.id }],
      }),
    );
    await t.db.deleteFrom('bill_lines').where('bill_id', '=', draft.bill.id).execute();
    await expect(
      t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: draft.bill.id })),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
  });

  it('postBill rejects already-posted bill', async () => {
    const { biz, ctx, vendor, expense } = await setup(t);
    const draft = await t.db.transaction().execute(trx =>
      billSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id,
        bill_number: 'BILL-004', bill_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'X', quantity: '1', unit_price: '10', expense_account_id: expense.id }],
      }),
    );
    await t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: draft.bill.id }));
    await expect(
      t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: draft.bill.id })),
    ).rejects.toMatchObject({ code: ERR.INVALID_STATE_TRANSITION });
  });

  it('addLine and removeLine work on drafts; refused on posted', async () => {
    const { biz, ctx, vendor, expense } = await setup(t);
    const draft = await t.db.transaction().execute(trx =>
      billSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id,
        bill_number: 'BILL-006', bill_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'A', quantity: '1', unit_price: '10', expense_account_id: expense.id }],
      }),
    );
    const after = await t.db.transaction().execute(trx =>
      billSvc.addLine(trx, ctx, { bill_id: draft.bill.id,
        line: { description: 'B', quantity: '2', unit_price: '5', expense_account_id: expense.id } }),
    );
    expect(after.lines).toHaveLength(2);
    expect(after.bill.subtotal).toBe('20.0000');

    await t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: draft.bill.id }));
    await expect(
      t.db.transaction().execute(trx =>
        billSvc.addLine(trx, ctx, { bill_id: draft.bill.id,
          line: { description: 'C', quantity: '1', unit_price: '1', expense_account_id: expense.id } }),
      ),
    ).rejects.toMatchObject({ code: ERR.INVALID_STATE_TRANSITION });
  });

  it('voidBill creates reversing JE and flips bill to voided', async () => {
    const { biz, ctx, vendor, expense } = await setup(t);
    const draft = await t.db.transaction().execute(trx =>
      billSvc.createDraft(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id,
        bill_number: 'BILL-005', bill_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'X', quantity: '1', unit_price: '50.0000', expense_account_id: expense.id }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => billSvc.postBill(trx, ctx, { bill_id: draft.bill.id }));
    await t.db.transaction().execute(trx => billSvc.voidBill(trx, ctx, { bill_id: posted.id, void_reason: 'data entry error' }));
    const after = await t.db.selectFrom('bills').selectAll().where('id', '=', posted.id).executeTakeFirstOrThrow();
    expect(after.status).toBe('voided');
    const jes = await t.db.selectFrom('journal_entries').selectAll()
      .where('source_id', '=', posted.posted_journal_entry_id!).execute();
    const reversal = jes.find(j => j.source_type === 'reversal');
    expect(reversal).toBeTruthy();
  });
});
