import { type Kysely, sql } from 'kysely';
import { addMoney, subMoney, toMoneyString } from '@accounting/shared';
import type { DB } from '../../../db/types.js';
import { NotFoundError } from '../../../lib/errors.js';

// A customer's statement: what they were billed, what they paid and were
// credited, and what they owe at each step. The kind of page a business sends
// its customer. Spec: docs/specs/2026-10-08-accounts-and-roles-design.md
//
// Only what is in the books counts: posted invoices, posted payments, posted
// credit memos. The closing balance is therefore what the customer owes net of
// money on account, the same figure the A/R Aging report gives for them.

export type StatementLine = {
  date: string;
  type: 'invoice' | 'payment' | 'credit_memo';
  number: string | null;
  /** Adds to what is owed (an invoice). */
  charge: string;
  /** Takes from what is owed (a payment or a credit). */
  credit: string;
  balance: string;
};

export type CustomerStatement = {
  customer: { id: string; name: string };
  period_start: string;
  period_end: string;
  opening_balance: string;
  lines: StatementLine[];
  closing_balance: string;
};

type Movement = { date: string; type: StatementLine['type']; number: string | null; charge: string; credit: string; id: string };

export async function customerStatement(
  db: Kysely<DB>,
  q: { business_id: string; customer_id: string; period_start: string; period_end: string },
): Promise<CustomerStatement> {
  const customer = await db.selectFrom('customers').select(['id', 'name'])
    .where('id', '=', q.customer_id).where('business_id', '=', q.business_id).executeTakeFirst();
  if (!customer) throw new NotFoundError('customer', q.customer_id);

  const result = await sql<Movement>`
    SELECT i.issue_date::text AS date, 'invoice' AS type, i.invoice_number AS number,
           i.total::text AS charge, '0' AS credit, i.id::text AS id
      FROM invoices i
     WHERE i.business_id = ${q.business_id} AND i.customer_id = ${q.customer_id}
       AND i.status IN ('posted', 'paid') AND i.deleted_at IS NULL AND i.issue_date <= ${q.period_end}
    UNION ALL
    SELECT p.payment_date::text, 'payment', p.reference, '0', p.amount::text, p.id::text
      FROM payments p
     WHERE p.business_id = ${q.business_id} AND p.customer_id = ${q.customer_id}
       AND p.status = 'posted' AND p.payment_date <= ${q.period_end}
    UNION ALL
    -- A credit made out of an overpayment is that payment's money, already counted.
    SELECT cm.memo_date::text, 'credit_memo', cm.credit_memo_number, '0', cm.amount::text, cm.id::text
      FROM credit_memos cm
     WHERE cm.business_id = ${q.business_id} AND cm.customer_id = ${q.customer_id}
       AND cm.status IN ('posted', 'applied') AND cm.source_payment_id IS NULL AND cm.memo_date <= ${q.period_end}
    ORDER BY date, type, id
  `.execute(db);

  let balance = '0';
  let opening = '0';
  const lines: StatementLine[] = [];
  for (const m of result.rows) {
    balance = toMoneyString(subMoney(addMoney(balance, m.charge), m.credit));
    if (m.date < q.period_start) { opening = balance; continue; }
    lines.push({ date: m.date, type: m.type, number: m.number, charge: toMoneyString(m.charge), credit: toMoneyString(m.credit), balance });
  }
  return {
    customer,
    period_start: q.period_start,
    period_end: q.period_end,
    opening_balance: toMoneyString(opening),
    lines,
    closing_balance: toMoneyString(balance),
  };
}
