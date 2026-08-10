import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeCustomer, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as invoiceSvc from '../../src/services/ar/invoiceService.js';
import * as paymentSvc from '../../src/services/ar/paymentService.js';
import * as rpt from '../../src/services/reports/balanceSheetService.js';
import * as ledger from '../../src/services/core/ledgerService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000004002', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('Balance Sheet report', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('accounting equation holds after a full AR cycle', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const cash = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id','=',biz.id).where('code','=','1020').executeTakeFirstOrThrow();
    const revenue = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id','=',biz.id).where('code','=','4010').executeTakeFirstOrThrow();
    const customer = await makeCustomer(t.db, biz.id, { name: 'Acme' });

    const inv = await t.db.transaction().execute(trx => invoiceSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, invoice_number: 'I-1',
      issue_date: '2026-04-10', due_date: '2026-05-10', memo: null, terms: null,
      lines: [{ description: 'Svc', quantity: '1', unit_price: '500.00', revenue_account_id: revenue.id, tax_code_id: null }],
    }));
    await t.db.transaction().execute(trx => invoiceSvc.postInvoice(trx, ctx, { invoice_id: inv.invoice.id }));

    const pay = await t.db.transaction().execute(trx => paymentSvc.createDraft(trx, ctx, {
      business_id: biz.id, customer_id: customer.id, payment_date: '2026-04-20',
      payment_method: 'check', reference: null, amount: '500.00', cash_account_id: cash.id, memo: null,
      initial_applications: [{ invoice_id: inv.invoice.id, applied_amount: '500.00' }],
    }));
    await t.db.transaction().execute(trx => paymentSvc.postPayment(trx, ctx, { payment_id: pay.payment.id }));

    const bs = await rpt.balanceSheet(t.db, { business_id: biz.id, as_of: '2026-04-30' });
    // Equation: assets = liabilities + equity + net_income_ytd
    const rhs = parseFloat(bs.liabilities_total) + parseFloat(bs.equity_total) + parseFloat(bs.net_income_ytd);
    expect(Math.abs(parseFloat(bs.assets_total) - rhs)).toBeLessThan(0.01);
    // Cash should be +500, Revenue contributes to net_income_ytd = +500
    expect(bs.net_income_ytd).toBe('500.0000');
  });

  it('returns zeros for a fresh business', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    void user;

    const bs = await rpt.balanceSheet(t.db, { business_id: biz.id, as_of: '2026-04-30' });
    expect(bs.assets_total).toBe('0.0000');
    expect(bs.liabilities_total).toBe('0.0000');
    expect(bs.equity_total).toBe('0.0000');
    expect(bs.net_income_ytd).toBe('0.0000');
  });

  it('counts a voided original with its reversal so balances cancel', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedCoa(t.db, biz.id);
    const cash = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '1020').executeTakeFirstOrThrow();
    const revenue = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).where('code', '=', '4010').executeTakeFirstOrThrow();

    const entry = await t.db.transaction().execute(trx => ledger.postJournalEntry(trx, ctx, {
      business_id: biz.id,
      entry_date: '2026-04-10',
      source_type: 'manual',
      memo: 'Entry to void',
      lines: [
        { account_id: cash.id, debit: '125.0000', credit: '0.0000', memo: null },
        { account_id: revenue.id, debit: '0.0000', credit: '125.0000', memo: null },
      ],
    }));
    await t.db.transaction().execute(trx => ledger.voidJournalEntry(trx, ctx, {
      journal_entry_id: entry.id,
      void_reason: 'Correction',
    }));

    const bs = await rpt.balanceSheet(t.db, { business_id: biz.id, as_of: '2026-12-31' });
    expect(bs.asset_lines.find(line => line.account_id === cash.id)).toBeUndefined();
    expect(bs.assets_total).toBe('0.0000');
    expect(bs.net_income_ytd).toBe('0.0000');
  });
});
