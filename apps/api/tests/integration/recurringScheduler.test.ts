import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess, makeAccount, seedCoa, seedYearPeriods } from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as rt from '../../src/services/accounting/recurringTemplateService.js';
import { materializeAllDue } from '../../src/jobs/recurringScheduler.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

async function bizWithDueTemplate(firmId: string, name: string) {
  const biz = await makeBusiness(t.db, firmId, name);
  const user = await makeUser(t.db, firmId);
  await grantAccess(t.db, user.id, biz.id);
  await seedCoa(t.db, biz.id);
  await seedYearPeriods(t.db, biz.id, new Date().getUTCFullYear());
  const expense = await makeAccount(t.db, biz.id, { code: '6001', name: 'Rent', account_type: 'expense' });
  const cash = await makeAccount(t.db, biz.id, { code: '1015', name: 'Cash op', account_type: 'asset' });
  const ctx = systemCtx({ firm_id: firmId, business_id: biz.id, user_id: user.id });
  const today = new Date().toISOString().slice(0, 10);
  const template = await t.db.transaction().execute(trx =>
    rt.create(trx, ctx, {
      business_id: biz.id,
      name: `${name} rent`,
      template_type: 'journal_entry',
      payload: { lines: [
        { account_id: expense.id, debit: '100', credit: '0' },
        { account_id: cash.id, debit: '0', credit: '100' },
      ] },
      recurrence: 'monthly',
      next_run_date: today,
    }),
  );
  return { biz, user, ctx, template };
}

describe('recurringScheduler.materializeAllDue', () => {
  it('materializes due templates across all businesses without a request ctx', async () => {
    const firm = await makeFirm(t.db);
    const a = await bizWithDueTemplate(firm.id, 'Biz A');
    const b = await bizWithDueTemplate(firm.id, 'Biz B');

    const result = await materializeAllDue(t.db);
    expect(result.processed).toBe(2);
    expect(result.failed).toBe(0);

    for (const biz of [a.biz, b.biz]) {
      const jes = await t.db.selectFrom('journal_entries').selectAll()
        .where('business_id', '=', biz.id).execute();
      expect(jes).toHaveLength(1);
    }
  });

  it('a broken template fails alone without blocking the others', async () => {
    const firm = await makeFirm(t.db);
    const good = await bizWithDueTemplate(firm.id, 'Good Biz');
    // Insert a structurally-broken payload directly (bypasses create validation).
    const today = new Date().toISOString().slice(0, 10);
    await t.db.insertInto('recurring_templates').values({
      business_id: good.biz.id,
      name: 'Broken template',
      template_type: 'journal_entry',
      payload: JSON.stringify({ lines: [] }),
      recurrence: 'monthly',
      next_run_date: today,
      created_by_user_id: good.user.id,
    }).execute();

    const result = await materializeAllDue(t.db);
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);

    const jes = await t.db.selectFrom('journal_entries').selectAll()
      .where('business_id', '=', good.biz.id).execute();
    expect(jes).toHaveLength(1);
  });
});

describe('recurringTemplateService.runDueForBusiness', () => {
  it('reports per-template errors while still materializing the good ones', async () => {
    const firm = await makeFirm(t.db);
    const good = await bizWithDueTemplate(firm.id, 'Partial Biz');
    const today = new Date().toISOString().slice(0, 10);
    await t.db.insertInto('recurring_templates').values({
      business_id: good.biz.id,
      name: 'Broken sibling',
      template_type: 'journal_entry',
      payload: JSON.stringify({ nonsense: true }),
      recurrence: 'monthly',
      next_run_date: today,
      created_by_user_id: good.user.id,
    }).execute();

    const results = await rt.runDueForBusiness(t.db, good.ctx, good.biz.id);
    expect(results).toHaveLength(2);
    const ok = results.find(r => r.template_id === good.template.id);
    const bad = results.find(r => r.template_id !== good.template.id);
    expect(ok?.runs_created).toBe(1);
    expect(ok?.error).toBeUndefined();
    expect(bad?.runs_created).toBe(0);
    expect(bad?.error).toMatch(/invalid recurring/);

    const jes = await t.db.selectFrom('journal_entries').selectAll()
      .where('business_id', '=', good.biz.id).execute();
    expect(jes).toHaveLength(1);
  });
});
