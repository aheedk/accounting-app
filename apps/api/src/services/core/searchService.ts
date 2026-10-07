import { type Kysely } from 'kysely';
import type { DB } from '../../db/types.js';

// The search box in the top bar: finds a client's records by name or number.
// Read-only, and always inside one business.

export type SearchResult = {
  type: 'customer' | 'vendor' | 'invoice' | 'bill';
  id: string;
  /** What the person typed for: a name, or "Invoice 1042". */
  label: string;
  /** Who it belongs to, for an invoice or bill. */
  detail: string | null;
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

  const [customers, vendors, invoices, bills] = await Promise.all([
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
  ]);

  return [
    ...customers.map(row => ({ type: 'customer' as const, id: row.id, label: row.name, detail: null })),
    ...vendors.map(row => ({ type: 'vendor' as const, id: row.id, label: row.name, detail: null })),
    ...invoices.map(row => ({ type: 'invoice' as const, id: row.id, label: `Invoice ${row.invoice_number}`, detail: row.party })),
    ...bills.map(row => ({ type: 'bill' as const, id: row.id, label: `Bill ${row.bill_number}`, detail: row.party })),
  ];
}
