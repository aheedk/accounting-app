import { type Kysely } from 'kysely';
import { addMoney, subMoney, toMoneyString } from '@accounting/shared';
import type { DB } from '../../../db/types.js';
import { AgingTable, daysBetween, type AgingRow } from '../../reports/agingBuckets.js';

/**
 * A/P aging per vendor: unpaid bills by days past due, less what the vendor owes
 * back (bill payments not yet applied, vendor credits not yet used). The credits
 * are what make the total agree with Accounts Payable in the ledger.
 */
export async function vendorAging(db: Kysely<DB>, q: { business_id: string; as_of: string }): Promise<AgingRow[]> {
  const table = new AgingTable();

  const bills = await db.selectFrom('bills as b')
    .innerJoin('vendors as v', 'v.id', 'b.vendor_id')
    .select(['b.id', 'b.vendor_id', 'v.name as vendor_name', 'b.due_date', 'b.total'])
    .where('b.business_id', '=', q.business_id)
    .where('b.status', 'in', ['posted', 'paid'])
    .where('b.deleted_at', 'is', null)
    .execute();

  if (bills.length > 0) {
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
    for (const bill of bills) {
      const open = toMoneyString(subMoney(bill.total, applied.get(bill.id) ?? '0'));
      if (parseFloat(open) <= 0) continue;
      table.add({ id: bill.vendor_id, name: bill.vendor_name }, open, daysBetween(q.as_of, bill.due_date));
    }
  }

  // Credit with the vendor: aged from its own date, shown as a negative.
  const unappliedPayments = await db.selectFrom('bill_payments as bp')
    .innerJoin('vendors as v', 'v.id', 'bp.vendor_id')
    .select(['bp.vendor_id', 'v.name as vendor_name', 'bp.payment_date as date', 'bp.unapplied_amount as amount'])
    .where('bp.business_id', '=', q.business_id)
    .where('bp.status', '=', 'posted')
    .where('bp.unapplied_amount', '>', '0')
    .execute();
  const openCredits = await db.selectFrom('vendor_credits as vc')
    .innerJoin('vendors as v', 'v.id', 'vc.vendor_id')
    .select(['vc.vendor_id', 'v.name as vendor_name', 'vc.credit_date as date', 'vc.remaining_amount as amount'])
    .where('vc.business_id', '=', q.business_id)
    .where('vc.status', 'in', ['posted', 'applied'])
    .where('vc.remaining_amount', '>', '0')
    .execute();
  for (const credit of [...unappliedPayments, ...openCredits]) {
    table.add(
      { id: credit.vendor_id, name: credit.vendor_name },
      toMoneyString(subMoney('0', credit.amount)),
      daysBetween(q.as_of, credit.date),
    );
  }

  return table.result();
}
