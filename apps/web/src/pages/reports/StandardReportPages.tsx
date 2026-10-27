import { api } from '@/lib/apiClient';
import { fmtDateText } from '@/lib/dates';
import { StandardReport, type ReportDates } from './StandardReport';
import {
  balanceSheetComparisonTable, balanceSheetDetailTable, expensesByVendorTable, journalTable, monthRanges,
  pnlColumnsTable, pnlDetailTable, salesByCustomerTable, transactionListTable, yearEarlier,
  type BalanceSheetReport, type GlReport, type ReportTable,
} from './standardReports';
import type { PnlReport } from './pnlLayout';

// Standard reports added for the 10-25 meeting (item 18). Each reads reports the
// app already has, so it ties out to them. The loaders stay at module level: the
// page reloads when its `load` changes.

const fetchLedger = (bizId: string, range: ReportDates): Promise<GlReport> =>
  api.get<GlReport>(`/businesses/${bizId}/reports/general-ledger`, { params: { period_start: range.start, period_end: range.end } })
    .then(r => r.data);

const fetchPnl = (bizId: string, range: ReportDates): Promise<PnlReport> =>
  api.get<PnlReport>(`/businesses/${bizId}/reports/pnl`, { params: { period_start: range.start, period_end: range.end } })
    .then(r => r.data);

const fetchBalanceSheet = (bizId: string, asOf: string): Promise<BalanceSheetReport> =>
  api.get<BalanceSheetReport>(`/businesses/${bizId}/reports/balance-sheet`, { params: { as_of: asOf } })
    .then(r => r.data);

const rangeLabel = (range: ReportDates): string => `${fmtDateText(range.start)} – ${fmtDateText(range.end)}`;

async function loadPnlDetail(bizId: string, range: ReportDates): Promise<ReportTable> {
  const [ledger, pnl] = await Promise.all([fetchLedger(bizId, range), fetchPnl(bizId, range)]);
  return pnlDetailTable(ledger, pnl);
}

async function loadPnlByMonth(bizId: string, range: ReportDates): Promise<ReportTable> {
  const months = monthRanges(range.start, range.end);
  if (!months) throw new Error('Choose 24 months or fewer.');
  const [total, ...byMonth] = await Promise.all([fetchPnl(bizId, range), ...months.map(month => fetchPnl(bizId, month))]);
  return pnlColumnsTable(
    [...months.map((month, i) => ({ label: month.label, report: byMonth[i]! })), { label: 'Total', report: total }],
    { drill: range },
  );
}

async function loadPnlComparison(bizId: string, range: ReportDates): Promise<ReportTable> {
  const earlier = { start: yearEarlier(range.start), end: yearEarlier(range.end) };
  const [now, before] = await Promise.all([fetchPnl(bizId, range), fetchPnl(bizId, earlier)]);
  return pnlColumnsTable([{ label: rangeLabel(range), report: now }, { label: rangeLabel(earlier), report: before }], { compare: true, drill: range });
}

async function loadBalanceSheetDetail(bizId: string, range: ReportDates): Promise<ReportTable> {
  const [ledger, sheet] = await Promise.all([fetchLedger(bizId, range), fetchBalanceSheet(bizId, range.end)]);
  return balanceSheetDetailTable(ledger, sheet.net_income_ytd);
}

async function loadBalanceSheetComparison(bizId: string, range: ReportDates): Promise<ReportTable> {
  const earlier = yearEarlier(range.end);
  const [now, before] = await Promise.all([fetchBalanceSheet(bizId, range.end), fetchBalanceSheet(bizId, earlier)]);
  return balanceSheetComparisonTable(now, before, [fmtDateText(range.end), fmtDateText(earlier)]);
}

const loadJournal = async (bizId: string, range: ReportDates) => journalTable(await fetchLedger(bizId, range));
const loadTransactionList = async (bizId: string, range: ReportDates) => transactionListTable(await fetchLedger(bizId, range));
const loadSalesByCustomer = async (bizId: string, range: ReportDates) => salesByCustomerTable(await fetchLedger(bizId, range));
const loadExpensesByVendor = async (bizId: string, range: ReportDates) => expensesByVendorTable(await fetchLedger(bizId, range));

export function ProfitLossDetailPage() {
  return <StandardReport title="Profit and Loss Detail" dates="period" fileStem="pnl-detail" load={loadPnlDetail} />;
}

export function ProfitLossByMonthPage() {
  return <StandardReport title="Profit and Loss by Month" dates="period" fileStem="pnl-by-month" load={loadPnlByMonth} />;
}

export function ProfitLossComparisonPage() {
  return <StandardReport title="Profit and Loss Comparison" dates="period" fileStem="pnl-comparison" load={loadPnlComparison} />;
}

export function BalanceSheetDetailPage() {
  return <StandardReport title="Balance Sheet Detail" dates="period" fileStem="balance-sheet-detail" load={loadBalanceSheetDetail} />;
}

export function BalanceSheetComparisonPage() {
  return <StandardReport title="Balance Sheet Comparison" dates="asOf" fileStem="balance-sheet-comparison" load={loadBalanceSheetComparison} />;
}

export function JournalReportPage() {
  return <StandardReport title="Journal" dates="period" fileStem="journal" load={loadJournal} />;
}

export function TransactionListByDatePage() {
  return <StandardReport title="Transaction List by Date" dates="period" fileStem="transaction-list" load={loadTransactionList} />;
}

export function SalesByCustomerSummaryPage() {
  return <StandardReport title="Sales by Customer Summary" dates="period" fileStem="sales-by-customer" load={loadSalesByCustomer} />;
}

export function ExpensesByVendorSummaryPage() {
  return <StandardReport title="Expenses by Vendor Summary" dates="period" fileStem="expenses-by-vendor" load={loadExpensesByVendor} />;
}
