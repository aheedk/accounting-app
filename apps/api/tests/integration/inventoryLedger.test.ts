import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, truncateAll, type TestDb } from '../helpers/testDb.js';
import { makeAccount, makeFirm, makeBusiness, makeUser, makeCustomer, makeVendor, seedYearPeriods, seedCoa } from '../helpers/factories.js';
import { createPO } from '../../src/services/inventory/purchaseOrderService.js';
import { createReceipt } from '../../src/services/inventory/itemReceiptService.js';
import { createSO, fulfill } from '../../src/services/inventory/salesOrderService.js';
import { adjustStock, postOpeningInventory, unpostedStockValue } from '../../src/services/inventory/stockMovementService.js';
import { getOverview } from '../../src/services/inventory/inventoryOverviewService.js';
import type { ServiceCtx } from '../../src/lib/ctx.js';

const meta = { request_id: '00000000-0000-0000-0000-000000004013', ip_address: '127.0.0.1', user_agent: 'vitest' };
const thisYear = new Date().getUTCFullYear();
const today = new Date().toISOString().slice(0, 10);

// 2026-09-28 audit, the last serious item: inventory never reached the books.
// Receiving stock did post a bill; what was missing was the cost of a sale and
// any stock entered or changed by hand.
describe('inventory in the ledger', () => {
  let t: TestDb;
  beforeAll(async () => { t = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await truncateAll(t.db); });

  async function setup() {
    const firm = await makeFirm(t.db);
    const biz = await makeBusiness(t.db, firm.id);
    const user = await makeUser(t.db, firm.id, { role: 'accountant' });
    const ctx: ServiceCtx = { user_id: user.id, firm_id: firm.id, business_id: biz.id, effective_role: 'accountant', ...meta };
    await seedCoa(t.db, biz.id);
    await seedYearPeriods(t.db, biz.id, thisYear);
    const account = (code: string) => t.db.selectFrom('chart_of_accounts').selectAll()
      .where('business_id', '=', biz.id).where('code', '=', code).executeTakeFirstOrThrow();
    const [inventory, cogs, revenue] = await Promise.all([account('1200'), account('5010'), account('4010')]);
    const widget = await t.db.insertInto('inventory_items').values({
      business_id: biz.id, sku: 'WIDGET', name: 'Widget', purchase_cost: '5.00', sale_price: '12.00',
      inventory_asset_account_id: inventory.id, expense_account_id: cogs.id, income_account_id: revenue.id,
    }).returningAll().executeTakeFirstOrThrow();
    const vendor = await makeVendor(t.db, biz.id);
    const customer = await makeCustomer(t.db, biz.id);
    return { biz, ctx, inventory, cogs, revenue, widget, vendor, customer };
  }

  async function balance(accountId: string): Promise<number> {
    const row = await t.db.selectFrom('journal_entry_lines as l')
      .innerJoin('journal_entries as je', 'je.id', 'l.journal_entry_id')
      .select(({ fn }) => [fn.sum<string>('l.debit').as('debit'), fn.sum<string>('l.credit').as('credit')])
      .where('l.account_id', '=', accountId).where('je.status', 'in', ['posted', 'voided'])
      .executeTakeFirstOrThrow();
    return Number(row.debit ?? 0) - Number(row.credit ?? 0);
  }

  const receive = (s: Awaited<ReturnType<typeof setup>>, quantity: string, unit_cost: string) =>
    t.db.transaction().execute(async trx => {
      const po = await createPO(trx, s.ctx, {
        business_id: s.biz.id, vendor_id: s.vendor.id, order_date: today,
        lines: [{ inventory_item_id: s.widget.id, quantity, unit_cost }],
      });
      return createReceipt(trx, s.ctx, { business_id: s.biz.id, purchase_order_id: po.id, receipt_date: today });
    });

  it('a receipt is in the ledger once, through its bill, at the purchase order cost', async () => {
    const s = await setup();
    const receipt = await receive(s, '10', '5.00');

    const bill = await t.db.selectFrom('bills').selectAll().where('id', '=', receipt.bill_id!).executeTakeFirstOrThrow();
    const [movement] = await t.db.selectFrom('stock_movements').selectAll().where('inventory_item_id', '=', s.widget.id).execute();
    expect(movement).toMatchObject({ unit_cost: '5.0000', total_cost: '50.0000', journal_entry_id: bill.posted_journal_entry_id });
    // Debited by the bill and not a second time by the movement.
    expect(await balance(s.inventory.id)).toBe(50);
    const entries = await t.db.selectFrom('journal_entries').select('id').where('business_id', '=', s.biz.id).execute();
    expect(entries).toHaveLength(1);
  });

  it('a sale posts cost of goods sold at the average cost of what is on hand', async () => {
    const s = await setup();
    await receive(s, '10', '5.00');     // 50.00
    await receive(s, '10', '7.00');     // 70.00, so 20 units at an average of 6.00

    const order = await t.db.transaction().execute(trx => createSO(trx, s.ctx, {
      business_id: s.biz.id, customer_id: s.customer.id, order_date: today,
      lines: [{ inventory_item_id: s.widget.id, quantity: '5', unit_price: '12.00' }],
    }));
    await t.db.transaction().execute(trx => fulfill(trx, s.ctx, { so_id: order.id }));

    // 5 units leave at 6.00 each.
    expect(await balance(s.cogs.id)).toBe(30);
    expect(await balance(s.inventory.id)).toBe(90);
    expect(await balance(s.revenue.id)).toBe(-60);   // the invoice, as before

    const sale = await t.db.selectFrom('stock_movements').selectAll()
      .where('inventory_item_id', '=', s.widget.id).where('quantity_delta', '<', '0').executeTakeFirstOrThrow();
    expect(sale).toMatchObject({ unit_cost: '6.0000', total_cost: '-30.0000' });
    const entry = await t.db.selectFrom('journal_entries').selectAll().where('id', '=', sale.journal_entry_id!).executeTakeFirstOrThrow();
    expect(entry).toMatchObject({ source_type: 'adjustment', source_id: sale.id, memo: expect.stringContaining('Cost of goods sold: Widget') });

    // The page and the ledger now say the same thing.
    const overview = await getOverview(t.db, s.ctx);
    expect(Number(overview.total_stock_value)).toBe(90);
    expect(Number(overview.unposted_stock_value)).toBe(0);
  });

  it('stock entered or changed by hand posts too, and selling the last unit leaves no cents behind', async () => {
    const s = await setup();
    const move = (quantity_delta: string, reason: 'opening_balance' | 'write_off' | 'manual_out', unit_cost?: string) =>
      t.db.transaction().execute(trx => adjustStock(trx, s.ctx, {
        business_id: s.biz.id, item_id: s.widget.id, movement_date: today, quantity_delta, reason, memo: null,
        ...(unit_cost !== undefined ? { unit_cost } : {}),
      }));

    // Three on hand at 3.3333 each: 9.9999.
    await move('3', 'opening_balance', '3.3333');
    expect(await balance(s.inventory.id)).toBeCloseTo(9.9999, 4);
    const equity = await t.db.selectFrom('chart_of_accounts').selectAll()
      .where('business_id', '=', s.biz.id).where('name', '=', 'Opening Balance Equity').executeTakeFirstOrThrow();
    expect(await balance(equity.id)).toBeCloseTo(-9.9999, 4);

    await move('-1', 'write_off');       // one written off at 3.3333
    expect(await balance(s.cogs.id)).toBeCloseTo(3.3333, 4);
    await move('-2', 'manual_out');      // the last two take whatever value is left
    expect(await balance(s.inventory.id)).toBe(0);
    expect(await balance(s.cogs.id)).toBeCloseTo(9.9999, 4);
  });

  it('does not post for an item kept out of the ledger, and asks for a cost account when one is needed', async () => {
    const s = await setup();
    const service = await t.db.insertInto('inventory_items').values({ business_id: s.biz.id, sku: 'SVC', name: 'Service', purchase_cost: '9.00' })
      .returningAll().executeTakeFirstOrThrow();
    await t.db.transaction().execute(trx => adjustStock(trx, s.ctx, {
      business_id: s.biz.id, item_id: service.id, movement_date: today, quantity_delta: '4', reason: 'manual_in', memo: null,
    }));
    expect(await t.db.selectFrom('journal_entries').select('id').where('business_id', '=', s.biz.id).execute()).toEqual([]);

    const other = await makeAccount(t.db, s.biz.id, { code: '1210', name: 'Parts', account_type: 'asset' });
    const part = await t.db.insertInto('inventory_items').values({
      business_id: s.biz.id, sku: 'PART', name: 'Part', purchase_cost: '2.00', inventory_asset_account_id: other.id,
    }).returningAll().executeTakeFirstOrThrow();
    await expect(t.db.transaction().execute(trx => adjustStock(trx, s.ctx, {
      business_id: s.biz.id, item_id: part.id, movement_date: today, quantity_delta: '4', reason: 'manual_in', memo: null,
    }))).rejects.toThrow(/no expense \(cost of goods sold\) account/);
  });

  it('posts the stock that was entered before any of this as one opening entry', async () => {
    const s = await setup();
    // As migration 0090 leaves old rows: costed, with no journal entry.
    await t.db.insertInto('stock_movements').values([
      { inventory_item_id: s.widget.id, movement_date: '2026-01-05', quantity_delta: '40', reason: 'opening_balance', memo: null, unit_cost: '5.0000', total_cost: '200.0000' },
      { inventory_item_id: s.widget.id, movement_date: '2026-02-10', quantity_delta: '-10', reason: 'manual_out', memo: null, unit_cost: '5.0000', total_cost: '-50.0000' },
    ]).execute();
    expect(await balance(s.inventory.id)).toBe(0);
    expect(Number(await unpostedStockValue(t.db, s.biz.id))).toBe(150);

    const result = await t.db.transaction().execute(trx => postOpeningInventory(trx, s.ctx, { business_id: s.biz.id, entry_date: today }));
    expect(result).toMatchObject({ movement_count: 2, value: '150.0000' });
    expect(await balance(s.inventory.id)).toBe(150);
    expect(Number(await unpostedStockValue(t.db, s.biz.id))).toBe(0);
    // Nothing left to post a second time.
    expect(await t.db.transaction().execute(trx => postOpeningInventory(trx, s.ctx, { business_id: s.biz.id, entry_date: today }))).toBeNull();
  });
});
