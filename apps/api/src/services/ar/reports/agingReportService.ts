import { type Kysely } from 'kysely';
import { addMoney, subMoney, toMoneyString } from '@accounting/shared';
import type { DB } from '../../../db/types.js';
import { AgingTable, daysBetween, type AgingRow } from '../../reports/agingBuckets.js';

export type { AgingRow };

/**
 * A/R aging per customer: open invoices by days past due, less what the customer
 * has on account (payments not yet applied, credit memos not yet used). The
 * credits are what make the total agree with Accounts Receivable in the ledger.
 */
export async function customerAging(db: Kysely<DB>, q: { business_id: string; as_of: string }): Promise<AgingRow[]> {
  const table = new AgingTable();

  const invoices = await db.selectFrom('invoices as i')
    .innerJoin('customers as c', 'c.id', 'i.customer_id')
    .select(['i.id', 'i.customer_id', 'c.name as customer_name', 'i.due_date', 'i.total'])
    .where('i.business_id', '=', q.business_id)
    .where('i.status', 'in', ['posted', 'paid'])
    .where('i.deleted_at', 'is', null)
    .execute();

  if (invoices.length > 0) {
    const applied = new Map<string, string>();
    const apps = await db.selectFrom('payment_applications as pa')
      .leftJoin('payments as p', 'p.id', 'pa.payment_id')
      .leftJoin('credit_memos as cm', 'cm.id', 'pa.credit_memo_id')
      .select(['pa.invoice_id', 'pa.applied_amount'])
      .where('pa.invoice_id', 'in', invoices.map(i => i.id))
      .where(eb => eb.or([eb('p.status', '=', 'posted'), eb('cm.status', 'in', ['posted', 'applied'])]))
      .execute();
    for (const a of apps) {
      applied.set(a.invoice_id, toMoneyString(addMoney(applied.get(a.invoice_id) ?? '0', a.applied_amount)));
    }
    for (const inv of invoices) {
      const open = toMoneyString(subMoney(inv.total, applied.get(inv.id) ?? '0'));
      if (parseFloat(open) <= 0) continue;
      table.add({ id: inv.customer_id, name: inv.customer_name }, open, daysBetween(q.as_of, inv.due_date));
    }
  }

  // Money on account: aged from its own date, shown as a negative.
  const unappliedPayments = await db.selectFrom('payments as p')
    .innerJoin('customers as c', 'c.id', 'p.customer_id')
    .select(['p.customer_id', 'c.name as customer_name', 'p.payment_date as date', 'p.unapplied_amount as amount'])
    .where('p.business_id', '=', q.business_id)
    .where('p.status', '=', 'posted')
    .where('p.unapplied_amount', '>', '0')
    .execute();
  const openCredits = await db.selectFrom('credit_memos as cm')
    .innerJoin('customers as c', 'c.id', 'cm.customer_id')
    .select(['cm.customer_id', 'c.name as customer_name', 'cm.memo_date as date', 'cm.remaining_amount as amount'])
    .where('cm.business_id', '=', q.business_id)
    .where('cm.status', 'in', ['posted', 'applied'])
    .where('cm.remaining_amount', '>', '0')
    .execute();
  for (const credit of [...unappliedPayments, ...openCredits]) {
    table.add(
      { id: credit.customer_id, name: credit.customer_name },
      toMoneyString(subMoney('0', credit.amount)),
      daysBetween(q.as_of, credit.date),
    );
  }

  return table.result();
}
