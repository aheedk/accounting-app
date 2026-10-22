import { type Kysely, sql } from 'kysely';
import { accountGroup, addMoney, subMoney, toMoneyString } from '@accounting/shared';
import type { DB } from '../../db/types.js';

/** Where a line sits on the P&L, in QuickBooks' order (item 83). */
export type PnlSection = 'income' | 'cogs' | 'operating' | 'other_income' | 'other_expense';

export type PnlLine = {
  account_id: string;
  account_code: string;
  account_name: string;
  amount: string;
  section: PnlSection;
};

// revenue_* and expense_* are every income and every expense account, as before
// the sections; the mobile app reads them.
export type PnlReport = {
  period_start: string;
  period_end: string;
  revenue_lines: PnlLine[];
  revenue_total: string;
  expense_lines: PnlLine[];
  expense_total: string;
  income_total: string;  // Income, without Other Income
  cogs_total: string;
  gross_profit: string;  // income - cost of goods sold
  operating_expenses_total: string;
  operating_income: string;  // gross_profit - operating_expenses
  other_income_total: string;
  other_expenses_total: string;
  net_other_income: string;  // other income - other expenses
  net_income: string;
};

/**
 * Whether an income account is Other Income (interest, dividends) rather than
 * the business's own sales. Read from its detail type; one with none is Income
 * unless its name says otherwise.
 */
export function incomeSection(
  account: { name: string; detail_type: string | null },
): 'income' | 'other_income' {
  if (account.detail_type) {
    return accountGroup({ account_type: 'revenue', detail_type: account.detail_type }) === 'Other Income' ? 'other_income' : 'income';
  }
  return /\bother income\b|\binterest (income|earned)\b|\bdividend/i.test(account.name) ? 'other_income' : 'income';
}

/**
 * Where an expense account sits on the P&L. Read from its detail type, since
 * account numbers are the client's own and follow no fixed plan; an account
 * with no detail type falls back to its name, then to the 50xx convention.
 * Anything not marked otherwise is an operating expense.
 */
export function expenseSection(
  account: { code: string; name: string; detail_type: string | null },
): 'cogs' | 'operating' | 'other' {
  // The Chart of Accounts' own list, so an account sits where it shows there,
  // older detail names ("Other Expenses") included.
  if (account.detail_type) {
    const group = accountGroup({ account_type: 'expense', detail_type: account.detail_type });
    if (group === 'Cost of Goods Sold') return 'cogs';
    if (group === 'Other Expense') return 'other';
  }
  if (/cost of goods|cost of sales|\bcogs\b/i.test(account.name)) return 'cogs';
  if (!account.detail_type && account.code.startsWith('50')) return 'cogs';
  return 'operating';
}

export async function profitLoss(db: Kysely<DB>, q: { business_id: string; period_start: string; period_end: string }): Promise<PnlReport> {
  const rows = await db.selectFrom('chart_of_accounts as a')
    .leftJoin('journal_entry_lines as jel', 'jel.account_id', 'a.id')
    .leftJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
    .select(({ fn }) => [
      'a.id as account_id', 'a.code', 'a.name', 'a.account_type', 'a.detail_type',
      fn.coalesce(fn.sum<string>('jel.debit'), sql.lit('0')).as('total_debit'),
      fn.coalesce(fn.sum<string>('jel.credit'), sql.lit('0')).as('total_credit'),
    ])
    .where('a.business_id', '=', q.business_id)
    .where('a.account_type', 'in', ['revenue', 'expense'])
    .where(eb => eb.or([
      eb('je.id', 'is', null),
      eb.and([
        // The ledger's rule (trial balance, general ledger, balance sheet): a voided
        // entry and its reversal are both counted and cancel. Skipping reversals
        // instead also dropped month-end reversing entries, whose originals stay posted.
        eb('je.status', 'in', ['posted', 'voided']),
        eb('je.entry_date', '>=', q.period_start),
        eb('je.entry_date', '<=', q.period_end),
      ]),
    ]))
    .groupBy(['a.id', 'a.code', 'a.name', 'a.account_type', 'a.detail_type'])
    .orderBy('a.code')
    .execute();

  const revenueLines: PnlLine[] = [];
  const expenseLines: PnlLine[] = [];
  const totals: Record<PnlSection, string> = {
    income: '0.0000', cogs: '0.0000', operating: '0.0000', other_income: '0.0000', other_expense: '0.0000',
  };

  for (const r of rows) {
    const debit = r.total_debit ?? '0';
    const credit = r.total_credit ?? '0';
    if (r.account_type === 'revenue') {
      // revenue is credit-normal, report as positive (credit - debit)
      const amt = toMoneyString(subMoney(credit, debit));
      if (parseFloat(amt) === 0) continue;
      const section = incomeSection(r);
      revenueLines.push({ account_id: r.account_id, account_code: r.code, account_name: r.name, amount: amt, section });
      totals[section] = toMoneyString(addMoney(totals[section], amt));
    } else {
      // expense is debit-normal
      const amt = toMoneyString(subMoney(debit, credit));
      if (parseFloat(amt) === 0) continue;
      const kind = expenseSection(r);
      const section: PnlSection = kind === 'other' ? 'other_expense' : kind;
      expenseLines.push({ account_id: r.account_id, account_code: r.code, account_name: r.name, amount: amt, section });
      totals[section] = toMoneyString(addMoney(totals[section], amt));
    }
  }

  const revenueTotal = toMoneyString(addMoney(totals.income, totals.other_income));
  const expenseTotal = toMoneyString(addMoney(addMoney(totals.cogs, totals.operating), totals.other_expense));
  const grossProfit = toMoneyString(subMoney(totals.income, totals.cogs));
  const operatingIncome = toMoneyString(subMoney(grossProfit, totals.operating));
  const netOtherIncome = toMoneyString(subMoney(totals.other_income, totals.other_expense));
  const netIncome = toMoneyString(addMoney(operatingIncome, netOtherIncome));

  return {
    period_start: q.period_start,
    period_end: q.period_end,
    revenue_lines: revenueLines,
    revenue_total: revenueTotal,
    expense_lines: expenseLines,
    expense_total: expenseTotal,
    income_total: totals.income,
    cogs_total: totals.cogs,
    gross_profit: grossProfit,
    operating_expenses_total: totals.operating,
    operating_income: operatingIncome,
    other_income_total: totals.other_income,
    other_expenses_total: totals.other_expense,
    net_other_income: netOtherIncome,
    net_income: netIncome,
  };
}
