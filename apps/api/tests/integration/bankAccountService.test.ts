import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, seedCoa } from '../helpers/factories.js';
import * as bankAcctSvc from '../../src/services/banking/bankAccountService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000bbb30', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id, { role: 'firm_admin' });
  const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'firm_admin', ...meta };
  await seedCoa(t.db, biz.id);
  const cash = await t.db.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', biz.id).where('code', '=', '1020').executeTakeFirstOrThrow();
  const cashOnHand = await t.db.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', biz.id).where('code', '=', '1010').executeTakeFirstOrThrow();
  const ap = await t.db.selectFrom('chart_of_accounts').selectAll()
    .where('business_id', '=', biz.id).where('code', '=', '2010').executeTakeFirstOrThrow();
  return { firm, biz, user, ctx, cash, cashOnHand, ap };
}

describe('bankAccountService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('createBankAccount creates one linked to a CoA cash row', async () => {
    const { biz, ctx, cash } = await setup(t);
    const row = await t.db.transaction().execute(trx =>
      bankAcctSvc.createBankAccount(trx, ctx, {
        business_id: biz.id,
        name: 'Primary Checking',
        institution: 'Demo Bank',
        account_last_four: '4321',
        cash_account_id: cash.id,
      }),
    );
    expect(row.name).toBe('Primary Checking');
    expect(row.institution).toBe('Demo Bank');
    expect(row.account_last_four).toBe('4321');
    expect(row.cash_account_id).toBe(cash.id);
    expect(row.is_active).toBe(true);
    const audit = await t.db.selectFrom('audit_logs').selectAll().where('action', '=', 'bank_account.create').execute();
    expect(audit).toHaveLength(1);
  });

  it('createBankAccount rejects non-asset CoA row', async () => {
    const { biz, ctx, ap } = await setup(t);
    await expect(
      t.db.transaction().execute(trx =>
        bankAcctSvc.createBankAccount(trx, ctx, {
          business_id: biz.id,
          name: 'Bad',
          institution: null,
          account_last_four: null,
          cash_account_id: ap.id,
        }),
      ),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
  });

  it('listBankAccounts returns active accounts sorted by name', async () => {
    const { biz, ctx, cash, cashOnHand } = await setup(t);
    await t.db.transaction().execute(trx =>
      bankAcctSvc.createBankAccount(trx, ctx, {
        business_id: biz.id, name: 'Zebra Savings',
        institution: null, account_last_four: null,
        cash_account_id: cash.id,
      }),
    );
    await t.db.transaction().execute(trx =>
      bankAcctSvc.createBankAccount(trx, ctx, {
        business_id: biz.id, name: 'Alpha Checking',
        institution: null, account_last_four: null,
        cash_account_id: cashOnHand.id,
      }),
    );
    const list = await bankAcctSvc.listBankAccounts(t.db, biz.id);
    expect(list).toHaveLength(2);
    expect(list[0]?.name).toBe('Alpha Checking');
    expect(list[1]?.name).toBe('Zebra Savings');
    expect(list[0]?.cash_account_code).toBeTruthy();
  });
});
