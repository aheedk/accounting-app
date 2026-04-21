import { type Kysely } from 'kysely';
import { addMoney, subMoney, toMoneyString } from '@accounting/shared';
import type { DB } from '../../../db/types.js';

export type AgingRow = {
  customer_id: string;
  customer_name: string;
  current: string;
  over_30: string;
  over_60: string;
  over_90: string;
  total: string;
};

// Reads open invoices (status posted, not paid) and applications, returns per-customer buckets.
export async function customerAging(db: Kysely<DB>, q: { business_id: string; as_of: string }): Promise<AgingRow[]> {
  const invoices = await db.selectFrom('invoices as i')
    .innerJoin('customers as c', 'c.id', 'i.customer_id')
    .select(['i.id', 'i.customer_id', 'c.name as customer_name', 'i.due_date', 'i.total'])
    .where('i.business_id', '=', q.business_id)
    .where('i.status', 'in', ['posted', 'paid'])
    .where('i.deleted_at', 'is', null)
    .execute();

  if (invoices.length === 0) return [];

  // Build applied lookup
  const appliedMap = new Map<string, string>();
  const apps = await db.selectFrom('payment_applications as pa')
    .leftJoin('payments as p', 'p.id', 'pa.payment_id')
    .leftJoin('credit_memos as cm', 'cm.id', 'pa.credit_memo_id')
    .select(['pa.invoice_id', 'pa.applied_amount'])
    .where('pa.invoice_id', 'in', invoices.map(i => i.id))
    .where(eb => eb.or([eb('p.status', '=', 'posted'), eb('cm.status', 'in', ['posted', 'applied'])]))
    .execute();
  for (const a of apps) {
    const cur = appliedMap.get(a.invoice_id) ?? '0';
    appliedMap.set(a.invoice_id, toMoneyString(addMoney(cur, a.applied_amount)));
  }

  const asOf = new Date(q.as_of + 'T00:00:00Z').getTime();
  const oneDay = 24 * 3600 * 1000;
  const buckets = new Map<string, AgingRow>();

  for (const inv of invoices) {
    const due = new Date(inv.due_date + 'T00:00:00Z').getTime();
    const daysOverdue = Math.floor((asOf - due) / oneDay);
    const open = toMoneyString(subMoney(inv.total, appliedMap.get(inv.id) ?? '0'));
    if (parseFloat(open) <= 0) continue;
    let row = buckets.get(inv.customer_id);
    if (!row) {
      row = { customer_id: inv.customer_id, customer_name: inv.customer_name, current: '0.0000', over_30: '0.0000', over_60: '0.0000', over_90: '0.0000', total: '0.0000' };
      buckets.set(inv.customer_id, row);
    }
    if (daysOverdue <= 0) row.current = toMoneyString(addMoney(row.current, open));
    else if (daysOverdue <= 30) row.over_30 = toMoneyString(addMoney(row.over_30, open));
    else if (daysOverdue <= 60) row.over_60 = toMoneyString(addMoney(row.over_60, open));
    else row.over_90 = toMoneyString(addMoney(row.over_90, open));
    row.total = toMoneyString(addMoney(row.total, open));
  }

  return [...buckets.values()].sort((a, b) => a.customer_name.localeCompare(b.customer_name));
}
