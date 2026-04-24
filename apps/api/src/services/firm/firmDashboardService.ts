import { sql, type Kysely } from 'kysely';
import { ERR } from '@accounting/shared';
import type { DB } from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';
import { BusinessRuleError } from '../../lib/errors.js';

export type FirmOverviewRow = {
  business_id: string;
  business_name: string;
  ar_balance: string;
  ap_balance: string;
  unreviewed_bank_txn_count: number;
  open_period_count: number;
  last_reconciliation_date: string | null;
};

// Cross-business firm-level dashboard overview. Read-only aggregate.
// Mirrors the raw-SQL LEFT-JOIN-subquery pattern from ap/apOverviewService.ts.
// Column names verified against migrations:
//   - bill_payment_applications.applied_amount  (0018)
//   - payment_applications.applied_amount       (0013) — NOT `amount_applied`; verified in migration
//   - invoices.total / bills.total              (0012 / 0017)
//   - bank_transactions.status='unreviewed'     (0022)
//   - bank_reconciliations.period_end           (0023)
//   - businesses.deleted_at                     (0003)
export async function getFirmOverview(db: Kysely<DB>, ctx: ServiceCtx): Promise<FirmOverviewRow[]> {
  if (ctx.effective_role !== 'firm_admin') {
    throw new BusinessRuleError(ERR.FORBIDDEN, 'firm_admin only');
  }

  const result = await db.executeQuery<FirmOverviewRow>(sql<FirmOverviewRow>`
    SELECT
      b.id AS business_id,
      b.name AS business_name,
      COALESCE(ar.balance, 0)::text AS ar_balance,
      COALESCE(ap.balance, 0)::text AS ap_balance,
      COALESCE(ut.cnt, 0)::int AS unreviewed_bank_txn_count,
      COALESCE(op.cnt, 0)::int AS open_period_count,
      lr.last_period_end::text AS last_reconciliation_date
    FROM businesses b
    LEFT JOIN (
      SELECT i.business_id, SUM(i.total - COALESCE(pa.applied, 0)) AS balance
        FROM invoices i
        LEFT JOIN (
          SELECT invoice_id, SUM(applied_amount) AS applied
            FROM payment_applications GROUP BY invoice_id
        ) pa ON pa.invoice_id = i.id
       WHERE i.status = 'posted' AND i.deleted_at IS NULL
       GROUP BY i.business_id
    ) ar ON ar.business_id = b.id
    LEFT JOIN (
      SELECT bi.business_id, SUM(bi.total - COALESCE(bpa.applied, 0)) AS balance
        FROM bills bi
        LEFT JOIN (
          SELECT bill_id, SUM(applied_amount) AS applied
            FROM bill_payment_applications GROUP BY bill_id
        ) bpa ON bpa.bill_id = bi.id
       WHERE bi.status = 'posted' AND bi.deleted_at IS NULL
       GROUP BY bi.business_id
    ) ap ON ap.business_id = b.id
    LEFT JOIN (
      SELECT business_id, COUNT(*) AS cnt
        FROM bank_transactions WHERE status = 'unreviewed' GROUP BY business_id
    ) ut ON ut.business_id = b.id
    LEFT JOIN (
      SELECT business_id, COUNT(*) AS cnt
        FROM fiscal_periods WHERE status = 'open' GROUP BY business_id
    ) op ON op.business_id = b.id
    LEFT JOIN (
      SELECT br.business_id, MAX(br.period_end) AS last_period_end
        FROM bank_reconciliations br GROUP BY br.business_id
    ) lr ON lr.business_id = b.id
    WHERE b.firm_id = ${ctx.firm_id}
      AND b.deleted_at IS NULL
    ORDER BY b.name
  `.compile(db));

  return result.rows;
}
