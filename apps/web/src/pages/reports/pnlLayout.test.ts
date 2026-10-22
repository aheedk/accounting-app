import { describe, expect, it } from 'vitest';
import { pnlRows, type PnlReport } from './pnlLayout';

const line = (code: string, name: string, amount: string, section: NonNullable<PnlReport['revenue_lines'][number]['section']>) => ({
  account_id: code, account_code: code, account_name: name, amount, section,
});

describe('pnlRows', () => {
  it('lays the P&L out as QuickBooks does: cost of goods before Gross Profit, other income after Net Operating Income', () => {
    const report: PnlReport = {
      period_start: '2026-04-01',
      period_end: '2026-04-30',
      revenue_lines: [line('4010', 'Sales', '1000.0000', 'income'), line('7010', 'Interest Earned', '40.0000', 'other_income')],
      revenue_total: '1040.0000',
      expense_lines: [
        line('5010', 'Cost of Goods Sold', '300.0000', 'cogs'),
        line('6200', 'Rent', '100.0000', 'operating'),
        line('8010', 'Penalties', '15.0000', 'other_expense'),
      ],
      expense_total: '415.0000',
      income_total: '1000.0000',
      cogs_total: '300.0000',
      gross_profit: '700.0000',
      operating_expenses_total: '100.0000',
      operating_income: '600.0000',
      other_income_total: '40.0000',
      other_expenses_total: '15.0000',
      net_other_income: '25.0000',
      net_income: '625.0000',
    };
    const labels = pnlRows(report).map(row => row.kind === 'line' ? row.line.account_name : row.label);
    expect(labels).toEqual([
      'Income', 'Sales', 'Total Income',
      'Cost of Goods Sold', 'Cost of Goods Sold', 'Total Cost of Goods Sold',
      'GROSS PROFIT',
      'Expenses', 'Rent', 'Total Expenses',
      'NET OPERATING INCOME',
      'Other Income', 'Interest Earned', 'Total Other Income',
      'Other Expenses', 'Penalties', 'Total Other Expenses',
      'NET OTHER INCOME',
      'NET INCOME',
    ]);
  });

  // 10-22: Netlify had the new page while Railway still ran the old API. Total
  // Expenses was then the operating total under a list that held every expense.
  it('totals every expense listed when the API sends no sections', () => {
    const report: PnlReport = {
      period_start: '2026-01-01',
      period_end: '2026-10-22',
      revenue_lines: [{ account_id: 'r', account_code: '4010', account_name: 'Sales', amount: '1000.0000' }],
      revenue_total: '1000.0000',
      expense_lines: [
        { account_id: 'c', account_code: '5010', account_name: 'Cost of Goods Sold', amount: '300.0000' },
        { account_id: 'o', account_code: '5200', account_name: 'Rent', amount: '100.0000' },
      ],
      expense_total: '400.0000',
      gross_profit: '700.0000',
      operating_expenses_total: '100.0000',
      operating_income: '600.0000',
      other_expenses_total: '0.0000',
      net_income: '600.0000',
    };
    const total = pnlRows(report).find(row => row.kind === 'total' && row.label === 'Total Expenses');
    expect(total).toEqual({ kind: 'total', label: 'Total Expenses', amount: '400.0000' });
  });
});
