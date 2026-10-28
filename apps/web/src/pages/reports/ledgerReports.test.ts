import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import {
  adjustedTrialBalanceTable, balanceSheetSummaryTable, billPaymentListTable, checkDetailTable, depositDetailTable, incomeByCustomerTable,
  pnlByCustomerTable, purchasesByVendorDetailTable, quarterRanges, recentTransactionsTable, salesByCustomerDetailTable,
  transactionDetailByAccountTable, transactionListByNameTable, transactionListWithSplitsTable,
} from './ledgerReports';
import { pnlColumnsTable, salesByCustomerTable, type BalanceSheetReport, type GlAccount, type GlReport, type ReportRow } from './standardReports';
import type { PnlReport } from './pnlLayout';

const ACCOUNTS: Record<string, { code: string; name: string; type: string; detail: string }> = {
  checking: { code: '1000', name: 'Checking', type: 'asset', detail: 'Checking' },
  ar: { code: '1200', name: 'Accounts Receivable', type: 'asset', detail: 'Accounts receivable (A/R)' },
  prepaid: { code: '1300', name: 'Prepaid Expenses', type: 'asset', detail: 'Prepaid Expenses' },
  undeposited: { code: '1400', name: 'Undeposited Funds', type: 'asset', detail: 'Undeposited Funds' },
  inventory: { code: '1500', name: 'Inventory', type: 'asset', detail: 'Inventory' },
  ap: { code: '2000', name: 'Accounts Payable', type: 'liability', detail: 'AP' },
  sales: { code: '4000', name: 'Sales', type: 'revenue', detail: 'Sales of Product Income' },
  cogs: { code: '5000', name: 'Cost of Goods Sold', type: 'expense', detail: 'Supplies & Materials - COGS' },
  supplies: { code: '6000', name: 'Supplies', type: 'expense', detail: 'Supplies & Materials' },
  rent: { code: '6100', name: 'Rent', type: 'expense', detail: 'Rent or Lease of Buildings' },
};

type Split = { account: string; debit?: string; credit?: string; name?: string; memo?: string };
type Entry = {
  je: string; date: string; label: string; num?: string; name?: string; memo?: string;
  created?: string; adjusting?: boolean; reconciled?: boolean; lines: Split[];
};

/** A General Ledger as the API returns it, from whole entries. */
function ledger(entries: Entry[]): GlReport {
  const accounts = new Map<string, GlAccount>(Object.entries(ACCOUNTS).map(([id, a]) => [id, {
    account_id: id, account_code: a.code, account_name: a.name, account_type: a.type, detail_type: a.detail,
    beginning_balance: '0.0000', ending_balance: '0.0000', lines: [],
  }]));
  for (const entry of entries) {
    for (const split of entry.lines) {
      const account = accounts.get(split.account)!;
      const debit = new Decimal(split.debit ?? '0');
      const credit = new Decimal(split.credit ?? '0');
      const debitNormal = account.account_type === 'asset' || account.account_type === 'expense';
      account.lines.push({
        journal_entry_id: entry.je, entry_date: entry.date, transaction_label: entry.label, num: entry.num ?? null,
        name: split.name ?? entry.name ?? null, memo: split.memo ?? entry.memo ?? null, split_account: null,
        debit: debit.toFixed(4), credit: credit.toFixed(4), amount: (debitNormal ? debit.minus(credit) : credit.minus(debit)).toFixed(4),
        running_balance: '0.0000', transaction_path: `/tx/${entry.je}`,
        ...(entry.created ? { created_at: entry.created } : {}),
        ...(entry.adjusting ? { is_adjusting: true } : {}),
        ...(entry.reconciled ? { is_reconciled: true } : {}),
      });
    }
  }
  return { period_start: '2026-03-01', period_end: '2026-03-31', accounts: [...accounts.values()].filter(a => a.lines.length > 0) };
}

const gl = ledger([
  { je: 'inv1', date: '2026-03-02', label: 'Invoice', num: '1001', name: 'Acme', created: '2026-03-02T15:00:00Z',
    lines: [{ account: 'ar', debit: '100' }, { account: 'sales', credit: '100', memo: 'Consulting' }] },
  { je: 'inv2', date: '2026-03-03', label: 'Invoice', num: '1002', name: 'Birch',
    lines: [{ account: 'ar', debit: '50' }, { account: 'sales', credit: '50', memo: 'Widgets' }, { account: 'cogs', debit: '20' }, { account: 'inventory', credit: '20' }] },
  { je: 'pay1', date: '2026-03-05', label: 'Payment', name: 'Acme',
    lines: [{ account: 'undeposited', debit: '100' }, { account: 'ar', credit: '100' }] },
  { je: 'dep1', date: '2026-03-06', label: 'Deposit', reconciled: true,
    lines: [{ account: 'checking', debit: '100' }, { account: 'undeposited', credit: '100', name: 'Acme' }] },
  { je: 'bill1', date: '2026-03-07', label: 'Bill', num: 'B-7', name: 'Staples',
    lines: [{ account: 'supplies', debit: '40' }, { account: 'ap', credit: '40' }] },
  { je: 'bp1', date: '2026-03-10', label: 'Bill Payment (Check)', num: '101', name: 'Staples',
    lines: [{ account: 'ap', debit: '40' }, { account: 'checking', credit: '40' }] },
  { je: 'chk1', date: '2026-03-12', label: 'Check', num: '102', name: 'Landlord', memo: 'March',
    lines: [{ account: 'rent', debit: '50' }, { account: 'supplies', debit: '10' }, { account: 'checking', credit: '60' }] },
  { je: 'vc1', date: '2026-03-15', label: 'Vendor Credit', num: 'VC-1', name: 'Staples',
    lines: [{ account: 'ap', debit: '5' }, { account: 'supplies', credit: '5' }] },
  { je: 'adj1', date: '2026-03-31', label: 'Journal Entry', num: 'J-1', adjusting: true, created: '2026-04-02T15:00:00Z',
    lines: [{ account: 'supplies', debit: '8' }, { account: 'prepaid', credit: '8' }] },
]);

const pnl: PnlReport = {
  period_start: '2026-03-01', period_end: '2026-03-31',
  revenue_lines: [{ account_id: 'sales', account_code: '4000', account_name: 'Sales', amount: '150.0000', section: 'income' }],
  revenue_total: '150.0000',
  expense_lines: [
    { account_id: 'cogs', account_code: '5000', account_name: 'Cost of Goods Sold', amount: '20.0000', section: 'cogs' },
    { account_id: 'supplies', account_code: '6000', account_name: 'Supplies', amount: '53.0000', section: 'operating' },
    { account_id: 'rent', account_code: '6100', account_name: 'Rent', amount: '50.0000', section: 'operating' },
  ],
  expense_total: '123.0000',
  gross_profit: '130.0000',
  operating_expenses_total: '103.0000',
  operating_income: '27.0000',
  other_expenses_total: '0.0000',
  net_income: '27.0000',
};

const cellsOf = (rows: ReportRow[], first: string): string[] => {
  const row = rows.find(r => r.kind !== 'heading' && r.cells[0] === first);
  if (!row || row.kind === 'heading') throw new Error(`no row ${first}`);
  return row.cells;
};
const amountsOf = (rows: ReportRow[], label: string): string[] => cellsOf(rows, label).slice(1).filter(cell => cell !== '');
const headings = (rows: ReportRow[]): string[] => rows.flatMap(r => (r.kind === 'heading' ? [r.label] : []));
const linesWith = (rows: ReportRow[], num: string): string[][] => {
  const at = rows.findIndex(r => r.kind === 'line' && r.cells.includes(num));
  const own: string[][] = [];
  for (let i = at; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.kind === 'heading' || (i > at && row.cells[0] !== '')) break;
    own.push(row.cells);
  }
  return own;
};

describe('transactionDetailByAccountTable', () => {
  const { rows } = transactionDetailByAccountTable(gl);

  it('lists the accounts in the chart order, each with its own running balance from zero', () => {
    expect(headings(rows)).toEqual([
      '1000 Checking', '1200 Accounts Receivable', '1300 Prepaid Expenses', '1400 Undeposited Funds', '1500 Inventory',
      '2000 Accounts Payable', '4000 Sales', '5000 Cost of Goods Sold', '6000 Supplies', '6100 Rent',
    ]);
    const start = rows.findIndex(r => r.kind === 'heading' && r.label === '1000 Checking');
    expect(rows.slice(start + 1, start + 4).map(r => (r.kind === 'line' ? [r.cells[1], r.cells[6], r.cells[7]] : []))).toEqual([
      ['Deposit', '100.0000', '100.0000'],
      ['Bill Payment (Check)', '-40.0000', '60.0000'],
      ['Check', '-60.0000', '0.0000'],
    ]);
    expect(amountsOf(rows, 'Total for 6000 Supplies')).toEqual(['53.0000']);
  });
});

describe('transactionListWithSplitsTable', () => {
  const { rows } = transactionListWithSplitsTable(gl);

  it('puts the account a check was drawn on first, and what it paid for under it', () => {
    expect(linesWith(rows, '102')).toEqual([
      ['2026-03-12', 'Check', '102', 'Landlord', 'March', '1000 Checking', '-60.0000'],
      ['', '', '', '', 'March', '6000 Supplies', '10.0000'],
      ['', '', '', '', 'March', '6100 Rent', '50.0000'],
    ]);
  });

  it('shows a payment in Undeposited Funds, not in A/R', () => {
    const payment = rows.find(r => r.kind === 'line' && r.cells[1] === 'Payment');
    expect(payment?.kind === 'line' && payment.cells[5]).toBe('1400 Undeposited Funds');
  });

  it('shows an expense in the account it was paid from when that account is set up under Banking, whatever its detail type', () => {
    const paid = ledger([{ je: 'exp1', date: '2026-03-20', label: 'Expense', name: 'Shell',
      lines: [{ account: 'supplies', debit: '7' }, { account: 'prepaid', credit: '7' }] }]);
    expect(transactionListWithSplitsTable(paid).rows[0]).toMatchObject({ cells: ['2026-03-20', 'Expense', '', 'Shell', '', '6000 Supplies', '7.0000'] });
    expect(transactionListWithSplitsTable(paid, new Set(['prepaid'])).rows[0])
      .toMatchObject({ cells: ['2026-03-20', 'Expense', '', 'Shell', '', '1300 Prepaid Expenses', '-7.0000'] });
  });
});

describe('recentTransactionsTable', () => {
  it('keeps the transactions entered between the dates, whatever date they carry, under their type', () => {
    const { rows } = recentTransactionsTable(gl, { start: '2026-04-01', end: '2026-04-05' });
    expect(headings(rows)).toEqual(['Journal Entry']);
    expect(rows[1]).toMatchObject({ kind: 'line', to: '/tx/adj1', cells: ['2026-03-31', 'J-1', '', '', '6000 Supplies', '1300 Prepaid Expenses', '8.0000'] });
  });
});

describe('transactionListByNameTable', () => {
  it('lists each customer\'s transactions under their name, a deposit too', () => {
    const { rows } = transactionListByNameTable(gl, new Set(['Acme', 'Birch']));
    expect(headings(rows)).toEqual(['Acme', 'Birch']);
    expect(rows.slice(1, 4).map(r => (r.kind === 'line' ? r.cells[1] : ''))).toEqual(['Invoice', 'Payment', 'Deposit']);
    expect(rows[1]).toMatchObject({ cells: ['2026-03-02', 'Invoice', '1001', 'Consulting', '1200 Accounts Receivable', '4000 Sales', '100.0000'] });
  });

  it('leaves out names that are not on the list', () => {
    const { rows } = transactionListByNameTable(gl, new Set(['Staples']));
    expect(headings(rows)).toEqual(['Staples']);
    expect(rows.filter(r => r.kind === 'line').map(r => (r.kind === 'line' ? r.cells[2] : ''))).toEqual(['B-7', '101', 'VC-1']);
  });
});

describe('depositDetailTable', () => {
  it('lists what went into each bank account, with where it came from under it', () => {
    const { rows } = depositDetailTable(gl);
    expect(headings(rows)).toEqual(['1000 Checking']);
    expect(rows.slice(1, 3).map(r => (r.kind === 'line' ? r.cells : []))).toEqual([
      ['2026-03-06', 'Deposit', '', '', '', '', 'R', '100.0000'],
      ['', '', '', 'Acme', '', '1400 Undeposited Funds', '', '100.0000'],
    ]);
    expect(amountsOf(rows, 'TOTAL')).toEqual(['100.0000']);
  });

  it('counts an account set up under Banking as a bank, whatever its detail type', () => {
    expect(headings(depositDetailTable(gl, new Set(['undeposited'])).rows)).toEqual(['1000 Checking', '1400 Undeposited Funds']);
  });
});

describe('checkDetailTable', () => {
  it('lists each check, bill payments by check too, with what it paid for', () => {
    const { rows } = checkDetailTable(gl);
    expect(linesWith(rows, '101')).toEqual([
      ['2026-03-10', 'Bill Payment (Check)', '101', 'Staples', '', '1000 Checking', '', '40.0000'],
      ['', '', '', 'Staples', '', '2000 Accounts Payable', '', '40.0000'],
    ]);
    expect(amountsOf(rows, 'TOTAL')).toEqual(['100.0000']);
  });
});

describe('billPaymentListTable', () => {
  it('lists bill payments under the account they were paid from', () => {
    const { rows } = billPaymentListTable(gl);
    expect(headings(rows)).toEqual(['1000 Checking']);
    expect(rows[1]).toMatchObject({ cells: ['2026-03-10', 'Bill Payment (Check)', '101', 'Staples', '', '40.0000'] });
    expect(amountsOf(rows, 'TOTAL')).toEqual(['40.0000']);
  });
});

describe('salesByCustomerDetailTable', () => {
  it('lists each customer\'s sales and adds up to Sales by Customer Summary', () => {
    const { rows } = salesByCustomerDetailTable(gl);
    expect(headings(rows)).toEqual(['Acme', 'Birch']);
    expect(rows[1]).toMatchObject({ cells: ['2026-03-02', 'Invoice', '1001', 'Consulting', '4000 Sales', '100.0000', '100.0000'] });
    expect(amountsOf(rows, 'TOTAL')).toEqual(amountsOf(salesByCustomerTable(gl).rows, 'TOTAL'));
  });
});

describe('purchasesByVendorDetailTable', () => {
  it('lists what was bought from each vendor, less vendor credits, not what paid for it', () => {
    const { rows } = purchasesByVendorDetailTable(gl);
    expect(headings(rows)).toEqual(['Landlord', 'Staples']);
    expect(amountsOf(rows, 'Total for Landlord')).toEqual(['60.0000']);
    expect(amountsOf(rows, 'Total for Staples')).toEqual(['35.0000']);
    expect(amountsOf(rows, 'TOTAL')).toEqual(['95.0000']);
  });
});

describe('incomeByCustomerTable', () => {
  it('sets each customer\'s income against the costs that name them', () => {
    const { rows } = incomeByCustomerTable(gl, new Set(['Acme', 'Birch']));
    expect(cellsOf(rows, 'Acme')).toEqual(['Acme', '100.0000', '0.0000', '100.0000']);
    expect(cellsOf(rows, 'Birch')).toEqual(['Birch', '50.0000', '20.0000', '30.0000']);
    expect(amountsOf(rows, 'TOTAL')).toEqual(['150.0000', '20.0000', '130.0000']);
  });
});

describe('pnlByCustomerTable', () => {
  it('gives each customer a column, the rest Not Specified, and the P&L as the total', () => {
    const { columns, rows } = pnlByCustomerTable(gl, pnl, new Set(['Acme', 'Birch']), { start: '2026-03-01', end: '2026-03-31' });
    expect(columns.map(c => c.label)).toEqual(['Account', 'Acme', 'Birch', 'Not Specified', 'Total']);
    expect(cellsOf(rows, '4000 Sales')).toEqual(['4000 Sales', '100.0000', '50.0000', '0', '150.0000']);
    expect(amountsOf(rows, 'Net Income')).toEqual(['100.0000', '30.0000', '-103.0000', '27.0000']);
  });
});

describe('pnlColumnsTable as % of income', () => {
  it('adds each amount as a share of total income', () => {
    const { columns, rows } = pnlColumnsTable([{ label: 'Total', report: pnl }], { percentOfIncome: true });
    expect(columns.map(c => c.label)).toEqual(['Account', 'Total', '% of Income']);
    expect(cellsOf(rows, '6000 Supplies')).toEqual(['6000 Supplies', '53.0000', '35.33%']);
    expect(amountsOf(rows, 'Total Income')).toEqual(['150.0000', '100.00%']);
    expect(amountsOf(rows, 'Net Income')).toEqual(['27.0000', '18.00%']);
  });
});

describe('quarterRanges', () => {
  it('splits a calendar year into its quarters', () => {
    expect(quarterRanges('2026-01-01', '2026-12-31', 1)?.map(q => q.label)).toEqual([
      'Jan - Mar, 2026', 'Apr - Jun, 2026', 'Jul - Sep, 2026', 'Oct - Dec, 2026',
    ]);
  });

  it('follows the fiscal year and cuts the first and last quarter at the dates', () => {
    expect(quarterRanges('2026-05-15', '2026-11-10', 4)).toEqual([
      { label: 'Apr - Jun, 2026', start: '2026-05-15', end: '2026-06-30' },
      { label: 'Jul - Sep, 2026', start: '2026-07-01', end: '2026-09-30' },
      { label: 'Oct - Dec, 2026', start: '2026-10-01', end: '2026-11-10' },
    ]);
  });

  it('names a quarter that runs into the next year with both years', () => {
    expect(quarterRanges('2025-11-01', '2026-04-30', 11)).toEqual([
      { label: 'Nov, 2025 - Jan, 2026', start: '2025-11-01', end: '2026-01-31' },
      { label: 'Feb - Apr, 2026', start: '2026-02-01', end: '2026-04-30' },
    ]);
  });

  it('refuses more than twelve', () => {
    expect(quarterRanges('2020-01-01', '2026-12-31', 1)).toBeNull();
  });
});

describe('balanceSheetSummaryTable', () => {
  it('shows each account type as one line, with this year\'s net income in equity', () => {
    const sheet: BalanceSheetReport = {
      as_of: '2026-03-31',
      asset_lines: [
        { account_id: 'a1', account_code: '1000', account_name: 'Checking', amount: '500.0000', group: 'Bank' },
        { account_id: 'a2', account_code: '1200', account_name: 'Accounts Receivable', amount: '200.0000', group: 'Accounts receivable (A/R)' },
        { account_id: 'a3', account_code: '1500', account_name: 'Inventory', amount: '100.0000', group: 'Other Current Assets' },
        { account_id: 'a4', account_code: '1700', account_name: 'Equipment', amount: '1000.0000', group: 'Fixed Assets' },
      ],
      liability_lines: [
        { account_id: 'l1', account_code: '2000', account_name: 'Accounts Payable', amount: '300.0000', group: 'Accounts payable (A/P)' },
        { account_id: 'l2', account_code: '2700', account_name: 'Loan', amount: '400.0000', group: 'Long Term Liabilities' },
      ],
      equity_lines: [{ account_id: 'e1', account_code: '3000', account_name: 'Opening Balance Equity', amount: '1000.0000', group: 'Equity' }],
      net_income_ytd: '100.0000',
    };
    const { rows } = balanceSheetSummaryTable(sheet);
    expect(rows.flatMap(r => (r.kind === 'heading' ? [] : [r.cells]))).toEqual([
      ['Bank Accounts', '500.0000'],
      ['Accounts Receivable', '200.0000'],
      ['Other Current Assets', '100.0000'],
      ['Total Current Assets', '800.0000'],
      ['Fixed Assets', '1000.0000'],
      ['Total Assets', '1800.0000'],
      ['Accounts Payable', '300.0000'],
      ['Total Current Liabilities', '300.0000'],
      ['Long-Term Liabilities', '400.0000'],
      ['Total Liabilities', '700.0000'],
      ['Equity', '1100.0000'],
      ['Total Liabilities and Equity', '1800.0000'],
    ]);
  });
});

describe('adjustedTrialBalanceTable', () => {
  it('takes the period\'s adjusting entries back out of the Trial Balance to show it before them', () => {
    const { rows } = adjustedTrialBalanceTable([
      { account_id: 'checking', code: '1000', name: 'Checking', net: '0.0000' },
      { account_id: 'prepaid', code: '1300', name: 'Prepaid Expenses', net: '92.0000' },
      { account_id: 'supplies', code: '6000', name: 'Supplies', net: '53.0000' },
      { account_id: '', code: '', name: 'Retained Earnings', net: '-145.0000' },
    ], gl, '2026-03-31');
    expect(rows.map(r => (r.kind === 'heading' ? [] : r.cells))).toEqual([
      ['1300 Prepaid Expenses', '100.0000', '', '', '8.0000', '92.0000', ''],
      ['6000 Supplies', '45.0000', '', '8.0000', '', '53.0000', ''],
      ['Retained Earnings', '', '145.0000', '', '', '', '145.0000'],
      ['TOTAL', '145.0000', '145.0000', '8.0000', '8.0000', '145.0000', '145.0000'],
    ]);
    expect(rows[2]).not.toHaveProperty('to');
  });
});
