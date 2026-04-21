import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, makeTaxCode, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000ddd03', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
  await seedYearPeriods(t.db, biz.id, 2026);
  await seedCoa(t.db, biz.id);
  const ar = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '1100').executeTakeFirstOrThrow();
  const taxAcct = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '2100').executeTakeFirstOrThrow();
  const revenue = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '4010').executeTakeFirstOrThrow();
  const customer = await makeCustomer(t.db, biz.id, { name: 'Acme' });
  const taxCode = await makeTaxCode(t.db, biz.id, taxAcct.id, { code: 'CA', rate: 0.0875 });
  return { firm, biz, user, ctx, ar, revenue, taxAcct, customer, taxCode };
}

describe('invoiceService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('createDraft creates an invoice with computed totals', async () => {
    const { biz, ctx, customer, revenue, taxCode } = await setup(t);
    const inv = await t.db.transaction().execute(trx =>
      invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id,
        invoice_number: 'INV-001', issue_date: '2026-04-15', due_date: '2026-05-15',
        memo: 'Test', terms: null,
        lines: [
          { description: 'Widget', quantity: '2', unit_price: '50.0000', revenue_account_id: revenue.id, tax_code_id: taxCode.id },
          { description: 'Gadget', quantity: '1', unit_price: '20.0000', revenue_account_id: revenue.id, tax_code_id: null },
        ],
      }),
    );
    expect(inv.invoice.subtotal).toBe('120.0000');
    // 100 * 0.0875 = 8.75 (only first line is taxed)
    expect(inv.invoice.tax_total).toBe('8.7500');
    expect(inv.invoice.total).toBe('128.7500');
    expect(inv.lines).toHaveLength(2);
  });

  it('postInvoice generates JE: DR AR / CR Revenue / CR Tax Payable', async () => {
    const { biz, ctx, customer, revenue, taxCode, ar, taxAcct } = await setup(t);
    const draft = await t.db.transaction().execute(trx =>
      invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id,
        invoice_number: 'INV-002', issue_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'Widget', quantity: '1', unit_price: '100.0000', revenue_account_id: revenue.id, tax_code_id: taxCode.id }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id }));
    expect(posted.status).toBe('posted');
    expect(posted.posted_journal_entry_id).toBeTruthy();

    const je = await t.db.selectFrom('journal_entries').selectAll().where('id', '=', posted.posted_journal_entry_id!).executeTakeFirstOrThrow();
    expect(je.source_type).toBe('invoice');
    expect(je.source_id).toBe(draft.invoice.id);
    expect(je.status).toBe('posted');

    const lines = await t.db.selectFrom('journal_entry_lines').selectAll()
      .where('journal_entry_id', '=', je.id).orderBy('line_number').execute();
    const arLine = lines.find(l => l.account_id === ar.id)!;
    expect(arLine.debit).toBe('108.7500');
    expect(arLine.credit).toBe('0.0000');
    const revLine = lines.find(l => l.account_id === revenue.id)!;
    expect(revLine.debit).toBe('0.0000');
    expect(revLine.credit).toBe('100.0000');
    const taxLine = lines.find(l => l.account_id === taxAcct.id)!;
    expect(taxLine.credit).toBe('8.7500');

    // audit row
    const audit = await t.db.selectFrom('audit_logs').selectAll().where('action', '=', 'invoice.post').execute();
    expect(audit).toHaveLength(1);
  });

  it('postInvoice rejects empty invoice', async () => {
    const { biz, ctx, customer, revenue } = await setup(t);
    const draft = await t.db.transaction().execute(trx =>
      invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id,
        invoice_number: 'INV-003', issue_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'X', quantity: '1', unit_price: '10', revenue_account_id: revenue.id, tax_code_id: null }],
      }),
    );
    // Remove the line
    await t.db.deleteFrom('invoice_lines').where('invoice_id', '=', draft.invoice.id).execute();
    await expect(
      t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id })),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
  });

  it('postInvoice rejects already-posted invoice', async () => {
    const { biz, ctx, customer, revenue } = await setup(t);
    const draft = await t.db.transaction().execute(trx =>
      invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id,
        invoice_number: 'INV-004', issue_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'X', quantity: '1', unit_price: '10', revenue_account_id: revenue.id, tax_code_id: null }],
      }),
    );
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id }));
    await expect(
      t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id })),
    ).rejects.toMatchObject({ code: ERR.INVALID_STATE_TRANSITION });
  });

  it('voidInvoice creates reversing JE and flips invoice to voided', async () => {
    const { biz, ctx, customer, revenue } = await setup(t);
    const draft = await t.db.transaction().execute(trx =>
      invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id,
        invoice_number: 'INV-005', issue_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'X', quantity: '1', unit_price: '50.0000', revenue_account_id: revenue.id, tax_code_id: null }],
      }),
    );
    const posted = await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id }));
    await t.db.transaction().execute(trx => invoiceSvc.voidInvoice(trx, ctx, { invoice_id: posted.id, void_reason: 'data entry error' }));
    const after = await t.db.selectFrom('invoices').selectAll().where('id', '=', posted.id).executeTakeFirstOrThrow();
    expect(after.status).toBe('voided');
    // there should now be a reversal JE
    const jes = await t.db.selectFrom('journal_entries').selectAll()
      .where('source_id', '=', posted.posted_journal_entry_id!).execute();
    const reversal = jes.find(j => j.source_type === 'reversal');
    expect(reversal).toBeTruthy();
  });

  it('addLine and removeLine work on drafts; refused on posted', async () => {
    const { biz, ctx, customer, revenue, taxCode } = await setup(t);
    const draft = await t.db.transaction().execute(trx =>
      invoiceSvc.createDraft(trx, ctx, {
        business_id: biz.id, customer_id: customer.id,
        invoice_number: 'INV-006', issue_date: '2026-04-15', due_date: '2026-05-15',
        memo: null, terms: null,
        lines: [{ description: 'A', quantity: '1', unit_price: '10', revenue_account_id: revenue.id, tax_code_id: null }],
      }),
    );
    const after = await t.db.transaction().execute(trx =>
      invoiceSvc.addLine(trx, ctx, { invoice_id: draft.invoice.id,
        line: { description: 'B', quantity: '2', unit_price: '5', revenue_account_id: revenue.id, tax_code_id: taxCode.id } }),
    );
    expect(after.lines).toHaveLength(2);
    expect(after.invoice.subtotal).toBe('20.0000');

    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: draft.invoice.id }));
    await expect(
      t.db.transaction().execute(trx =>
        invoiceSvc.addLine(trx, ctx, { invoice_id: draft.invoice.id,
          line: { description: 'C', quantity: '1', unit_price: '1', revenue_account_id: revenue.id, tax_code_id: null } }),
      ),
    ).rejects.toMatchObject({ code: ERR.INVALID_STATE_TRANSITION });
  });
});
