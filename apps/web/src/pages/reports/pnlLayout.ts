// The P&L in QuickBooks' order (item 83): Income, Cost of Goods Sold, Gross
// Profit, Expenses, Net Operating Income, then Other Income and Other Expenses
// and their net, then Net Income. The page, the print and the Excel export all
// read these rows. Cost of Goods Sold and the "other" sections are left out
// when nothing is in them, as QuickBooks does.

export type PnlSection = 'income' | 'cogs' | 'operating' | 'other_income' | 'other_expense';

export type PnlLine = {
  account_id: string;
  account_code: string;
  account_name: string;
  amount: string;
  /** Missing from an API older than the sections: then income is Income and expenses Expenses. */
  section?: PnlSection;
};

export type PnlReport = {
  period_start: string;
  period_end: string;
  revenue_lines: PnlLine[];
  revenue_total: string;
  expense_lines: PnlLine[];
  expense_total: string;
  income_total?: string;
  cogs_total?: string;
  gross_profit: string;
  operating_expenses_total: string;
  operating_income: string;
  other_income_total?: string;
  other_expenses_total: string;
  net_other_income?: string;
  net_income: string;
};

export type PnlRow =
  | { kind: 'heading'; label: string }
  | { kind: 'line'; line: PnlLine }
  | { kind: 'empty'; label: string }
  | { kind: 'total'; label: string; amount: string }
  /** Gross Profit, Net Operating Income and the like: can be negative, shown with its sign. */
  | { kind: 'result'; label: string; amount: string; final?: boolean };

export function pnlRows(report: PnlReport): PnlRow[] {
  const inSection = (lines: PnlLine[], section: PnlSection, fallback: PnlSection) =>
    lines.filter(line => (line.section ?? fallback) === section);
  const income = inSection(report.revenue_lines, 'income', 'income');
  const otherIncome = inSection(report.revenue_lines, 'other_income', 'income');
  const cogs = inSection(report.expense_lines, 'cogs', 'operating');
  const expenses = inSection(report.expense_lines, 'operating', 'operating');
  const otherExpenses = inSection(report.expense_lines, 'other_expense', 'operating');

  const rows: PnlRow[] = [];
  const block = (heading: string, lines: PnlLine[], total: string, totalLabel: string, emptyLabel?: string) => {
    rows.push({ kind: 'heading', label: heading });
    if (lines.length === 0 && emptyLabel) rows.push({ kind: 'empty', label: emptyLabel });
    for (const line of lines) rows.push({ kind: 'line', line });
    rows.push({ kind: 'total', label: totalLabel, amount: total });
  };

  block('Income', income, report.income_total ?? report.revenue_total, 'Total Income', 'No income recorded.');
  if (cogs.length > 0) block('Cost of Goods Sold', cogs, report.cogs_total ?? '0', 'Total Cost of Goods Sold');
  rows.push({ kind: 'result', label: 'GROSS PROFIT', amount: report.gross_profit });
  // An API from before the sections lists every expense here, so its total is all of them.
  const expensesTotal = report.income_total === undefined ? report.expense_total : report.operating_expenses_total;
  block('Expenses', expenses, expensesTotal, 'Total Expenses', 'No expenses recorded.');
  rows.push({ kind: 'result', label: 'NET OPERATING INCOME', amount: report.operating_income });
  if (otherIncome.length > 0 || otherExpenses.length > 0) {
    if (otherIncome.length > 0) block('Other Income', otherIncome, report.other_income_total ?? '0', 'Total Other Income');
    if (otherExpenses.length > 0) block('Other Expenses', otherExpenses, report.other_expenses_total, 'Total Other Expenses');
    rows.push({ kind: 'result', label: 'NET OTHER INCOME', amount: report.net_other_income ?? '0' });
  }
  rows.push({ kind: 'result', label: 'NET INCOME', amount: report.net_income, final: true });
  return rows;
}
