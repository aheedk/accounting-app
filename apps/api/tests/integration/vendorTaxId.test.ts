import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess } from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as vend from '../../src/services/ap/vendorService.js';

let t: TestDb;
beforeAll(async () => {
  t = await startTestDb();
  process.env['FIELD_ENCRYPTION_KEY'] =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
});
beforeEach(async () => { await truncateAll(t.db); });

describe('vendor tax_id (encrypted)', () => {
  it('createVendor with tax_id stores encrypted blob + last_four + type', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id);
    await grantAccess(t.db, user.id, biz.id);
    const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });

    const v = await t.db.transaction().execute(trx =>
      vend.createVendor(trx, ctx, {
        business_id: biz.id, name: 'Acme', is_1099: true,
        tax_id: '123-45-6789', tax_id_type: 'SSN',
      }),
    );

    expect(v.tax_id_last_four).toBe('6789');
    expect(v.tax_id_type).toBe('SSN');
    expect(v.tax_id_encrypted).toBeInstanceOf(Buffer);

    const revealed = await vend.revealTaxId(t.db, ctx, { vendor_id: v.id });
    expect(revealed).toBe('123-45-6789');
  });

  it('revealTaxId is audit-logged with action vendor.tax_id_reveal', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id);
    await grantAccess(t.db, user.id, biz.id);
    const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });

    const v = await t.db.transaction().execute(trx =>
      vend.createVendor(trx, ctx, {
        business_id: biz.id, name: 'Acme', is_1099: true,
        tax_id: '12-3456789', tax_id_type: 'EIN',
      }),
    );

    await vend.revealTaxId(t.db, ctx, { vendor_id: v.id });

    const logs = await t.db.selectFrom('audit_logs').selectAll()
      .where('action', '=', 'vendor.tax_id_reveal').execute();
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0]?.entity_id).toBe(v.id);
  });
});
