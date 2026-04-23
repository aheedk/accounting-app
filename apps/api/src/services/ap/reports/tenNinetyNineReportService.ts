import { type Kysely, sql } from 'kysely';
import { addMoney, toMoneyString } from '@accounting/shared';
import type { DB } from '../../../db/types.js';

export type TenNinetyNineRow = {
  vendor_id: string;
  vendor_name: string;
  tax_id: string | null;
  total_paid: string;
};

export async function tenNinetyNine(db: Kysely<DB>, q: { business_id: string; year: number }): Promise<TenNinetyNineRow[]> {
  const start = `${q.year}-01-01`;
  const end = `${q.year}-12-31`;
  const rows = await db.selectFrom('bill_payments as bp')
    .innerJoin('vendors as v', 'v.id', 'bp.vendor_id')
    .select(({ fn }) => [
      'v.id as vendor_id', 'v.name as vendor_name', 'v.tax_id',
      fn.coalesce(fn.sum<string>('bp.amount'), sql.lit('0')).as('total_paid'),
    ])
    .where('bp.business_id', '=', q.business_id)
    .where('bp.status', '=', 'posted')
    .where('bp.payment_date', '>=', start)
    .where('bp.payment_date', '<=', end)
    .where('v.is_1099', '=', true)
    .where('v.deleted_at', 'is', null)
    .groupBy(['v.id', 'v.name', 'v.tax_id'])
    .orderBy('v.name')
    .execute();
  return rows.map(r => ({
    vendor_id: r.vendor_id,
    vendor_name: r.vendor_name,
    tax_id: r.tax_id,
    total_paid: toMoneyString(addMoney(r.total_paid ?? '0', '0')),
  }));
}
