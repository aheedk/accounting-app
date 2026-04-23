import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser } from '../helpers/factories.js';
import * as vend from '../../src/services/ap/vendorService.js';
import { ERR } from '@accounting/shared';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-0000000bbb10', ip_address: '127.0.0.1', user_agent: 'vitest' };

describe('vendorService', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  async function setup() {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    return { firm, biz, ctx };
  }

  it('creates and lists vendors, scoped to business', async () => {
    const { biz, ctx } = await setup();
    const v = await t.db.transaction().execute(trx =>
      vend.createVendor(trx, ctx, { business_id: biz.id, name: 'Acme Supply', email: 'ap@acme.com', is_1099: true, tax_id: '12-3456789' }),
    );
    expect(v.name).toBe('Acme Supply');
    expect(v.is_1099).toBe(true);
    expect(v.tax_id).toBe('12-3456789');
    const list = await vend.listVendors(t.db, biz.id);
    expect(list).toHaveLength(1);
  });

  it('rejects duplicate name', async () => {
    const { biz, ctx } = await setup();
    await t.db.transaction().execute(trx => vend.createVendor(trx, ctx, { business_id: biz.id, name: 'Acme' }));
    await expect(
      t.db.transaction().execute(trx => vend.createVendor(trx, ctx, { business_id: biz.id, name: 'Acme' })),
    ).rejects.toMatchObject({ code: ERR.DUPLICATE_RESOURCE });
  });

  it('soft-deletes a vendor; list excludes by default', async () => {
    const { biz, ctx } = await setup();
    const v = await t.db.transaction().execute(trx => vend.createVendor(trx, ctx, { business_id: biz.id, name: 'Acme' }));
    await t.db.transaction().execute(trx => vend.deleteVendor(trx, ctx, { vendor_id: v.id }));
    const list = await vend.listVendors(t.db, biz.id);
    expect(list).toHaveLength(0);
  });
});
