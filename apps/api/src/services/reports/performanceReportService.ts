import { type Kysely, sql } from 'kysely';
import type { DB } from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type PerformanceReport = {
  revenue_trend: Array<{ month: string; amount: string }>;
  expense_trend: Array<{ month: string; amount: string }>;
  net_income_trend: Array<{ month: string; amount: string }>;
};

type MonthAmtRow = { month: string; amount: string };

/**
 * Read-only 12-month performance trend over posted JE activity.
 * Each series is exactly 12 entries (oldest -> newest), zero-filled where there
 * is no activity. Reversal JEs are excluded so voided entries net out cleanly.
 */
export async function getPerformanceReport(db: Kysely<DB>, ctx: ServiceCtx): Promise<PerformanceReport> {
  const business_id = ctx.business_id;
  if (!business_id) {
    return { revenue_trend: [], expense_trend: [], net_income_trend: [] };
  }

  const revenueRes = await db.executeQuery<MonthAmtRow>(sql<MonthAmtRow>`
    SELECT
      to_char(m.month, 'YYYY-MM') AS month,
      COALESCE(SUM(jel.credit - jel.debit), 0)::text AS amount
    FROM generate_series(
      date_trunc('month', now()) - interval '11 months',
      date_trunc('month', now()),
      interval '1 month'
    ) AS m(month)
    LEFT JOIN journal_entries je
      ON je.business_id = ${business_id}::uuid
     AND je.status = 'posted'
     AND je.reversed_entry_id IS NULL
     AND date_trunc('month', je.entry_date) = m.month
    LEFT JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
    LEFT JOIN chart_of_accounts coa
      ON coa.id = jel.account_id AND coa.account_type = 'revenue'
    GROUP BY m.month
    ORDER BY m.month
  `.compile(db));

  const expenseRes = await db.executeQuery<MonthAmtRow>(sql<MonthAmtRow>`
    SELECT
      to_char(m.month, 'YYYY-MM') AS month,
      COALESCE(SUM(jel.debit - jel.credit), 0)::text AS amount
    FROM generate_series(
      date_trunc('month', now()) - interval '11 months',
      date_trunc('month', now()),
      interval '1 month'
    ) AS m(month)
    LEFT JOIN journal_entries je
      ON je.business_id = ${business_id}::uuid
     AND je.status = 'posted'
     AND je.reversed_entry_id IS NULL
     AND date_trunc('month', je.entry_date) = m.month
    LEFT JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
    LEFT JOIN chart_of_accounts coa
      ON coa.id = jel.account_id AND coa.account_type = 'expense'
    GROUP BY m.month
    ORDER BY m.month
  `.compile(db));

  // Both queries use the same generate_series window so both arrays have the
  // same length & matching months. Net income = revenue - expense per month.
  const revenue_trend = revenueRes.rows;
  const expense_trend = expenseRes.rows;
  const net_income_trend: MonthAmtRow[] = revenue_trend.map((r, i) => {
    const exp = expense_trend[i]?.amount ?? '0';
    const net = (Number(r.amount) - Number(exp)).toString();
    return { month: r.month, amount: net };
  });

  return { revenue_trend, expense_trend, net_income_trend };
}
