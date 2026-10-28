import { type Kysely } from 'kysely';
import { addMoney, subMoney, toMoneyString } from '@accounting/shared';
import type { DB, PaymentMethod } from '../../../db/types.js';

// Invoices and Received Payments (item 18): each invoice dated in the period,
// with the payments and credit memos applied to it. The same invoices and
// applications as the Open Invoices report (agingReportService.openInvoices),
// so what is left open on each ties out to it and to A/R Aging.
// Spec: docs/specs/2026-10-07-report-set-design.md, section 3.

export type InvoiceApplication = {
  id: string;
  kind: 'payment' | 'credit_memo';
  /** The payment or the credit memo. */
  source_id: string;
  date: string;
  /** The payment's reference (a check number, say), or the credit memo's number. */
  number: string | null;
  method: PaymentMethod | null;
  amount: string;
};

export type InvoiceWithPayments = {
  id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  issue_date: string;
  due_date: string;
  total: string;
  /** What is still owed today, after everything applied below. */
  open: string;
  /** Oldest first. */
  applications: InvoiceApplication[];
};

/**
 * The posted invoices dated in the period (paid ones too; not drafts or voided
 * ones), each with what was applied to it from posted payments and credit memos,
 * whenever that was.
 */
export async function invoicesAndPayments(
  db: Kysely<DB>, q: { business_id: string; period_start: string; period_end: string },
): Promise<InvoiceWithPayments[]> {
  const invoices = await db.selectFrom('invoices as i')
    .innerJoin('customers as c', 'c.id', 'i.customer_id')
    .select(['i.id', 'i.invoice_number', 'i.customer_id', 'c.name as customer_name', 'i.issue_date', 'i.due_date', 'i.total'])
    .where('i.business_id', '=', q.business_id)
    .where('i.status', 'in', ['posted', 'paid'])
    .where('i.deleted_at', 'is', null)
    .where('i.issue_date', '>=', q.period_start)
    .where('i.issue_date', '<=', q.period_end)
    .orderBy('c.name').orderBy('i.issue_date').orderBy('i.invoice_number')
    .execute();
  if (invoices.length === 0) return [];

  const applied = await db.selectFrom('payment_applications as pa')
    .leftJoin('payments as p', 'p.id', 'pa.payment_id')
    .leftJoin('credit_memos as cm', 'cm.id', 'pa.credit_memo_id')
    .select([
      'pa.id', 'pa.invoice_id', 'pa.applied_amount', 'pa.payment_id', 'pa.credit_memo_id',
      'p.payment_date', 'p.reference', 'p.payment_method', 'cm.memo_date', 'cm.credit_memo_number',
    ])
    .where('pa.invoice_id', 'in', invoices.map(i => i.id))
    .where(eb => eb.or([eb('p.status', '=', 'posted'), eb('cm.status', 'in', ['posted', 'applied'])]))
    .execute();

  const byInvoice = new Map<string, InvoiceApplication[]>();
  for (const a of applied) {
    const application: InvoiceApplication = a.payment_id !== null
      ? { id: a.id, kind: 'payment', source_id: a.payment_id, date: a.payment_date ?? '', number: a.reference, method: a.payment_method, amount: a.applied_amount }
      : { id: a.id, kind: 'credit_memo', source_id: a.credit_memo_id ?? '', date: a.memo_date ?? '', number: a.credit_memo_number, method: null, amount: a.applied_amount };
    byInvoice.set(a.invoice_id, [...(byInvoice.get(a.invoice_id) ?? []), application]);
  }

  return invoices.map(inv => {
    const applications = (byInvoice.get(inv.id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
    const paid = applications.reduce<string>((total, a) => toMoneyString(addMoney(total, a.amount)), '0');
    return { ...inv, open: toMoneyString(subMoney(inv.total, paid)), applications };
  });
}
