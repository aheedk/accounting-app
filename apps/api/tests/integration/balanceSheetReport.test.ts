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

  // Found by the report tie-out on 2026-10-07: nothing carried a finished year's
  // profit into Retained Earnings, so every balance sheet went out of balance on
  // the first day of the next year.
  it('carries earlier years into Retained Earnings, so it still balances after year end', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    await seedYearPeriods(t.db, biz.id, 2027);
    await seedCoa(t.db, biz.id);
    const account = (code: string) => t.db.selectFrom('chart_of_accounts').selectAll()
      .where('business_id', '=', biz.id).where('code', '=', code).executeTakeFirstOrThrow();
    const [cash, revenue, retained] = await Promise.all([account('1020'), account('4010'), account('3020')]);
    const earn = (entry_date: string, amount: string) => t.db.transaction().execute(trx => ledger.postJournalEntry(trx, ctx, {
      business_id: biz.id, entry_date, source_type: 'manual', memo: 'Sale',
      lines: [
        { account_id: cash.id, debit: amount, credit: '0.0000', memo: null },
        { account_id: revenue.id, debit: '0.0000', credit: amount, memo: null },
      ],
    }));
    await earn('2026-06-15', '1000.0000');
    await earn('2027-02-10', '300.0000');

    const during = await rpt.balanceSheet(t.db, { business_id: biz.id, as_of: '2026-12-31' });
    expect(during).toMatchObject({ net_income_ytd: '1000.0000', retained_earnings_prior_years: '0.0000', in_balance: true });

    const after = await rpt.balanceSheet(t.db, { business_id: biz.id, as_of: '2027-03-31' });
    expect(after).toMatchObject({
      assets_total: '1300.0000', net_income_ytd: '300.0000', fiscal_year_start: '2027-01-01',
      retained_earnings_prior_years: '1000.0000', liabilities_equity_total: '1300.0000', in_balance: true,
    });
    expect(after.equity_lines.find(line => line.account_id === retained.id)?.amount).toBe('1000.0000');

    // A July fiscal year: June's sale is already a finished year by August.
    await t.db.updateTable('businesses').set({ fiscal_year_start_month: 7 }).where('id', '=', biz.id).execute();
    const fiscal = await rpt.balanceSheet(t.db, { business_id: biz.id, as_of: '2026-08-31' });
    expect(fiscal).toMatchObject({
      fiscal_year_start: '2026-07-01', net_income_ytd: '0.0000', retained_earnings_prior_years: '1000.0000', in_balance: true,
    });
    expect(rpt.fiscalYearStart('2026-03-15', 7)).toBe('2025-07-01');
    expect(rpt.fiscalYearStart('2026-07-01', 7)).toBe('2026-07-01');
    expect(rpt.fiscalYearStart('2026-03-15', 1)).toBe('2026-01-01');
  });
});
