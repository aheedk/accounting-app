import { Decimal } from 'decimal.js';
import type { AccountGroup } from '@accounting/shared';
import { fmtDateText } from '@/lib/dates';
import { assetBlocks, liabilityBlocks, type SheetBlock } from '@/lib/balanceSheetLayout';
import { generalLedgerDrilldownUrl, LEDGER_HISTORY_START } from '@/lib/reportDrilldown';
import type { PnlReport, PnlSection } from './pnlLayout';

// More of QuickBooks' standard reports (item 18, 10-25 meeting), worked out from
// what the ledger reports already give: the General Ledger's lines, the P&L and
// the Balance Sheet. Built from the same figures, each one ties out to those
// reports. A builder returns a ReportTable of plain values (dates as
// YYYY-MM-DD, amounts as decimal strings) that the page shows, prints and
// exports alike.

export type ColumnKind = 'text' | 'date' | 'money' | 'percent';
export type ReportColumn = { label: string; kind: ColumnKind };
export type ReportRow =
  | { kind: 'heading'; label: string; depth: number }
  /** `to` opens what the row is about: the transaction, or the account's ledger. */
  | { kind: 'line' | 'total'; cells: string[]; depth: number; to?: string };
export type ReportTable = { columns: ReportColumn[]; rows: ReportRow[] };

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The rows as Excel and the print page take them: amounts as numbers, dates as typed. */
export function exportRows(table: ReportTable): string[][] {
  return table.rows.map(row => {
    if (row.kind === 'heading') return [row.label, ...Array<string>(Math.max(table.columns.length - 1, 0)).fill('')];
    return row.cells.map((cell, i) => (table.columns[i]?.kind === 'date' && ISO_DATE.test(cell) ? fmtDateText(cell) : cell));
  });
}

/** The same day a year earlier; February 29 becomes the 28th. */
export function yearEarlier(iso: string): string {
  const year = String(Number(iso.slice(0, 4)) - 1).padStart(4, '0');
  return iso.slice(5) === '02-29' ? `${year}-02-28` : `${year}${iso.slice(4)}`;
}

export type GlLine = {
  journal_entry_id: string;
  entry_date: string;
  transaction_label: string;
  num: string | null;
  name: string | null;
  memo: string | null;
  split_account: string | null;
  debit: string;
  credit: string;
  /** Signed in the account's natural direction. */
  amount: string;
  running_balance: string;
  transaction_path: string;
  /** True only for a real adjusting entry: the Adjusted Trial Balance's adjustments. */
  is_adjusting?: boolean;
  /** When it was entered (an ISO timestamp): Recent Transactions. */
  created_at?: string;
  /** Cleared by a finished bank reconciliation: the Clr column. */
  is_reconciled?: boolean;
};

export type GlAccount = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  /** For the Account List report — every other report groups by account_type alone. */
  detail_type: string | null;
  beginning_balance: string;
  ending_balance: string;
  lines: GlLine[];
};

export type GlReport = { period_start: string; period_end: string; accounts: GlAccount[] };

export type BsLine = {
  account_id: string;
  account_code: string;
  account_name: string;
  amount: string;
  group?: AccountGroup | null;
};

export type BalanceSheetReport = {
  as_of: string;
  asset_lines: BsLine[];
  liability_lines: BsLine[];
  equity_lines: BsLine[];
  net_income_ytd: string;
};

export const sum = (values: string[]): string => values.reduce((total, v) => total.plus(v || '0'), new Decimal(0)).toFixed(4);
export const minus = (a: string, b: string): string => new Decimal(a || '0').minus(b || '0').toFixed(4);
export const isZero = (v: string): boolean => new Decimal(v || '0').isZero();
export const accountLabel = (a: { account_code: string; account_name: string }): string =>
  a.account_code ? `${a.account_code} ${a.account_name}` : a.account_name;
const byLabel = (a: { account_code: string; account_name: string }, b: { account_code: string; account_name: string }): number =>
  a.account_code.localeCompare(b.account_code) || a.account_name.localeCompare(b.account_name);

/** A total row: the label first, then the given amounts in the last columns. */
export function totalRow(width: number, label: string, amounts: string[], depth = 0): ReportRow {
  const cells = Array<string>(width).fill('');
  cells[0] = label;
  amounts.forEach((amount, i) => { cells[width - amounts.length + i] = amount; });
  return { kind: 'total', cells, depth };
}

export const DETAIL_COLUMNS: ReportColumn[] = [
  { label: 'Date', kind: 'date' },
  { label: 'Transaction Type', kind: 'text' },
  { label: 'Num', kind: 'text' },
  { label: 'Name', kind: 'text' },
  { label: 'Memo/Description', kind: 'text' },
  { label: 'Split', kind: 'text' },
  { label: 'Amount', kind: 'money' },
  { label: 'Balance', kind: 'money' },
];

export function detailRow(line: GlLine, balance: string, depth = 2): ReportRow {
  return {
    kind: 'line', depth, to: line.transaction_path,
    cells: [line.entry_date, line.transaction_label, line.num ?? '', line.name ?? '', line.memo ?? '', line.split_account ?? '', line.amount, balance],
  };
}

export function pnlSections(pnl: PnlReport): Map<string, PnlSection> {
  const sections = new Map<string, PnlSection>();
  for (const line of pnl.revenue_lines) sections.set(line.account_id, line.section ?? 'income');
  for (const line of pnl.expense_lines) sections.set(line.account_id, line.section ?? 'operating');
  return sections;
}

/**
 * Profit and Loss Detail: every transaction behind the P&L, under its account,
 * in the P&L's sections and order. The balance runs from zero within the period.
 */
export function pnlDetailTable(gl: GlReport, pnl: PnlReport): ReportTable {
  const sections = pnlSections(pnl);
  const sectionOf = (a: GlAccount): PnlSection => sections.get(a.account_id) ?? (a.account_type === 'revenue' ? 'income' : 'operating');
  const width = DETAIL_COLUMNS.length;
  const rows: ReportRow[] = [];

  const block = (section: PnlSection, label: string, always: boolean): string | null => {
    const accounts = gl.accounts
      .filter(a => (a.account_type === 'revenue' || a.account_type === 'expense') && a.lines.length > 0 && sectionOf(a) === section);
    if (accounts.length === 0 && !always) return null;
    rows.push({ kind: 'heading', label, depth: 0 });
    const totals: string[] = [];
    for (const account of accounts) {
      rows.push({ kind: 'heading', label: accountLabel(account), depth: 1 });
      let running = new Decimal(0);
      for (const line of account.lines) {
        running = running.plus(line.amount || '0');
        rows.push(detailRow(line, running.toFixed(4)));
      }
      totals.push(running.toFixed(4));
      rows.push(totalRow(width, `Total for ${accountLabel(account)}`, [running.toFixed(4), ''], 1));
    }
    const total = sum(totals);
    rows.push(totalRow(width, `Total ${label}`, [total, '']));
    return total;
  };
  const result = (label: string, amount: string) => rows.push(totalRow(width, label, [amount, '']));

  const income = block('income', 'Income', true) ?? '0';
  const cogs = block('cogs', 'Cost of Goods Sold', false);
  const grossProfit = minus(income, cogs ?? '0');
  result('Gross Profit', grossProfit);
  const expenses = block('operating', 'Expenses', true) ?? '0';
  const operating = minus(grossProfit, expenses);
  result('Net Operating Income', operating);
  const otherIncome = block('other_income', 'Other Income', false);
  const otherExpenses = block('other_expense', 'Other Expenses', false);
  let netIncome = operating;
  if (otherIncome !== null || otherExpenses !== null) {
    const netOther = minus(otherIncome ?? '0', otherExpenses ?? '0');
    result('Net Other Income', netOther);
    netIncome = sum([operating, netOther]);
  }
  result('Net Income', netIncome);
  return { columns: DETAIL_COLUMNS, rows };
}

/**
 * Balance Sheet Detail: each balance sheet account's beginning balance, the
 * period's transactions with the running balance, and where it ends. This
 * year's net income is not in an account (year end is not posted), so it is a
 * line of its own under Equity, as on the Balance Sheet.
 */
export function balanceSheetDetailTable(gl: GlReport, netIncomeYtd: string): ReportTable {
  const width = DETAIL_COLUMNS.length;
  const rows: ReportRow[] = [];

  const block = (type: string, label: string): { change: string; balance: string } => {
    rows.push({ kind: 'heading', label, depth: 0 });
    const changes: string[] = [];
    const balances: string[] = [];
    const accounts = gl.accounts
      .filter(a => a.account_type === type && (a.lines.length > 0 || !isZero(a.beginning_balance) || !isZero(a.ending_balance)));
    for (const account of accounts) {
      rows.push({ kind: 'heading', label: accountLabel(account), depth: 1 });
      rows.push({ kind: 'line', depth: 2, cells: ['Beginning Balance', '', '', '', '', '', '', account.beginning_balance] });
      for (const line of account.lines) rows.push(detailRow(line, line.running_balance));
      const change = sum(account.lines.map(line => line.amount));
      changes.push(change);
      balances.push(account.ending_balance);
      rows.push(totalRow(width, `Total for ${accountLabel(account)}`, [change, account.ending_balance], 1));
    }
    return { change: sum(changes), balance: sum(balances) };
  };

  const assets = block('asset', 'Assets');
  rows.push(totalRow(width, 'Total Assets', [assets.change, assets.balance]));
  const liabilities = block('liability', 'Liabilities');
  rows.push(totalRow(width, 'Total Liabilities', [liabilities.change, liabilities.balance]));
  const equity = block('equity', 'Equity');
  rows.push({ kind: 'line', depth: 1, cells: ['Net Income', '', '', '', 'This fiscal year, not posted to an account', '', '', netIncomeYtd] });
  const equityBalance = sum([equity.balance, netIncomeYtd]);
  rows.push(totalRow(width, 'Total Equity', [equity.change, equityBalance]));
  rows.push(totalRow(width, 'Total Liabilities and Equity', ['', sum([liabilities.balance, equityBalance])]));
  return { columns: DETAIL_COLUMNS, rows };
}

const ACCOUNT_TYPE_SECTIONS: { type: string; label: string }[] = [
  { type: 'asset', label: 'Assets' },
  { type: 'liability', label: 'Liabilities' },
  { type: 'equity', label: 'Equity' },
  { type: 'revenue', label: 'Income' },
  { type: 'expense', label: 'Expenses' },
];

/**
 * Account List: every account in the chart, grouped by type, with its detail
 * type and its balance as of the date chosen — not a period activity report
 * like the others here, so `lines` and `beginning_balance` are unused; only
 * `ending_balance` (as of the General Ledger's own `period_end`) matters.
 * No grand total: assets/expenses and liabilities/equity/income run in
 * opposite natural directions, so summing every balance wouldn't mean
 * anything, the same reason QuickBooks' own Account List has none.
 */
export function accountListTable(gl: GlReport): ReportTable {
  const columns: ReportColumn[] = [
    { label: 'Account', kind: 'text' },
    { label: 'Detail Type', kind: 'text' },
    { label: 'Balance', kind: 'money' },
  ];
  const rows: ReportRow[] = [];
  for (const section of ACCOUNT_TYPE_SECTIONS) {
    const accounts = gl.accounts.filter(a => a.account_type === section.type).sort(byLabel);
    if (accounts.length === 0) continue;
    rows.push({ kind: 'heading', label: section.label, depth: 0 });
    for (const account of accounts) {
      rows.push({
        kind: 'line', depth: 1, to: generalLedgerDrilldownUrl({ accountId: account.account_id, periodStart: LEDGER_HISTORY_START, periodEnd: gl.period_end }),
        cells: [accountLabel(account), account.detail_type ?? '', account.ending_balance],
      });
    }
  }
  return { columns, rows };
}

/** A ledger line with its account: the label, and the type and detail type that say what kind of account it is. */
export type JournalLine = GlLine & { account_id: string; account: string; account_code: string; account_type: string; detail_type: string | null };
export type Transaction = { id: string; date: string; num: string; lines: JournalLine[] };

/** The General Ledger's lines put back together into their transactions, by date. */
export function transactions(gl: GlReport): Transaction[] {
  const byId = new Map<string, Transaction>();
  for (const account of gl.accounts) {
    for (const line of account.lines) {
      let tx = byId.get(line.journal_entry_id);
      if (!tx) {
        tx = { id: line.journal_entry_id, date: line.entry_date, num: '', lines: [] };
        byId.set(line.journal_entry_id, tx);
      }
      if (!tx.num && line.num) tx.num = line.num;
      tx.lines.push({
        ...line, account_id: account.account_id, account: accountLabel(account), account_code: account.account_code,
        account_type: account.account_type, detail_type: account.detail_type,
      });
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.date.localeCompare(b.date) || a.num.localeCompare(b.num, undefined, { numeric: true }) || a.id.localeCompare(b.id));
}

/** Journal: every transaction in the period with all of its debits and credits. */
export function journalTable(gl: GlReport): ReportTable {
  const columns: ReportColumn[] = [
    { label: 'Date', kind: 'date' },
    { label: 'Transaction Type', kind: 'text' },
    { label: 'Num', kind: 'text' },
    { label: 'Name', kind: 'text' },
    { label: 'Memo/Description', kind: 'text' },
    { label: 'Account', kind: 'text' },
    { label: 'Debit', kind: 'money' },
    { label: 'Credit', kind: 'money' },
  ];
  const rows: ReportRow[] = [];
  const debits: string[] = [];
  const credits: string[] = [];
  for (const tx of transactions(gl)) {
    // Debits first, then credits, each by account, as a journal entry is written.
    const lines = [...tx.lines].sort((a, b) =>
      Number(isZero(a.debit)) - Number(isZero(b.debit)) || a.account_code.localeCompare(b.account_code));
    lines.forEach((line, i) => {
      const first = i === 0;
      rows.push({
        kind: 'line', depth: 0, ...(first ? { to: line.transaction_path } : {}),
        cells: [
          first ? line.entry_date : '', first ? line.transaction_label : '', first ? line.num ?? '' : '', first ? line.name ?? '' : '',
          line.memo ?? '', line.account, isZero(line.debit) ? '' : line.debit, isZero(line.credit) ? '' : line.credit,
        ],
      });
    });
    const debit = sum(lines.map(line => line.debit));
    const credit = sum(lines.map(line => line.credit));
    debits.push(debit);
    credits.push(credit);
    rows.push(totalRow(columns.length, '', [debit, credit]));
  }
  rows.push(totalRow(columns.length, 'TOTAL', [sum(debits), sum(credits)]));
  return { columns, rows };
}

/** Transaction List by Date: one row per transaction in the period. */
export function transactionListTable(gl: GlReport): ReportTable {
  const columns: ReportColumn[] = [
    { label: 'Date', kind: 'date' },
    { label: 'Transaction Type', kind: 'text' },
    { label: 'Num', kind: 'text' },
    { label: 'Name', kind: 'text' },
    { label: 'Memo/Description', kind: 'text' },
    { label: 'Amount', kind: 'money' },
  ];
  const rows: ReportRow[] = transactions(gl).map(tx => {
    const first = tx.lines[0]!;
    return {
      kind: 'line', depth: 0, to: first.transaction_path,
      cells: [
        tx.date, first.transaction_label, tx.num,
        tx.lines.find(line => line.name)?.name ?? '',
        tx.lines.find(line => line.memo)?.memo ?? '',
        sum(tx.lines.map(line => line.debit)),
      ],
    };
  });
  return { columns, rows };
}

// What QuickBooks counts as a sale: invoices and credit memos, and deposits
// straight to an income account.
export const SALES_TYPES = new Set(['Invoice', 'Credit Memo', 'Deposit']);
export const NOT_SPECIFIED = 'Not Specified';

function byName(lines: GlLine[], nameOf: (line: GlLine) => string | null, heading: string): ReportTable {
  const totals = new Map<string, string[]>();
  for (const line of lines) {
    const name = nameOf(line)?.trim() || NOT_SPECIFIED;
    totals.set(name, [...(totals.get(name) ?? []), line.amount]);
  }
  const names = [...totals.keys()].sort((a, b) =>
    Number(a === NOT_SPECIFIED) - Number(b === NOT_SPECIFIED) || a.localeCompare(b));
  const columns: ReportColumn[] = [{ label: heading, kind: 'text' }, { label: 'Total', kind: 'money' }];
  const rows: ReportRow[] = names.map(name => ({ kind: 'line', depth: 0, cells: [name, sum(totals.get(name)!)] }));
  rows.push(totalRow(2, 'TOTAL', [sum(lines.map(line => line.amount))]));
  return { columns, rows };
}

/** Sales by Customer Summary: income from sales, per customer. */
export function salesByCustomerTable(gl: GlReport): ReportTable {
  const lines = gl.accounts
    .filter(a => a.account_type === 'revenue')
    .flatMap(a => a.lines)
    .filter(line => SALES_TYPES.has(line.transaction_label));
  return byName(lines, line => line.name, 'Customer');
}

/** Expenses by Vendor Summary: everything spent, per vendor or payee. */
export function expensesByVendorTable(gl: GlReport): ReportTable {
  const lines = gl.accounts.filter(a => a.account_type === 'expense').flatMap(a => a.lines);
  // A stock movement names the item, not who was paid.
  return byName(lines, line => (line.transaction_label === 'Inventory' ? null : line.name), 'Vendor');
}

/** A party's current balance, as the Aging Summary reports already compute it. */
export type PartyBalance = { id: string; name: string; total: string };

/**
 * Customer/Vendor Balance Summary: each party's current open balance, with no
 * bucket breakdown — the Aging Summary report's own `total` column, read
 * straight off its rows rather than re-derived from the ledger. Unlike the
 * other reports here this isn't built from the General Ledger, the P&L or
 * the Balance Sheet; it's the same "built from a report the app already has"
 * principle applied to Aging instead, since that's exactly what this figure
 * already is there.
 */
export function partyBalanceTable(rows: PartyBalance[], heading: 'Customer' | 'Vendor'): ReportTable {
  const columns: ReportColumn[] = [{ label: heading, kind: 'text' }, { label: 'Balance', kind: 'money' }];
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  const lines: ReportRow[] = sorted.map(r => ({ kind: 'line', depth: 0, cells: [r.name, r.total] }));
  lines.push(totalRow(2, 'TOTAL', [sum(sorted.map(r => r.total))]));
  return { columns, rows: lines };
}

/** Mirrors apps/api/src/services/reports/agingBuckets.ts's own Bucket type
 * and order — the bucket key is part of the Aging endpoints' wire shape, so
 * this is the display-only half (label + order), not a re-derivation of
 * which bucket a document falls in (the API already decides that). */
export type AgingBucket = 'current' | 'days_1_30' | 'days_31_60' | 'days_61_90' | 'days_over_90';
const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  current: 'Current', days_1_30: '1 - 30', days_31_60: '31 - 60', days_61_90: '61 - 90', days_over_90: '91 and over',
};
const AGING_BUCKET_ORDER: AgingBucket[] = ['current', 'days_1_30', 'days_31_60', 'days_61_90', 'days_over_90'];

/** One open invoice or unpaid bill, as the Aging reports' own per-document
 * detail already carries it. */
export type OpenDocument = {
  number: string;
  party_name: string;
  issue_date: string;
  due_date: string;
  total: string;
  open: string;
  bucket: AgingBucket;
};

/**
 * Open Invoices / Unpaid Bills: every document still carrying a balance, due
 * soonest first, reading the Aging reports' own per-document figures instead
 * of re-deriving them — the same principle as the balance summaries above.
 */
export function openDocumentsTable(
  rows: OpenDocument[], kind: 'invoice' | 'bill',
): ReportTable {
  const columns: ReportColumn[] = [
    { label: kind === 'invoice' ? 'Invoice #' : 'Bill #', kind: 'text' },
    { label: kind === 'invoice' ? 'Customer' : 'Vendor', kind: 'text' },
    { label: kind === 'invoice' ? 'Issue Date' : 'Bill Date', kind: 'date' },
    { label: 'Due Date', kind: 'date' },
    { label: 'Amount', kind: 'money' },
    { label: 'Open Balance', kind: 'money' },
  ];
  const lines: ReportRow[] = rows.map(r => ({
    kind: 'line', depth: 0,
    cells: [r.number, r.party_name, r.issue_date, r.due_date, r.total, r.open],
  }));
  lines.push(totalRow(columns.length, 'TOTAL', [sum(rows.map(r => r.open))]));
  return { columns, rows: lines };
}

/**
 * A/R or A/P Aging Detail: the same open documents as Open Invoices/Unpaid
 * Bills, grouped under their aging bucket instead of listed flat — one line
 * per invoice or bill, a subtotal per bucket, a grand total. Reads the same
 * `OpenDocument[]` (now carrying its own `bucket`, decided by the API the
 * same way the summary's buckets are) rather than re-bucketing anything.
 */
export function agingDetailTable(rows: OpenDocument[], kind: 'invoice' | 'bill'): ReportTable {
  const columns: ReportColumn[] = [
    { label: kind === 'invoice' ? 'Invoice #' : 'Bill #', kind: 'text' },
    { label: kind === 'invoice' ? 'Customer' : 'Vendor', kind: 'text' },
    { label: 'Due Date', kind: 'date' },
    { label: 'Open Balance', kind: 'money' },
  ];
  const width = columns.length;
  const reportRows: ReportRow[] = [];
  for (const bucket of AGING_BUCKET_ORDER) {
    const inBucket = rows.filter(r => r.bucket === bucket);
    if (inBucket.length === 0) continue;
    reportRows.push({ kind: 'heading', label: AGING_BUCKET_LABELS[bucket], depth: 0 });
    for (const r of inBucket) reportRows.push({ kind: 'line', depth: 1, cells: [r.number, r.party_name, r.due_date, r.open] });
    reportRows.push(totalRow(width, `Total ${AGING_BUCKET_LABELS[bucket]}`, [sum(inBucket.map(r => r.open))]));
  }
  reportRows.push(totalRow(width, 'TOTAL', [sum(rows.map(r => r.open))]));
  return { columns, rows: reportRows };
}

/**
 * Customer or Vendor Balance Detail: the same open documents as Open
 * Invoices/Unpaid Bills, grouped under the party that owes (or is owed)
 * them instead of listed flat — one line per invoice or bill, a subtotal
 * per party, a grand total. The companion to the Balance Summary reports
 * above, which show only each party's total; this shows what makes it up.
 */
export function partyBalanceDetailTable(rows: OpenDocument[], kind: 'invoice' | 'bill'): ReportTable {
  const columns: ReportColumn[] = [
    { label: kind === 'invoice' ? 'Invoice #' : 'Bill #', kind: 'text' },
    { label: 'Due Date', kind: 'date' },
    { label: 'Open Balance', kind: 'money' },
  ];
  const width = columns.length;
  const reportRows: ReportRow[] = [];
  const parties = [...new Set(rows.map(r => r.party_name))].sort((a, b) => a.localeCompare(b));
  for (const party of parties) {
    const theirs = rows.filter(r => r.party_name === party);
    reportRows.push({ kind: 'heading', label: party, depth: 0 });
    for (const r of theirs) reportRows.push({ kind: 'line', depth: 1, cells: [r.number, r.due_date, r.open] });
    reportRows.push(totalRow(width, `Total for ${party}`, [sum(theirs.map(r => r.open))]));
  }
  reportRows.push(totalRow(width, 'TOTAL', [sum(rows.map(r => r.open))]));
  return { columns, rows: reportRows };
}

/**
 * The months from `start` to `end`, the first and last cut at those dates; null
 * when there are more than `max`.
 */
export function monthRanges(start: string, end: string, max = 24): { label: string; start: string; end: string }[] | null {
  const ranges: { label: string; start: string; end: string }[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  let first = `${start.slice(0, 7)}-01`;
  while (first <= end) {
    const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    ranges.push({ label, start: first < start ? start : first, end: last > end ? end : last });
    if (ranges.length > max) return null;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    first = `${year}-${String(month).padStart(2, '0')}-01`;
  }
  return ranges;
}

/** "12.50%": the change against the earlier amount, or blank when that is zero. */
function percentChange(current: string, earlier: string): string {
  const base = new Decimal(earlier || '0');
  if (base.isZero()) return '';
  return `${new Decimal(current || '0').minus(base).dividedBy(base.abs()).times(100).toFixed(2)}%`;
}

/** "40.00%": `part` as a share of `whole`, or blank when that is zero. */
function percentOf(part: string, whole: string): string {
  const base = new Decimal(whole || '0');
  if (base.isZero()) return '';
  return `${new Decimal(part || '0').dividedBy(base.abs()).times(100).toFixed(2)}%`;
}

function withChange(amounts: string[], compare: boolean): string[] {
  if (!compare) return amounts;
  const [current = '0', earlier = '0'] = amounts;
  return [...amounts, minus(current, earlier), percentChange(current, earlier)];
}

function columnsFor(first: string, labels: string[], compare: boolean): ReportColumn[] {
  return [
    { label: first, kind: 'text' },
    ...labels.map(label => ({ label, kind: 'money' as const })),
    ...(compare ? [{ label: '$ Change', kind: 'money' as const }, { label: '% Change', kind: 'percent' as const }] : []),
  ];
}

/**
 * The P&L with a column per period: by month, or this period against an
 * earlier one (`compare` adds the $ and % change of the first column against
 * the second). `percentOfIncome` adds each first-column amount as a share of
 * that column's total income instead. Laid out as the P&L page is.
 */
export function pnlColumnsTable(
  periods: { label: string; report: PnlReport }[],
  options: { compare?: boolean; percentOfIncome?: boolean; drill?: { start: string; end: string } } = {},
): ReportTable {
  const compare = options.compare ?? false;
  const percentOfIncome = !compare && (options.percentOfIncome ?? false);
  type Account = { id: string; code: string; name: string; section: PnlSection; amounts: string[] };
  const accounts = new Map<string, Account>();
  periods.forEach((period, column) => {
    const lines = [
      ...period.report.revenue_lines.map(line => ({ line, section: line.section ?? 'income' as PnlSection })),
      ...period.report.expense_lines.map(line => ({ line, section: line.section ?? 'operating' as PnlSection })),
    ];
    for (const { line, section } of lines) {
      let account = accounts.get(line.account_id);
      if (!account) {
        account = { id: line.account_id, code: line.account_code, name: line.account_name, section, amounts: periods.map(() => '0') };
        accounts.set(line.account_id, account);
      }
      account.amounts[column] = line.amount;
    }
  });

  const columns = [
    ...columnsFor('Account', periods.map(p => p.label), compare),
    ...(percentOfIncome ? [{ label: '% of Income', kind: 'percent' as const }] : []),
  ];
  const width = columns.length;
  const rows: ReportRow[] = [];
  const zeros = periods.map(() => '0');
  const columnTotals = (list: Account[]): string[] => periods.map((_, c) => sum(list.map(a => a.amounts[c]!)));
  const combine = (a: string[], b: string[], op: (x: string, y: string) => string): string[] => a.map((x, i) => op(x, b[i]!));
  const totalIncome = sum([...accounts.values()].filter(a => a.section === 'income').map(a => a.amounts[0] ?? '0'));
  const extra = (amounts: string[]): string[] =>
    (percentOfIncome ? [...amounts, percentOf(amounts[0] ?? '0', totalIncome)] : withChange(amounts, compare));
  const result = (label: string, amounts: string[]) => rows.push(totalRow(width, label, extra(amounts)));

  const block = (section: PnlSection, label: string, always: boolean): string[] | null => {
    const list = [...accounts.values()]
      .filter(a => a.section === section)
      .sort((a, b) => byLabel({ account_code: a.code, account_name: a.name }, { account_code: b.code, account_name: b.name }));
    if (list.length === 0 && !always) return null;
    rows.push({ kind: 'heading', label, depth: 0 });
    for (const account of list) {
      rows.push({
        kind: 'line', depth: 1,
        ...(options.drill ? { to: generalLedgerDrilldownUrl({ accountId: account.id, periodStart: options.drill.start, periodEnd: options.drill.end }) } : {}),
        cells: [accountLabel({ account_code: account.code, account_name: account.name }), ...extra(account.amounts)],
      });
    }
    const totals = columnTotals(list);
    result(`Total ${label}`, totals);
    return totals;
  };

  const income = block('income', 'Income', true) ?? zeros;
  const cogs = block('cogs', 'Cost of Goods Sold', false);
  const grossProfit = combine(income, cogs ?? zeros, minus);
  result('Gross Profit', grossProfit);
  const expenses = block('operating', 'Expenses', true) ?? zeros;
  const operating = combine(grossProfit, expenses, minus);
  result('Net Operating Income', operating);
  const otherIncome = block('other_income', 'Other Income', false);
  const otherExpenses = block('other_expense', 'Other Expenses', false);
  let netIncome = operating;
  if (otherIncome !== null || otherExpenses !== null) {
    const netOther = combine(otherIncome ?? zeros, otherExpenses ?? zeros, minus);
    result('Net Other Income', netOther);
    netIncome = combine(operating, netOther, (x, y) => sum([x, y]));
  }
  result('Net Income', netIncome);
  return { columns, rows };
}

/**
 * The Balance Sheet as of two dates side by side, with the $ and % change of
 * the first against the second, laid out as the Balance Sheet page is.
 */
export function balanceSheetComparisonTable(current: BalanceSheetReport, earlier: BalanceSheetReport, labels: [string, string]): ReportTable {
  type Line = BsLine & { amounts: [string, string] };
  const union = (side: 'asset_lines' | 'liability_lines' | 'equity_lines'): Line[] => {
    const lines = new Map<string, Line>();
    [current, earlier].forEach((report, column) => {
      for (const line of report[side]) {
        const existing = lines.get(line.account_id) ?? { ...line, amounts: ['0', '0'] as [string, string] };
        existing.amounts[column] = line.amount;
        lines.set(line.account_id, existing);
      }
    });
    return [...lines.values()].sort(byLabel);
  };
  const columns = columnsFor('Account', [...labels], true);
  const width = columns.length;
  const rows: ReportRow[] = [];
  const totals = (lines: Line[]): [string, string] => [sum(lines.map(l => l.amounts[0])), sum(lines.map(l => l.amounts[1]))];
  const total = (label: string, amounts: [string, string], depth = 0) => rows.push(totalRow(width, label, withChange(amounts, true), depth));
  const lineRow = (line: Line, depth: number) => rows.push({
    kind: 'line', depth,
    to: generalLedgerDrilldownUrl({ accountId: line.account_id, periodStart: LEDGER_HISTORY_START, periodEnd: current.as_of }),
    cells: [accountLabel(line), ...withChange(line.amounts, true)],
  });
  // "Current Assets" with its account types under it, or one type on its own, from `base` in.
  const blocks = (list: SheetBlock<Line>[], base: number) => {
    for (const block of list) {
      if (block.label) rows.push({ kind: 'heading', label: block.label, depth: base });
      const depth = block.label ? base + 1 : base;
      for (const group of block.groups) {
        rows.push({ kind: 'heading', label: group.label, depth });
        for (const line of group.lines) lineRow(line, depth + 1);
        total(`Total ${group.label}`, totals(group.lines), depth);
      }
      if (block.label) total(`Total ${block.label}`, totals(block.groups.flatMap(group => group.lines)), base);
    }
  };

  const assets = union('asset_lines');
  rows.push({ kind: 'heading', label: 'Assets', depth: 0 });
  blocks(assetBlocks(assets), 1);
  total('Total Assets', totals(assets));

  const liabilities = union('liability_lines');
  rows.push({ kind: 'heading', label: 'Liabilities and Equity', depth: 0 });
  rows.push({ kind: 'heading', label: 'Liabilities', depth: 1 });
  blocks(liabilityBlocks(liabilities), 2);
  total('Total Liabilities', totals(liabilities), 1);

  const equity = union('equity_lines');
  rows.push({ kind: 'heading', label: 'Equity', depth: 1 });
  for (const line of equity) lineRow(line, 2);
  const netIncome: [string, string] = [current.net_income_ytd, earlier.net_income_ytd];
  rows.push({ kind: 'line', depth: 2, cells: ['Net Income', ...withChange(netIncome, true)] });
  const equityTotals = totals(equity);
  const equityTotal: [string, string] = [sum([equityTotals[0], netIncome[0]]), sum([equityTotals[1], netIncome[1]])];
  total('Total Equity', equityTotal, 1);
  const liabilityTotals = totals(liabilities);
  total('Total Liabilities and Equity', [sum([liabilityTotals[0], equityTotal[0]]), sum([liabilityTotals[1], equityTotal[1]])]);
  return { columns, rows };
}
