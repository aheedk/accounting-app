import { describe, expect, it } from 'vitest';
import {
  balanceSheetComparisonTable, balanceSheetDetailTable, expensesByVendorTable, exportRows, journalTable, monthRanges,
  pnlColumnsTable, pnlDetailTable, salesByCustomerTable, transactionListTable, yearEarlier,
  type BalanceSheetReport, type GlAccount, type GlLine, type GlReport, type ReportRow,
} from './standardReports';
import type { PnlReport } from './pnlLayout';

function line(je: string, date: string, overrides: Partial<GlLine> = {}): GlLine {
  return {
    journal_entry_id: je, entry_date: date, transaction_label: 'Invoice', num: null, name: null, memo: null,
    split_account: null, debit: '0.0000', credit: '0.0000', amount: '0.0000', running_balance: '0.0000',
    transaction_path: `/tx/${je}`, ...overrides,
  };
}

function account(id: string, code: string, name: string, type: string, lines: GlLine[], balances: Partial<GlAccount> = {}): GlAccount {
  return { account_id: id, account_code: code, account_name: name, account_type: type, beginning_balance: '0.0000', ending_balance: '0.0000', lines, ...balances };
}

const sales = account('inc', '4000', 'Sales', 'revenue', [
  line('je1', '2026-03-02', { name: 'Acme', num: '1001', credit: '100.0000', amount: '100.0000' }),
  line('je2', '2026-03-09', { name: 'Birch', num: '1002', credit: '50.0000', amount: '50.0000' }),
]);
const interest = account('int', '4900', 'Interest Earned', 'revenue', [
  line('je4', '2026-03-31', { transaction_label: 'Deposit', name: 'Regions', credit: '2.0000', amount: '2.0000' }),
]);
const supplies = account('exp', '6000', 'Supplies', 'expense', [
  line('je3', '2026-03-05', { transaction_label: 'Expense', name: 'Staples', debit: '30.0000', amount: '30.0000' }),
  line('je5', '2026-03-20', { transaction_label: 'Inventory', name: 'Widget', debit: '5.0000', amount: '5.0000' }),
]);
const bank = account('bank', '1000', 'Checking', 'asset', [
  line('je1', '2026-03-02', { name: 'Acme', num: '1001', debit: '100.0000', amount: '100.0000', running_balance: '600.0000' }),
  line('je3', '2026-03-05', { transaction_label: 'Expense', name: 'Staples', credit: '30.0000', amount: '-30.0000', running_balance: '570.0000' }),
], { beginning_balance: '500.0000', ending_balance: '570.0000' });

const gl: GlReport = { period_start: '2026-03-01', period_end: '2026-03-31', accounts: [bank, sales, interest, supplies] };

const pnl: PnlReport = {
  period_start: '2026-03-01', period_end: '2026-03-31',
  revenue_lines: [
    { account_id: 'inc', account_code: '4000', account_name: 'Sales', amount: '150.0000', section: 'income' },
    { account_id: 'int', account_code: '4900', account_name: 'Interest Earned', amount: '2.0000', section: 'other_income' },
  ],
  revenue_total: '152.0000',
  expense_lines: [{ account_id: 'exp', account_code: '6000', account_name: 'Supplies', amount: '35.0000', section: 'operating' }],
  expense_total: '35.0000',
  gross_profit: '150.0000',
  operating_expenses_total: '35.0000',
  operating_income: '115.0000',
  other_expenses_total: '0.0000',
  net_income: '117.0000',
};

const totalOf = (rows: ReportRow[], label: string): string[] => {
  const row = rows.find(r => r.kind !== 'heading' && r.cells[0] === label);
  if (!row || row.kind === 'heading') throw new Error(`no row ${label}`);
  return row.cells.filter(cell => cell !== '' && cell !== label);
};

describe('pnlDetailTable', () => {
  const table = pnlDetailTable(gl, pnl);

  it('lists each account in its P&L section, with a balance running from zero', () => {
    const labels = table.rows.filter(r => r.kind === 'heading').map(r => (r.kind === 'heading' ? r.label : ''));
    expect(labels).toEqual(['Income', '4000 Sales', 'Expenses', '6000 Supplies', 'Other Income', '4900 Interest Earned']);
    const salesLines = table.rows.filter(r => r.kind === 'line' && r.cells[1] === 'Invoice');
    expect(salesLines.map(r => (r.kind === 'line' ? r.cells[7] : ''))).toEqual(['100.0000', '150.0000']);
    expect(salesLines[0]).toMatchObject({ to: '/tx/je1' });
  });

  it('adds up to the P&L', () => {
    expect(totalOf(table.rows, 'Total Income')).toEqual(['150.0000']);
    expect(totalOf(table.rows, 'Gross Profit')).toEqual([pnl.gross_profit]);
    expect(totalOf(table.rows, 'Net Operating Income')).toEqual([pnl.operating_income]);
    expect(totalOf(table.rows, 'Net Income')).toEqual([pnl.net_income]);
  });
});

describe('balanceSheetDetailTable', () => {
  const table = balanceSheetDetailTable(gl, '117.0000');

  it('starts each account at its beginning balance and ends at its ending balance', () => {
    const begin = table.rows.find(r => r.kind === 'line' && r.cells[0] === 'Beginning Balance');
    expect(begin).toMatchObject({ cells: ['Beginning Balance', '', '', '', '', '', '', '500.0000'] });
    expect(totalOf(table.rows, 'Total for 1000 Checking')).toEqual(['70.0000', '570.0000']);
    expect(totalOf(table.rows, 'Total Assets')).toEqual(['70.0000', '570.0000']);
  });

  it('shows this year\'s net income under Equity, as the Balance Sheet does', () => {
    expect(totalOf(table.rows, 'Total Equity')).toEqual(['0.0000', '117.0000']);
    expect(totalOf(table.rows, 'Total Liabilities and Equity')).toEqual(['117.0000']);
  });
});

describe('journalTable', () => {
  const table = journalTable(gl);

  it('puts each transaction back together, debits first, with its totals', () => {
    const first = table.rows.slice(0, 3);
    expect(first[0]).toMatchObject({ kind: 'line', to: '/tx/je1', cells: ['2026-03-02', 'Invoice', '1001', 'Acme', '', '1000 Checking', '100.0000', ''] });
    expect(first[1]).toMatchObject({ kind: 'line', cells: ['', '', '', '', '', '4000 Sales', '', '100.0000'] });
    expect(first[2]).toMatchObject({ kind: 'total', cells: ['', '', '', '', '', '', '100.0000', '100.0000'] });
    // The fixture's other transactions are one-sided, so the two totals differ here.
    expect(totalOf(table.rows, 'TOTAL')).toEqual(['135.0000', '182.0000']);
  });
});

describe('transactionListTable', () => {
  it('has one row per transaction, by date', () => {
    const table = transactionListTable(gl);
    expect(table.rows.map(r => (r.kind === 'heading' ? '' : r.cells[0]))).toEqual(['2026-03-02', '2026-03-05', '2026-03-09', '2026-03-20', '2026-03-31']);
    expect(table.rows[0]).toMatchObject({ cells: ['2026-03-02', 'Invoice', '1001', 'Acme', '', '100.0000'] });
  });
});

describe('by name', () => {
  it('sales by customer counts invoices, credit memos and deposits', () => {
    const table = salesByCustomerTable(gl);
    expect(table.rows.map(r => (r.kind === 'heading' ? [] : r.cells))).toEqual([
      ['Acme', '100.0000'], ['Birch', '50.0000'], ['Regions', '2.0000'], ['TOTAL', '152.0000'],
    ]);
  });

  it('expenses by vendor puts a stock movement under Not Specified, last', () => {
    const table = expensesByVendorTable(gl);
    expect(table.rows.map(r => (r.kind === 'heading' ? [] : r.cells))).toEqual([
      ['Staples', '30.0000'], ['Not Specified', '5.0000'], ['TOTAL', '35.0000'],
    ]);
  });
});

describe('monthRanges', () => {
  it('cuts the first and last month at the dates asked for', () => {
    expect(monthRanges('2026-01-15', '2026-03-10')).toEqual([
      { label: 'Jan 2026', start: '2026-01-15', end: '2026-01-31' },
      { label: 'Feb 2026', start: '2026-02-01', end: '2026-02-28' },
      { label: 'Mar 2026', start: '2026-03-01', end: '2026-03-10' },
    ]);
  });

  it('crosses the year, and refuses more than the limit', () => {
    expect(monthRanges('2025-12-01', '2026-01-31')?.map(m => m.label)).toEqual(['Dec 2025', 'Jan 2026']);
    expect(monthRanges('2024-01-01', '2026-12-31')).toBeNull();
  });
});

describe('pnlColumnsTable', () => {
  const earlier: PnlReport = {
    ...pnl,
    revenue_lines: [{ account_id: 'inc', account_code: '4000', account_name: 'Sales', amount: '100.0000', section: 'income' }],
    expense_lines: [],
  };

  it('compares two periods, an account missing from one counting as zero', () => {
    const table = pnlColumnsTable([{ label: 'This year', report: pnl }, { label: 'Last year', report: earlier }], { compare: true });
    expect(table.columns.map(c => c.label)).toEqual(['Account', 'This year', 'Last year', '$ Change', '% Change']);
    expect(table.rows.find(r => r.kind === 'line' && r.cells[0] === '4000 Sales')).toMatchObject({ cells: ['4000 Sales', '150.0000', '100.0000', '50.0000', '50.00%'] });
    expect(table.rows.find(r => r.kind === 'line' && r.cells[0] === '6000 Supplies')).toMatchObject({ cells: ['6000 Supplies', '35.0000', '0', '35.0000', ''] });
    expect(totalOf(table.rows, 'Net Income').slice(0, 2)).toEqual(['117.0000', '100.0000']);
  });
});

describe('balanceSheetComparisonTable', () => {
  const sheet = (amount: string, ni: string): BalanceSheetReport => ({
    as_of: '2026-03-31',
    asset_lines: [{ account_id: 'bank', account_code: '1000', account_name: 'Checking', amount, group: 'Bank' }],
    liability_lines: [],
    equity_lines: [{ account_id: 'eq', account_code: '3000', account_name: 'Owner Equity', amount: '500.0000' }],
    net_income_ytd: ni,
  });

  it('lays out both dates and the change, and still balances', () => {
    const table = balanceSheetComparisonTable(sheet('570.0000', '70.0000'), sheet('500.0000', '0.0000'), ['03/31/2026', '03/31/2025']);
    expect(totalOf(table.rows, 'Total Bank Accounts')).toEqual(['570.0000', '500.0000', '70.0000', '14.00%']);
    expect(totalOf(table.rows, 'Total Assets')).toEqual(['570.0000', '500.0000', '70.0000', '14.00%']);
    expect(totalOf(table.rows, 'Total Liabilities and Equity')).toEqual(['570.0000', '500.0000', '70.0000', '14.00%']);
  });
});

describe('page helpers', () => {
  it('a year earlier keeps the day, and February 29 becomes the 28th', () => {
    expect(yearEarlier('2026-10-26')).toBe('2025-10-26');
    expect(yearEarlier('2028-02-29')).toBe('2027-02-28');
  });

  it('exports headings as one cell and dates as typed', () => {
    const rows = exportRows({ columns: [{ label: 'Date', kind: 'date' }, { label: 'Amount', kind: 'money' }], rows: [
      { kind: 'heading', label: 'Income', depth: 0 },
      { kind: 'line', depth: 1, cells: ['2026-03-02', '100.0000'] },
    ] });
    expect(rows).toEqual([['Income', ''], ['03/02/2026', '100.0000']]);
  });
});
