import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, makeAccount } from '../helpers/factories.js';
import * as tax from '../../src/services/tax/taxCodeService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000ddd01', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('taxCodeService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  it('creates tax code with initial rate', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'firm_admin' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'firm_admin', ...meta };
    const acct = await makeAccount(t.db, biz.id, { code: '2100', name: 'Sales Tax Payable', account_type: 'liability', is_system: true });
    const tc = await t.db.transaction().execute(trx =>
      tax.createTaxCode(trx, ctx, {
        business_id: biz.id, code: 'CA', name: 'CA Sales Tax 8.75%',
        tax_payable_account_id: acct.id,
        initial_rate: { rate: 0.0875, effective_from: '2024-01-01', effective_to: null },
      }),
    );
    expect(tc.code).toBe('CA');
    const rates = await t.db.selectFrom('tax_rates').selectAll().where('tax_code_id', '=', tc.id).execute();
    expect(rates).toHaveLength(1);
    expect(rates[0]!.rate).toBe('0.087500');
  });

  it('getEffectiveRate returns the rate active on the given date', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const acct = await makeAccount(t.db, biz.id, { code: '2100', account_type: 'liability' });
    const tc = await t.db.insertInto('tax_codes').values({ business_id: biz.id, code: 'CA', name: 'CA', tax_payable_account_id: acct.id }).returningAll().executeTakeFirstOrThrow();
    await t.db.insertInto('tax_rates').values([
      { tax_code_id: tc.id, rate: '0.080000', effective_from: '2020-01-01', effective_to: '2023-12-31' },
      { tax_code_id: tc.id, rate: '0.087500', effective_from: '2024-01-01', effective_to: null },
    ]).execute();
    expect(await tax.getEffectiveRate(t.db, tc.id, '2022-06-01')).toBe('0.080000');
    expect(await tax.getEffectiveRate(t.db, tc.id, '2024-06-01')).toBe('0.087500');
  });
});
