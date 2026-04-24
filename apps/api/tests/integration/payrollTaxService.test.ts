import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess, makeAccount, seedCoa, seedYearPeriods } from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as pt from '../../src/services/payroll/payrollTaxService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

describe('payrollTaxService', () => {
  it('payLiability posts DR liability / CR cash and flips status to paid', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id);
    await grantAccess(t.db, user.id, biz.id);
    await seedCoa(t.db, biz.id);
    await seedYearPeriods(t.db, biz.id, 2026);
    const liabilityAcc = await makeAccount(t.db, biz.id, { code: '2110', name: 'Federal Tax Payable', account_type: 'liability' });
    const cashAcc = await makeAccount(t.db, biz.id, { code: '1015', name: 'Cash', account_type: 'asset' });
    const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });

    const accrued = await t.db.transaction().execute(trx =>
      pt.recordLiability(trx, ctx, {
        business_id: biz.id, period: 'monthly', period_start: '2026-04-01', period_end: '2026-04-30',
        liability_account_id: liabilityAcc.id, amount: '1000.00',
      }),
    );
    expect(accrued.status).toBe('accrued');

    const paid = await t.db.transaction().execute(trx =>
      pt.payLiability(trx, ctx, { liability_id: accrued.id, cash_account_id: cashAcc.id, payment_date: '2026-05-15' }),
    );
    expect(paid.status).toBe('paid');
    expect(paid.payment_journal_entry_id).not.toBeNull();

    const lines = await t.db.selectFrom('journal_entry_lines').selectAll()
      .where('journal_entry_id', '=', paid.payment_journal_entry_id!).execute();
    expect(lines).toHaveLength(2);
    const dr = lines.find(l => l.account_id === liabilityAcc.id);
    const cr = lines.find(l => l.account_id === cashAcc.id);
    expect(dr?.debit).toBe('1000.0000');
    expect(cr?.credit).toBe('1000.0000');
  });
});
