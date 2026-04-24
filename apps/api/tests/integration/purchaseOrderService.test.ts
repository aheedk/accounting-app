import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { startTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeFirm, makeBusiness, makeUser, grantAccess } from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import * as po from '../../src/services/inventory/purchaseOrderService.js';

let t: TestDb;
beforeAll(async () => { t = await startTestDb(); });
beforeEach(async () => { await truncateAll(t.db); });

async function bootstrap() {
  const firm = await makeFirm(t.db);
  const biz = await makeBusiness(t.db, firm.id);
  const user = await makeUser(t.db, firm.id);
  await grantAccess(t.db, user.id, biz.id);
  // Make a vendor
  const vendor = await t.db.insertInto('vendors').values({ business_id: biz.id, name: 'Acme Supply' })
    .returningAll().executeTakeFirstOrThrow();
  // Make an inventory item
  const item = await t.db.insertInto('inventory_items').values({
    business_id: biz.id, sku: 'WIDGET', name: 'Widget',
  }).returningAll().executeTakeFirstOrThrow();
  const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });
  return { biz, vendor, item, ctx };
}

describe('purchaseOrderService', () => {
  it('createPO assigns sequential po_number and inserts lines', async () => {
    const { biz, vendor, item, ctx } = await bootstrap();
    const p1 = await t.db.transaction().execute(trx =>
      po.createPO(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id, order_date: '2026-04-01',
        lines: [{ inventory_item_id: item.id, quantity: '10', unit_cost: '5.00' }],
      }),
    );
    expect(p1.po_number).toBe('PO-0001');
    expect(p1.status).toBe('draft');

    const p2 = await t.db.transaction().execute(trx =>
      po.createPO(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id, order_date: '2026-04-02',
        lines: [{ inventory_item_id: item.id, quantity: '5', unit_cost: '5.00' }],
      }),
    );
    expect(p2.po_number).toBe('PO-0002');

    const detail = await po.getPO(t.db, biz.id, p1.id);
    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0]?.quantity).toBe('10.0000');
  });

  it('voidPO blocks if any item_receipt exists for that PO', async () => {
    const { biz, vendor, item, ctx } = await bootstrap();
    const p1 = await t.db.transaction().execute(trx =>
      po.createPO(trx, ctx, {
        business_id: biz.id, vendor_id: vendor.id, order_date: '2026-04-01',
        lines: [{ inventory_item_id: item.id, quantity: '10', unit_cost: '5.00' }],
      }),
    );

    // Insert a fake item_receipt referencing this PO
    await t.db.insertInto('item_receipts').values({
      business_id: biz.id, purchase_order_id: p1.id, receipt_date: '2026-04-05',
    }).execute();

    await expect(t.db.transaction().execute(trx => po.voidPO(trx, ctx, { po_id: p1.id })))
      .rejects.toThrow(/cannot void/);
  });
});
