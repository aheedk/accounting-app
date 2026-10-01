import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Decimal } from 'decimal.js';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileDown,
  Printer,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { Input } from '@/components/ui/input';
import { ReportAmountLink } from '@/components/ui/ReportAmountLink';
import { ReportCard } from '@/components/ui/ReportCard';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { dateToLocalIso, fmtLongDate } from '@/lib/dates';
import { downloadAsExcel } from '@/lib/download';
import {
  GENERAL_LEDGER_COLUMNS,
  defaultGeneralLedgerPreferences,
  loadGeneralLedgerPreferences,
  moveGeneralLedgerColumn,
  saveGeneralLedgerPreferences,
  type GeneralLedgerColumnKey,
  type GeneralLedgerPreferences,
} from '@/lib/generalLedgerCustomization';
import { fmtMoney } from '@/lib/money';
import { AppSelect } from '../../components/ui/select';

type Account = {
  id: string;
  code: string;
  name: string;
  account_type: string;
};

type GeneralLedgerLine = {
  journal_entry_id: string;
  line_id: string;
  entry_date: string;
  source_type: string;
  transaction_type: string | null;
  payee_name: string | null;
  reference: string | null;
  transaction_label: string;
  num: string | null;
  name: string | null;
  is_adjusting: boolean;
  transaction_path: string;
  /** Signed in the account's natural direction, so the column adds up to the balance. */
  amount: string;
  memo: string | null;
  split_account: string | null;
  status: 'posted' | 'voided';
  debit: string;
  credit: string;
  running_balance: string;
};

type GeneralLedgerAccount = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  normal_balance: 'debit' | 'credit';
  beginning_balance: string;
  total_debit: string;
  total_credit: string;
  ending_balance: string;
  lines: GeneralLedgerLine[];
};

type GeneralLedgerReport = {
  period_start: string;
  period_end: string;
  account_id: string | null;
  accounts: GeneralLedgerAccount[];
  totals: { total_debit: string; total_credit: string };
};

type DisplayAccount = GeneralLedgerAccount & {
  visible_total_debit: string;
  visible_total_credit: string;
  visible_total_amount: string;
};

type AccountTypeFilter = 'all' | 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
type StatusFilter = 'all' | GeneralLedgerLine['status'];
type AdjFilter = 'all' | 'regular' | 'adjustments';

const DEFAULT_PREFERENCES = defaultGeneralLedgerPreferences();
const NON_NUMERIC_COLUMNS: GeneralLedgerColumnKey[] = ['date', 'transaction', 'reference', 'adj', 'name', 'memo', 'split'];

type DateRangePreset =
  | 'all-dates' | 'custom'
  | 'today' | 'yesterday'
  | 'this-week' | 'this-week-to-date' | 'last-week' | 'last-week-to-date'
  | 'this-month' | 'this-month-to-date' | 'last-month' | 'last-month-to-date'
  | 'this-quarter' | 'this-quarter-to-date' | 'last-quarter' | 'last-quarter-to-date'
  | 'this-year' | 'this-year-to-date' | 'last-year' | 'last-year-to-date'
  | 'this-fiscal-year' | 'this-fiscal-year-to-date' | 'last-fiscal-year' | 'last-fiscal-year-to-date'
  | 'last-7-days' | 'last-30-days' | 'last-90-days';

const DATE_RANGE_OPTIONS: { value: DateRangePreset; label: string }[] = [
  { value: 'all-dates', label: 'All Dates' },
  { value: 'custom', label: 'Custom' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this-week', label: 'This Week' },
  { value: 'this-week-to-date', label: 'This Week-to-date' },
  { value: 'last-week', label: 'Last Week' },
  { value: 'last-week-to-date', label: 'Last Week-to-date' },
  { value: 'this-month', label: 'This Month' },
  { value: 'this-month-to-date', label: 'This Month-to-date' },
  { value: 'last-month', label: 'Last Month' },
  { value: 'last-month-to-date', label: 'Last Month-to-date' },
  { value: 'this-quarter', label: 'This Quarter' },
  { value: 'this-quarter-to-date', label: 'This Quarter-to-date' },
  { value: 'last-quarter', label: 'Last Quarter' },
  { value: 'last-quarter-to-date', label: 'Last Quarter-to-date' },
  { value: 'this-year', label: 'This Year' },
  { value: 'this-year-to-date', label: 'This Year-to-date' },
  { value: 'last-year', label: 'Last Year' },
  { value: 'last-year-to-date', label: 'Last Year-to-date' },
  { value: 'this-fiscal-year', label: 'This Fiscal Year' },
  { value: 'this-fiscal-year-to-date', label: 'This Fiscal Year-to-date' },
  { value: 'last-fiscal-year', label: 'Last Fiscal Year' },
  { value: 'last-fiscal-year-to-date', label: 'Last Fiscal Year-to-date' },
  { value: 'last-7-days', label: 'Last 7 Days' },
  { value: 'last-30-days', label: 'Last 30 Days' },
  { value: 'last-90-days', label: 'Last 90 Days' },
];

function shiftDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function weekStart(d: Date): Date { const r = new Date(d); r.setDate(r.getDate() - r.getDay()); return r; }
function weekEnd(d: Date): Date { const r = new Date(d); r.setDate(r.getDate() + (6 - r.getDay())); return r; }
function monthStart(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function monthEnd(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function quarterStart(d: Date): Date { return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1); }
function quarterEnd(d: Date): Date { const q = Math.floor(d.getMonth() / 3); return new Date(d.getFullYear(), q * 3 + 3, 0); }

function computePresetRange(preset: DateRangePreset): { start: string; end: string } {
  const today = new Date();
  const iso = (d: Date) => dateToLocalIso(d);
  const t = iso(today);
  switch (preset) {
    case 'all-dates':                 return { start: '2000-01-01', end: '2099-12-31' };
    case 'custom':                    return { start: t, end: t };
    case 'today':                     return { start: t, end: t };
    case 'yesterday':                 { const y = shiftDays(today, -1); return { start: iso(y), end: iso(y) }; }
    case 'this-week':                 return { start: iso(weekStart(today)), end: iso(weekEnd(today)) };
    case 'this-week-to-date':         return { start: iso(weekStart(today)), end: t };
    case 'last-week':                 { const lws = shiftDays(weekStart(today), -7); return { start: iso(lws), end: iso(weekEnd(lws)) }; }
    case 'last-week-to-date':         { const lws = shiftDays(weekStart(today), -7); return { start: iso(lws), end: iso(shiftDays(today, -7)) }; }
    case 'this-month':                return { start: iso(monthStart(today)), end: iso(monthEnd(today)) };
    case 'this-month-to-date':        return { start: iso(monthStart(today)), end: t };
    case 'last-month':                { const lm = new Date(today.getFullYear(), today.getMonth() - 1, 1); return { start: iso(lm), end: iso(monthEnd(lm)) }; }
    case 'last-month-to-date':        { const lmS = new Date(today.getFullYear(), today.getMonth() - 1, 1); return { start: iso(lmS), end: iso(new Date(today.getFullYear(), today.getMonth() - 1, today.getDate())) }; }
    case 'this-quarter':              return { start: iso(quarterStart(today)), end: iso(quarterEnd(today)) };
    case 'this-quarter-to-date':      return { start: iso(quarterStart(today)), end: t };
    case 'last-quarter':              { const lqE = new Date(quarterStart(today).getTime() - 86400000); return { start: iso(quarterStart(lqE)), end: iso(quarterEnd(lqE)) }; }
    case 'last-quarter-to-date':      { const lqS = quarterStart(new Date(quarterStart(today).getTime() - 86400000)); const diq = Math.floor((today.getTime() - quarterStart(today).getTime()) / 86400000); return { start: iso(lqS), end: iso(shiftDays(lqS, diq)) }; }
    case 'this-year':                 return { start: `${today.getFullYear()}-01-01`, end: `${today.getFullYear()}-12-31` };
    case 'this-year-to-date':         return { start: `${today.getFullYear()}-01-01`, end: t };
    case 'last-year':                 return { start: `${today.getFullYear() - 1}-01-01`, end: `${today.getFullYear() - 1}-12-31` };
    case 'last-year-to-date':         { const ly = today.getFullYear() - 1; return { start: `${ly}-01-01`, end: iso(new Date(ly, today.getMonth(), today.getDate())) }; }
    case 'this-fiscal-year':          return { start: `${today.getFullYear()}-01-01`, end: `${today.getFullYear()}-12-31` };
    case 'this-fiscal-year-to-date':  return { start: `${today.getFullYear()}-01-01`, end: t };
    case 'last-fiscal-year':          return { start: `${today.getFullYear() - 1}-01-01`, end: `${today.getFullYear() - 1}-12-31` };
    case 'last-fiscal-year-to-date':  { const lfy = today.getFullYear() - 1; return { start: `${lfy}-01-01`, end: iso(new Date(lfy, today.getMonth(), today.getDate())) }; }
    case 'last-7-days':               return { start: iso(shiftDays(today, -6)), end: t };
    case 'last-30-days':              return { start: iso(shiftDays(today, -29)), end: t };
    case 'last-90-days':              return { start: iso(shiftDays(today, -89)), end: t };
  }
}

function fmtShortDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;
  return `${Number(month)}/${Number(day)}/${year.slice(2)}`;
}

// QuickBooks shows negatives with a leading minus in this report, not parentheses.
function fmtAmount(value: string): string {
  const amount = new Decimal(value);
  const formatted = fmtMoney(amount.abs().toFixed(4));
  return amount.isNegative() ? `-${formatted}` : formatted;
}

function fmtNum(line: GeneralLedgerLine): string {
  return line.num ? line.num.replace(/^AJE-/i, 'JE-') : '';
}

function pickErr(error: unknown): string {
  return (error as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Failed to load the General Ledger report';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function columnDefinition(key: GeneralLedgerColumnKey) {
  return GENERAL_LEDGER_COLUMNS.find(column => column.key === key)!;
}

function sumLines(lines: GeneralLedgerLine[], key: 'debit' | 'credit' | 'amount'): string {
  return lines.reduce((sum, line) => sum.plus(line[key]), new Decimal(0)).toFixed(4);
}

function summaryLabelColumn(columns: GeneralLedgerColumnKey[]): GeneralLedgerColumnKey | undefined {
  return columns.includes('transaction')
    ? 'transaction'
    : columns.find(column => NON_NUMERIC_COLUMNS.includes(column));
}

function summaryValues(
  columns: GeneralLedgerColumnKey[],
  label: string,
  amounts: Partial<Record<'amount' | 'balance', string>>,
): string[] {
  const labelColumn = summaryLabelColumn(columns);
  return columns.map(column => {
    if (column === labelColumn) return label;
    if (column === 'amount' || column === 'balance') return amounts[column] ?? '';
    return '';
  });
}

function lineExportValue(line: GeneralLedgerLine, column: GeneralLedgerColumnKey): string {
  switch (column) {
    case 'date': return line.entry_date;
    case 'transaction': return `${line.transaction_label}${line.status === 'voided' ? ' (Voided)' : ''}`;
    case 'reference': return fmtNum(line);
    case 'adj': return line.is_adjusting ? 'Yes' : 'No';
    case 'name': return line.name ?? '';
    case 'memo': return line.memo ?? '';
    case 'split': return line.split_account ?? '';
    case 'amount': return new Decimal(line.amount).isZero() ? '' : line.amount;
    case 'balance': return line.running_balance;
  }
}

function exportRows(
  accounts: DisplayAccount[],
  columns: GeneralLedgerColumnKey[],
  preferences: GeneralLedgerPreferences,
  reportTotals: { debit: string; credit: string },
): string[][] {
  const rows: string[][] = [];
  for (const account of accounts) {
    const accountPrefix = preferences.showAccountNumbers
      ? [account.account_code, account.account_name]
      : [account.account_name];
    if (preferences.showBeginningBalances) {
      rows.push([
        ...accountPrefix,
        ...summaryValues(columns, 'Beginning Balance', { balance: account.beginning_balance }),
      ]);
    }
    for (const line of account.lines) {
      rows.push([...accountPrefix, ...columns.map(column => lineExportValue(line, column))]);
    }
    if (preferences.showAccountTotals) {
      const netAmount = account.visible_total_amount;
      rows.push([
        ...accountPrefix,
        ...summaryValues(columns, 'Account Total', {
          amount: netAmount,
          balance: account.ending_balance,
        }),
      ]);
    }
  }
  if (preferences.showReportTotal) {
    const netReportAmount = new Decimal(reportTotals.debit).minus(reportTotals.credit).toFixed(4);
    rows.push([
      ...(preferences.showAccountNumbers ? ['', 'REPORT TOTAL'] : ['REPORT TOTAL']),
      ...summaryValues(columns, '', { amount: netReportAmount }),
    ]);
  }
  return rows;
}

export default function GeneralLedgerPage() {
  const [businessId] = useActiveBusinessId();
  const [searchParams] = useSearchParams();
  const { businesses } = useAuth();
  const businessName = businesses.find(business => business.id === businessId)?.name ?? '';
  const initPreset: DateRangePreset = searchParams.get('period_start') ? 'custom' : 'this-year-to-date';
  const initRange = computePresetRange(initPreset);
  const [periodPreset, setPeriodPreset] = useState<DateRangePreset>(initPreset);
  const [draftStart, setDraftStart] = useState(() => searchParams.get('period_start') ?? initRange.start);
  const [draftEnd, setDraftEnd] = useState(() => searchParams.get('period_end') ?? initRange.end);
  const [draftAccountId, setDraftAccountId] = useState(() => searchParams.get('account_id') ?? '');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [report, setReport] = useState<GeneralLedgerReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [customizationOpen, setCustomizationOpen] = useState(false);
  const [preferences, setPreferences] = useState(loadGeneralLedgerPreferences);
  const [accountTypeFilter, setAccountTypeFilter] = useState<AccountTypeFilter>('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [adjFilter, setAdjFilter] = useState<AdjFilter>('all');
  const [searchText, setSearchText] = useState('');
  const [showEmptyAccounts, setShowEmptyAccounts] = useState(true);
  const [collapsedAccounts, setCollapsedAccounts] = useState<Set<string>>(() => new Set());

  useEffect(() => { saveGeneralLedgerPreferences(preferences); }, [preferences]);

  useEffect(() => {
    if (!businessId) return;
    api.get<{ accounts: Account[] }>(`/businesses/${businessId}/coa`, { params: { include_inactive: 'true' } })
      .then(response => {
        setAccounts(response.data.accounts);
        setDraftAccountId(current => (
          current && !response.data.accounts.some(account => account.id === current) ? '' : current
        ));
      })
      .catch(() => setAccounts([]));
  }, [businessId]);

  const load = useCallback(async (start: string, end: string, acctId: string): Promise<void> => {
    if (!businessId) return;
    if (start > end) {
      setError('Period end must be on or after period start');
      setReport(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<GeneralLedgerReport>(`/businesses/${businessId}/reports/general-ledger`, {
        params: {
          period_start: start,
          period_end: end,
          ...(acctId ? { account_id: acctId } : {}),
        },
      });
      setReport(response.data);
    } catch (requestError: unknown) {
      setError(pickErr(requestError));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  // Ref always holds current draft values; lets the mount/business-change effect read them without being a dep
  const draftRef = useRef({ start: draftStart, end: draftEnd, acctId: draftAccountId });
  draftRef.current = { start: draftStart, end: draftEnd, acctId: draftAccountId };

  // Auto-load on mount and when business changes
  useEffect(() => {
    const { start, end, acctId } = draftRef.current;
    void load(start, end, acctId);
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const sourceTypes = useMemo(() => {
    const values = new Set<string>();
    report?.accounts.forEach(account => account.lines.forEach(line => values.add(line.transaction_label)));
    return [...values].sort((left, right) => left.localeCompare(right));
  }, [report]);

  useEffect(() => {
    if (sourceFilter !== 'all' && !sourceTypes.includes(sourceFilter)) setSourceFilter('all');
  }, [sourceFilter, sourceTypes]);

  const visibleColumns = useMemo(() => (
    preferences.columnOrder.filter(column => preferences.visibleColumns.includes(column))
  ), [preferences.columnOrder, preferences.visibleColumns]);

  const displayAccounts = useMemo<DisplayAccount[]>(() => {
    if (!report) return [];
    const needle = searchText.trim().toLowerCase();
    return report.accounts.flatMap(account => {
      if (accountTypeFilter !== 'all' && account.account_type !== accountTypeFilter) return [];
      // The server returns lines in posting order, which is the order the
      // running balance was computed in -- so only ever keep or reverse it.
      const matching = account.lines
        .filter(line => sourceFilter === 'all' || line.transaction_label === sourceFilter)
        .filter(line => statusFilter === 'all' || line.status === statusFilter)
        .filter(line => adjFilter === 'all' || (adjFilter === 'adjustments' ? line.is_adjusting : !line.is_adjusting))
        .filter(line => !needle || [
          line.transaction_label, fmtNum(line), line.name, line.memo, line.split_account,
          fmtAmount(line.amount), new Decimal(line.amount).toFixed(2),
        ].join(' ').toLowerCase().includes(needle));
      const lines = preferences.sortDirection === 'oldest' ? matching : [...matching].reverse();
      if (!showEmptyAccounts && lines.length === 0) return [];
      return [{
        ...account,
        lines,
        visible_total_debit: sumLines(lines, 'debit'),
        visible_total_credit: sumLines(lines, 'credit'),
        visible_total_amount: sumLines(lines, 'amount'),
      }];
    });
  }, [accountTypeFilter, adjFilter, preferences.sortDirection, report, searchText, showEmptyAccounts, sourceFilter, statusFilter]);

  const reportTotals = useMemo(() => {
    const debit = displayAccounts.reduce((sum, account) => sum.plus(account.visible_total_debit), new Decimal(0)).toFixed(4);
    const credit = displayAccounts.reduce((sum, account) => sum.plus(account.visible_total_credit), new Decimal(0)).toFixed(4);
    return { debit, credit, amount: new Decimal(debit).minus(credit).toFixed(4) };
  }, [displayAccounts]);

  const transactionCount = useMemo(
    () => displayAccounts.reduce((count, account) => count + account.lines.length, 0),
    [displayAccounts],
  );

  const exportHeaders = useMemo(() => [
    ...(preferences.showAccountNumbers ? ['Account Number'] : []),
    'Account',
    ...visibleColumns.map(column => columnDefinition(column).label),
  ], [preferences.showAccountNumbers, visibleColumns]);

  const rowsForExport = useMemo(() => exportRows(displayAccounts, visibleColumns, preferences, reportTotals), [
    displayAccounts,
    preferences,
    reportTotals,
    visibleColumns,
  ]);

  const activeFilterCount = [
    accountTypeFilter !== 'all',
    sourceFilter !== 'all',
    statusFilter !== 'all',
    adjFilter !== 'all',
    searchText.trim() !== '',
    !showEmptyAccounts,
  ].filter(Boolean).length;
  const displayCustomized = JSON.stringify(preferences) !== JSON.stringify(DEFAULT_PREFERENCES);
  const customizationCount = activeFilterCount + (displayCustomized ? 1 : 0);

  function updatePreferences(patch: Partial<GeneralLedgerPreferences>): void {
    setPreferences(current => ({ ...current, ...patch }));
  }

  function toggleColumn(column: GeneralLedgerColumnKey): void {
    setPreferences(current => {
      const isVisible = current.visibleColumns.includes(column);
      if (isVisible && current.visibleColumns.length === 1) return current;
      return {
        ...current,
        visibleColumns: isVisible
          ? current.visibleColumns.filter(key => key !== column)
          : [...current.visibleColumns, column],
      };
    });
  }

  function resetCustomization(): void {
    setPreferences(defaultGeneralLedgerPreferences());
    setAccountTypeFilter('all');
    setSourceFilter('all');
    setStatusFilter('all');
    setAdjFilter('all');
    setSearchText('');
    setShowEmptyAccounts(true);
    setCollapsedAccounts(new Set());
  }

  function handlePresetChange(preset: DateRangePreset): void {
    setPeriodPreset(preset);
    const range = computePresetRange(preset);
    setDraftStart(range.start);
    setDraftEnd(range.end);
  }

  function handleRunReport(): void {
    if (draftStart > draftEnd) {
      setError('Period end must be on or after period start');
      return;
    }
    setError(null);
    void load(draftStart, draftEnd, draftAccountId);
  }

  function toggleAccount(accountIdToToggle: string): void {
    setCollapsedAccounts(current => {
      const next = new Set(current);
      if (next.has(accountIdToToggle)) next.delete(accountIdToToggle);
      else next.add(accountIdToToggle);
      return next;
    });
  }

  function handleExport(): void {
    if (!report) return;
    setExporting(true);
    try {
      downloadAsExcel(exportHeaders, rowsForExport, `general-ledger-${report.period_start}-to-${report.period_end}`);
    } finally {
      setExporting(false);
    }
  }

  function handlePrint(): void {
    if (!report) return;
    const numericIndexes = new Set<number>();
    const offset = preferences.showAccountNumbers ? 2 : 1;
    visibleColumns.forEach((column, index) => {
      if (columnDefinition(column).numeric) numericIndexes.add(offset + index);
    });
    const body = rowsForExport.map(row => (
      `<tr>${row.map((cell, index) => `<td${numericIndexes.has(index) ? ' class="number"' : ''}>${escapeHtml(cell)}</td>`).join('')}</tr>`
    )).join('');
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`<!DOCTYPE html><html><head><title>General Ledger</title><style>body{font-family:Arial,sans-serif;font-size:10px;margin:24px}h2{margin:0 0 4px;text-align:center}p{color:#666;margin:0 0 16px;text-align:center}table{width:100%;border-collapse:collapse}th{background:#eee;text-align:left;padding:5px;border-bottom:2px solid #bbb}td{padding:4px 5px;border-bottom:1px solid #ddd}.number{text-align:right}</style></head><body><h2>${escapeHtml(businessName)} — General Ledger</h2><p>${escapeHtml(fmtLongDate(report.period_start))} – ${escapeHtml(fmtLongDate(report.period_end))}</p><table><thead><tr>${exportHeaders.map((header, index) => `<th${numericIndexes.has(index) ? ' class="number"' : ''}>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table><script>window.onload=function(){window.print()}</script></body></html>`);
    printWindow.document.close();
  }

  if (!businessId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-4">
      {/* Back link */}
      <div>
        <Link to="/reports" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ChevronLeft className="h-4 w-4" />Back to custom reports
        </Link>
      </div>

      {/* Title */}
      <div>
        <h1 className="text-2xl font-semibold">General Ledger Report</h1>
        <p className="mt-1 text-sm text-muted-foreground">Detailed activity and running balance for every ledger account.</p>
      </div>

      {/* QBO-style report controls */}
      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="mb-1.5 text-sm font-medium">Report period</div>
            <div className="flex items-center gap-2">
              <AppSelect
                className="w-48"
                value={periodPreset}
                onChange={event => handlePresetChange(event.target.value as DateRangePreset)}
              >
                {DATE_RANGE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </AppSelect>
              <DateInput
                className="h-9 w-36"
                value={draftStart}
                onChange={event => setDraftStart(event.target.value)}
                disabled={periodPreset !== 'custom'}
              />
              <span className="text-sm text-muted-foreground">to</span>
              <DateInput
                className="h-9 w-36"
                value={draftEnd}
                onChange={event => setDraftEnd(event.target.value)}
                disabled={periodPreset !== 'custom'}
              />
            </div>
          </div>
          <Button
            variant="outline"
            className="rounded-full px-6"
            onClick={handleRunReport}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Run report'}
          </Button>
        </div>
      </div>

      {/* Secondary toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[16rem]">
          <AppSelect
            className="w-full"
            value={draftAccountId}
            onChange={event => setDraftAccountId(event.target.value)}
          >
            <option value="">All accounts</option>
            {accounts.map(account => (
              <option key={account.id} value={account.id}>{account.code} — {account.name}</option>
            ))}
          </AppSelect>
        </div>
        <Button
          variant={customizationOpen ? 'secondary' : 'outline'}
          onClick={() => setCustomizationOpen(current => !current)}
          aria-expanded={customizationOpen}
        >
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          Customize{customizationCount > 0 ? ` (${customizationCount})` : ''}
        </Button>
      </div>

      {customizationOpen && (
        <CustomizationPanel
          preferences={preferences}
          accountTypeFilter={accountTypeFilter}
          sourceFilter={sourceFilter}
          sourceTypes={sourceTypes}
          statusFilter={statusFilter}
          adjFilter={adjFilter}
          searchText={searchText}
          showEmptyAccounts={showEmptyAccounts}
          onPreferencesChange={updatePreferences}
          onToggleColumn={toggleColumn}
          onMoveColumn={(column, direction) => updatePreferences({
            columnOrder: moveGeneralLedgerColumn(preferences.columnOrder, column, direction),
          })}
          onAccountTypeFilterChange={setAccountTypeFilter}
          onSourceFilterChange={setSourceFilter}
          onStatusFilterChange={setStatusFilter}
          onAdjFilterChange={setAdjFilter}
          onSearchTextChange={setSearchText}
          onShowEmptyAccountsChange={setShowEmptyAccounts}
          onReset={resetCustomization}
        />
      )}

      {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      {report && (
        <ReportCard
          companyName={businessName}
          title="General Ledger"
          subtitle={`${fmtLongDate(report.period_start)} – ${fmtLongDate(report.period_end)}`}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b pb-3 text-sm text-muted-foreground">
            <span>
              Showing {displayAccounts.length} {displayAccounts.length === 1 ? 'account' : 'accounts'} and{' '}
              {transactionCount} {transactionCount === 1 ? 'transaction' : 'transactions'}
              {activeFilterCount > 0 ? ` with ${activeFilterCount} active ${activeFilterCount === 1 ? 'filter' : 'filters'}` : ''}
            </span>
            <span className="flex items-center gap-3">
              {displayAccounts.length > 0 && (
                <>
                  <button type="button" className="text-primary hover:underline" onClick={() => setCollapsedAccounts(new Set())}>Expand all</button>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => setCollapsedAccounts(new Set(displayAccounts.map(account => account.account_id)))}
                  >
                    Collapse all
                  </button>
                  <span aria-hidden="true" className="text-border">|</span>
                </>
              )}
              <div className="relative group">
                <button
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
                  onClick={handleExport}
                  disabled={!report || exporting}
                  aria-label="Export to Excel"
                >
                  <FileDown className="h-4 w-4" />
                </button>
                <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Export to Excel</div>
              </div>
              <div className="relative group">
                <button
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
                  onClick={handlePrint}
                  disabled={!report}
                  aria-label="Print report"
                >
                  <Printer className="h-4 w-4" />
                </button>
                <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Print</div>
              </div>
            </span>
          </div>
          {activeFilterCount > 0 && (
            <p className="mb-3 text-xs text-muted-foreground">
              Debit and credit totals reflect the matching transactions; running and ending balances remain ledger balances.
            </p>
          )}

          {displayAccounts.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {report.accounts.length === 0
                ? 'No ledger activity was found for this period.'
                : 'No ledger activity matches the current customization.'}
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table
                className="w-full text-sm"
                style={{ minWidth: `${Math.max(520, visibleColumns.length * 135)}px` }}
              >
                <thead className="border-b">
                  <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {visibleColumns.map(column => {
                      const definition = columnDefinition(column);
                      return (
                        <th key={column} className={`${preferences.density === 'compact' ? 'px-3 py-2' : 'p-3'} ${definition.numeric ? 'text-right' : 'text-left'} ${column === 'date' ? 'min-w-[6rem]' : ''}`}>
                          {definition.label}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {displayAccounts.map(account => (
                    <AccountSection
                      key={account.account_id}
                      account={account}
                      columns={visibleColumns}
                      preferences={preferences}
                      collapsed={collapsedAccounts.has(account.account_id)}
                      onToggle={() => toggleAccount(account.account_id)}
                    />
                  ))}
                  {preferences.showReportTotal && (
                    <SummaryRow
                      columns={visibleColumns}
                      label="REPORT TOTAL"
                      amount={reportTotals.amount}
                      density={preferences.density}
                      className="border-t-2 font-semibold"
                    />
                  )}
                </tbody>
              </table>
            </div>
          )}
        </ReportCard>
      )}
    </div>
  );
}

type CustomizationPanelProps = {
  preferences: GeneralLedgerPreferences;
  accountTypeFilter: AccountTypeFilter;
  sourceFilter: string;
  sourceTypes: string[];
  statusFilter: StatusFilter;
  adjFilter: AdjFilter;
  searchText: string;
  showEmptyAccounts: boolean;
  onPreferencesChange: (patch: Partial<GeneralLedgerPreferences>) => void;
  onToggleColumn: (column: GeneralLedgerColumnKey) => void;
  onMoveColumn: (column: GeneralLedgerColumnKey, direction: -1 | 1) => void;
  onAccountTypeFilterChange: (value: AccountTypeFilter) => void;
  onSourceFilterChange: (value: string) => void;
  onStatusFilterChange: (value: StatusFilter) => void;
  onAdjFilterChange: (value: AdjFilter) => void;
  onSearchTextChange: (value: string) => void;
  onShowEmptyAccountsChange: (value: boolean) => void;
  onReset: () => void;
};

function CustomizationPanel(props: CustomizationPanelProps) {
  const { preferences } = props;
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Customize General Ledger</h2>
            <p className="mt-1 text-xs text-muted-foreground">Column and display choices are saved automatically on this browser.</p>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={props.onReset}>
            <RotateCcw className="mr-2 h-4 w-4" />Reset
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transaction columns</h3>
            <div className="space-y-1">
              {preferences.columnOrder.map((column, index) => {
                const definition = columnDefinition(column);
                const checked = preferences.visibleColumns.includes(column);
                return (
                  <div key={column} className="flex h-9 items-center gap-2 rounded-md px-2 hover:bg-muted/50">
                    <input
                      id={`gl-column-${column}`}
                      type="checkbox"
                      checked={checked}
                      disabled={checked && preferences.visibleColumns.length === 1}
                      onChange={() => props.onToggleColumn(column)}
                    />
                    <label htmlFor={`gl-column-${column}`} className="flex-1 cursor-pointer text-sm">{definition.label}</label>
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30"
                      disabled={index === 0}
                      onClick={() => props.onMoveColumn(column, -1)}
                      aria-label={`Move ${definition.label} left`}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30"
                      disabled={index === preferences.columnOrder.length - 1}
                      onClick={() => props.onMoveColumn(column, 1)}
                      aria-label={`Move ${definition.label} right`}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filters</h3>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Account type</div>
              <AppSelect
                className="w-full"
                value={props.accountTypeFilter}
                onChange={event => props.onAccountTypeFilterChange(event.target.value as AccountTypeFilter)}
              >
                <option value="all">All account types</option>
                <option value="asset">Assets</option>
                <option value="liability">Liabilities</option>
                <option value="equity">Equity</option>
                <option value="revenue">Revenue</option>
                <option value="expense">Expenses</option>
              </AppSelect>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Transaction type</div>
              <AppSelect
                className="w-full"
                value={props.sourceFilter}
                onChange={event => props.onSourceFilterChange(event.target.value)}
              >
                <option value="all">All transaction types</option>
                {props.sourceTypes.map(source => <option key={source} value={source}>{source}</option>)}
              </AppSelect>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Posting status</div>
              <AppSelect
                className="w-full"
                value={props.statusFilter}
                onChange={event => props.onStatusFilterChange(event.target.value as StatusFilter)}
              >
                <option value="all">Posted and voided</option>
                <option value="posted">Posted only</option>
                <option value="voided">Voided only</option>
              </AppSelect>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Adjusting entries</div>
              <AppSelect
                className="w-full"
                value={props.adjFilter}
                onChange={event => props.onAdjFilterChange(event.target.value as AdjFilter)}
              >
                <option value="all">All entries</option>
                <option value="regular">Regular only</option>
                <option value="adjustments">Adjustments only</option>
              </AppSelect>
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Reference or memo contains</div>
              <Input value={props.searchText} onChange={event => props.onSearchTextChange(event.target.value)} placeholder="Search report activity" />
            </div>
            <CheckboxRow
              checked={props.showEmptyAccounts}
              onChange={props.onShowEmptyAccountsChange}
              label="Show accounts without matching transactions"
            />
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Display</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Date order</div>
                <AppSelect
                  className="w-full"
                  value={preferences.sortDirection}
                  onChange={event => props.onPreferencesChange({ sortDirection: event.target.value as GeneralLedgerPreferences['sortDirection'] })}
                >
                  <option value="oldest">Oldest first</option>
                  <option value="newest">Newest first</option>
                </AppSelect>
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Row spacing</div>
                <AppSelect
                  className="w-full"
                  value={preferences.density}
                  onChange={event => props.onPreferencesChange({ density: event.target.value as GeneralLedgerPreferences['density'] })}
                >
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </AppSelect>
              </div>
            </div>
            <CheckboxRow checked={preferences.showAccountNumbers} onChange={value => props.onPreferencesChange({ showAccountNumbers: value })} label="Show account numbers" />
            <CheckboxRow checked={preferences.showAccountDetails} onChange={value => props.onPreferencesChange({ showAccountDetails: value })} label="Show account type and normal balance" />
            <CheckboxRow checked={preferences.showBeginningBalances} onChange={value => props.onPreferencesChange({ showBeginningBalances: value })} label="Show beginning balances" />
            <CheckboxRow checked={preferences.showAccountTotals} onChange={value => props.onPreferencesChange({ showAccountTotals: value })} label="Show totals for each account" />
            <CheckboxRow checked={preferences.showReportTotal} onChange={value => props.onPreferencesChange({ showReportTotal: value })} label="Show report total" />
          </section>
        </div>
      </CardContent>
    </Card>
  );
}

function CheckboxRow({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function AccountSection({
  account,
  columns,
  preferences,
  collapsed,
  onToggle,
}: {
  account: DisplayAccount;
  columns: GeneralLedgerColumnKey[];
  preferences: GeneralLedgerPreferences;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const padding = preferences.density === 'compact' ? 'px-3 py-1.5' : 'p-3';
  return (
    <>
      <tr className="border-y bg-muted/50">
        <td colSpan={columns.length} className={padding}>
          <button type="button" className="flex w-full items-center text-left font-semibold" onClick={onToggle} aria-expanded={!collapsed}>
            {collapsed ? <ChevronRight className="mr-1.5 h-4 w-4" /> : <ChevronDown className="mr-1.5 h-4 w-4" />}
            {preferences.showAccountNumbers && <span className="mr-3 font-mono text-muted-foreground">{account.account_code}</span>}
            {account.account_name}
            {preferences.showAccountDetails && (
              <span className="ml-2 text-xs font-normal capitalize text-muted-foreground">
                {account.account_type} · {account.normal_balance}-normal
              </span>
            )}
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {account.lines.length} {account.lines.length === 1 ? 'transaction' : 'transactions'}
            </span>
          </button>
        </td>
      </tr>
      {!collapsed && (
        <>
          {preferences.showBeginningBalances && (
            <SummaryRow
              columns={columns}
              label="Beginning Balance"
              balance={account.beginning_balance}
              density={preferences.density}
              className="border-b text-muted-foreground"
            />
          )}
          {account.lines.length === 0 && (
            <tr className="border-b">
              <td colSpan={columns.length} className={`${padding} pl-8 text-muted-foreground`}>No matching activity in this period.</td>
            </tr>
          )}
          {account.lines.map(line => (
            <tr key={line.line_id} className={`border-b hover:bg-muted/30 ${line.status === 'voided' ? 'text-muted-foreground' : ''}`}>
              {columns.map(column => <LedgerLineCell key={column} column={column} line={line} padding={padding} />)}
            </tr>
          ))}
          {preferences.showAccountTotals && (
            <SummaryRow
              columns={columns}
              label={`Total for ${preferences.showAccountNumbers ? `${account.account_code} — ` : ''}${account.account_name}`}
              amount={account.visible_total_amount}
              balance={account.ending_balance}
              density={preferences.density}
              className="border-b-2 font-semibold"
            />
          )}
        </>
      )}
    </>
  );
}

function LedgerLineCell({ column, line, padding }: { column: GeneralLedgerColumnKey; line: GeneralLedgerLine; padding: string }) {
  let content: ReactNode;
  let className = padding;
  // Date, name and memo open the transaction too, like the type, number and
  // amount do. They keep the look of plain text until hovered.
  const textLink = (text: string) => (
    <Link className="block truncate hover:text-primary hover:underline" to={line.transaction_path} title={text}>{text}</Link>
  );
  switch (column) {
    case 'date':
      content = textLink(fmtShortDate(line.entry_date));
      className += ' whitespace-nowrap min-w-[6rem]';
      break;
    case 'transaction':
      content = (
        <>
          <Link className="font-medium text-primary hover:underline" to={line.transaction_path}>{line.transaction_label}</Link>
          {line.status === 'voided' && <span className="ml-2 text-xs uppercase">Voided</span>}
        </>
      );
      break;
    case 'reference': {
      const num = fmtNum(line);
      content = num
        ? <Link className="font-medium text-primary hover:underline" to={line.transaction_path}>{num}</Link>
        : null;
      className += ' font-mono text-xs whitespace-nowrap';
      break;
    }
    case 'adj':
      content = line.is_adjusting
        ? <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Yes</span>
        : <span className="text-xs text-muted-foreground">No</span>;
      className += ' text-center';
      break;
    case 'name':
      content = line.name ? textLink(line.name) : '';
      className += ' max-w-[16rem]';
      break;
    case 'memo':
      content = line.memo ? textLink(line.memo) : '';
      className += ' max-w-[22rem]';
      break;
    case 'split':
      content = line.split_account ?? '';
      className += ' max-w-[16rem] truncate text-xs text-muted-foreground';
      break;
    case 'amount':
      content = new Decimal(line.amount).isZero()
        ? ''
        : <ReportAmountLink to={line.transaction_path} title="Open this transaction">{fmtAmount(line.amount)}</ReportAmountLink>;
      className += ' text-right font-mono';
      break;
    case 'balance':
      content = fmtAmount(line.running_balance);
      className += ' text-right font-mono';
      break;
  }
  return <td className={className}>{content}</td>;
}

function SummaryRow({
  columns,
  label,
  amount,
  balance,
  density,
  className,
}: {
  columns: GeneralLedgerColumnKey[];
  label: string;
  amount?: string;
  balance?: string;
  density: GeneralLedgerPreferences['density'];
  className: string;
}) {
  const labelColumn = summaryLabelColumn(columns);
  const padding = density === 'compact' ? 'px-3 py-1.5' : 'p-3';
  return (
    <tr className={className}>
      {columns.map(column => {
        let value: ReactNode = column === labelColumn ? label : null;
        if (column === 'amount' && amount !== undefined) value = fmtAmount(amount);
        if (column === 'balance' && balance !== undefined) value = fmtAmount(balance);
        const numeric = columnDefinition(column).numeric;
        return <td key={column} className={`${padding} ${numeric ? 'text-right font-mono' : ''}`}>{value}</td>;
      })}
    </tr>
  );
}
