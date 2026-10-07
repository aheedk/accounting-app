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
  gross_profit: string;  // revenue - cost of goods sold
  operating_expenses_total: string;
  operating_income: string;  // gross_profit - operating_expenses
  other_expenses_total: string;
  net_income: string;
};

// The detail types under "Cost of Goods Sold" and "Other Expense" in the Chart of Accounts.
const COGS_DETAIL_TYPES = new Set([
  'Cost of labor - COS', 'Equipment Rental - COS', 'Other Costs of Services - COS',
  'Shipping, Freight & Delivery - COS', 'Supplies & Materials - COGS',
]);
const OTHER_EXPENSE_DETAIL_TYPES = new Set([
  'Amortization', 'Depreciation', 'Exchange Gain or Loss', 'Gas And Fuel', 'Home Office',
  'Homeowner Rental Insurance', 'Mortgage Interest Home Office', 'Other Home Office Expenses',
  'Other Miscellaneous Expense', 'Other Vehicle Expenses', 'Parking and Tolls', 'Penalties & Settlements',
  'Property Tax Home Office', 'Rent and Lease Home Office', 'Repairs and Maintenance Home Office',
  'Utilities Home Office', 'Vehicle', 'Vehicle Insurance', 'Vehicle Lease', 'Vehicle Loan',
  'Vehicle Loan Interest', 'Vehicle Registration', 'Vehicle Repairs', 'Wash and Road Services',
]);

/**
 * Where an expense account sits on the P&L. Read from its detail type, since
 * account numbers are the client's own and follow no fixed plan; an account
 * with no detail type falls back to its name, then to the 50xx convention.
 * Anything not marked otherwise is an operating expense.
 */
export function expenseSection(
  account: { code: string; name: string; detail_type: string | null },
): 'cogs' | 'operating' | 'other' {
  if (account.detail_type && COGS_DETAIL_TYPES.has(account.detail_type)) return 'cogs';
  if (account.detail_type && OTHER_EXPENSE_DETAIL_TYPES.has(account.detail_type)) return 'other';
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
      const section = expenseSection(r);
      if (section === 'cogs') cogs = toMoneyString(addMoney(cogs, amt));
      else if (section === 'operating') opex = toMoneyString(addMoney(opex, amt));
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
