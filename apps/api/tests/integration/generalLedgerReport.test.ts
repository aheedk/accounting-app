import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERR } from '@accounting/shared';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeAccount, makeBusiness, makeFirm, makeUser, seedYearPeriods } from '../helpers/factories.js';
import * as ledger from '../../src/services/core/ledgerService.js';
import * as reportService from '../../src/services/reports/generalLedgerService.js';
import { BusinessRuleError } from '../../src/lib/errors.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = {
  request_id: '00000000-0000-0000-0000-00000000a001',
  ip_address: '127.0.0.1',
  user_agent: 'vitest',
};

describe('general ledger report', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  async function setup() {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = {
      user_id: user.id,
      firm_id: firm.id,
      business_id: biz.id,
      effective_role: 'accountant',
      ...meta,
    };
    await seedYearPeriods(t.db, biz.id, 2026);
    const cash = await makeAccount(t.db, biz.id, { code: '1010', name: 'Cash', account_type: 'asset' });
    const revenue = await makeAccount(t.db, biz.id, { code: '4010', name: 'Revenue', account_type: 'revenue' });
    const expense = await makeAccount(t.db, biz.id, { code: '6010', name: 'Expense', account_type: 'expense' });
    return { firm, biz, ctx, cash, revenue, expense };
  }

  it('computes opening, period totals, and natural running balances by account', async () => {
    const { biz, ctx, cash, revenue, expense } = await setup();
    await t.db.transaction().execute(trx => ledger.postJournalEntry(trx, ctx, {
      business_id: biz.id,
      entry_date: '2026-01-15',
      source_type: 'manual',
      memo: 'Opening activity',
      lines: [
        { account_id: cash.id, debit: '100.0000', credit: '0.0000', memo: null },
        { account_id: revenue.id, debit: '0.0000', credit: '100.0000', memo: null },
      ],
    }));
    await t.db.transaction().execute(trx => ledger.postJournalEntry(trx, ctx, {
      business_id: biz.id,
      entry_date: '2026-03-05',
      source_type: 'manual',
      memo: 'March sale',
      reference: 'GL-001',
      lines: [
        { account_id: cash.id, debit: '50.0000', credit: '0.0000', memo: 'Cash received' },
        { account_id: revenue.id, debit: '0.0000', credit: '50.0000', memo: null },
      ],
    }));
    await t.db.transaction().execute(trx => ledger.postJournalEntry(trx, ctx, {
      business_id: biz.id,
      entry_date: '2026-03-20',
      source_type: 'manual',
      memo: 'March expense',
      lines: [
        { account_id: expense.id, debit: '20.0000', credit: '0.0000', memo: null },
        { account_id: cash.id, debit: '0.0000', credit: '20.0000', memo: null },
      ],
    }));

    const report = await reportService.generalLedger(t.db, {
      business_id: biz.id,
      period_start: '2026-03-01',
      period_end: '2026-03-31',
    });

    expect(report.totals).toEqual({ total_debit: '70.0000', total_credit: '70.0000' });
    const cashAccount = report.accounts.find(account => account.account_id === cash.id)!;
    expect(cashAccount.beginning_balance).toBe('100.0000');
    expect(cashAccount.total_debit).toBe('50.0000');
    expect(cashAccount.total_credit).toBe('20.0000');
    expect(cashAccount.lines.map(line => line.running_balance)).toEqual(['150.0000', '130.0000']);
    expect(cashAccount.ending_balance).toBe('130.0000');
    expect(cashAccount.lines[0]).toMatchObject({ reference: 'GL-001', memo: 'Cash received' });

    const revenueAccount = report.accounts.find(account => account.account_id === revenue.id)!;
    expect(revenueAccount.normal_balance).toBe('credit');
    expect(revenueAccount.beginning_balance).toBe('100.0000');
    expect(revenueAccount.ending_balance).toBe('150.0000');
  });

  it('filters to one tenant-owned account and rejects an account from another business', async () => {
    const { firm, biz, cash } = await setup();
    const otherBusiness = await makeBusiness(t.db, firm.id, 'Other Business');
    const otherAccount = await makeAccount(t.db, otherBusiness.id, { code: '1010', name: 'Other Cash' });

    const filtered = await reportService.generalLedger(t.db, {
      business_id: biz.id,
      period_start: '2026-01-01',
      period_end: '2026-12-31',
      account_id: cash.id,
    });
    expect(filtered.accounts).toHaveLength(1);
    expect(filtered.accounts[0]!.account_id).toBe(cash.id);

    await expect(reportService.generalLedger(t.db, {
      business_id: biz.id,
      period_start: '2026-01-01',
      period_end: '2026-12-31',
      account_id: otherAccount.id,
    })).rejects.toMatchObject<Partial<BusinessRuleError>>({ code: ERR.NOT_FOUND });
  });

  it('includes voided originals with their reversals so the ending balance cancels to zero', async () => {
    const { biz, ctx, cash, revenue } = await setup();
    const entry = await t.db.transaction().execute(trx => ledger.postJournalEntry(trx, ctx, {
      business_id: biz.id,
      entry_date: '2026-02-01',
      source_type: 'manual',
      memo: 'Entry to void',
      lines: [
        { account_id: cash.id, debit: '75.0000', credit: '0.0000', memo: null },
        { account_id: revenue.id, debit: '0.0000', credit: '75.0000', memo: null },
      ],
    }));
    await t.db.transaction().execute(trx => ledger.voidJournalEntry(trx, ctx, {
      journal_entry_id: entry.id,
      void_reason: 'Test correction',
    }));

    const report = await reportService.generalLedger(t.db, {
      business_id: biz.id,
      period_start: '2026-01-01',
      period_end: '2026-12-31',
      account_id: cash.id,
    });
    expect(report.accounts[0]!.lines).toHaveLength(2);
    expect(report.accounts[0]!.lines.map(line => line.status)).toContain('voided');
    expect(report.accounts[0]!.ending_balance).toBe('0.0000');
  });
});
