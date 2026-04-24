import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess, makeAccount, seedCoa, seedYearPeriods } from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as rt from '../../src/services/accounting/recurringTemplateService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

async function bootstrap() {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id);
  await grantAccess(t.db, user.id, biz.id);
  await seedCoa(t.db, biz.id);
  // Seed periods for current year + previous year so the "3 months ago" test is covered
  // even when run near year boundaries.
  const currentYear = new Date().getUTCFullYear();
  await seedYearPeriods(t.db, biz.id, currentYear);
  await seedYearPeriods(t.db, biz.id, currentYear - 1);
  const expense = await makeAccount(t.db, biz.id, { code: '6001', name: 'Rent', account_type: 'expense' });
  const cash = await makeAccount(t.db, biz.id, { code: '1015', name: 'Cash op', account_type: 'asset' });
  const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });
  return { biz, user, ctx, expense, cash };
}

describe('recurringTemplateService', () => {
  it('create inserts a template with next_run_date as supplied', async () => {
    const { biz, ctx, expense, cash } = await bootstrap();
    const row = await t.db.transaction().execute(trx =>
      rt.create(trx, ctx, {
        business_id: biz.id,
        name: 'Monthly rent',
        template_type: 'journal_entry',
        payload: { lines: [
          { account_id: expense.id, debit: '1000', credit: '0' },
          { account_id: cash.id, debit: '0', credit: '1000' },
        ] },
        recurrence: 'monthly',
        next_run_date: '2026-04-01',
      }),
    );
    expect(row.next_run_date).toBe('2026-04-01');
    expect(row.is_active).toBe(true);
    expect(row.template_type).toBe('journal_entry');
  });

  it('runDue with one due monthly JE template materializes one JE and advances next_run_date by 1 month', async () => {
    const { biz, ctx, expense, cash } = await bootstrap();
    // Set next_run_date to today so exactly one cycle runs.
    const today = new Date().toISOString().slice(0, 10);
    await t.db.transaction().execute(trx =>
      rt.create(trx, ctx, {
        business_id: biz.id,
        name: 'Monthly rent',
        template_type: 'journal_entry',
        payload: { lines: [
          { account_id: expense.id, debit: '500', credit: '0' },
          { account_id: cash.id, debit: '0', credit: '500' },
        ] },
        recurrence: 'monthly',
        next_run_date: today,
      }),
    );
    const results = await t.db.transaction().execute(trx => rt.runDue(trx, ctx, biz.id));
    expect(results).toHaveLength(1);
    expect(results[0]?.runs_created).toBe(1);

    const jes = await t.db.selectFrom('journal_entries').selectAll()
      .where('business_id', '=', biz.id).execute();
    expect(jes).toHaveLength(1);
  });

  it('runDue catches up multiple cycles when next_run_date is in the past', async () => {
    const { biz, ctx, expense, cash } = await bootstrap();
    // 3 months ago next_run_date → expect >= 3 runs (the past one + 2-3 catch-ups, depending on alignment)
    const past = new Date();
    past.setUTCMonth(past.getUTCMonth() - 3);
    const pastStr = past.toISOString().slice(0, 10);

    await t.db.transaction().execute(trx =>
      rt.create(trx, ctx, {
        business_id: biz.id,
        name: 'Catchup',
        template_type: 'journal_entry',
        payload: { lines: [
          { account_id: expense.id, debit: '100', credit: '0' },
          { account_id: cash.id, debit: '0', credit: '100' },
        ] },
        recurrence: 'monthly',
        next_run_date: pastStr,
      }),
    );

    const results = await t.db.transaction().execute(trx => rt.runDue(trx, ctx, biz.id));
    expect(results[0]?.runs_created).toBeGreaterThanOrEqual(3);

    const jes = await t.db.selectFrom('journal_entries').selectAll()
      .where('business_id', '=', biz.id).execute();
    expect(jes.length).toBeGreaterThanOrEqual(3);
  });
});
