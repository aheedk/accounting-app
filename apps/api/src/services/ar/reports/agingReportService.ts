import { type Kysely } from 'kysely';
import { addMoney, subMoney, toMoneyString } from '@accounting/shared';
import type { DB } from '../../../db/types.js';
import { AgingTable, bucketFor, daysBetween, type AgingRow, type Bucket } from '../../reports/agingBuckets.js';

export type { AgingRow };

/** One invoice with a balance still owed — the Aging report's own per-invoice
 * figures, before they're summed into a customer's buckets. What the Open
 * Invoices and Aging Detail reports read directly, so they tie out to Aging
 * the same way every other standard report ties out to what it's built from. */
export type OpenInvoice = {
  id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  issue_date: string;
  due_date: string;
  total: string;
  open: string;
  bucket: Bucket;
};

/** Every posted invoice with a balance still owed, as of a date — no business
 * filters here beyond the account, since Reconcile and other callers always
 * scope by business_id themselves; kept separate from `customerAging` so
 * both it and the Open Invoices report run the exact same query once. */
export async function openInvoices(db: Kysely<DB>, q: { business_id: string; as_of: string }): Promise<OpenInvoice[]> {
  const invoices = await db.selectFrom('invoices as i')
    .innerJoin('customers as c', 'c.id', 'i.customer_id')
    .select(['i.id', 'i.invoice_number', 'i.customer_id', 'c.name as customer_name', 'i.issue_date', 'i.due_date', 'i.total'])
    .where('i.business_id', '=', q.business_id)
    .where('i.status', 'in', ['posted', 'paid'])
    .where('i.deleted_at', 'is', null)
    .execute();
  if (invoices.length === 0) return [];

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
  return invoices
    .map(inv => ({ ...inv, open: toMoneyString(subMoney(inv.total, applied.get(inv.id) ?? '0')) }))
    .filter(inv => parseFloat(inv.open) > 0)
    .map(inv => ({ ...inv, bucket: bucketFor(daysBetween(q.as_of, inv.due_date)) }))
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
}

/**
 * A/R aging per customer: open invoices by days past due, less what the customer
 * has on account (payments not yet applied, credit memos not yet used). The
 * credits are what make the total agree with Accounts Receivable in the ledger.
 */
export async function customerAging(db: Kysely<DB>, q: { business_id: string; as_of: string }): Promise<AgingRow[]> {
  const table = new AgingTable();

  for (const inv of await openInvoices(db, q)) {
    table.add({ id: inv.customer_id, name: inv.customer_name }, inv.open, daysBetween(q.as_of, inv.due_date));
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
