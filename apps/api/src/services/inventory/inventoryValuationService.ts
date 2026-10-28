import { type Kysely } from 'kysely';
import { D, toMoneyString } from '@accounting/shared';
import type { DB, StockMovementReason } from '../../db/types.js';

// The Inventory Valuation reports (item 18): each item's stock and what it
// cost, as of a date. Read from the stock movements, whose costs are what the
// ledger carries for an item that posts (stockMovementService.adjustStock).
// Spec: docs/specs/2026-10-07-report-set-design.md, section 3.

export type ValuationMovement = {
  id: string;
  movement_date: string;
  reason: StockMovementReason;
  memo: string | null;
  quantity: string;
  unit_cost: string | null;
  /** Signed like the quantity: what it added to, or took from, the value of stock. */
  value: string;
};

export type ValuationItem = {
  item_id: string;
  sku: string;
  name: string;
  /** On hand as of the date, and what it cost. */
  quantity: string;
  value: string;
  /** Before `period_start`: where the detail report starts. Zero without one. */
  opening_quantity: string;
  opening_value: string;
  /** The movements from `period_start` to the date, oldest first. None without a `period_start`. */
  movements: ValuationMovement[];
};

/**
 * Every item's stock as of `as_of`. An inactive item is left out unless it
 * still holds stock or moved in the period.
 */
export async function inventoryValuation(
  db: Kysely<DB>, q: { business_id: string; as_of: string; period_start?: string },
): Promise<ValuationItem[]> {
  const items = await db.selectFrom('inventory_items')
    .select(['id', 'sku', 'name', 'is_active'])
    .where('business_id', '=', q.business_id)
    .where('deleted_at', 'is', null)
    .orderBy('name')
    .execute();
  if (items.length === 0) return [];

  const movements = await db.selectFrom('stock_movements')
    .select(['id', 'inventory_item_id', 'movement_date', 'reason', 'memo', 'quantity_delta', 'unit_cost', 'total_cost'])
    .where('inventory_item_id', 'in', items.map(item => item.id))
    .where('movement_date', '<=', q.as_of)
    .orderBy('movement_date')
    .orderBy('created_at')
    .execute();
  const byItem = new Map<string, typeof movements>();
  for (const movement of movements) {
    byItem.set(movement.inventory_item_id, [...(byItem.get(movement.inventory_item_id) ?? []), movement]);
  }

  return items.flatMap(item => {
    const own = byItem.get(item.id) ?? [];
    const before = q.period_start === undefined ? [] : own.filter(m => m.movement_date < q.period_start!);
    const during = q.period_start === undefined ? [] : own.filter(m => m.movement_date >= q.period_start!);
    const total = (list: typeof own, pick: (m: typeof own[number]) => string | null) =>
      toMoneyString(list.reduce((sum, m) => sum.plus(pick(m) ?? '0'), D('0')));
    const quantity = total(own, m => m.quantity_delta);
    const value = total(own, m => m.total_cost);
    if (!item.is_active && D(quantity).isZero() && D(value).isZero() && during.length === 0) return [];
    return [{
      item_id: item.id,
      sku: item.sku,
      name: item.name,
      quantity,
      value,
      opening_quantity: total(before, m => m.quantity_delta),
      opening_value: total(before, m => m.total_cost),
      movements: during.map(m => ({
        id: m.id,
        movement_date: m.movement_date,
        reason: m.reason,
        memo: m.memo,
        quantity: toMoneyString(m.quantity_delta),
        unit_cost: m.unit_cost === null ? null : toMoneyString(m.unit_cost),
        value: toMoneyString(m.total_cost ?? '0'),
      })),
    }];
  });
}
