import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeAccount, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import * as ledger from '../../src/services/core/ledgerService.js';
import { balanceSheet } from '../../src/services/reports/balanceSheetService.js';
import { generalLedger } from '../../src/services/reports/generalLedgerService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-00000000ffff', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('trial balance', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('reflects posted JEs only; debits equal credits in totals', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedYearPeriods(t.db, biz.id, 2026);
    const cash = await makeAccount(t.db, biz.id, { code: '1010', account_type: 'asset' });
    const rev = await makeAccount(t.db, biz.id, { code: '4010', account_type: 'revenue' });
    await t.db.transaction().execute(trx =>
      ledger.postJournalEntry(trx, ctx, {
        business_id: biz.id, entry_date: '2026-04-15', source_type: 'manual', memo: null,
        lines: [
          { account_id: cash.id, debit: '500.0000', credit: '0.0000',  memo: null },
          { account_id: rev.id,  debit: '0.0000',   credit: '500.0000', memo: null },
        ],
      }),
    );
    const tb = await ledger.computeTrialBalance(t.db, { business_id: biz.id, as_of: '2026-12-31' });
    expect(tb.totals.total_debit).toBe('500.0000');
    expect(tb.totals.total_credit).toBe('500.0000');
    const cashRow = tb.rows.find(r => r.code === '1010')!;
    expect(cashRow.net).toBe('500.0000');
  });

  // 10-10 meeting, item 37: at year end the net income has to be in Retained
  // Earnings. Nothing is posted for it (as in QuickBooks), so every report that
  // shows a balance has to make the year end itself, and they have to agree.
  describe('year end', () => {
    async function twoYears() {
      const firm = await makeFirm(t.db);
      const biz = await makeBusiness(t.db, firm.id);
      const user = await makeUser(t.db, firm.id, { role: 'accountant' });
      const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
      await seedYearPeriods(t.db, biz.id, 2026);
      await seedYearPeriods(t.db, biz.id, 2027);
      await seedCoa(t.db, biz.id);
      const account = (code: string) => t.db.selectFrom('chart_of_accounts').selectAll()
        .where('business_id', '=', biz.id).where('code', '=', code).executeTakeFirstOrThrow();
      const [cash, revenue, expense, retained] = await Promise.all([account('1020'), account('4010'), account('5200'), account('3020')]);
      const post = (entry_date: string, debit: string, credit: string, amount: string) =>
        t.db.transaction().execute(trx => ledger.postJournalEntry(trx, ctx, {
          business_id: biz.id, entry_date, source_type: 'manual', memo: null,
          lines: [
            { account_id: debit, debit: amount, credit: '0.0000', memo: null },
            { account_id: credit, debit: '0.0000', credit: amount, memo: null },
          ],
        }));
      await post('2026-06-15', cash.id, revenue.id, '1000.0000');    // 2026: 1,000 of sales
      await post('2026-09-01', expense.id, cash.id, '400.0000');     //       400 of expenses, so 600 of profit
      await post('2027-02-10', cash.id, revenue.id, '300.0000');     // 2027: 300 of sales so far
      return { biz, cash, revenue, expense, retained, post };
    }
    const row = (tb: Awaited<ReturnType<typeof ledger.computeTrialBalance>>, id: string) => {
      const found = tb.rows.find(r => r.account_id === id)!;
      return [found.total_debit, found.total_credit];
    };

    it('leaves the year in progress alone', async () => {
      const { biz, revenue, expense, retained } = await twoYears();
      const tb = await ledger.computeTrialBalance(t.db, { business_id: biz.id, as_of: '2026-12-31' });
      expect(tb).toMatchObject({ fiscal_year_start: '2026-01-01', retained_earnings_prior_years: '0.0000' });
      expect(row(tb, revenue.id)).toEqual(['0.0000', '1000.0000']);
      expect(row(tb, expense.id)).toEqual(['400.0000', '0.0000']);
      expect(row(tb, retained.id)).toEqual(['0.0000', '0.0000']);
      expect(tb.totals).toEqual({ total_debit: '1400.0000', total_credit: '1400.0000' });
    });

    it('starts income and expense at zero in the new year and puts the profit in Retained Earnings', async () => {
      const { biz, cash, revenue, expense, retained } = await twoYears();
      const tb = await ledger.computeTrialBalance(t.db, { business_id: biz.id, as_of: '2027-03-31' });
      expect(tb).toMatchObject({ fiscal_year_start: '2027-01-01', retained_earnings_prior_years: '600.0000' });
      expect(row(tb, revenue.id)).toEqual(['0.0000', '300.0000']);      // this year's sales only
      expect(row(tb, expense.id)).toEqual(['0.0000', '0.0000']);
      expect(row(tb, retained.id)).toEqual(['0.0000', '600.0000']);     // last year's profit
      expect(row(tb, cash.id)).toEqual(['1300.0000', '400.0000']);      // balance sheet accounts carry on
      expect(tb.totals.total_debit).toBe(tb.totals.total_credit);

      // The same Retained Earnings as the Balance Sheet.
      const bs = await balanceSheet(t.db, { business_id: biz.id, as_of: '2027-03-31' });
      expect(bs.equity_lines.find(line => line.account_id === retained.id)?.amount).toBe('600.0000');
      expect(bs.in_balance).toBe(true);

      // And the General Ledger opens the new year the same way.
      const gl = await generalLedger(t.db, { business_id: biz.id, period_start: '2027-01-01', period_end: '2027-03-31' });
      const opened = (id: string) => gl.accounts.find(a => a.account_id === id);
      expect(opened(retained.id)).toMatchObject({ beginning_balance: '600.0000', ending_balance: '600.0000' });
      expect(opened(revenue.id)).toMatchObject({ beginning_balance: '0.0000', ending_balance: '300.0000' });
      expect(opened(expense.id)).toBeUndefined();                        // nothing this year, nothing carried
      expect(opened(cash.id)).toMatchObject({ beginning_balance: '600.0000', ending_balance: '900.0000' });
    });

    it('follows a fiscal year that does not start in January', async () => {
      const { biz, revenue, expense, retained } = await twoYears();
      // July to June: by August 2026 the June sale is a finished year; the September expense is not.
      await t.db.updateTable('businesses').set({ fiscal_year_start_month: 7 }).where('id', '=', biz.id).execute();
      const august = await ledger.computeTrialBalance(t.db, { business_id: biz.id, as_of: '2026-08-31' });
      expect(august).toMatchObject({ fiscal_year_start: '2026-07-01', retained_earnings_prior_years: '1000.0000' });
      expect(row(august, revenue.id)).toEqual(['0.0000', '0.0000']);
      expect(row(august, retained.id)).toEqual(['0.0000', '1000.0000']);

      // A general ledger that opens mid-year carries the year so far, not all time.
      const gl = await generalLedger(t.db, { business_id: biz.id, period_start: '2027-03-01', period_end: '2027-03-31' });
      expect(gl.accounts.find(a => a.account_id === expense.id)?.beginning_balance).toBe('400.0000');
      expect(gl.accounts.find(a => a.account_id === revenue.id)?.beginning_balance).toBe('300.0000');
      expect(gl.accounts.find(a => a.account_id === retained.id)?.beginning_balance).toBe('1000.0000');
    });

    it('puts a year that lost money on the debit side of Retained Earnings', async () => {
      const { biz, cash, expense, retained, post } = await twoYears();
      await post('2026-11-20', expense.id, cash.id, '900.0000');     // 2026 now ends 300 down
      const tb = await ledger.computeTrialBalance(t.db, { business_id: biz.id, as_of: '2027-03-31' });
      expect(tb.retained_earnings_prior_years).toBe('-300.0000');
      expect(row(tb, retained.id)).toEqual(['300.0000', '0.0000']);
      expect(tb.totals.total_debit).toBe(tb.totals.total_credit);
    });
  });
});
