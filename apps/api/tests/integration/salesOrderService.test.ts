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
import * as so from '../../src/services/inventory/salesOrderService.js';

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
  const incomeAccount = await makeAccount(t.db, biz.id, {
    code: '4001', name: 'Sales Revenue', account_type: 'revenue',
  });
  const customer = await t.db.insertInto('customers')
    .values({ business_id: biz.id, name: 'Cust1' })
    .returningAll().executeTakeFirstOrThrow();
  const item = await t.db.insertInto('inventory_items').values({
    business_id: biz.id, sku: 'WIDGET', name: 'Widget',
    income_account_id: incomeAccount.id,
  }).returningAll().executeTakeFirstOrThrow();
  const ctx = systemCtx({ firm_id: firm.id, business_id: biz.id, user_id: user.id });
  return { biz, customer, item, ctx };
}

describe('salesOrderService', () => {
  it('createSO assigns sequential so_number', async () => {
    const { biz, customer, item, ctx } = await bootstrap();
    const s1 = await t.db.transaction().execute(trx =>
      so.createSO(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, order_date: '2026-04-01',
        lines: [{ inventory_item_id: item.id, quantity: '5', unit_price: '20.00' }],
      }),
    );
    expect(s1.so_number).toBe('SO-0001');
    const s2 = await t.db.transaction().execute(trx =>
      so.createSO(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, order_date: '2026-04-02',
        lines: [{ inventory_item_id: item.id, quantity: '3', unit_price: '20.00' }],
      }),
    );
    expect(s2.so_number).toBe('SO-0002');
  });

  it('fulfill creates Invoice + decrements stock + sets SO.status=fulfilled', async () => {
    const { biz, customer, item, ctx } = await bootstrap();
    const s = await t.db.transaction().execute(trx =>
      so.createSO(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, order_date: '2026-04-01',
        lines: [{ inventory_item_id: item.id, quantity: '5', unit_price: '20.00' }],
      }),
    );

    const fulfilled = await t.db.transaction().execute(trx =>
      so.fulfill(trx, ctx, { so_id: s.id }),
    );
    expect(fulfilled.status).toBe('fulfilled');
    expect(fulfilled.invoice_id).not.toBeNull();

    const movements = await t.db.selectFrom('stock_movements').selectAll()
      .where('inventory_item_id', '=', item.id).execute();
    expect(movements).toHaveLength(1);
    expect(movements[0]?.quantity_delta).toBe('-5.0000');

    const inv = await t.db.selectFrom('invoices').selectAll()
      .where('id', '=', fulfilled.invoice_id!).executeTakeFirstOrThrow();
    expect(inv.status).toBe('posted');
  });

  it('voidSO blocks fulfilled SOs', async () => {
    const { biz, customer, item, ctx } = await bootstrap();
    const s = await t.db.transaction().execute(trx =>
      so.createSO(trx, ctx, {
        business_id: biz.id, customer_id: customer.id, order_date: '2026-04-01',
        lines: [{ inventory_item_id: item.id, quantity: '5', unit_price: '20.00' }],
      }),
    );
    await t.db.transaction().execute(trx => so.fulfill(trx, ctx, { so_id: s.id }));
    await expect(
      t.db.transaction().execute(trx => so.voidSO(trx, ctx, { so_id: s.id })),
    ).rejects.toThrow(/fulfilled/);
  });
});
