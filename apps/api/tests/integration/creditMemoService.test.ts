import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import * as cm from '../../src/services/ar/creditMemoService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000ddd05', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
  await seedYearPeriods(t.db, biz.id, 2026);
  await seedCoa(t.db, biz.id);
  const ar = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '1100').executeTakeFirstOrThrow();
  const returns = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '4910').executeTakeFirstOrThrow();
  const revenue = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '4010').executeTakeFirstOrThrow();
  const customer = await makeCustomer(t.db, biz.id, { name: 'Acme' });
  return { firm, biz, ctx, ar, returns, revenue, customer };
}

describe('creditMemoService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('post creates JE: DR Sales Returns / CR AR', async () => {
    const { biz, ctx, customer, returns, ar } = await setup(t);
    const c = await t.db.transaction().execute(trx =>
      cm.createDraft(trx, ctx, { business_id: biz.id, customer_id: customer.id, memo_date: '2026-04-15', amount: '20.0000', revenue_account_id: returns.id, memo: null }),
    );
    const posted = await t.db.transaction().execute(trx => cm.postCreditMemo(trx, ctx, { credit_memo_id: c.id }));
    expect(posted.status).toBe('posted');
    const lines = await t.db.selectFrom('journal_entry_lines').selectAll().where('journal_entry_id', '=', posted.posted_journal_entry_id!).execute();
    const drLine = lines.find(l => l.account_id === returns.id)!;
    expect(drLine.debit).toBe('20.0000');
    const crLine = lines.find(l => l.account_id === ar.id)!;
    expect(crLine.credit).toBe('20.0000');
  });

  it('apply credit memo to invoice reduces remaining_amount, no JE generated', async () => {
    const { biz, ctx, customer, returns, revenue } = await setup(t);
    const draftInv = await t.db.transaction().execute(trx =>
      invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id,
        invoice_number: 'INV-200', issue_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'X', quantity: '1', unit_price: '50.0000', revenue_account_id: revenue.id, tax_code_id: null }],
      }),
    );
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draftInv.invoice.id }));

    const c = await t.db.transaction().execute(trx =>
      cm.createDraft(trx, ctx, { business_id: biz.id, customer_id: customer.id, memo_date: '2026-04-16', amount: '50.0000', revenue_account_id: returns.id, memo: null }),
    );
    const postedCm = await t.db.transaction().execute(trx => cm.postCreditMemo(trx, ctx, { credit_memo_id: c.id }));

    const jeCountBefore = await t.db.selectFrom('journal_entries').select(({ fn }) => fn.count<string>('id').as('n')).executeTakeFirst();
    await t.db.transaction().execute(trx => cm.applyToInvoice(trx, ctx, { credit_memo_id: postedCm.id, invoice_id: draftInv.invoice.id, applied_amount: '50.0000' }));
    const jeCountAfter = await t.db.selectFrom('journal_entries').select(({ fn }) => fn.count<string>('id').as('n')).executeTakeFirst();
    expect(jeCountAfter!.n).toBe(jeCountBefore!.n);  // no new JE

    const after = await t.db.selectFrom('credit_memos').selectAll().where('id', '=', postedCm.id).executeTakeFirstOrThrow();
    expect(after.remaining_amount).toBe('0.0000');
    expect(after.status).toBe('applied');
    const invAfter = await t.db.selectFrom('invoices').selectAll().where('id', '=', draftInv.invoice.id).executeTakeFirstOrThrow();
    expect(invAfter.status).toBe('paid');
  });

  it('over-application is rejected', async () => {
    const { biz, ctx, customer, returns, revenue } = await setup(t);
    const draftInv = await t.db.transaction().execute(trx =>
      invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id,
        invoice_number: 'INV-201', issue_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'X', quantity: '1', unit_price: '50.0000', revenue_account_id: revenue.id, tax_code_id: null }],
      }),
    );
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draftInv.invoice.id }));
    const c = await t.db.transaction().execute(trx =>
      cm.createDraft(trx, ctx, { business_id: biz.id, customer_id: customer.id, memo_date: '2026-04-16', amount: '100.0000', revenue_account_id: returns.id, memo: null }),
    );
    const postedCm = await t.db.transaction().execute(trx => cm.postCreditMemo(trx, ctx, { credit_memo_id: c.id }));
    await expect(
      t.db.transaction().execute(trx => cm.applyToInvoice(trx, ctx, { credit_memo_id: postedCm.id, invoice_id: draftInv.invoice.id, applied_amount: '60.0000' })),
    ).rejects.toMatchObject({ code: ERR.OVERAPPLICATION });
  });
});
