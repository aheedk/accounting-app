import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess } from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as sl from '../../src/services/inventory/shippingLabelService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

describe('shippingLabelService', () => {
  it('createLabel with sales_order_id only succeeds and audit-logs CREATE', async () => {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id);
    await grantAccess(t.db, user.id, biz.id);
    const customer = await t.db.insertInto('customers').values({ business_id: biz.id, name: 'Cust1' }).returningAll().executeTakeFirstOrThrow();
    const so = await t.db.insertInto('sales_orders').values({
      business_id: biz.id, customer_id: customer.id, so_number: 'SO-0001', order_date: '2026-04-01',
    }).returningAll().executeTakeFirstOrThrow();
    const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });

    const label = await t.db.transaction().execute(trx =>
      sl.createLabel(trx, ctx, {
        business_id: biz.id, sales_order_id: so.id,
        carrier: 'USPS', tracking_number: '9405XYZ', shipped_at: '2026-04-05',
      }),
    );
    expect(label.carrier).toBe('USPS');
    expect(label.tracking_number).toBe('9405XYZ');
    expect(label.invoice_id).toBeNull();

    const logs = await t.db.selectFrom('audit_logs').selectAll().where('action', '=', 'shipping_label.create').execute();
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });
});
