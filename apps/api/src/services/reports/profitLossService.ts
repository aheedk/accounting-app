import { type Kysely, sql } from 'kysely';
import { addMoney, subMoney, toMoneyString } from '@accounting/shared';
import type { DB } from '../../db/types.js';

export type PnlLine = {
  account_id: string;
  account_code: string;
  account_name: string;
  amount: string;
};

export type PnlReport = {
  period_start: string;
  period_end: string;
  revenue_lines: PnlLine[];
  revenue_total: string;
  expense_lines: PnlLine[];
  expense_total: string;
  gross_profit: string;  // revenue - COGS (code 50xx)
  operating_expenses_total: string;
  operating_income: string;  // gross_profit - operating_expenses
  other_expenses_total: string;
  net_income: string;
};

export async function profitLoss(db: Kysely<DB>, q: { business_id: string; period_start: string; period_end: string }): Promise<PnlReport> {
  const rows = await db.selectFrom('chart_of_accounts as a')
    .leftJoin('journal_entry_lines as jel', 'jel.account_id', 'a.id')
    .leftJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .select(({ fn }) => [
      'a.id as account_id', 'a.code', 'a.name', 'a.account_type',
      fn.coalesce(fn.sum<string>('jel.debit'), sql.lit('0')).as('total_debit'),
      fn.coalesce(fn.sum<string>('jel.credit'), sql.lit('0')).as('total_credit'),
    ])
    .where('a.business_id', '=', q.business_id)
    .where('a.account_type', 'in', ['revenue', 'expense'])
    .where(eb => eb.or([
      eb('je.id', 'is', null),
      eb.and([
        eb('je.status', '=', 'posted'),
        eb('je.entry_date', '>=', q.period_start),
        eb('je.entry_date', '<=', q.period_end),
        // Exclude reversal JEs so voided entries net out entirely (reversal itself is skipped;
        // the voided original is already filtered by the status='posted' guard above).
        eb('je.reversed_entry_id', 'is', null),
      ]),
    ]))
    .groupBy(['a.id', 'a.code', 'a.name', 'a.account_type'])
    .orderBy('a.code')
    .execute();

  const revenueLines: PnlLine[] = [];
  let revenueTotal = '0.0000';
  const expenseLines: PnlLine[] = [];
  let expenseTotal = '0.0000';
  let cogs = '0.0000';
  let opex = '0.0000';
  let otherExp = '0.0000';

  for (const r of rows) {
    const debit = r.total_debit ?? '0';
    const credit = r.total_credit ?? '0';
    if (r.account_type === 'revenue') {
      // revenue is credit-normal, report as positive (credit - debit)
      const amt = toMoneyString(subMoney(credit, debit));
      if (parseFloat(amt) === 0) continue;
      revenueLines.push({ account_id: r.account_id, account_code: r.code, account_name: r.name, amount: amt });
      revenueTotal = toMoneyString(addMoney(revenueTotal, amt));
    } else {
      // expense is debit-normal
      const amt = toMoneyString(subMoney(debit, credit));
      if (parseFloat(amt) === 0) continue;
      expenseLines.push({ account_id: r.account_id, account_code: r.code, account_name: r.name, amount: amt });
      expenseTotal = toMoneyString(addMoney(expenseTotal, amt));
      if (r.code.startsWith('50')) cogs = toMoneyString(addMoney(cogs, amt));
      else if (r.code.startsWith('6')) opex = toMoneyString(addMoney(opex, amt));
      else otherExp = toMoneyString(addMoney(otherExp, amt));
    }
  }

  const grossProfit = toMoneyString(subMoney(revenueTotal, cogs));
  const operatingIncome = toMoneyString(subMoney(grossProfit, opex));
  const netIncome = toMoneyString(subMoney(revenueTotal, expenseTotal));

  return {
    period_start: q.period_start,
    period_end: q.period_end,
    revenue_lines: revenueLines,
    revenue_total: revenueTotal,
    expense_lines: expenseLines,
    expense_total: expenseTotal,
    gross_profit: grossProfit,
    operating_expenses_total: opex,
    operating_income: operatingIncome,
    other_expenses_total: otherExp,
    net_income: netIncome,
  };
}
