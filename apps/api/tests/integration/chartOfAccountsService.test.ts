import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser } from '../helpers/factories.js';
import * as coa from '../../src/services/core/chartOfAccountsService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000000001', ip_address: '127.0.0.1', user_agent: 'vitest' };

async function setup(t: TestDb) {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id, 'Biz');
  const user = await makeUser(t.db, firm.id, { role: 'firm_admin' });
  const ctx: ServiceCtx = {
    user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'firm_admin',
    ...meta,
  };
  return { firm, biz, user, ctx };
}

describe('chartOfAccountsService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('seedDefaultCoa creates the standard COA + writes audit', async () => {
    const { biz, ctx } = await setup(t);
    await t.db.transaction().execute(trx => coa.seedDefaultCoa(trx, ctx, { business_id: biz.id }));
    const accounts = await t.db.selectFrom('chart_of_accounts').selectAll().where('business_id', '=', biz.id).execute();
    expect(accounts.length).toBeGreaterThan(20);
    const ar = accounts.find(a => a.code === '1100');
    expect(ar?.is_system).toBe(true);
    const audits = await t.db.selectFrom('audit_logs').selectAll().execute();
    expect(audits.some(a => a.action === 'coa.create')).toBe(true);
  });

  it('createAccount creates a non-system account', async () => {
    const { biz, ctx } = await setup(t);
    const created = await t.db.transaction().execute(trx =>
      coa.createAccount(trx, ctx, { business_id: biz.id, code: '4500', name: 'Consulting', account_type: 'revenue', parent_id: null }),
    );
    expect(created.code).toBe('4500');
    expect(created.is_system).toBe(false);
  });

  it('createAccount: duplicate code rejected with DUPLICATE_RESOURCE', async () => {
    const { biz, ctx } = await setup(t);
    await t.db.transaction().execute(trx =>
      coa.createAccount(trx, ctx, { business_id: biz.id, code: '4500', name: 'Consulting', account_type: 'revenue', parent_id: null }),
    );
    await expect(
      t.db.transaction().execute(trx =>
        coa.createAccount(trx, ctx, { business_id: biz.id, code: '4500', name: 'Other', account_type: 'revenue', parent_id: null }),
      ),
    ).rejects.toMatchObject({ code: ERR.DUPLICATE_RESOURCE });
  });

  it('updateAccount on a system account: forbids name change but allows is_active toggle', async () => {
    const { biz, ctx } = await setup(t);
    await t.db.transaction().execute(trx => coa.seedDefaultCoa(trx, ctx, { business_id: biz.id }));
    const ar = await t.db.selectFrom('chart_of_accounts').selectAll().where('code', '=', '1100').executeTakeFirstOrThrow();
    await expect(
      t.db.transaction().execute(trx => coa.updateAccount(trx, ctx, { account_id: ar.id, patch: { name: 'NEW NAME' } })),
    ).rejects.toMatchObject({ code: ERR.PRECONDITION_FAILED });
    const after = await t.db.transaction().execute(trx =>
      coa.updateAccount(trx, ctx, { account_id: ar.id, patch: { is_active: false } }),
    );
    expect(after.is_active).toBe(false);
  });

  it('listAccounts respects business scoping', async () => {
    const { biz, ctx } = await setup(t);
    const otherBiz = await (async () => {
      const otherFirm = await makeFirm(t.db, 'Other Firm');
      return makeBusiness(t.db, otherFirm.id, 'OtherBiz');
    })();
    await t.db.transaction().execute(trx => coa.seedDefaultCoa(trx, ctx, { business_id: biz.id }));
    await t.db.transaction().execute(trx =>
      coa.seedDefaultCoa(trx, { ...ctx, business_id: otherBiz.id, firm_id: otherBiz.firm_id } as ServiceCtx, { business_id: otherBiz.id }),
    );
    const list = await coa.listAccounts(t.db, { business_id: biz.id });
    expect(list.every(a => a.business_id === biz.id)).toBe(true);
  });
});
