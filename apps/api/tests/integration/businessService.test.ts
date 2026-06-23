import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeUser } from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import { createBusiness } from '../../src/services/core/businessService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

describe('businessService.createBusiness', () => {
  it('creates a client, seeds default COA + periods, grants creator access, and audits', async () => {
    const firm = await makeFirm(t.db);
    const user = await makeUser(t.db, firm.id, { role: 'firm_admin' });
    const ctx = systemCtx({ firm_id: firm.id, business_id: null, user_id: user.id, effective_role: 'firm_admin' });

    const created = await t.db.transaction().execute(trx =>
      createBusiness(trx, ctx, { name: 'New Client Co.', tax_id: '12-3456789' }),
    );

    expect(created.name).toBe('New Client Co.');
    expect(created.firm_id).toBe(firm.id);
    expect(created.tax_id).toBe('12-3456789');

    // Default chart of accounts seeded.
    const coa = await t.db.selectFrom('chart_of_accounts')
      .select(t.db.fn.countAll<string>().as('n'))
      .where('business_id', '=', created.id)
      .executeTakeFirstOrThrow();
    expect(Number(coa.n)).toBeGreaterThan(0);

    // Current-year fiscal periods seeded (12 calendar months).
    const periods = await t.db.selectFrom('fiscal_periods')
      .select(t.db.fn.countAll<string>().as('n'))
      .where('business_id', '=', created.id)
      .executeTakeFirstOrThrow();
    expect(Number(periods.n)).toBe(12);

    // Creator was granted access (so it shows in /me).
    const access = await t.db.selectFrom('user_business_access')
      .selectAll()
      .where('user_id', '=', user.id)
      .where('business_id', '=', created.id)
      .executeTakeFirst();
    expect(access).toBeTruthy();

    // Audit recorded.
    const audit = await t.db.selectFrom('audit_logs')
      .select(['action'])
      .where('business_id', '=', created.id)
      .where('action', '=', 'business.create')
      .executeTakeFirst();
    expect(audit).toBeTruthy();
  });

  it('grants access only to the creating user', async () => {
    const firm = await makeFirm(t.db);
    const creator = await makeUser(t.db, firm.id, { role: 'firm_admin' });
    const other = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx = systemCtx({ firm_id: firm.id, business_id: null, user_id: creator.id, effective_role: 'firm_admin' });

    const created = await t.db.transaction().execute(trx =>
      createBusiness(trx, ctx, { name: 'Solo Client' }),
    );

    const rows = await t.db.selectFrom('user_business_access')
      .select(['user_id'])
      .where('business_id', '=', created.id)
      .execute();
    expect(rows.map(r => r.user_id)).toEqual([creator.id]);
    expect(rows.map(r => r.user_id)).not.toContain(other.id);
  });
});
