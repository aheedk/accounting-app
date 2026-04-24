import { type Kysely, sql } from 'kysely';
import type { DB } from '../../db/types.js';
import type { ServiceCtx } from '../../lib/ctx.js';

export type ManagementReport = {
  // last 12 months, formatted as YYYY-MM, oldest -> newest
  revenue_by_month: Array<{ month: string; amount: string }>;
  // top 10 expense accounts by total debit over the same 12-month window
  expense_breakdown: Array<{ account_code: string; account_name: string; amount: string }>;
  total_revenue_last_12: string;
  total_expense_last_12: string;
  // NOTE: Skipping gross-margin / AR-AP days / current-ratio for slice 12 — those
  // require business-rule decisions about what counts as cost-of-goods-sold etc.
};

type MonthAmtRow = { month: string; amount: string };
type ExpenseBreakdownRow = { account_code: string; account_name: string; amount: string };
type TotalRow = { total: string };

/**
 * Read-only management report aggregating posted JE activity over the last 12 months.
 * Months without any activity still appear with amount = '0' (generate_series scaffold).
 * Reversal JEs are excluded so voided entries net out cleanly (mirrors profitLossService).
 */
export async function getManagementReport(db: Kysely<DB>, ctx: ServiceCtx): Promise<ManagementReport> {
  const business_id = ctx.business_id;
  if (!business_id) {
    return {
      revenue_by_month: [],
      expense_breakdown: [],
      total_revenue_last_12: '0',
      total_expense_last_12: '0',
    };
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

  // Top 10 expense accounts over the same 12-month window
  const breakdownRes = await db.executeQuery<ExpenseBreakdownRow>(sql<ExpenseBreakdownRow>`
    SELECT
      coa.code AS account_code,
      coa.name AS account_name,
      SUM(jel.debit - jel.credit)::text AS amount
    FROM chart_of_accounts coa
    JOIN journal_entry_lines jel ON jel.account_id = coa.id
    JOIN journal_entries je
      ON je.id = jel.journal_entry_id
     AND je.status = 'posted'
     AND je.reversed_entry_id IS NULL
     AND je.entry_date >= (date_trunc('month', now()) - interval '11 months')::date
    WHERE coa.business_id = ${business_id}::uuid
      AND coa.account_type = 'expense'
    GROUP BY coa.code, coa.name
    HAVING SUM(jel.debit - jel.credit) <> 0
    ORDER BY SUM(jel.debit - jel.credit) DESC
    LIMIT 10
  `.compile(db));

  const totalRevenueRes = await db.executeQuery<TotalRow>(sql<TotalRow>`
    SELECT COALESCE(SUM(jel.credit - jel.debit), 0)::text AS total
    FROM journal_entry_lines jel
    JOIN journal_entries je
      ON je.id = jel.journal_entry_id
     AND je.status = 'posted'
     AND je.reversed_entry_id IS NULL
     AND je.entry_date >= (date_trunc('month', now()) - interval '11 months')::date
    JOIN chart_of_accounts coa
      ON coa.id = jel.account_id AND coa.account_type = 'revenue'
    WHERE coa.business_id = ${business_id}::uuid
  `.compile(db));

  const totalExpenseRes = await db.executeQuery<TotalRow>(sql<TotalRow>`
    SELECT COALESCE(SUM(jel.debit - jel.credit), 0)::text AS total
    FROM journal_entry_lines jel
    JOIN journal_entries je
      ON je.id = jel.journal_entry_id
     AND je.status = 'posted'
     AND je.reversed_entry_id IS NULL
     AND je.entry_date >= (date_trunc('month', now()) - interval '11 months')::date
    JOIN chart_of_accounts coa
      ON coa.id = jel.account_id AND coa.account_type = 'expense'
    WHERE coa.business_id = ${business_id}::uuid
  `.compile(db));

  return {
    revenue_by_month: revenueRes.rows,
    expense_breakdown: breakdownRes.rows,
    total_revenue_last_12: totalRevenueRes.rows[0]?.total ?? '0',
    total_expense_last_12: totalExpenseRes.rows[0]?.total ?? '0',
  };
}
