import { type Kysely } from 'kysely';
import { addMoney, subMoney, toMoneyString } from '@accounting/shared';
import type { DB } from '../../../db/types.js';
import { AgingTable, bucketFor, daysBetween, type AgingRow, type Bucket } from '../../reports/agingBuckets.js';

/** One bill with a balance still owed — the Aging report's own per-bill
 * figures, before they're summed into a vendor's buckets. What the Unpaid
 * Bills and Aging Detail reports read directly, so they tie out to Aging the
 * same way every other standard report ties out to what it's built from. */
export type UnpaidBill = {
  id: string;
  bill_number: string;
  vendor_id: string;
  vendor_name: string;
  bill_date: string;
  due_date: string;
  total: string;
  open: string;
  bucket: Bucket;
  /** 'Bill', or credit with the vendor: 'Bill Payment' (not yet applied) or 'Vendor Credit' (not yet used). */
  type: 'Bill' | 'Bill Payment' | 'Vendor Credit';
};

/** Every posted bill with a balance still owed, as of a date — kept separate
 * from `vendorAging` so both it and the Unpaid Bills report run the exact
 * same query once. */
export async function unpaidBills(db: Kysely<DB>, q: { business_id: string; as_of: string }): Promise<UnpaidBill[]> {
  const bills = await db.selectFrom('bills as b')
    .innerJoin('vendors as v', 'v.id', 'b.vendor_id')
    .select(['b.id', 'b.bill_number', 'b.vendor_id', 'v.name as vendor_name', 'b.bill_date', 'b.due_date', 'b.total'])
    .where('b.business_id', '=', q.business_id)
    .where('b.status', 'in', ['posted', 'paid'])
    .where('b.deleted_at', 'is', null)
    .execute();
  if (bills.length === 0) return [];

  const applied = new Map<string, string>();
  const apps = await db.selectFrom('bill_payment_applications as bpa')
    .leftJoin('bill_payments as bp', 'bp.id', 'bpa.bill_payment_id')
    .leftJoin('vendor_credits as vc', 'vc.id', 'bpa.vendor_credit_id')
    .select(['bpa.bill_id', 'bpa.applied_amount'])
    .where('bpa.bill_id', 'in', bills.map(b => b.id))
    .where(eb => eb.or([eb('bp.status', '=', 'posted'), eb('vc.status', 'in', ['posted', 'applied'])]))
    .execute();
  for (const a of apps) {
    applied.set(a.bill_id, toMoneyString(addMoney(applied.get(a.bill_id) ?? '0', a.applied_amount)));
  }
  return bills
    .map(bill => ({ ...bill, open: toMoneyString(subMoney(bill.total, applied.get(bill.id) ?? '0')) }))
    .filter(bill => parseFloat(bill.open) > 0)
    .map(bill => ({ ...bill, bucket: bucketFor(daysBetween(q.as_of, bill.due_date)), type: 'Bill' as const }))
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
}

/**
 * Credit with a vendor: bill payments not yet applied and vendor credits not
 * yet used, each as a negative row dated (and aged) from its own date. The
 * Aging summary takes them off each vendor's total; the Unpaid Bills and
 * detail reports list them, as QuickBooks does, so they too add up to
 * Accounts Payable.
 */
export async function openVendorCredits(db: Kysely<DB>, q: { business_id: string; as_of: string }): Promise<UnpaidBill[]> {
  const payments = await db.selectFrom('bill_payments as bp')
    .innerJoin('vendors as v', 'v.id', 'bp.vendor_id')
    .select(['bp.id', 'bp.reference as number', 'bp.vendor_id', 'v.name as vendor_name', 'bp.payment_date as date', 'bp.amount as total', 'bp.unapplied_amount as open'])
    .where('bp.business_id', '=', q.business_id)
    .where('bp.status', '=', 'posted')
    .where('bp.unapplied_amount', '>', '0')
    .execute();
  const credits = await db.selectFrom('vendor_credits as vc')
    .innerJoin('vendors as v', 'v.id', 'vc.vendor_id')
    .select(['vc.id', 'vc.vendor_credit_number as number', 'vc.vendor_id', 'v.name as vendor_name', 'vc.credit_date as date', 'vc.amount as total', 'vc.remaining_amount as open'])
    .where('vc.business_id', '=', q.business_id)
    .where('vc.status', 'in', ['posted', 'applied'])
    .where('vc.remaining_amount', '>', '0')
    .execute();
  const row = (r: (typeof payments)[number], type: 'Bill Payment' | 'Vendor Credit'): UnpaidBill => ({
    id: r.id, bill_number: r.number ?? type, vendor_id: r.vendor_id, vendor_name: r.vendor_name,
    bill_date: r.date, due_date: r.date, total: toMoneyString(subMoney('0', r.total)), open: toMoneyString(subMoney('0', r.open)),
    bucket: bucketFor(daysBetween(q.as_of, r.date)), type,
  });
  return [...payments.map(p => row(p, 'Bill Payment')), ...credits.map(c => row(c, 'Vendor Credit'))]
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
}

/**
 * A/P aging per vendor: unpaid bills by days past due, less what the vendor owes
 * back (bill payments not yet applied, vendor credits not yet used). The credits
 * are what make the total agree with Accounts Payable in the ledger.
 */
export async function vendorAging(db: Kysely<DB>, q: { business_id: string; as_of: string }): Promise<AgingRow[]> {
  const table = new AgingTable();

  for (const bill of await unpaidBills(db, q)) {
    table.add({ id: bill.vendor_id, name: bill.vendor_name }, bill.open, daysBetween(q.as_of, bill.due_date));
  }

  // Credit with the vendor: aged from its own date, shown as a negative.
  for (const credit of await openVendorCredits(db, q)) {
    table.add({ id: credit.vendor_id, name: credit.vendor_name }, credit.open, daysBetween(q.as_of, credit.due_date));
  }

  return table.result();
}
