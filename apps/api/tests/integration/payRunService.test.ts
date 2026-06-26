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
  makeEmployee,
} from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as pr from '../../src/services/payroll/payRunService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

async function bootstrap() {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id);
  await grantAccess(t.db, user.id, biz.id);
  await seedCoa(t.db, biz.id);
  await seedYearPeriods(t.db, biz.id, 2026);
  const accounts = {
    wages_expense: (await makeAccount(t.db, biz.id, { code: '6100', name: 'Wages Expense', account_type: 'expense' })).id,
    payroll_tax_expense: (await makeAccount(t.db, biz.id, { code: '6110', name: 'Payroll Tax Expense', account_type: 'expense' })).id,
    cash: (await makeAccount(t.db, biz.id, { code: '1015', name: 'Cash op', account_type: 'asset' })).id,
    fed_tax_liability: (await makeAccount(t.db, biz.id, { code: '2110', name: 'Federal Tax Payable', account_type: 'liability' })).id,
    fica_liability: (await makeAccount(t.db, biz.id, { code: '2120', name: 'FICA Payable', account_type: 'liability' })).id,
  };
  const employee = await makeEmployee(t.db, biz.id);
  const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });
  return { biz, accounts, employee, ctx };
}

describe('payRunService', () => {
  it('createDraft computes net = gross - deductions per line', async () => {
    const { biz, accounts, employee, ctx } = await bootstrap();
    const run = await t.db.transaction().execute(trx =>
      pr.createDraft(trx, ctx, {
        business_id: biz.id,
        pay_period_start: '2026-04-01',
        pay_period_end: '2026-04-15',
        pay_date: '2026-04-20',
        accounts,
        lines: [
          { employee_id: employee.id, gross: '1000', federal_wh: '100', fica_employee: '60', medicare_employee: '15' },
        ],
      }),
    );
    const lines = await t.db.selectFrom('pay_run_lines').selectAll()
      .where('pay_run_id', '=', run.id).execute();
    expect(lines).toHaveLength(1);
    // 1000 - 100 - 60 - 15 = 825
    expect(lines[0]?.net).toBe('825.0000');
  });

  it('finalize posts a balanced JE and links it', async () => {
    const { biz, accounts, employee, ctx } = await bootstrap();
    const draft = await t.db.transaction().execute(trx =>
      pr.createDraft(trx, ctx, {
        business_id: biz.id,
        pay_period_start: '2026-04-01',
        pay_period_end: '2026-04-15',
        pay_date: '2026-04-20',
        accounts,
        lines: [
          {
            employee_id: employee.id,
            gross: '1000',
            federal_wh: '100',
            fica_employee: '60',
            fica_employer: '60',
            medicare_employee: '15',
            medicare_employer: '15',
          },
        ],
      }),
    );
    const finalized = await t.db.transaction().execute(trx =>
      pr.finalize(trx, ctx, { pay_run_id: draft.id }),
    );
    expect(finalized.status).toBe('finalized');
    expect(finalized.journal_entry_id).not.toBeNull();

    const jeLines = await t.db.selectFrom('journal_entry_lines').selectAll()
      .where('journal_entry_id', '=', finalized.journal_entry_id!).execute();
    const totalDr = jeLines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCr = jeLines.reduce((s, l) => s + Number(l.credit), 0);
    expect(totalDr).toBeCloseTo(totalCr, 4);
    // Wages expense debit = 1000, payroll tax expense debit = 75 (fica_employer 60 + med_employer 15)
    expect(totalDr).toBeCloseTo(1075, 4);
  });

  it('voidPayRun on a finalized run reverses the JE and flips status', async () => {
    const { biz, accounts, employee, ctx } = await bootstrap();
    const draft = await t.db.transaction().execute(trx =>
      pr.createDraft(trx, ctx, {
        business_id: biz.id,
        pay_period_start: '2026-04-01',
        pay_period_end: '2026-04-15',
        pay_date: '2026-04-20',
        accounts,
        lines: [{ employee_id: employee.id, gross: '500', federal_wh: '50' }],
      }),
    );
    const finalized = await t.db.transaction().execute(trx =>
      pr.finalize(trx, ctx, { pay_run_id: draft.id }),
    );
    const voided = await t.db.transaction().execute(trx =>
      pr.voidPayRun(trx, ctx, { pay_run_id: finalized.id }),
    );
    expect(voided.status).toBe('void');
    // Migration 0051 loosened the constraint so the JE back-link is preserved on void.
    expect(voided.journal_entry_id).toBe(finalized.journal_entry_id);
    expect(voided.finalized_at).toBe(finalized.finalized_at);
  });
});
