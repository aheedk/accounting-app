import { type Kysely } from 'kysely';
import { addMoney, toMoneyString } from '@accounting/shared';
import type { DB } from '../../../db/types.js';

// Sales by Product/Service (item 18): income from invoice lines, dated in the
// period, under the product/service each was for — the one standard report
// this needed its own new data: invoice_lines carries no inventory_item_id
// until migration 0112, so a line written before that (or one left as plain
// text) has none and falls under "Not Specified", same as Expenses by Vendor
// already handles a line with no name. Credit memos carry no item of their
// own, so they are not in it — matching Sales by Customer Summary's own call
// on the same question.

const NOT_SPECIFIED = 'Not Specified';

export type SalesByProductLine = {
  item_id: string | null;
  sku: string | null;
  name: string;
  quantity: string;
  amount: string;
};

/** Posted invoices (paid ones too; not drafts or voided ones) dated in the period. */
export async function salesByProduct(
  db: Kysely<DB>, q: { business_id: string; period_start: string; period_end: string },
): Promise<SalesByProductLine[]> {
  const lines = await db.selectFrom('invoice_lines as l')
    .innerJoin('invoices as i', 'i.id', 'l.invoice_id')
    .leftJoin('inventory_items as item', 'item.id', 'l.inventory_item_id')
    .select(['l.inventory_item_id', 'l.quantity', 'l.line_subtotal', 'item.sku', 'item.name'])
    .where('i.business_id', '=', q.business_id)
    .where('i.status', 'in', ['posted', 'paid'])
    .where('i.deleted_at', 'is', null)
    .where('i.issue_date', '>=', q.period_start)
    .where('i.issue_date', '<=', q.period_end)
    .execute();

  const byItem = new Map<string, { item_id: string | null; sku: string | null; name: string; quantity: string; amount: string }>();
  for (const line of lines) {
    const key = line.inventory_item_id ?? NOT_SPECIFIED;
    const own = byItem.get(key) ?? { item_id: line.inventory_item_id, sku: line.sku, name: line.name ?? NOT_SPECIFIED, quantity: '0', amount: '0' };
    own.quantity = toMoneyString(addMoney(own.quantity, line.quantity));
    own.amount = toMoneyString(addMoney(own.amount, line.line_subtotal));
    byItem.set(key, own);
  }

  return [...byItem.values()].sort((a, b) =>
    Number(a.name === NOT_SPECIFIED) - Number(b.name === NOT_SPECIFIED) || a.name.localeCompare(b.name));
}
