import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { grantAccess, makeBusiness, makeFirm, makeUser } from '../helpers/factories.js';
import { makeApp } from '../../src/app.js';
import { destroyDbSingleton } from '../../src/db/index.js';
import { inventoryValuation } from '../../src/services/inventory/inventoryValuationService.js';
import type { StockMovementReason } from '../../src/db/types.js';

// The Inventory Valuation reports (item 18): stock and its cost as of a date,
// from the stock movements.
describe('inventoryValuation', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await startTestDb();
    process.env.DATABASE_URL = t.url;
  });
  afterAll(async () => {
    await destroyDbSingleton();
    await stopTestDb();
  });
  beforeEach(async () => { await truncateAll(t.db); });

  async function setup() {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const item = (sku: string, name: string, is_active = true) => t.db.insertInto('inventory_items')
      .values({ business_id: biz.id, sku, name, purchase_cost: '5.00', is_active })
      .returningAll().executeTakeFirstOrThrow();
    const move = (item_id: string, movement_date: string, reason: StockMovementReason, quantity_delta: string, unit_cost: string, total_cost: string) =>
      t.db.insertInto('stock_movements')
        .values({ inventory_item_id: item_id, movement_date, reason, memo: `${reason} ${movement_date}`, quantity_delta, unit_cost, total_cost })
        .execute();
    const widget = await item('W-1', 'Widget');
    await move(widget.id, '2026-01-05', 'opening_balance', '10', '5', '50');
    await move(widget.id, '2026-02-10', 'manual_out', '-4', '5', '-20');
    await move(widget.id, '2026-03-15', 'manual_in', '6', '6', '36');
    await move(widget.id, '2026-04-02', 'manual_out', '-2', '5.5', '-11');
    const gadget = await item('G-1', 'Gadget');
    const retired = await item('R-1', 'Retired', false);
    const stocked = await item('S-1', 'Shelved', false);
    await move(stocked.id, '2026-01-02', 'opening_balance', '3', '2', '6');
    return { biz, widget, gadget, retired, stocked };
  }

  it('gives each item\'s quantity and cost as of the date, leaving out later movements', async () => {
    const s = await setup();
    const items = await inventoryValuation(t.db, { business_id: s.biz.id, as_of: '2026-03-31' });
    expect(items.map(i => [i.name, i.quantity, i.value, i.movements.length])).toEqual([
      ['Gadget', '0.0000', '0.0000', 0],
      ['Shelved', '3.0000', '6.0000', 0],
      ['Widget', '12.0000', '66.0000', 0],
    ]);
  });

  it('leaves out an inactive item with nothing on hand', async () => {
    const s = await setup();
    const items = await inventoryValuation(t.db, { business_id: s.biz.id, as_of: '2026-12-31' });
    expect(items.map(i => i.item_id)).not.toContain(s.retired.id);
    expect(items.map(i => i.item_id)).toContain(s.stocked.id);
  });

  it('from a period start, gives where the item started and every movement after, oldest first', async () => {
    const s = await setup();
    const [widget] = (await inventoryValuation(t.db, { business_id: s.biz.id, as_of: '2026-03-31', period_start: '2026-02-01' }))
      .filter(i => i.item_id === s.widget.id);
    expect(widget).toMatchObject({ opening_quantity: '10.0000', opening_value: '50.0000', quantity: '12.0000', value: '66.0000' });
    expect(widget!.movements.map(m => [m.movement_date, m.reason, m.quantity, m.unit_cost, m.value])).toEqual([
      ['2026-02-10', 'manual_out', '-4.0000', '5.0000', '-20.0000'],
      ['2026-03-15', 'manual_in', '6.0000', '6.0000', '36.0000'],
    ]);
  });

  it('over HTTP: staff read it; a period start after the date is a 400', async () => {
    const s = await setup();
    const user = await makeUser(t.db, s.biz.firm_id, { role: 'staff' });
    await grantAccess(t.db, user.id, s.biz.id);
    const app = makeApp();
    const login = await request(app).post('/auth/login').send({ email: user.email, password: user.plaintext_password });    const auth = { Authorization: `Bearer ${login.body.access_token as string}` };
    const url = `/businesses/${s.biz.id}/reports/inventory-valuation`;

    const res = await request(app).get(url).query({ as_of: '2026-03-31', period_start: '2026-02-01' }).set(auth);
    expect(res.status).toBe(200);
    const widget = (res.body.items as { name: string; quantity: string; movements: unknown[] }[]).find(i => i.name === 'Widget');
    expect(widget).toMatchObject({ quantity: '12.0000', movements: [{ reason: 'manual_out' }, { reason: 'manual_in' }] });
    expect((await request(app).get(url).query({ as_of: '2026-01-31', period_start: '2026-02-01' }).set(auth)).status).toBe(400);
  });

  it('keeps to the one business', async () => {
    await setup();
    const firm = await makeFirm(t.db);
    const other = await makeBusiness(t.db, firm.id);
    expect(await inventoryValuation(t.db, { business_id: other.id, as_of: '2026-12-31' })).toEqual([]);
  });
});
