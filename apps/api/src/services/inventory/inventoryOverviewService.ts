import { sql, type Kysely } from 'kysely';
import type { DB } from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';
import { unpostedStockValue } from './stockMovementService.js';

export type InventoryOverview = {
  total_items_count: number;
  /** What the stock on hand cost: the sum of every movement's cost, which is what the ledger carries. */
  total_stock_value: string;
  /** The part of it recorded before inventory posted to the ledger and not yet posted. */
  unposted_stock_value: string;
  recent_receipts: Array<{ id: string; receipt_date: string; po_number: string }>;
  recent_sales: Array<{ id: string; order_date: string; so_number: string }>;
};

// Read-only KPI aggregate. quantity_on_hand is computed from
// stock_movements.quantity_delta (signed deltas) per item, since
// inventory_items has no quantity_on_hand column. stock_movements has
// no business_id, so it is implicitly scoped via inventory_item_id.
export async function getOverview(db: Kysely<DB>, ctx: ServiceCtx): Promise<InventoryOverview> {
  const business_id = ctx.business_id;
  if (!business_id) {
    return { total_items_count: 0, total_stock_value: '0', unposted_stock_value: '0', recent_receipts: [], recent_sales: [] };
  }

  const countRow = await db.executeQuery<{ cnt: number }>(sql<{ cnt: number }>`
    SELECT COUNT(*)::int AS cnt FROM inventory_items
    WHERE business_id = ${business_id} AND deleted_at IS NULL
  `.compile(db));

  const valueRow = await db.executeQuery<{ total: string }>(sql<{ total: string }>`
    SELECT COALESCE(SUM(sm.total_cost), 0)::text AS total
      FROM stock_movements sm
      JOIN inventory_items i ON i.id = sm.inventory_item_id
     WHERE i.business_id = ${business_id}
       AND i.deleted_at IS NULL
  `.compile(db));
  const unposted = await unpostedStockValue(db, business_id);

  const recentReceipts = await db.executeQuery<{ id: string; receipt_date: string; po_number: string }>(sql<{ id: string; receipt_date: string; po_number: string }>`
    SELECT ir.id, ir.receipt_date::text AS receipt_date, po.po_number
      FROM item_receipts ir
      JOIN purchase_orders po ON po.id = ir.purchase_order_id
     WHERE ir.business_id = ${business_id}
     ORDER BY ir.receipt_date DESC
     LIMIT 5
  `.compile(db));

  const recentSales = await db.executeQuery<{ id: string; order_date: string; so_number: string }>(sql<{ id: string; order_date: string; so_number: string }>`
    SELECT id, order_date::text AS order_date, so_number
      FROM sales_orders
     WHERE business_id = ${business_id} AND status = 'fulfilled'
     ORDER BY order_date DESC
     LIMIT 5
  `.compile(db));

  return {
    total_items_count: countRow.rows[0]?.cnt ?? 0,
    total_stock_value: valueRow.rows[0]?.total ?? '0',
    unposted_stock_value: unposted,
    recent_receipts: recentReceipts.rows,
    recent_sales: recentSales.rows,
  };
}
