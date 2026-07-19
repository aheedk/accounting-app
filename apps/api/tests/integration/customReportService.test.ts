import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import {
  makeFirm,
  makeBusiness,
  makeUser,
  grantAccess,
  makeAccount,
  seedCoa,
  seedYearPeriods,
} from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import { postJournalEntry } from '../../src/services/core/ledgerService.js';
import * as cr from '../../src/services/reports/customReportService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

describe('customReportService', () => {
  it('createReport + getReport roundtrips the definition', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id);
    await grantAccess(t.db, user.id, biz.id);
    const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });

    const def = {
      account_ids: [],
      date_range: { from: '2026-01-01', to: '2026-12-31' },
      group_by: 'account' as const,
      columns: ['debit', 'credit', 'net'] as const,
    };
    const created = await t.db.transaction().execute(trx =>
      cr.createReport(trx, ctx, { business_id: biz.id, name: 'My Report', definition: def }),
    );
    const fetched = await cr.getReport(t.db, biz.id, created.id);
    expect(fetched.name).toBe('My Report');
    expect((fetched.definition as Record<string, unknown>).group_by).toBe('account');
  });

  it('runReport on empty business returns empty rows', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id);
    await grantAccess(t.db, user.id, biz.id);
    await seedCoa(t.db, biz.id);
    await seedYearPeriods(t.db, biz.id, 2026);

    const rows = await cr.runReport(t.db, biz.id, {
      account_ids: [],
      date_range: { from: '2026-01-01', to: '2026-12-31' },
      group_by: 'account',
      columns: ['debit', 'credit', 'net'],
    });
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(0);
  });

  async function bootstrapWithActivity() {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id);
    await grantAccess(t.db, user.id, biz.id);
    await seedCoa(t.db, biz.id);
    await seedYearPeriods(t.db, biz.id, 2026);
    const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });
    const rent = await makeAccount(t.db, biz.id, { code: '6301', name: 'Rent expense', account_type: 'expense' });
    const utilities = await makeAccount(t.db, biz.id, { code: '6302', name: 'Utilities expense', account_type: 'expense' });
    const cash = await makeAccount(t.db, biz.id, { code: '1031', name: 'Operating cash', account_type: 'asset' });
    await t.db.transaction().execute(trx => postJournalEntry(trx, ctx, {
      business_id: biz.id,
      entry_date: '2026-03-10',
      source_type: 'manual',
      memo: 'Rent',
      lines: [
        { account_id: rent.id, debit: '900.0000', credit: '0.0000', memo: null },
        { account_id: cash.id, debit: '0.0000', credit: '900.0000', memo: null },
      ],
    }));
    await t.db.transaction().execute(trx => postJournalEntry(trx, ctx, {
      business_id: biz.id,
      entry_date: '2026-04-05',
      source_type: 'manual',
      memo: 'Utilities',
      lines: [
        { account_id: utilities.id, debit: '150.0000', credit: '0.0000', memo: null },
        { account_id: cash.id, debit: '0.0000', credit: '150.0000', memo: null },
      ],
    }));
    const RANGE = { from: '2026-01-01', to: '2026-12-31' };
    return { biz, ctx, rent, utilities, cash, RANGE };
  }

  it('saved report lifecycle: create, run, update, delete', async () => {
    const { biz, ctx, RANGE } = await bootstrapWithActivity();
    const created = await t.db.transaction().execute(trx =>
      cr.createReport(trx, ctx, {
        business_id: biz.id,
        name: 'Expense review',
        definition: { account_ids: [], date_range: RANGE, group_by: 'account', columns: ['debit', 'credit', 'net'] },
      }),
    );

    const saved = await cr.getReport(t.db, biz.id, created.id);
    const rows = await cr.runReport(t.db, biz.id, saved.definition as cr.CustomReportDefinition);
    expect(rows.length).toBe(3); // rent, utilities, cash

    const renamed = await t.db.transaction().execute(trx =>
      cr.updateReport(trx, ctx, { report_id: created.id, patch: { name: 'Expense review v2' } }),
    );
    expect(renamed.name).toBe('Expense review v2');

    await t.db.transaction().execute(trx =>
      cr.deleteReport(trx, ctx, { report_id: created.id }),
    );
    const remaining = await cr.listReports(t.db, biz.id);
    expect(remaining).toHaveLength(0);
  });

  it('account filter: all accounts vs one account vs an account-type group', async () => {
    const { biz, rent, RANGE } = await bootstrapWithActivity();
    const base = { date_range: RANGE, group_by: 'account' as const, columns: ['debit', 'credit', 'net'] as ('debit' | 'credit' | 'net')[] };

    const all = await cr.runReport(t.db, biz.id, { ...base, account_ids: [] });
    expect(all.length).toBe(3);
    const cashRow = all.find(r => r.group_key.includes('Operating cash'));
    expect(Number(cashRow?.credit)).toBe(1050);

    const single = await cr.runReport(t.db, biz.id, { ...base, account_ids: [rent.id] });
    expect(single.length).toBe(1);
    expect(single[0]?.group_key).toContain('Rent expense');
    expect(Number(single[0]?.debit)).toBe(900);

    // Account-type group selection resolves to all ids of that type (the web
    // picker expands groups client-side into account_ids).
    const expenseIds = await t.db.selectFrom('chart_of_accounts').select('id')
      .where('business_id', '=', biz.id).where('account_type', '=', 'expense').execute();
    const group = await cr.runReport(t.db, biz.id, { ...base, account_ids: expenseIds.map(r => r.id) });
    expect(group.length).toBe(2);
    expect(group.map(r => r.group_key).join(' ')).toContain('Utilities expense');
    const totalDebit = group.reduce((s, r) => s + Number(r.debit), 0);
    expect(totalDebit).toBe(1050);
  });

  it('group_by month buckets rows by entry month', async () => {
    const { biz, RANGE } = await bootstrapWithActivity();
    const rows = await cr.runReport(t.db, biz.id, {
      account_ids: [],
      date_range: RANGE,
      group_by: 'month',
      columns: ['debit', 'credit', 'net'],
    });
    expect(rows.map(r => r.group_key)).toEqual(['2026-03', '2026-04']);
    expect(Number(rows[0]?.debit)).toBe(900);
    expect(Number(rows[1]?.debit)).toBe(150);
  });
});
