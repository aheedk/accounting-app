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
} from '../helpers/factories.js';
import { systemCtx } from '../../src/lib/ctx.js';
import { createPO } from '../../src/services/inventory/purchaseOrderService.js';
import * as ir from '../../src/services/inventory/itemReceiptService.js';

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
  const inventoryAsset = await makeAccount(t.db, biz.id, {
    code: '1300',
    name: 'Inventory Asset',
    account_type: 'asset',
  });
  // Make a vendor + an item that ties to the inventory asset account.
  const vendor = await t.db.insertInto('vendors').values({ business_id: biz.id, name: 'Acme' })
    .returningAll().executeTakeFirstOrThrow();
  const item = await t.db.insertInto('inventory_items').values({
    business_id: biz.id,
    sku: 'WIDGET',
    name: 'Widget',
    inventory_asset_account_id: inventoryAsset.id,
  }).returningAll().executeTakeFirstOrThrow();
  const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });
  return { biz, vendor, item, ctx };
}

describe('itemReceiptService', () => {
  it('createReceipt creates a Bill (DR inventory / CR AP) + stock_movement + flips PO to received', async () => {
    const { biz, vendor, item, ctx } = await bootstrap();
    const po = await t.db.transaction().execute(trx =>
      createPO(trx, ctx, {
        business_id: biz.id,
        vendor_id: vendor.id,
        order_date: '2026-04-01',
        lines: [{ inventory_item_id: item.id, quantity: '10', unit_cost: '5.00' }],
      }),
    );

    const receipt = await t.db.transaction().execute(trx =>
      ir.createReceipt(trx, ctx, {
        business_id: biz.id,
        purchase_order_id: po.id,
        receipt_date: '2026-04-05',
      }),
    );
    expect(receipt.bill_id).not.toBeNull();

    const updatedPO = await t.db.selectFrom('purchase_orders').selectAll()
      .where('id', '=', po.id).executeTakeFirstOrThrow();
    expect(updatedPO.status).toBe('received');

    const movements = await t.db.selectFrom('stock_movements').selectAll()
      .where('inventory_item_id', '=', item.id).execute();
    expect(movements).toHaveLength(1);
    expect(movements[0]?.quantity_delta).toBe('10.0000');

    const bill = await t.db.selectFrom('bills').selectAll()
      .where('id', '=', receipt.bill_id!).executeTakeFirstOrThrow();
    expect(bill.status).toBe('posted');
    // Verify total = 10 * 5.00 = 50.00.
    expect(bill.total).toBe('50.0000');
  });

  it('createReceipt rejects against a voided PO', async () => {
    const { biz, vendor, item, ctx } = await bootstrap();
    const po = await t.db.transaction().execute(trx =>
      createPO(trx, ctx, {
        business_id: biz.id,
        vendor_id: vendor.id,
        order_date: '2026-04-01',
        lines: [{ inventory_item_id: item.id, quantity: '10', unit_cost: '5.00' }],
      }),
    );
    await t.db.updateTable('purchase_orders').set({ status: 'void' })
      .where('id', '=', po.id).execute();

    await expect(t.db.transaction().execute(trx =>
      ir.createReceipt(trx, ctx, {
        business_id: biz.id,
        purchase_order_id: po.id,
        receipt_date: '2026-04-05',
      }),
    )).rejects.toThrow(/voided PO/);
  });
});
