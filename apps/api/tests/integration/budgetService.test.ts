import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess, makeAccount } from '../helpers/factories.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';
import * as budgetSvc from '../../src/services/reports/budgetService.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000bd701', ip_address: '127.0.0.1', user_agent: 'vitest' };

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

async function setup() {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id, { role: 'accountant' });
  await grantAccess(t.db, user.id, biz.id);
  const ctx: ServiceCtx = {
    user_id: user.id,
    firm_id: firm.id,
    business_id: biz.id,
    effective_role: 'accountant',
    ...meta,
  };
  return { firm, biz, user, ctx };
}

describe('budgetService', () => {
  it('createBudget + setBudgetLine upserts a single cell', async () => {
    const { biz, ctx } = await setup();
    const acct = await makeAccount(t.db, biz.id, { code: '6000', name: 'Marketing', account_type: 'expense' });

    const budget = await t.db.transaction().execute(trx =>
      budgetSvc.createBudget(trx, ctx, { business_id: biz.id, name: 'FY26 Plan', fiscal_year: 2026 }),
    );
    expect(budget.name).toBe('FY26 Plan');
    expect(budget.fiscal_year).toBe(2026);
    expect(budget.status).toBe('draft');

    await t.db.transaction().execute(trx =>
      budgetSvc.setBudgetLine(trx, ctx, {
        budget_id: budget.id, account_id: acct.id, month_offset: 0, amount: '1000',
      }),
    );

    const after1 = await t.db.selectFrom('budget_lines').selectAll()
      .where('budget_id', '=', budget.id).execute();
    expect(after1).toHaveLength(1);
    expect(after1[0]!.amount).toBe('1000.0000');

    // Re-set the same cell to a new amount → upsert (no duplicate row).
    await t.db.transaction().execute(trx =>
      budgetSvc.setBudgetLine(trx, ctx, {
        budget_id: budget.id, account_id: acct.id, month_offset: 0, amount: '1500',
      }),
    );

    const after2 = await t.db.selectFrom('budget_lines').selectAll()
      .where('budget_id', '=', budget.id).execute();
    expect(after2).toHaveLength(1);
    expect(after2[0]!.amount).toBe('1500.0000');
    expect(after2[0]!.id).toBe(after1[0]!.id); // same row was updated, not replaced
  });

  it('getVarianceReport on a budget with one line + zero actuals returns the budgeted amount with variance equal to negative budget', async () => {
    const { biz, ctx } = await setup();
    const acct = await makeAccount(t.db, biz.id, { code: '6100', name: 'Office', account_type: 'expense' });

    const budget = await t.db.transaction().execute(trx =>
      budgetSvc.createBudget(trx, ctx, { business_id: biz.id, name: 'FY26 Office', fiscal_year: 2026 }),
    );
    await t.db.transaction().execute(trx =>
      budgetSvc.setBudgetLine(trx, ctx, {
        budget_id: budget.id, account_id: acct.id, month_offset: 0, amount: '1000',
      }),
    );

    const variance = await budgetSvc.getVarianceReport(t.db, biz.id, budget.id);
    expect(variance).toHaveLength(1);
    const row = variance[0]!;
    expect(row.account_id).toBe(acct.id);
    expect(row.account_code).toBe('6100');
    expect(row.account_name).toBe('Office');
    expect(row.month_offset).toBe(0);
    expect(row.budget).toBe('1000.0000');
    expect(row.actual).toBe('0.0000');
    expect(row.variance).toBe('-1000.0000');
  });
});
