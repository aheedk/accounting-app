import { api } from '@/lib/apiClient';
import { fmtDateText } from '@/lib/dates';
import { StandardReport, type ReportDates } from './StandardReport';
import {
  accountListTable, agingDetailTable, balanceSheetComparisonTable, balanceSheetDetailTable, expensesByVendorTable, journalTable,
  monthRanges, openDocumentsTable, partyBalanceDetailTable, partyBalanceTable, pnlColumnsTable, pnlDetailTable, salesByCustomerTable,
  transactionListTable, yearEarlier,
  type OpenDocument, type PartyBalance, type ReportTable,
} from './standardReports';
import { LEDGER_HISTORY_START } from '@/lib/reportDrilldown';
import { fetchBalanceSheet, fetchLedger, fetchPnl } from './reportApi';

// Standard reports added for the 10-25 meeting (item 18). Each reads reports the
// app already has, so it ties out to them. The loaders stay at module level: the
// page reloads when its `load` changes.

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

const loadAccountList = async (bizId: string, range: ReportDates) => accountListTable(await fetchLedger(bizId, { start: LEDGER_HISTORY_START, end: range.end }));

const fetchPartyBalances = (bizId: string, endpoint: 'aging' | 'ap-aging', asOf: string): Promise<PartyBalance[]> =>
  api.get<{ rows: PartyBalance[] }>(`/businesses/${bizId}/reports/${endpoint}`, { params: { as_of: asOf } }).then(r => r.data.rows);
const loadCustomerBalances = async (bizId: string, range: ReportDates) => partyBalanceTable(await fetchPartyBalances(bizId, 'aging', range.end), 'Customer');
const loadVendorBalances = async (bizId: string, range: ReportDates) => partyBalanceTable(await fetchPartyBalances(bizId, 'ap-aging', range.end), 'Vendor');

type OpenInvoiceRow = { invoice_number: string; customer_name: string; issue_date: string; due_date: string; total: string; open: string; bucket: OpenDocument['bucket'] };
type UnpaidBillRow = { bill_number: string; vendor_name: string; bill_date: string; due_date: string; total: string; open: string; bucket: OpenDocument['bucket'] };

const fetchOpenInvoices = (bizId: string, asOf: string): Promise<OpenDocument[]> =>
  api.get<{ rows: OpenInvoiceRow[] }>(`/businesses/${bizId}/reports/open-invoices`, { params: { as_of: asOf } }).then(r => r.data.rows.map(row => ({
    number: row.invoice_number, party_name: row.customer_name, issue_date: row.issue_date, due_date: row.due_date, total: row.total, open: row.open, bucket: row.bucket,
  })));
const fetchUnpaidBills = (bizId: string, asOf: string): Promise<OpenDocument[]> =>
  api.get<{ rows: UnpaidBillRow[] }>(`/businesses/${bizId}/reports/unpaid-bills`, { params: { as_of: asOf } }).then(r => r.data.rows.map(row => ({
    number: row.bill_number, party_name: row.vendor_name, issue_date: row.bill_date, due_date: row.due_date, total: row.total, open: row.open, bucket: row.bucket,
  })));

const loadOpenInvoices = async (bizId: string, range: ReportDates) => openDocumentsTable(await fetchOpenInvoices(bizId, range.end), 'invoice');
const loadUnpaidBills = async (bizId: string, range: ReportDates) => openDocumentsTable(await fetchUnpaidBills(bizId, range.end), 'bill');
const loadArAgingDetail = async (bizId: string, range: ReportDates) => agingDetailTable(await fetchOpenInvoices(bizId, range.end), 'invoice');
const loadApAgingDetail = async (bizId: string, range: ReportDates) => agingDetailTable(await fetchUnpaidBills(bizId, range.end), 'bill');
const loadCustomerBalanceDetail = async (bizId: string, range: ReportDates) => partyBalanceDetailTable(await fetchOpenInvoices(bizId, range.end), 'invoice');
const loadVendorBalanceDetail = async (bizId: string, range: ReportDates) => partyBalanceDetailTable(await fetchUnpaidBills(bizId, range.end), 'bill');
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

export function AccountListPage() {
  return <StandardReport title="Account List" dates="asOf" fileStem="account-list" load={loadAccountList} />;
}

export function CustomerBalanceSummaryPage() {
  return <StandardReport title="Customer Balance Summary" dates="asOf" fileStem="customer-balances" load={loadCustomerBalances} />;
}

export function VendorBalanceSummaryPage() {
  return <StandardReport title="Vendor Balance Summary" dates="asOf" fileStem="vendor-balances" load={loadVendorBalances} />;
}

export function OpenInvoicesPage() {
  return <StandardReport title="Open Invoices" dates="asOf" fileStem="open-invoices" load={loadOpenInvoices} />;
}

export function UnpaidBillsPage() {
  return <StandardReport title="Unpaid Bills" dates="asOf" fileStem="unpaid-bills" load={loadUnpaidBills} />;
}

export function ArAgingDetailPage() {
  return <StandardReport title="A/R Aging Detail" dates="asOf" fileStem="ar-aging-detail" load={loadArAgingDetail} />;
}

export function ApAgingDetailPage() {
  return <StandardReport title="A/P Aging Detail" dates="asOf" fileStem="ap-aging-detail" load={loadApAgingDetail} />;
}

export function CustomerBalanceDetailPage() {
  return <StandardReport title="Customer Balance Detail" dates="asOf" fileStem="customer-balance-detail" load={loadCustomerBalanceDetail} />;
}

export function VendorBalanceDetailPage() {
  return <StandardReport title="Vendor Balance Detail" dates="asOf" fileStem="vendor-balance-detail" load={loadVendorBalanceDetail} />;
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
