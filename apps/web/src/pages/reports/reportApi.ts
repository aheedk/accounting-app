import { api } from '@/lib/apiClient';
import type { ReportDates } from './StandardReport';
import type { TrialBalanceRow } from './ledgerReports';
import type { PnlReport } from './pnlLayout';
import type { BalanceSheetReport, GlReport } from './standardReports';

// What the standard reports read: the reports the app already has, and the
// lists that say which names are customers and which accounts are banks.

export const fetchLedger = (bizId: string, range: ReportDates): Promise<GlReport> =>
  api.get<GlReport>(`/businesses/${bizId}/reports/general-ledger`, { params: { period_start: range.start, period_end: range.end } })
    .then(r => r.data);

export const fetchPnl = (bizId: string, range: ReportDates): Promise<PnlReport> =>
  api.get<PnlReport>(`/businesses/${bizId}/reports/pnl`, { params: { period_start: range.start, period_end: range.end } })
    .then(r => r.data);

export const fetchBalanceSheet = (bizId: string, asOf: string): Promise<BalanceSheetReport> =>
  api.get<BalanceSheetReport>(`/businesses/${bizId}/reports/balance-sheet`, { params: { as_of: asOf } })
    .then(r => r.data);

export const fetchTrialBalance = (bizId: string, asOf: string): Promise<TrialBalanceRow[]> =>
  api.get<{ rows: TrialBalanceRow[] }>(`/businesses/${bizId}/reports/trial-balance`, { params: { as_of: asOf } })
    .then(r => r.data.rows);

// Every name, inactive ones too: a report that goes by customer or vendor
// matches the ledger's Name column against these.
export const fetchCustomerNames = (bizId: string): Promise<Set<string>> =>
  api.get<{ customers: { name: string }[] }>(`/businesses/${bizId}/customers`, { params: { include_inactive: 'true' } })
    .then(r => new Set(r.data.customers.map(customer => customer.name.trim())));

export const fetchVendorNames = (bizId: string): Promise<Set<string>> =>
  api.get<{ vendors: { name: string }[] }>(`/businesses/${bizId}/vendors`, { params: { include_inactive: 'true' } })
    .then(r => new Set(r.data.vendors.map(vendor => vendor.name.trim())));

/** The ledger accounts set up under Banking: bank accounts whatever their detail type says. */
export const fetchBankAccountIds = (bizId: string): Promise<Set<string>> =>
  api.get<{ bank_accounts: { cash_account_id: string }[] }>(`/businesses/${bizId}/bank-accounts`)
    .then(r => new Set(r.data.bank_accounts.map(account => account.cash_account_id)));
