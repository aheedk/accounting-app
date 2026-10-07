import { sql, type Kysely } from 'kysely';
import type { DB } from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type ApOverview = {
  outstanding_bills_total: string;
  /** Vendor credits not yet used and bill payments not yet applied. */
  unused_credits_total: string;
  /** Outstanding bills less unused credits: equals Accounts Payable in the ledger. */
  net_payable_total: string;
  overdue_bills_count: number;
  upcoming_payments_7d: string;
  upcoming_payments_30d: string;
  top_vendors: { vendor_id: string; vendor_name: string; outstanding: string }[];
};

// Read-only aggregate over bills + bill_payment_applications + vendors.
// Note: bill_payment_applications uses column `applied_amount` (per migration 0018).
export async function getOverview(db: Kysely<DB>, ctx: ServiceCtx): Promise<ApOverview> {
  const business_id = ctx.business_id;
  if (!business_id) {
    return {
      outstanding_bills_total: '0',
      unused_credits_total: '0',
      net_payable_total: '0',
      overdue_bills_count: 0,
      upcoming_payments_7d: '0',
      upcoming_payments_30d: '0',
      top_vendors: [],
    };
  }

  // Outstanding = bills.total - SUM(bill_payment_applications.applied_amount) per bill,
  // for posted bills only (paid bills have status='paid' and are excluded).
  const outstandingRow = await db.executeQuery<{ total: string }>(sql<{ total: string }>`
    SELECT COALESCE(SUM(b.total - COALESCE(p.applied, 0)), 0)::text AS total
      FROM bills b
      LEFT JOIN (
        SELECT bill_id, SUM(applied_amount) AS applied
          FROM bill_payment_applications
         GROUP BY bill_id
      ) p ON p.bill_id = b.id
     WHERE b.business_id = ${business_id}
       AND b.status = 'posted'
       AND b.deleted_at IS NULL
  `.compile(db));

  const creditsRow = await db.executeQuery<{ total: string }>(sql<{ total: string }>`
    SELECT (
      COALESCE((SELECT SUM(remaining_amount) FROM vendor_credits
                 WHERE business_id = ${business_id} AND status IN ('posted', 'applied')), 0)
      + COALESCE((SELECT SUM(unapplied_amount) FROM bill_payments
                   WHERE business_id = ${business_id} AND status = 'posted'), 0)
    )::text AS total
  `.compile(db));
  const outstanding = outstandingRow.rows[0]?.total ?? '0';
  const unusedCredits = creditsRow.rows[0]?.total ?? '0';

  const overdueRow = await db.executeQuery<{ cnt: number }>(sql<{ cnt: number }>`
    SELECT COUNT(*)::int AS cnt
      FROM bills b
      LEFT JOIN (
        SELECT bill_id, SUM(applied_amount) AS applied
          FROM bill_payment_applications
         GROUP BY bill_id
      ) p ON p.bill_id = b.id
     WHERE b.business_id = ${business_id}
       AND b.status = 'posted'
       AND b.deleted_at IS NULL
       AND b.due_date < now()::date
       AND (b.total - COALESCE(p.applied, 0)) > 0
  `.compile(db));

  const upcomingTotal = (days: number) => sql<{ total: string }>`
    SELECT COALESCE(SUM(b.total - COALESCE(p.applied, 0)), 0)::text AS total
      FROM bills b
      LEFT JOIN (
        SELECT bill_id, SUM(applied_amount) AS applied
          FROM bill_payment_applications
         GROUP BY bill_id
      ) p ON p.bill_id = b.id
     WHERE b.business_id = ${business_id}
       AND b.status = 'posted'
       AND b.deleted_at IS NULL
       AND b.due_date BETWEEN now()::date AND (now() + (${days} || ' days')::interval)::date
       AND (b.total - COALESCE(p.applied, 0)) > 0
  `.compile(db);
  const upcoming7Row = await db.executeQuery<{ total: string }>(upcomingTotal(7));
  const upcoming30Row = await db.executeQuery<{ total: string }>(upcomingTotal(30));

  const top = await db.executeQuery<{ vendor_id: string; vendor_name: string; outstanding: string }>(
    sql<{ vendor_id: string; vendor_name: string; outstanding: string }>`
      SELECT v.id AS vendor_id, v.name AS vendor_name,
             SUM(b.total - COALESCE(p.applied, 0))::text AS outstanding
        FROM bills b
        JOIN vendors v ON v.id = b.vendor_id
        LEFT JOIN (
          SELECT bill_id, SUM(applied_amount) AS applied
            FROM bill_payment_applications
           GROUP BY bill_id
        ) p ON p.bill_id = b.id
       WHERE b.business_id = ${business_id}
         AND b.status = 'posted'
         AND b.deleted_at IS NULL
         AND (b.total - COALESCE(p.applied, 0)) > 0
       GROUP BY v.id, v.name
       ORDER BY SUM(b.total - COALESCE(p.applied, 0)) DESC
       LIMIT 5
    `.compile(db),
  );

  return {
    outstanding_bills_total: outstanding,
    unused_credits_total: unusedCredits,
    net_payable_total: (Number(outstanding) - Number(unusedCredits)).toFixed(4),
    overdue_bills_count: overdueRow.rows[0]?.cnt ?? 0,
    upcoming_payments_7d: upcoming7Row.rows[0]?.total ?? '0',
    upcoming_payments_30d: upcoming30Row.rows[0]?.total ?? '0',
    top_vendors: top.rows.map(r => ({
      vendor_id: r.vendor_id, vendor_name: r.vendor_name, outstanding: r.outstanding,
    })),
  };
}
