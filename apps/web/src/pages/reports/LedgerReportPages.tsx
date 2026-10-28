import { fmtDateText } from '@/lib/dates';
import { fiscalYearRange } from '@/lib/fiscalYear';
import { LEDGER_HISTORY_START } from '@/lib/reportDrilldown';
import { StandardReport, type ReportContext, type ReportDates } from './StandardReport';
import {
  adjustedTrialBalanceTable, balanceSheetSummaryTable, billPaymentListTable, checkDetailTable, depositDetailTable, incomeByCustomerTable,
  pnlByCustomerTable, purchasesByVendorDetailTable, quarterRanges, recentTransactionsTable, salesByCustomerDetailTable,
  transactionDetailByAccountTable, transactionListByNameTable, transactionListWithSplitsTable,
} from './ledgerReports';
import { pnlColumnsTable, type ReportTable } from './standardReports';
import {
  fetchBalanceSheet, fetchBankAccountIds, fetchCustomerNames, fetchLedger, fetchPnl, fetchTrialBalance, fetchVendorNames,
} from './reportApi';

// The pages for ledgerReports.ts (item 18, 10-27). As in StandardReportPages,
// the loaders stay at module level: the page reloads when its `load` changes.

const rangeLabel = (range: ReportDates): string => `${fmtDateText(range.start)} – ${fmtDateText(range.end)}`;

// The far end of the ledger, so that a transaction dated ahead is still found.
const LEDGER_HISTORY_END = '2999-12-31';

const loadPnlPercentOfIncome = async (bizId: string, range: ReportDates) =>
  pnlColumnsTable([{ label: 'Total', report: await fetchPnl(bizId, range) }], { percentOfIncome: true, drill: range });

async function loadQuarterlyPnl(bizId: string, range: ReportDates, context: ReportContext): Promise<ReportTable> {
  const quarters = quarterRanges(range.start, range.end, context.fiscalYearStartMonth);
  if (!quarters) throw new Error('Choose 12 quarters or fewer.');
  const [total, ...byQuarter] = await Promise.all([fetchPnl(bizId, range), ...quarters.map(quarter => fetchPnl(bizId, quarter))]);
  return pnlColumnsTable(
    [...quarters.map((quarter, i) => ({ label: quarter.label, report: byQuarter[i]! })), { label: 'Total', report: total }],
    { drill: range },
  );
}

async function loadPnlYtdComparison(bizId: string, range: ReportDates, context: ReportContext): Promise<ReportTable> {
  const yearToDate = { start: fiscalYearRange(range.end, context.fiscalYearStartMonth).start, end: range.end };
  const [period, toDate] = await Promise.all([fetchPnl(bizId, range), fetchPnl(bizId, yearToDate)]);
  return pnlColumnsTable([{ label: rangeLabel(range), report: period }, { label: rangeLabel(yearToDate), report: toDate }], { drill: range });
}

async function loadPnlByCustomer(bizId: string, range: ReportDates): Promise<ReportTable> {
  const [ledger, pnl, customers] = await Promise.all([fetchLedger(bizId, range), fetchPnl(bizId, range), fetchCustomerNames(bizId)]);
  return pnlByCustomerTable(ledger, pnl, customers, range);
}

async function loadIncomeByCustomer(bizId: string, range: ReportDates): Promise<ReportTable> {
  const [ledger, customers] = await Promise.all([fetchLedger(bizId, range), fetchCustomerNames(bizId)]);
  return incomeByCustomerTable(ledger, customers);
}

/** The ledger for the dates, and the accounts set up under Banking, which count as bank accounts. */
const fetchLedgerAndBanks = (bizId: string, range: ReportDates) => Promise.all([fetchLedger(bizId, range), fetchBankAccountIds(bizId)]);

async function loadTransactionsByCustomer(bizId: string, range: ReportDates): Promise<ReportTable> {
  const [[ledger, bankIds], customers] = await Promise.all([fetchLedgerAndBanks(bizId, range), fetchCustomerNames(bizId)]);
  return transactionListByNameTable(ledger, customers, bankIds);
}

async function loadTransactionsByVendor(bizId: string, range: ReportDates): Promise<ReportTable> {
  const [[ledger, bankIds], vendors] = await Promise.all([fetchLedgerAndBanks(bizId, range), fetchVendorNames(bizId)]);
  return transactionListByNameTable(ledger, vendors, bankIds);
}

async function loadAdjustedTrialBalance(bizId: string, range: ReportDates): Promise<ReportTable> {
  const [trialBalance, ledger] = await Promise.all([fetchTrialBalance(bizId, range.end), fetchLedger(bizId, range)]);
  return adjustedTrialBalanceTable(trialBalance, ledger, range.end);
}

// Entered between the dates, whatever date they carry: the whole ledger, sorted by when each was entered.
async function loadRecentTransactions(bizId: string, range: ReportDates): Promise<ReportTable> {
  const [ledger, bankIds] = await fetchLedgerAndBanks(bizId, { start: LEDGER_HISTORY_START, end: LEDGER_HISTORY_END });
  return recentTransactionsTable(ledger, range, bankIds);
}

const loadBalanceSheetSummary = async (bizId: string, range: ReportDates) => balanceSheetSummaryTable(await fetchBalanceSheet(bizId, range.end));
const loadTransactionDetailByAccount = async (bizId: string, range: ReportDates) => transactionDetailByAccountTable(await fetchLedger(bizId, range));
const loadTransactionListWithSplits = async (bizId: string, range: ReportDates) => transactionListWithSplitsTable(...await fetchLedgerAndBanks(bizId, range));
const loadDepositDetail = async (bizId: string, range: ReportDates) => depositDetailTable(...await fetchLedgerAndBanks(bizId, range));
const loadCheckDetail = async (bizId: string, range: ReportDates) => checkDetailTable(...await fetchLedgerAndBanks(bizId, range));
const loadBillPayments = async (bizId: string, range: ReportDates) => billPaymentListTable(...await fetchLedgerAndBanks(bizId, range));
const loadSalesByCustomerDetail = async (bizId: string, range: ReportDates) => salesByCustomerDetailTable(await fetchLedger(bizId, range));
const loadPurchasesByVendorDetail = async (bizId: string, range: ReportDates) => purchasesByVendorDetailTable(await fetchLedger(bizId, range));

export function ProfitLossPercentOfIncomePage() {
  return <StandardReport title="Profit and Loss as % of Total Income" dates="period" fileStem="pnl-percent-of-income" load={loadPnlPercentOfIncome} />;
}

export function QuarterlyProfitLossPage() {
  return <StandardReport title="Quarterly Profit and Loss Summary" dates="period" fileStem="pnl-quarterly" load={loadQuarterlyPnl} />;
}

export function ProfitLossYtdComparisonPage() {
  return <StandardReport title="Profit and Loss Year-to-Date Comparison" dates="period" fileStem="pnl-ytd-comparison" load={loadPnlYtdComparison} opens="thisMonth" />;
}

export function ProfitLossByCustomerPage() {
  return <StandardReport title="Profit and Loss by Customer" dates="period" fileStem="pnl-by-customer" load={loadPnlByCustomer} />;
}

export function BalanceSheetSummaryPage() {
  return <StandardReport title="Balance Sheet Summary" dates="asOf" fileStem="balance-sheet-summary" load={loadBalanceSheetSummary} />;
}

export function AdjustedTrialBalancePage() {
  return <StandardReport title="Adjusted Trial Balance" dates="period" fileStem="adjusted-trial-balance" load={loadAdjustedTrialBalance} />;
}

export function RecentTransactionsPage() {
  return <StandardReport title="Recent Transactions" dates="period" fileStem="recent-transactions" load={loadRecentTransactions} opens="recent" />;
}

export function TransactionDetailByAccountPage() {
  return <StandardReport title="Transaction Detail by Account" dates="period" fileStem="transaction-detail-by-account" load={loadTransactionDetailByAccount} />;
}

export function TransactionListWithSplitsPage() {
  return <StandardReport title="Transaction List with Splits" dates="period" fileStem="transaction-list-with-splits" load={loadTransactionListWithSplits} />;
}

export function TransactionListByCustomerPage() {
  return <StandardReport title="Transaction List by Customer" dates="period" fileStem="transaction-list-by-customer" load={loadTransactionsByCustomer} />;
}

export function TransactionListByVendorPage() {
  return <StandardReport title="Transaction List by Vendor" dates="period" fileStem="transaction-list-by-vendor" load={loadTransactionsByVendor} />;
}

export function SalesByCustomerDetailPage() {
  return <StandardReport title="Sales by Customer Detail" dates="period" fileStem="sales-by-customer-detail" load={loadSalesByCustomerDetail} />;
}

export function IncomeByCustomerSummaryPage() {
  return <StandardReport title="Income by Customer Summary" dates="period" fileStem="income-by-customer" load={loadIncomeByCustomer} />;
}

export function DepositDetailPage() {
  return <StandardReport title="Deposit Detail" dates="period" fileStem="deposit-detail" load={loadDepositDetail} />;
}

export function CheckDetailPage() {
  return <StandardReport title="Check Detail" dates="period" fileStem="check-detail" load={loadCheckDetail} />;
}

export function BillPaymentListReportPage() {
  return <StandardReport title="Bill Payment List" dates="period" fileStem="bill-payment-list" load={loadBillPayments} />;
}

export function PurchasesByVendorDetailPage() {
  return <StandardReport title="Purchases by Vendor Detail" dates="period" fileStem="purchases-by-vendor-detail" load={loadPurchasesByVendorDetail} />;
}
