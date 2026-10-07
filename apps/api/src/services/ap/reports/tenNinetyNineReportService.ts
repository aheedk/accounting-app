import { type Kysely, sql } from 'kysely';
import { addMoney, toMoneyString } from '@accounting/shared';
import type { DB, PaymentMethod } from '../../../db/types.js';

export type TenNinetyNineRow = {
  vendor_id: string;
  vendor_name: string;
  tax_id_last_four: string | null;
  tax_id_type: 'SSN' | 'EIN' | null;
  total_paid: string;
};

// Card payments are reported by the card processor on a 1099-K, not by the payer.
const CARD_METHODS: PaymentMethod[] = ['card', 'credit_card', 'debit_card'];

/**
 * What each 1099 vendor was paid in the year: bill payments, expenses paid
 * straight to the vendor, and checks written to them. Card payments are left out.
 */
export async function tenNinetyNine(db: Kysely<DB>, q: { business_id: string; year: number }): Promise<TenNinetyNineRow[]> {
  const start = `${q.year}-01-01`;
  const end = `${q.year}-12-31`;

  const vendors = await db.selectFrom('vendors')
    .select(['id', 'name', 'tax_id_last_four', 'tax_id_type'])
    .where('business_id', '=', q.business_id)
    .where('is_1099', '=', true)
    .where('deleted_at', 'is', null)
    .orderBy('name')
    .execute();
  if (vendors.length === 0) return [];
  const vendorIds = vendors.map(v => v.id);

  const billPayments = await db.selectFrom('bill_payments')
    .select(({ fn }) => ['vendor_id', fn.coalesce(fn.sum<string>('amount'), sql.lit('0')).as('total')])
    .where('business_id', '=', q.business_id)
    .where('status', '=', 'posted')
    .where('payment_date', '>=', start)
    .where('payment_date', '<=', end)
    .where('payment_method', 'not in', CARD_METHODS)
    .where('vendor_id', 'in', vendorIds)
    .groupBy('vendor_id')
    .execute();

  const expenses = await db.selectFrom('expense_transactions')
    .select(({ fn }) => ['vendor_id', fn.coalesce(fn.sum<string>('total_amount'), sql.lit('0')).as('total')])
    .where('business_id', '=', q.business_id)
    .where('status', '=', 'posted')
    .where('transaction_date', '>=', start)
    .where('transaction_date', '<=', end)
    .where('payment_method', 'not in', CARD_METHODS)
    .where('vendor_id', 'in', vendorIds)
    .groupBy('vendor_id')
    .execute();

  const checks = await db.selectFrom('checks')
    .select(({ fn }) => ['payee_id as vendor_id', fn.coalesce(fn.sum<string>('total_amount'), sql.lit('0')).as('total')])
    .where('business_id', '=', q.business_id)
    .where('status', '=', 'posted')
    .where('payment_date', '>=', start)
    .where('payment_date', '<=', end)
    .where('payee_type', '=', 'vendor')
    .where('payee_id', 'in', vendorIds)
    .groupBy('payee_id')
    .execute();

  const paid = new Map<string, string>();
  for (const row of [...billPayments, ...expenses, ...checks]) {
    if (!row.vendor_id) continue;
    paid.set(row.vendor_id, toMoneyString(addMoney(paid.get(row.vendor_id) ?? '0', row.total ?? '0')));
  }

  return vendors.filter(v => paid.has(v.id)).map(v => ({
    vendor_id: v.id,
    vendor_name: v.name,
    tax_id_last_four: v.tax_id_last_four,
    tax_id_type: v.tax_id_type,
    total_paid: toMoneyString(addMoney(paid.get(v.id) ?? '0', '0')),
  }));
}
