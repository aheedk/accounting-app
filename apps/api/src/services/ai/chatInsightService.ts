import { sql, type Kysely } from 'kysely';
import type { DB } from '../../db/types.js';
import { callClaudeForText } from './chatLlm.js';
import Anthropic from '@anthropic-ai/sdk';

/**
 * The 5 predefined metrics behind "insight" intent. These are fixed,
 * known queries — not LLM-generated SQL — so they're written directly with
 * Kysely's type-safe query builder (every one already scoped by
 * `business_id`, the same convention as every other service in this
 * codebase) rather than routed through chatSqlEngine's guardrail, which
 * exists specifically to validate *LLM-authored* text. One of these also
 * reads `bank_accounts`, a table outside chatSqlGuardrail's allow-list for
 * the text-to-SQL path — fine here since this code is trusted, not
 * model-generated.
 */
export type InsightMetrics = {
  revenue_this_month: string;
  revenue_last_month: string;
  expense_this_month: string;
  expense_last_month: string;
  overdue_ar_total: string;
  top_expense_accounts: Array<{ account_name: string; amount: string }>;
  cash_balance: string;
};

function monthBounds(monthsAgo: number): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

async function sumByAccountType(
  db: Kysely<DB>, businessId: string, accountType: 'revenue' | 'expense', start: string, end: string,
): Promise<string> {
  const sign = accountType === 'revenue' ? sql<string>`jel.credit - jel.debit` : sql<string>`jel.debit - jel.credit`;
  const row = await db.selectFrom('journal_entry_lines as jel')
    .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .innerJoin('chart_of_accounts as coa', 'coa.id', 'jel.account_id')
    .select(({ fn }) => fn.coalesce(fn.sum<string>(sign), sql.lit('0')).as('total'))
    .where('je.business_id', '=', businessId)
    .where('je.status', '=', 'posted')
    .where('coa.account_type', '=', accountType)
    .where('je.entry_date', '>=', start)
    .where('je.entry_date', '<=', end)
    .executeTakeFirst();
  return row?.total ?? '0';
}

async function overdueArTotal(db: Kysely<DB>, businessId: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const invoices = await db.selectFrom('invoices')
    .select(['id', 'total'])
    .where('business_id', '=', businessId)
    .where('status', '=', 'posted')
    .where('due_date', '<', today)
    .execute();
  if (invoices.length === 0) return '0';
  const applied = await db.selectFrom('payment_applications')
    .select(({ fn }) => ['invoice_id', fn.coalesce(fn.sum<string>('applied_amount'), sql.lit('0')).as('applied')])
    .where('invoice_id', 'in', invoices.map(i => i.id))
    .groupBy('invoice_id')
    .execute();
  const appliedById = new Map(applied.map(a => [a.invoice_id, parseFloat(a.applied)]));
  const total = invoices.reduce((sum, inv) => sum + (parseFloat(inv.total) - (appliedById.get(inv.id) ?? 0)), 0);
  return total.toFixed(2);
}

async function topExpenseAccounts(db: Kysely<DB>, businessId: string, start: string, end: string) {
  return db.selectFrom('journal_entry_lines as jel')
    .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .innerJoin('chart_of_accounts as coa', 'coa.id', 'jel.account_id')
    .select(({ fn }) => [
      'coa.name as account_name',
      fn.coalesce(fn.sum<string>(sql<string>`jel.debit - jel.credit`), sql.lit('0')).as('amount'),
    ])
    .where('je.business_id', '=', businessId)
    .where('je.status', '=', 'posted')
    .where('coa.account_type', '=', 'expense')
    .where('je.entry_date', '>=', start)
    .where('je.entry_date', '<=', end)
    .groupBy('coa.name')
    .having(sql<boolean>`SUM(jel.debit - jel.credit) <> 0`)
    .orderBy(sql`SUM(jel.debit - jel.credit)`, 'desc')
    .limit(5)
    .execute();
}

async function cashBalance(db: Kysely<DB>, businessId: string): Promise<string> {
  const bankAccounts = await db.selectFrom('bank_accounts')
    .select('cash_account_id')
    .where('business_id', '=', businessId)
    .where('is_active', '=', true)
    .execute();
  if (bankAccounts.length === 0) return '0';
  const row = await db.selectFrom('journal_entry_lines as jel')
    .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .select(({ fn }) => fn.coalesce(fn.sum<string>(sql<string>`jel.debit - jel.credit`), sql.lit('0')).as('total'))
    .where('je.business_id', '=', businessId)
    .where('je.status', '=', 'posted')
    .where('jel.account_id', 'in', bankAccounts.map(b => b.cash_account_id))
    .executeTakeFirst();
  return row?.total ?? '0';
}

export async function runInsightQueries(db: Kysely<DB>, businessId: string): Promise<InsightMetrics> {
  const thisMonth = monthBounds(0);
  const lastMonth = monthBounds(1);
  const [revenueThis, revenueLast, expenseThis, expenseLast, overdueAr, topExpenses, cash] = await Promise.all([
    sumByAccountType(db, businessId, 'revenue', thisMonth.start, thisMonth.end),
    sumByAccountType(db, businessId, 'revenue', lastMonth.start, lastMonth.end),
    sumByAccountType(db, businessId, 'expense', thisMonth.start, thisMonth.end),
    sumByAccountType(db, businessId, 'expense', lastMonth.start, lastMonth.end),
    overdueArTotal(db, businessId),
    topExpenseAccounts(db, businessId, thisMonth.start, thisMonth.end),
    cashBalance(db, businessId),
  ]);
  return {
    revenue_this_month: revenueThis,
    revenue_last_month: revenueLast,
    expense_this_month: expenseThis,
    expense_last_month: expenseLast,
    overdue_ar_total: overdueAr,
    top_expense_accounts: topExpenses,
    cash_balance: cash,
  };
}

export async function summarizeInsights(metrics: InsightMetrics, client: Anthropic | undefined): Promise<string> {
  const system = 'You are an accounting assistant summarizing a small business\'s financial health. Be specific with numbers (prefix with $). Flag anomalies or concerns plainly. Keep it to a few short paragraphs, not a long report.';
  const metricsText = `Revenue this month: $${metrics.revenue_this_month} (last month: $${metrics.revenue_last_month})
Expenses this month: $${metrics.expense_this_month} (last month: $${metrics.expense_last_month})
Overdue accounts receivable: $${metrics.overdue_ar_total}
Cash balance: $${metrics.cash_balance}
Top expense categories this month:
${metrics.top_expense_accounts.map(a => `  ${a.account_name}: $${a.amount}`).join('\n') || '  (none)'}`;

  return callClaudeForText({
    system,
    history: [{ role: 'user', content: `Summarize the financial health of this business from these numbers:\n\n${metricsText}` }],
    client,
  });
}
