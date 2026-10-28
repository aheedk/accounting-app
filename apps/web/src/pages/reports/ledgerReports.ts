import { Decimal } from 'decimal.js';
import { accountGroup } from '@accounting/shared';
import { assetBlocks, liabilityBlocks, type SheetBlock } from '@/lib/balanceSheetLayout';
import { dateToLocalIso } from '@/lib/dates';
import { generalLedgerDrilldownUrl, LEDGER_HISTORY_START } from '@/lib/reportDrilldown';
import type { PnlLine, PnlReport } from './pnlLayout';
import {
  DETAIL_COLUMNS, NOT_SPECIFIED, SALES_TYPES, accountLabel, detailRow, isZero, minus, pnlColumnsTable, pnlSections, sum, totalRow, transactions,
  type BalanceSheetReport, type BsLine, type GlAccount, type GlLine, type GlReport, type JournalLine, type ReportColumn, type ReportRow,
  type ReportTable, type Transaction,
} from './standardReports';

// The rest of QuickBooks' standard reports that the ledger answers (item 18,
// 10-27): transaction lists and details, the P&L by customer, by quarter and as
// a share of income, the Balance Sheet in summary, and the Adjusted Trial
// Balance. As in standardReports.ts, each is worked out from the General
// Ledger, the P&L, the Balance Sheet or the Trial Balance, so it ties out to them.

const TYPE_ORDER: Record<string, number> = { asset: 0, liability: 1, equity: 2, revenue: 3, expense: 4 };

/** Assets, liabilities, equity, income, expenses, each by code: the chart's own order. */
const inChartOrder = (accounts: GlAccount[]): GlAccount[] =>
  [...accounts].sort((a, b) =>
    (TYPE_ORDER[a.account_type] ?? 5) - (TYPE_ORDER[b.account_type] ?? 5)
    || a.account_code.localeCompare(b.account_code) || a.account_name.localeCompare(b.account_name));

const byName = (a: string, b: string): number => Number(a === NOT_SPECIFIED) - Number(b === NOT_SPECIFIED) || a.localeCompare(b);

/** Debits plus, credits minus. */
const signed = (line: GlLine): string => minus(line.debit, line.credit);

const clr = (line: GlLine): string => (line.is_reconciled ? 'R' : '');

// The ledger's own word for a split with more than one other account (generalLedgerService).
const SPLIT = '–Split–';

// The account a transaction is "in", as QuickBooks lists it: the bank or card
// it went through, else Undeposited Funds, else A/R or A/P. A journal entry has
// none of those, so it goes by its first debit. `bankIds` are the accounts set
// up under Banking: bank accounts whatever their detail type says, as on the
// Balance Sheet.
function anchorRank(line: JournalLine, bankIds: ReadonlySet<string>): number {
  const group = accountGroup(line);
  if (bankIds.has(line.account_id) || group === 'Bank' || group === 'Credit Card') return 0;
  if ((line.detail_type ?? '').trim().toLowerCase() === 'undeposited funds') return 1;
  if (group === 'Accounts receivable (A/R)' || group === 'Accounts payable (A/P)') return 2;
  return 3;
}

function anchorOf(tx: Transaction, bankIds: ReadonlySet<string>): JournalLine {
  let anchor = tx.lines.find(line => !isZero(line.debit)) ?? tx.lines[0]!;
  let rank = anchorRank(anchor, bankIds);
  for (const line of tx.lines) {
    const lineRank = anchorRank(line, bankIds);
    if (lineRank < rank) {
      anchor = line;
      rank = lineRank;
    }
  }
  return anchor;
}

/** The other side of a transaction: its one account, or "–Split–" when there are more. */
function splitOf(tx: Transaction, anchor: JournalLine): string {
  const others = [...new Set(tx.lines.filter(line => line.account !== anchor.account).map(line => line.account))];
  return others.length === 0 ? '' : others.length === 1 ? others[0]! : SPLIT;
}

type Summary = { tx: Transaction; anchor: JournalLine; name: string; memo: string; total: string };

function summarize(tx: Transaction, bankIds: ReadonlySet<string>): Summary {
  const anchor = anchorOf(tx, bankIds);
  return {
    tx,
    anchor,
    name: tx.lines.find(line => line.name)?.name ?? '',
    memo: anchor.memo ?? tx.lines.find(line => line.memo)?.memo ?? '',
    total: sum(tx.lines.map(line => line.debit)),
  };
}

/** Transaction Detail by Account: each account's transactions in the period, the balance running from zero. */
export function transactionDetailByAccountTable(gl: GlReport): ReportTable {
  const width = DETAIL_COLUMNS.length;
  const rows: ReportRow[] = [];
  for (const account of inChartOrder(gl.accounts)) {
    if (account.lines.length === 0) continue;
    rows.push({ kind: 'heading', label: accountLabel(account), depth: 0 });
    let running = new Decimal(0);
    for (const line of account.lines) {
      running = running.plus(line.amount || '0');
      rows.push(detailRow(line, running.toFixed(4), 1));
    }
    rows.push(totalRow(width, `Total for ${accountLabel(account)}`, [running.toFixed(4), '']));
  }
  return { columns: DETAIL_COLUMNS, rows };
}

/**
 * Transaction List with Splits: each transaction, the account it is in first
 * and every other line under it, debits plus and credits minus.
 */
export function transactionListWithSplitsTable(gl: GlReport, bankIds: ReadonlySet<string> = new Set()): ReportTable {
  const columns: ReportColumn[] = [
    { label: 'Date', kind: 'date' },
    { label: 'Transaction Type', kind: 'text' },
    { label: 'Num', kind: 'text' },
    { label: 'Name', kind: 'text' },
    { label: 'Memo/Description', kind: 'text' },
    { label: 'Account', kind: 'text' },
    { label: 'Amount', kind: 'money' },
  ];
  const rows: ReportRow[] = [];
  for (const tx of transactions(gl)) {
    const { anchor, name, memo } = summarize(tx, bankIds);
    rows.push({
      kind: 'line', depth: 0, to: anchor.transaction_path,
      cells: [tx.date, anchor.transaction_label, tx.num, name, memo, anchor.account, signed(anchor)],
    });
    for (const line of tx.lines) {
      if (line === anchor) continue;
      const other = line.name && line.name !== name ? line.name : '';
      rows.push({ kind: 'line', depth: 0, cells: ['', '', '', other, line.memo ?? '', line.account, signed(line)] });
    }
  }
  return { columns, rows };
}

/**
 * Recent Transactions: those entered between the dates, whatever date they
 * carry, by type. `gl` has to reach back far enough to hold them.
 */
export function recentTransactionsTable(
  gl: GlReport, entered: { start: string; end: string }, bankIds: ReadonlySet<string> = new Set(),
): ReportTable {
  const columns: ReportColumn[] = [
    { label: 'Date', kind: 'date' },
    { label: 'Num', kind: 'text' },
    { label: 'Name', kind: 'text' },
    { label: 'Memo/Description', kind: 'text' },
    { label: 'Account', kind: 'text' },
    { label: 'Split', kind: 'text' },
    { label: 'Amount', kind: 'money' },
  ];
  const byType = new Map<string, Summary[]>();
  for (const tx of transactions(gl)) {
    const at = tx.lines[0]?.created_at;
    const day = at ? dateToLocalIso(new Date(at)) : null;
    if (!day || day < entered.start || day > entered.end) continue;
    const summary = summarize(tx, bankIds);
    const type = summary.anchor.transaction_label;
    byType.set(type, [...(byType.get(type) ?? []), summary]);
  }
  const rows: ReportRow[] = [];
  for (const type of [...byType.keys()].sort()) {
    rows.push({ kind: 'heading', label: type, depth: 0 });
    for (const s of byType.get(type)!) {
      rows.push({
        kind: 'line', depth: 1, to: s.anchor.transaction_path,
        cells: [s.tx.date, s.tx.num, s.name, s.memo, s.anchor.account, splitOf(s.tx, s.anchor), s.total],
      });
    }
  }
  return { columns, rows };
}

/** Transaction List by Customer or by Vendor: the transactions naming each of `names`, under that name. */
export function transactionListByNameTable(gl: GlReport, names: ReadonlySet<string>, bankIds: ReadonlySet<string> = new Set()): ReportTable {
  const columns: ReportColumn[] = [
    { label: 'Date', kind: 'date' },
    { label: 'Transaction Type', kind: 'text' },
    { label: 'Num', kind: 'text' },
    { label: 'Memo/Description', kind: 'text' },
    { label: 'Account', kind: 'text' },
    { label: 'Split', kind: 'text' },
    { label: 'Amount', kind: 'money' },
  ];
  const byParty = new Map<string, Summary[]>();
  for (const tx of transactions(gl)) {
    const named = new Set(tx.lines.map(line => line.name?.trim() ?? '').filter(name => names.has(name)));
    if (named.size === 0) continue;
    const summary = summarize(tx, bankIds);
    for (const name of named) byParty.set(name, [...(byParty.get(name) ?? []), summary]);
  }
  const rows: ReportRow[] = [];
  for (const name of [...byParty.keys()].sort(byName)) {
    rows.push({ kind: 'heading', label: name, depth: 0 });
    for (const s of byParty.get(name)!) {
      rows.push({
        kind: 'line', depth: 1, to: s.anchor.transaction_path,
        cells: [s.tx.date, s.anchor.transaction_label, s.tx.num, s.memo, s.anchor.account, splitOf(s.tx, s.anchor), s.total],
      });
    }
  }
  return { columns, rows };
}

const MOVEMENT_COLUMNS: ReportColumn[] = [
  { label: 'Date', kind: 'date' },
  { label: 'Transaction Type', kind: 'text' },
  { label: 'Num', kind: 'text' },
  { label: 'Name', kind: 'text' },
  { label: 'Memo/Description', kind: 'text' },
  { label: 'Account', kind: 'text' },
  { label: 'Clr', kind: 'text' },
  { label: 'Amount', kind: 'money' },
];

// Money into a bank account: a deposit, or a payment put straight in.
const DEPOSIT_TYPES = new Set(['Deposit', 'Payment']);

/**
 * Deposit Detail: what went into each bank account by deposit or payment, with
 * where it came from under it. `bankIds` are the accounts set up under Banking,
 * which count as bank accounts whatever their detail type says.
 */
export function depositDetailTable(gl: GlReport, bankIds: ReadonlySet<string> = new Set()): ReportTable {
  const width = MOVEMENT_COLUMNS.length;
  const byId = new Map(transactions(gl).map(tx => [tx.id, tx]));
  const isBank = (account: GlAccount): boolean =>
    bankIds.has(account.account_id) || (account.account_type === 'asset' && accountGroup(account) === 'Bank');
  const rows: ReportRow[] = [];
  const totals: string[] = [];
  for (const account of inChartOrder(gl.accounts).filter(isBank)) {
    const deposits = account.lines.filter(line => DEPOSIT_TYPES.has(line.transaction_label) && !isZero(line.debit));
    if (deposits.length === 0) continue;
    rows.push({ kind: 'heading', label: accountLabel(account), depth: 0 });
    for (const line of deposits) {
      rows.push({
        kind: 'line', depth: 1, to: line.transaction_path,
        cells: [line.entry_date, line.transaction_label, line.num ?? '', line.name ?? '', line.memo ?? '', '', clr(line), line.debit],
      });
      for (const from of byId.get(line.journal_entry_id)?.lines ?? []) {
        if (isZero(from.credit)) continue;
        rows.push({ kind: 'line', depth: 2, cells: ['', '', '', from.name ?? '', from.memo ?? '', from.account, '', from.credit] });
      }
    }
    const total = sum(deposits.map(line => line.debit));
    totals.push(total);
    rows.push(totalRow(width, `Total for ${accountLabel(account)}`, [total]));
  }
  rows.push(totalRow(width, 'TOTAL', [sum(totals)]));
  return { columns: MOVEMENT_COLUMNS, rows };
}

const CHECK_TYPES = new Set(['Check', 'Bill Payment (Check)']);

/** Check Detail: every check written, from the account it was drawn on, with what it paid for under it. */
export function checkDetailTable(gl: GlReport, bankIds: ReadonlySet<string> = new Set()): ReportTable {
  const width = MOVEMENT_COLUMNS.length;
  const rows: ReportRow[] = [];
  const totals: string[] = [];
  for (const tx of transactions(gl)) {
    const anchor = anchorOf(tx, bankIds);
    // A voided check's reversal puts the money back: not a check written.
    if (!CHECK_TYPES.has(anchor.transaction_label) || isZero(anchor.credit)) continue;
    rows.push({
      kind: 'line', depth: 0, to: anchor.transaction_path,
      cells: [tx.date, anchor.transaction_label, tx.num, anchor.name ?? '', anchor.memo ?? '', anchor.account, clr(anchor), anchor.credit],
    });
    for (const line of tx.lines) {
      if (line === anchor) continue;
      rows.push({ kind: 'line', depth: 1, cells: ['', '', '', line.name ?? '', line.memo ?? '', line.account, '', signed(line)] });
    }
    totals.push(anchor.credit);
  }
  rows.push(totalRow(width, 'TOTAL', [sum(totals)]));
  return { columns: MOVEMENT_COLUMNS, rows };
}

/** Bill Payment List: every bill payment, under the bank account or card it was paid from. */
export function billPaymentListTable(gl: GlReport, bankIds: ReadonlySet<string> = new Set()): ReportTable {
  const columns: ReportColumn[] = [
    { label: 'Date', kind: 'date' },
    { label: 'Transaction Type', kind: 'text' },
    { label: 'Num', kind: 'text' },
    { label: 'Vendor', kind: 'text' },
    { label: 'Memo/Description', kind: 'text' },
    { label: 'Amount', kind: 'money' },
  ];
  const width = columns.length;
  const byAccount = new Map<string, JournalLine[]>();
  for (const tx of transactions(gl)) {
    const anchor = anchorOf(tx, bankIds);
    if (!anchor.transaction_label.startsWith('Bill Payment') || isZero(anchor.credit)) continue;
    byAccount.set(anchor.account, [...(byAccount.get(anchor.account) ?? []), anchor]);
  }
  const rows: ReportRow[] = [];
  const totals: string[] = [];
  for (const account of [...byAccount.keys()].sort()) {
    const payments = byAccount.get(account)!;
    rows.push({ kind: 'heading', label: account, depth: 0 });
    for (const line of payments) {
      rows.push({
        kind: 'line', depth: 1, to: line.transaction_path,
        cells: [line.entry_date, line.transaction_label, line.num ?? '', line.name ?? '', line.memo ?? '', line.credit],
      });
    }
    const total = sum(payments.map(line => line.credit));
    totals.push(total);
    rows.push(totalRow(width, `Total for ${account}`, [total]));
  }
  rows.push(totalRow(width, 'TOTAL', [sum(totals)]));
  return { columns, rows };
}

const DETAIL_BY_NAME_COLUMNS: ReportColumn[] = [
  { label: 'Date', kind: 'date' },
  { label: 'Transaction Type', kind: 'text' },
  { label: 'Num', kind: 'text' },
  { label: 'Memo/Description', kind: 'text' },
  { label: 'Account', kind: 'text' },
  { label: 'Amount', kind: 'money' },
  { label: 'Balance', kind: 'money' },
];

type NamedLine = { line: GlLine; account: string; amount: string };

/** Lines under the name they carry ("Not Specified" last), each name's balance running from zero. */
function detailByName(entries: NamedLine[]): ReportTable {
  const groups = new Map<string, NamedLine[]>();
  for (const entry of entries) {
    const name = entry.line.name?.trim() || NOT_SPECIFIED;
    groups.set(name, [...(groups.get(name) ?? []), entry]);
  }
  const width = DETAIL_BY_NAME_COLUMNS.length;
  const rows: ReportRow[] = [];
  for (const name of [...groups.keys()].sort(byName)) {
    rows.push({ kind: 'heading', label: name, depth: 0 });
    let running = new Decimal(0);
    const own = [...groups.get(name)!].sort((a, b) => a.line.entry_date.localeCompare(b.line.entry_date));
    for (const { line, account, amount } of own) {
      running = running.plus(amount);
      rows.push({
        kind: 'line', depth: 1, to: line.transaction_path,
        cells: [line.entry_date, line.transaction_label, line.num ?? '', line.memo ?? '', account, amount, running.toFixed(4)],
      });
    }
    rows.push(totalRow(width, `Total for ${name}`, [running.toFixed(4), '']));
  }
  rows.push(totalRow(width, 'TOTAL', [sum(entries.map(entry => entry.amount)), '']));
  return { columns: DETAIL_BY_NAME_COLUMNS, rows };
}

/** Sales by Customer Detail: the lines behind Sales by Customer Summary, under each customer. */
export function salesByCustomerDetailTable(gl: GlReport): ReportTable {
  return detailByName(gl.accounts
    .filter(account => account.account_type === 'revenue')
    .flatMap(account => account.lines
      .filter(line => SALES_TYPES.has(line.transaction_label))
      .map(line => ({ line, account: accountLabel(account), amount: line.amount }))));
}

// What QuickBooks counts as bought from a vendor: bills, checks, expenses and
// card charges, less vendor credits.
const PURCHASE_TYPES = new Set(['Bill', 'Check', 'Expense', 'Credit Card Expense', 'Vendor Credit']);
const PAYING_GROUPS = new Set(['Bank', 'Credit Card', 'Accounts payable (A/P)']);

/**
 * Purchases by Vendor Detail: what was bought from each vendor. The lines a
 * bill, check or expense charges, not the account that paid it.
 */
export function purchasesByVendorDetailTable(gl: GlReport): ReportTable {
  return detailByName(gl.accounts
    .filter(account => !PAYING_GROUPS.has(accountGroup(account) ?? ''))
    .flatMap(account => account.lines
      .filter(line => PURCHASE_TYPES.has(line.transaction_label))
      .map(line => ({ line, account: accountLabel(account), amount: signed(line) }))));
}

const isPnlAccount = (account: GlAccount): boolean => account.account_type === 'revenue' || account.account_type === 'expense';

/**
 * Income by Customer Summary: each customer's income, the costs that name
 * them (the cost of goods on their invoices), and what is left.
 */
export function incomeByCustomerTable(gl: GlReport, customers: ReadonlySet<string>): ReportTable {
  const columns: ReportColumn[] = [
    { label: 'Customer', kind: 'text' },
    { label: 'Income', kind: 'money' },
    { label: 'Expenses', kind: 'money' },
    { label: 'Net Income', kind: 'money' },
  ];
  const figures = new Map<string, { income: string[]; expenses: string[] }>();
  for (const account of gl.accounts.filter(isPnlAccount)) {
    for (const line of account.lines) {
      const name = line.name?.trim() ?? '';
      if (!customers.has(name)) continue;
      const entry = figures.get(name) ?? { income: [], expenses: [] };
      (account.account_type === 'revenue' ? entry.income : entry.expenses).push(line.amount);
      figures.set(name, entry);
    }
  }
  const rows: ReportRow[] = [...figures.keys()].sort(byName).map((name): ReportRow => {
    const entry = figures.get(name)!;
    const income = sum(entry.income);
    const expenses = sum(entry.expenses);
    return { kind: 'line', depth: 0, cells: [name, income, expenses, minus(income, expenses)] };
  });
  const all = [...figures.values()];
  const income = sum(all.flatMap(entry => entry.income));
  const expenses = sum(all.flatMap(entry => entry.expenses));
  rows.push(totalRow(columns.length, 'TOTAL', [income, expenses, minus(income, expenses)]));
  return { columns, rows };
}

/**
 * Profit and Loss by Customer: the P&L with a column for each customer, what
 * names no customer under Not Specified, and the P&L itself as the total.
 */
export function pnlByCustomerTable(
  gl: GlReport, pnl: PnlReport, customers: ReadonlySet<string>, drill: { start: string; end: string },
): ReportTable {
  const sections = pnlSections(pnl);
  type Entry = { line: PnlLine; revenue: boolean };
  const byCustomer = new Map<string, Map<string, Entry>>();
  for (const account of gl.accounts.filter(isPnlAccount)) {
    const revenue = account.account_type === 'revenue';
    for (const line of account.lines) {
      const trimmed = line.name?.trim() ?? '';
      const name = customers.has(trimmed) ? trimmed : NOT_SPECIFIED;
      const accounts = byCustomer.get(name) ?? new Map<string, Entry>();
      const amount = sum([accounts.get(account.account_id)?.line.amount ?? '0', line.amount]);
      accounts.set(account.account_id, {
        revenue,
        line: {
          account_id: account.account_id, account_code: account.account_code, account_name: account.account_name, amount,
          section: sections.get(account.account_id) ?? (revenue ? 'income' : 'operating'),
        },
      });
      byCustomer.set(name, accounts);
    }
  }
  // Only the lines are read for a column; the P&L's own totals are worked out again from them.
  const reportOf = (accounts: Map<string, Entry>): PnlReport => {
    const entries = [...accounts.values()];
    return {
      ...pnl,
      revenue_lines: entries.filter(entry => entry.revenue).map(entry => entry.line),
      expense_lines: entries.filter(entry => !entry.revenue).map(entry => entry.line),
    };
  };
  const periods = [...byCustomer.keys()].sort(byName).map(name => ({ label: name, report: reportOf(byCustomer.get(name)!) }));
  return pnlColumnsTable([...periods, { label: 'Total', report: pnl }], { drill });
}

/**
 * The quarters of the fiscal year that begins in `startMonth`, from `start` to
 * `end`, the first and last cut at those dates; null when there are more than `max`.
 */
export function quarterRanges(start: string, end: string, startMonth: number, max = 12): { label: string; start: string; end: string }[] | null {
  const monthName = (year: number, month: number): string =>
    new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const ranges: { label: string; start: string; end: string }[] = [];
  let year = Number(start.slice(0, 4));
  // Back to the first month of the quarter `start` falls in.
  let month = Number(start.slice(5, 7)) - ((((Number(start.slice(5, 7)) - startMonth) % 3) + 3) % 3);
  if (month < 1) {
    month += 12;
    year -= 1;
  }
  let first = `${year}-${String(month).padStart(2, '0')}-01`;
  while (first <= end) {
    const lastMonth = month + 2 > 12 ? month - 10 : month + 2;
    const lastYear = month + 2 > 12 ? year + 1 : year;
    const last = new Date(Date.UTC(lastYear, lastMonth, 0)).toISOString().slice(0, 10);
    const label = lastYear === year
      ? `${monthName(year, month)} - ${monthName(lastYear, lastMonth)}, ${year}`
      : `${monthName(year, month)}, ${year} - ${monthName(lastYear, lastMonth)}, ${lastYear}`;
    ranges.push({ label, start: first < start ? start : first, end: last > end ? end : last });
    if (ranges.length > max) return null;
    month = lastMonth === 12 ? 1 : lastMonth + 1;
    year = lastMonth === 12 ? lastYear + 1 : lastYear;
    first = `${year}-${String(month).padStart(2, '0')}-01`;
  }
  return ranges;
}

/** Balance Sheet Summary: the Balance Sheet with each account type as one line. */
export function balanceSheetSummaryTable(sheet: BalanceSheetReport): ReportTable {
  const columns: ReportColumn[] = [{ label: '', kind: 'text' }, { label: 'Total', kind: 'money' }];
  const rows: ReportRow[] = [];
  const blocks = (list: SheetBlock<BsLine>[], base: number) => {
    for (const block of list) {
      if (block.label) rows.push({ kind: 'heading', label: block.label, depth: base });
      const depth = block.label ? base + 1 : base;
      for (const group of block.groups) rows.push({ kind: 'line', depth, cells: [group.label, group.total] });
      if (block.label) rows.push(totalRow(2, `Total ${block.label}`, [block.total], base));
    }
  };
  rows.push({ kind: 'heading', label: 'Assets', depth: 0 });
  blocks(assetBlocks(sheet.asset_lines), 1);
  rows.push(totalRow(2, 'Total Assets', [sum(sheet.asset_lines.map(line => line.amount))]));
  rows.push({ kind: 'heading', label: 'Liabilities and Equity', depth: 0 });
  rows.push({ kind: 'heading', label: 'Liabilities', depth: 1 });
  blocks(liabilityBlocks(sheet.liability_lines), 2);
  const liabilities = sum(sheet.liability_lines.map(line => line.amount));
  rows.push(totalRow(2, 'Total Liabilities', [liabilities], 1));
  // This year's net income is part of equity, as on the Balance Sheet.
  const equity = sum([...sheet.equity_lines.map(line => line.amount), sheet.net_income_ytd]);
  rows.push({ kind: 'line', depth: 1, cells: ['Equity', equity] });
  rows.push(totalRow(2, 'Total Liabilities and Equity', [sum([liabilities, equity])]));
  return { columns, rows };
}

/** One row of the Trial Balance report; `net` is debit minus credit. */
export type TrialBalanceRow = { account_id: string; code: string; name: string; net: string };

/** A net debit in the debit column, a net credit in the credit column. */
function sides(net: string): [string, string] {
  const value = new Decimal(net || '0');
  if (value.isZero()) return ['', ''];
  return value.greaterThan(0) ? [value.toFixed(4), ''] : ['', value.negated().toFixed(4)];
}

/**
 * Adjusted Trial Balance: each account's balance as of the end date before the
 * period's adjusting entries, the adjustments, and the balance after them (the
 * Trial Balance itself).
 */
export function adjustedTrialBalanceTable(trialBalance: TrialBalanceRow[], gl: GlReport, asOf: string): ReportTable {
  const columns: ReportColumn[] = [
    { label: 'Account', kind: 'text' },
    { label: 'Unadjusted Debit', kind: 'money' },
    { label: 'Unadjusted Credit', kind: 'money' },
    { label: 'Adjustments Debit', kind: 'money' },
    { label: 'Adjustments Credit', kind: 'money' },
    { label: 'Adjusted Debit', kind: 'money' },
    { label: 'Adjusted Credit', kind: 'money' },
  ];
  const adjustments = new Map<string, string>();
  for (const account of gl.accounts) {
    const adjusting = account.lines.filter(line => line.is_adjusting);
    if (adjusting.length > 0) adjustments.set(account.account_id, sum(adjusting.map(signed)));
  }
  const rows: ReportRow[] = [];
  const columnValues: string[][] = columns.slice(1).map(() => []);
  for (const row of trialBalance) {
    const adjustment = adjustments.get(row.account_id) ?? '0';
    if (isZero(row.net) && isZero(adjustment)) continue;
    const cells = [...sides(minus(row.net, adjustment)), ...sides(adjustment), ...sides(row.net)];
    cells.forEach((cell, i) => columnValues[i]!.push(cell));
    rows.push({
      kind: 'line', depth: 0,
      ...(row.account_id ? { to: generalLedgerDrilldownUrl({ accountId: row.account_id, periodStart: LEDGER_HISTORY_START, periodEnd: asOf }) } : {}),
      cells: [row.code ? `${row.code} ${row.name}` : row.name, ...cells],
    });
  }
  rows.push(totalRow(columns.length, 'TOTAL', columnValues.map(values => sum(values))));
  return { columns, rows };
}
