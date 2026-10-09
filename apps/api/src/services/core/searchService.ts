import { type Kysely } from 'kysely';
import type { DB } from '../../db/types.js';

// The search box in the top bar: finds a client's records by name or number.
// Read-only, and always inside one business.

export type SearchResult = {
  type: 'customer' | 'vendor' | 'invoice' | 'bill' | 'check';
  id: string;
  /** What the person typed for: a name, or "Invoice 1042". */
  label: string;
  /** Who it belongs to, for an invoice, bill, or check. */
  detail: string | null;
  /**
   * Where this result's own type normally lives (customer/vendor/invoice/
   * bill). A check is the exception — this business's historical checks are
   * expense_transactions rows (payment_method='check'), not real `checks`
   * table rows (the Write Check feature postdates them; see checkService.
   * listChecks for the same split) — so unlike the other types, a check
   * result's target page varies per row, not per type.
   */
  path: string;
};

const PER_TYPE = 5;

/** Makes the typed text literal inside a LIKE pattern ("50%" must not match everything). */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, char => `\\${char}`)}%`;
}

export async function searchRecords(
  db: Kysely<DB>, q: { business_id: string; query: string },
): Promise<SearchResult[]> {
  const text = q.query.trim();
  if (text.length < 2) return [];
  const pattern = likePattern(text);

  const [customers, vendors, invoices, bills, checks, legacyChecks] = await Promise.all([
    db.selectFrom('customers').select(['id', 'name'])
      .where('business_id', '=', q.business_id)
      .where('deleted_at', 'is', null)
      .where('name', 'ilike', pattern)
      .orderBy('name').limit(PER_TYPE).execute(),
    db.selectFrom('vendors').select(['id', 'name'])
      .where('business_id', '=', q.business_id)
      .where('deleted_at', 'is', null)
      .where('name', 'ilike', pattern)
      .orderBy('name').limit(PER_TYPE).execute(),
    db.selectFrom('invoices as i')
      .innerJoin('customers as c', 'c.id', 'i.customer_id')
      .select(['i.id', 'i.invoice_number', 'c.name as party'])
      .where('i.business_id', '=', q.business_id)
      .where('i.deleted_at', 'is', null)
      .where(eb => eb.or([eb('i.invoice_number', 'ilike', pattern), eb('c.name', 'ilike', pattern)]))
      .orderBy('i.issue_date', 'desc').limit(PER_TYPE).execute(),
    db.selectFrom('bills as b')
      .innerJoin('vendors as v', 'v.id', 'b.vendor_id')
      .select(['b.id', 'b.bill_number', 'v.name as party'])
      .where('b.business_id', '=', q.business_id)
      .where('b.deleted_at', 'is', null)
      .where(eb => eb.or([eb('b.bill_number', 'ilike', pattern), eb('v.name', 'ilike', pattern)]))
      .orderBy('b.bill_date', 'desc').limit(PER_TYPE).execute(),
    // Checks written through the Write Check feature.
    db.selectFrom('checks as ch')
      .leftJoin('vendors as v', 'v.id', 'ch.payee_id')
      .select(['ch.id', 'ch.check_number', 'v.name as vendor_name', 'ch.payee_text'])
      .where('ch.business_id', '=', q.business_id)
      .where(eb => eb.or([eb('ch.check_number', 'ilike', pattern), eb('ch.payee_text', 'ilike', pattern), eb('v.name', 'ilike', pattern)]))
      .orderBy('ch.payment_date', 'desc').limit(PER_TYPE).execute(),
    // This client's historical checks — expense_transactions rows paid by
    // check, from before the Write Check feature existed (see the `path`
    // field's doc comment above).
    db.selectFrom('expense_transactions as e')
      .leftJoin('vendors as v', 'v.id', 'e.vendor_id')
      .select(['e.id', 'e.reference', 'v.name as vendor_name', 'e.payee_text'])
      .where('e.business_id', '=', q.business_id)
      .where('e.payment_method', '=', 'check')
      .where(eb => eb.or([eb('e.reference', 'ilike', pattern), eb('e.payee_text', 'ilike', pattern), eb('v.name', 'ilike', pattern)]))
      .orderBy('e.transaction_date', 'desc').limit(PER_TYPE).execute(),
  ]);

  return [
    ...customers.map(row => ({ type: 'customer' as const, id: row.id, label: row.name, detail: null, path: `/customers/${row.id}` })),
    ...vendors.map(row => ({ type: 'vendor' as const, id: row.id, label: row.name, detail: null, path: `/ap/vendors/${row.id}` })),
    ...invoices.map(row => ({ type: 'invoice' as const, id: row.id, label: `Invoice ${row.invoice_number}`, detail: row.party, path: `/invoices/${row.id}` })),
    ...bills.map(row => ({ type: 'bill' as const, id: row.id, label: `Bill ${row.bill_number}`, detail: row.party, path: `/ap/bills/${row.id}` })),
    ...checks.map(row => ({
      type: 'check' as const, id: row.id, label: `Check ${row.check_number}`,
      detail: row.vendor_name ?? row.payee_text, path: `/accounting/checks/${row.id}`,
    })),
    ...legacyChecks.map(row => ({
      type: 'check' as const, id: row.id, label: row.reference ? `Check ${row.reference}` : 'Check',
      detail: row.vendor_name ?? row.payee_text, path: `/accounting/expenses/${row.id}`,
    })),
  ];
}
