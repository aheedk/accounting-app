import { api } from './apiClient';
import type { ConfidenceBand, CodingLayerId, AccountGroup } from '@accounting/shared';

// Thin, typed wrappers over the same REST endpoints the web app calls —
// no parallel backend, no mobile-specific routes. Response shapes mirror
// apps/api's actual route handlers (transactionsService.TransactionRow, etc.)
// rather than re-declaring them from scratch.

export type TransactionRow = {
  id: string;
  type: string;
  date: string;
  ref_no: string | null;
  contact_name: string | null;
  balance: string;
  total_amount: string;
  memo: string | null;
  status: string;
  category: string | null;
  path: string;
};

export type TransactionSortKey = 'date' | 'type' | 'ref_no' | 'due_date' | 'balance' | 'total_amount' | 'updated_at';

export async function listTransactions(
  businessId: string,
  params: {
    limit?: number; type?: string; contact_id?: string;
    date_start?: string; date_end?: string; ref_no?: string;
    amount_op?: 'eq' | 'between' | 'lt' | 'lte' | 'gt' | 'gte'; amount_value?: string; amount_value2?: string;
    sort_key?: TransactionSortKey; sort_dir?: 'asc' | 'desc';
  } = {},
) {
  const r = await api.get<{ transactions: TransactionRow[]; total: number }>(
    `/businesses/${businessId}/transactions`,
    {
      params: {
        page_size: params.limit ?? 50,
        sort_key: params.sort_key ?? 'date', sort_dir: params.sort_dir ?? 'desc',
        ...(params.type ? { type: params.type } : {}),
        ...(params.contact_id ? { contact_id: params.contact_id } : {}),
        ...(params.date_start ? { date_start: params.date_start } : {}),
        ...(params.date_end ? { date_end: params.date_end } : {}),
        ...(params.ref_no ? { ref_no: params.ref_no } : {}),
        ...(params.amount_op ? { amount_op: params.amount_op } : {}),
        ...(params.amount_value ? { amount_value: params.amount_value } : {}),
        ...(params.amount_value2 ? { amount_value2: params.amount_value2 } : {}),
      },
    },
  );
  return r.data;
}

export type InvoiceRow = {
  id: string; invoice_number: string; customer_id: string; issue_date: string;
  due_date: string; status: string; total: string;
};

export async function listInvoices(businessId: string, params: { status?: string; customer_id?: string } = {}) {
  const r = await api.get<{ invoices: InvoiceRow[] }>(`/businesses/${businessId}/invoices`, {
    params: {
      limit: 500,
      ...(params.status ? { status: params.status } : {}),
      ...(params.customer_id ? { customer_id: params.customer_id } : {}),
    },
  });
  return r.data.invoices;
}

// invoices.ts's list/detail routes return every InvoicesTable column — these
// types only declare the subset the mobile screens actually use, same as
// the web app's own InvoiceListPage/-DetailPage narrow their local types.
export type InvoiceLine = {
  id: string; line_number: number; description: string; quantity: string;
  unit_price: string; line_subtotal: string; tax_amount: string; line_total: string;
};

export type InvoiceDetail = {
  invoice: InvoiceRow & { subtotal: string; tax_total: string; memo: string | null; terms: string | null };
  lines: InvoiceLine[];
  amount_due: string;
};

export async function getInvoice(businessId: string, id: string) {
  const r = await api.get<InvoiceDetail>(`/businesses/${businessId}/invoices/${id}`);
  return r.data;
}

// customers.ts's list route returns every CustomersTable column plus two
// computed fields (open_balance, has_transactions); the detail route returns
// the plain row WITHOUT those two — they're list-only. Two separate types so
// a screen can't accidentally read open_balance off the detail response (it
// would just be undefined, not a type error) the way the detail screen
// originally did.
export type CustomerRow = {
  id: string; name: string; company_name: string | null; email: string | null;
  phone: string | null; mobile: string | null; open_balance: string; is_active: boolean;
};

export type Address = {
  line1?: string | null; line2?: string | null; city?: string | null;
  state?: string | null; postal_code?: string | null; country?: string | null;
} | null;

export type CustomerDetail = {
  id: string; name: string; company_name: string | null; email: string | null;
  phone: string | null; mobile: string | null; is_active: boolean;
  website: string | null; default_terms_days: number;
  opening_balance: string | null; opening_balance_as_of: string | null;
  billing_address: Address; shipping_address: Address; notes: string | null;
  created_at: string; updated_at: string;
};

export async function listCustomers(businessId: string) {
  const r = await api.get<{ customers: CustomerRow[] }>(`/businesses/${businessId}/customers`);
  return r.data.customers;
}

export async function getCustomer(businessId: string, id: string) {
  const r = await api.get<CustomerDetail>(`/businesses/${businessId}/customers/${id}`);
  return r.data;
}

// vendors.ts mirrors customers.ts exactly: list adds open_balance +
// has_transactions, detail returns the plain row without them.
export type VendorRow = {
  id: string; name: string; company_name: string | null; email: string | null;
  phone: string | null; mobile: string | null; open_balance: string; is_active: boolean;
};

export type VendorDetail = {
  id: string; name: string; company_name: string | null; email: string | null;
  phone: string | null; mobile: string | null; website: string | null; notes: string | null;
  account_number: string | null; is_active: boolean; is_1099: boolean;
};

export async function listVendors(businessId: string) {
  const r = await api.get<{ vendors: VendorRow[] }>(`/businesses/${businessId}/vendors`);
  return r.data.vendors;
}

export async function getVendor(businessId: string, id: string) {
  const r = await api.get<VendorDetail>(`/businesses/${businessId}/vendors/${id}`);
  return r.data;
}

export type VendorNote = { id: string; note_text: string; created_at: string; user_id: string; author_name: string };

export async function listVendorNotes(businessId: string, vendorId: string) {
  const r = await api.get<{ notes: VendorNote[] }>(`/businesses/${businessId}/vendors/${vendorId}/notes`);
  return r.data.notes;
}

export async function addVendorNote(businessId: string, vendorId: string, noteText: string) {
  const r = await api.post<VendorNote>(`/businesses/${businessId}/vendors/${vendorId}/notes`, { note_text: noteText });
  return r.data;
}

// --- AI Document Inbox (batch item 4) — the real backend for this is
// email-imports.ts, NOT integration-inbox.ts (that's an unrelated
// CSV-reconciliation inbox for Stripe/PayPal/Shopify matching). Shapes
// copied from emailImports.ts's StagedTransaction/StagedImportRow and
// statementImportService.ts's StatementLine — confirmed by reading both,
// not guessed. Known backend gaps, carried into how the mobile screens
// work (documented again at point of use below):
//  - No per-line PATCH — every edit (offset account, payee override,
//    "remember") is bundled into one whole-statement approve call.
//  - No real "partially reviewed" status — only pending/approved/rejected;
//    a partial auto-post is inferred from each line's auto_posted flag.
//  - No vendor_id on a line — vendor "detection" is just a free-text
//    payee_name string, fuzzy-matched client-side against the vendor list.
//  - Reject is whole-statement only — dropping one bad line is
//    include: false on that line at approve time, not a separate action.

export type StagedTransaction = {
  date: string; // "MM/DD/YYYY" as extracted, not ISO
  payee_name?: string;
  description: string;
  amount: string; // always unsigned — direction comes from `type`
  type: 'deposit' | 'check' | 'expense' | 'debit' | 'credit';
  balance?: string;
  check_number?: string;
  card_type?: 'charge' | 'payment' | 'refund';
  suggested_offset?: string;
  suggested_account_id?: string;
  suggestion?: { confidence: number; band: ConfidenceBand; source_layer: CodingLayerId } | null;
  auto_posted?: boolean;
  check_stub?: { id: string; check_number: string | null; payee_name: string | null; memo: string | null; amount: string; check_date: string | null; suggested_account_id: string | null } | null;
};

export type StagedImportRow = {
  id: string;
  email_from: string | null;
  email_subject: string | null;
  received_at: string;
  extracted_transactions: StagedTransaction[];
  status: 'pending' | 'approved' | 'rejected';
  source: 'email' | 'upload';
  statement_kind: 'bank' | 'credit_card';
  account_hint: string | null;
  account_id: string | null;
  suggested_statement_account_id: string | null;
};

export async function listEmailImports(businessId: string) {
  const r = await api.get<{ imports: StagedImportRow[] }>(`/businesses/${businessId}/email-imports`);
  return r.data.imports;
}

export type ApproveTransactionInput = {
  index: number; offset_account_id: string; include?: boolean; remember?: boolean;
  payee_name?: string; check_stub_id?: string | null;
};

export async function approveEmailImport(
  businessId: string, importId: string, body: { bank_account_id: string; transactions: ApproveTransactionInput[] },
) {
  const r = await api.post<{ ok: boolean; posted: number; learned: number }>(
    `/businesses/${businessId}/email-imports/${importId}/approve`, body,
  );
  return r.data;
}

export async function rejectEmailImport(businessId: string, importId: string) {
  const r = await api.post<{ ok: boolean }>(`/businesses/${businessId}/email-imports/${importId}/reject`, {});
  return r.data;
}

export async function createVendor(businessId: string, name: string) {
  const r = await api.post<{ id: string; name: string }>(`/businesses/${businessId}/vendors`, { name });
  return r.data;
}

// --- Transaction detail — the 4 types Phase 1 scopes for mobile viewing.
// Shapes mirror each service's own getX() return value (bankDepositService,
// expenseTransactionService, checkService, journalEntryQueryService) —
// field names copied from the route handlers, not guessed.

export type DepositDetail = {
  id: string; bank_account_id: string; deposit_date: string; deposit_number: string | null; memo: string | null;
  total_amount: string; bank_account_name: string; editable: boolean; imported: boolean;
  is_reconciled: boolean; voided_at: string | null; journal_entry_id: string | null;
  cash_back_account_id: string | null; cash_back_memo: string | null; cash_back_amount: string | null;
  lines: Array<{
    id: string; line_type: 'other_funds' | 'undeposited_funds'; payment_id: string | null;
    received_from: string | null; account_id: string | null; description: string | null;
    payment_method: string | null; ref_no: string | null; amount: string;
    account_name: string | null; account_code: string | null;
  }>;
};
export async function getDeposit(businessId: string, id: string) {
  const r = await api.get<DepositDetail>(`/businesses/${businessId}/bank-deposits/${id}`);
  return r.data;
}

// bankDepositCreateSchema/-UpdateSchema shape. On update, 'undeposited_funds'
// lines already on the deposit are kept server-side regardless of what's
// sent — only 'other_funds' lines are caller-controlled (see getDeposit's
// own lines, which the mobile edit screen only re-sends the other_funds
// subset of).
export type DepositLineInput = {
  line_type?: 'other_funds' | 'undeposited_funds'; payment_id?: string | null;
  received_from?: string | null; account_id?: string | null; description?: string | null;
  payment_method?: string | null; ref_no?: string | null; amount: string; sort_order?: number;
};
export type DepositInput = {
  bank_account_id: string; deposit_date: string; memo?: string | null;
  lines: DepositLineInput[];
  cash_back_account_id?: string | null; cash_back_memo?: string | null; cash_back_amount?: string | null;
};

export async function createDeposit(businessId: string, body: DepositInput) {
  const r = await api.post<{ id: string }>(`/businesses/${businessId}/bank-deposits`, body);
  return r.data;
}

export async function updateDeposit(businessId: string, id: string, body: DepositInput) {
  const r = await api.patch<{ id: string }>(`/businesses/${businessId}/bank-deposits/${id}`, body);
  return r.data;
}

export async function voidDeposit(businessId: string, id: string) {
  const r = await api.post(`/businesses/${businessId}/bank-deposits/${id}/void`);
  return r.data;
}

export async function deleteDeposit(businessId: string, id: string) {
  await api.delete(`/businesses/${businessId}/bank-deposits/${id}`);
}

export type ExpenseDetail = {
  id: string; transaction_date: string; payee_text: string | null; payee_name: string | null;
  vendor_id: string | null; customer_id: string | null;
  vendor_name: string | null; customer_name: string | null;
  payment_account_id: string; payment_account_name: string;
  payment_method: string; reference: string | null; memo: string | null; total_amount: string;
  status: string; editable: boolean; imported: boolean; is_reconciled: boolean;
  journal_entry_id: string | null;
  lines: Array<{
    id: string; category_account_id: string; category_name: string; category_code: string;
    description: string | null; amount: string;
  }>;
};
export async function getExpense(businessId: string, id: string) {
  const r = await api.get<ExpenseDetail>(`/businesses/${businessId}/expense-transactions/${id}`);
  return r.data;
}

// Create/update bodies match expenseTransactionCreateSchema/-UpdateSchema in
// packages/shared/src/schemas/expenseTransaction.ts exactly (same shape for
// both — update is a full resend, not a partial patch; the API always
// derives total_amount from the lines, there's no top-level total field).
export type ExpenseLineInput = {
  category_account_id: string; description?: string | null; amount: string; sort_order?: number;
};
export type ExpenseInput = {
  transaction_date: string;
  payee_text?: string | null; vendor_id?: string | null; customer_id?: string | null;
  payment_account_id: string;
  payment_method: 'cash' | 'check' | 'credit_card' | 'debit_card' | 'ach' | 'other';
  reference?: string | null; memo?: string | null;
  lines: ExpenseLineInput[];
};

export async function createExpense(businessId: string, body: ExpenseInput) {
  const r = await api.post<{ id: string }>(`/businesses/${businessId}/expense-transactions`, body);
  return r.data;
}

export async function updateExpense(businessId: string, id: string, body: ExpenseInput) {
  const r = await api.patch<{ id: string }>(`/businesses/${businessId}/expense-transactions/${id}`, body);
  return r.data;
}

export async function voidExpense(businessId: string, id: string) {
  const r = await api.post(`/businesses/${businessId}/expense-transactions/${id}/void`);
  return r.data;
}

export async function deleteExpense(businessId: string, id: string) {
  await api.delete(`/businesses/${businessId}/expense-transactions/${id}`);
}

export type CheckDetail = {
  id: string; check_number: string | null; payee_text: string | null; payee_name: string | null;
  vendor_name: string | null; customer_name: string | null; bank_account_name: string;
  payment_date: string; memo: string | null; total_amount: string; status: string;
  editable: boolean; is_reconciled: boolean;
  lines: Array<{ id: string; account_name: string; account_code: string; description: string | null; amount: string }>;
};
export async function getCheck(businessId: string, id: string) {
  const r = await api.get<CheckDetail>(`/businesses/${businessId}/checks/${id}`);
  return r.data;
}

export type JournalEntryDetail = {
  entry: {
    id: string; entry_date: string; journal_number: string; memo: string | null;
    reference: string | null; status: string; payee_name: string | null;
  };
  lines: Array<{
    id: string; account_code: string; account_name: string; debit: string; credit: string;
    memo: string | null; name: string | null; class_name: string | null;
  }>;
};
export async function getJournalEntry(businessId: string, id: string) {
  const r = await api.get<JournalEntryDetail>(`/businesses/${businessId}/journal-entries/${id}`);
  return r.data;
}

// Journal entries list — the same GET /journal-entries route web's
// RecentJournalEntries.tsx uses for its "last 10" popover (confirmed by
// reading it; web has no standalone list PAGE, only that popover). Mobile
// adapts it into a real screen rather than inventing a pattern web doesn't
// have — same fields, same endpoint, just a status filter + a full list
// instead of a 10-row dropdown.
export type JeLine = {
  id: string; account_id: string; account_code: string; account_name: string;
  debit: string; credit: string; memo: string | null;
};
export type JournalEntryListItem = {
  id: string; entry_date: string; journal_number: string | null; memo: string | null;
  reference: string | null; status: 'draft' | 'posted' | 'voided'; lines: JeLine[];
};

export async function listJournalEntries(
  businessId: string,
  params: { limit?: number; offset?: number; status?: 'draft' | 'posted' | 'voided' } = {},
) {
  const r = await api.get<{ entries: JournalEntryListItem[]; limit: number; offset: number }>(
    `/businesses/${businessId}/journal-entries`, { params: { limit: 100, ...params } },
  );
  return r.data.entries;
}

// --- General Ledger (Phase 1, item 6) — shapes copied from
// generalLedgerService.ts's GeneralLedgerReport/-Account/-Line types and
// chartOfAccounts.ts's /coa route, not guessed.

// Full row shape from ChartOfAccountsTable (apps/api/src/db/types.ts),
// widened from the original picker-only {id,code,name,account_type,
// detail_type} now that a full Chart of Accounts list/detail screen needs
// is_active/is_locked/description/parent_id too — additive, so every
// existing picker call site (ExpenseForm/DepositForm/general-ledger.tsx,
// which only read code/name) keeps working unchanged.
export type CoaAccount = {
  id: string; code: string; name: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parent_id: string | null; detail_type: string | null; description: string | null;
  is_system: boolean; is_active: boolean; is_locked: boolean; system_key: string | null;
  created_at: string; updated_at: string;
};

export async function listChartOfAccounts(businessId: string, params: { include_inactive?: boolean } = {}) {
  const r = await api.get<{ accounts: CoaAccount[] }>(`/businesses/${businessId}/coa`, {
    params: params.include_inactive ? { include_inactive: 'true' } : undefined,
  });
  return r.data.accounts;
}

export type CoaAccountDetail = CoaAccount & { balance: string };

export async function getAccount(businessId: string, accountId: string) {
  const r = await api.get<CoaAccountDetail>(`/businesses/${businessId}/coa/${accountId}`);
  return r.data;
}

export type AccountRegisterRow = {
  journal_entry_id: string; line_id: string; entry_date: string; reference: string | null;
  source_type: string; memo: string | null; debit: string; credit: string; balance: string;
  is_voided: boolean; counter_account: string | null;
};
export type AccountRegister = { account: CoaAccount; rows: AccountRegisterRow[]; ending_balance: string };

export async function getAccountRegister(businessId: string, accountId: string) {
  const r = await api.get<AccountRegister>(`/businesses/${businessId}/coa/${accountId}/register`);
  return r.data;
}

export type BankAccountRow = { id: string; name: string; cash_account_id: string };

export async function listBankAccounts(businessId: string) {
  const r = await api.get<{ bank_accounts: BankAccountRow[] }>(`/businesses/${businessId}/bank-accounts`);
  return r.data.bank_accounts;
}

export type GeneralLedgerLine = {
  journal_entry_id: string; line_id: string; entry_date: string; transaction_label: string;
  num: string | null; name: string | null; memo: string | null; split_account: string | null;
  debit: string; credit: string; amount: string; running_balance: string;
  status: 'posted' | 'voided'; is_reconciled: boolean;
};

export type GeneralLedgerAccount = {
  account_id: string; account_code: string; account_name: string; account_type: string;
  normal_balance: 'debit' | 'credit'; beginning_balance: string; total_debit: string;
  total_credit: string; ending_balance: string; lines: GeneralLedgerLine[];
};

export type GeneralLedgerReport = {
  period_start: string; period_end: string; account_id: string | null;
  accounts: GeneralLedgerAccount[]; totals: { total_debit: string; total_credit: string };
};

export async function getGeneralLedger(
  businessId: string,
  params: { period_start: string; period_end: string; account_id?: string },
) {
  const r = await api.get<GeneralLedgerReport>(`/businesses/${businessId}/reports/general-ledger`, { params });
  return r.data;
}

// --- Camera capture → AI Inbox (batch item 5). One endpoint handles both a
// multi-page bank/card statement PDF and a single photographed receipt —
// the same model call classifies either, so there's no separate "receipt
// mode" to call (confirmed by reading documentIngestService.ts /
// gmailWorker.ts's classifier prompt, not guessed). Synchronous: the model
// call happens inline, so this can take 15-30s and the result — which
// queue the upload landed in — comes back in the same response, no polling.
export type DocumentUploadResult =
  | { kind: 'bank_statement' | 'credit_card_statement'; staging_id: string; statement_count: number }
  | { kind: 'invoice'; staging_id: string; invoice_type: 'ap' | 'ar' }
  | { kind: 'check_stubs'; check_count: number };

export async function uploadDocument(
  businessId: string, file: { uri: string; name: string; type: string },
) {
  const form = new FormData();
  // React Native's FormData file part — Expo's ImagePicker asset uri/mimeType
  // map straight onto this shape.
  form.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  const r = await api.post<DocumentUploadResult>(`/businesses/${businessId}/ai/documents`, form, {
    timeout: 45_000,
  });
  return r.data;
}

// --- Profit & Loss and Balance Sheet — shapes copied from
// profitLossService.ts's PnlReport and balanceSheetService.ts's
// BalanceSheetReport (confirmed by reading both service files directly;
// neither has a shared zod/TS type in packages/shared — even the web pages
// each redeclare their own local copy of these shapes, so this is the same
// pattern, not a shortcut).

export type PnlLine = { account_id: string; account_code: string; account_name: string; amount: string };
export type PnlReport = {
  period_start: string; period_end: string;
  revenue_lines: PnlLine[]; revenue_total: string;
  expense_lines: PnlLine[]; expense_total: string;
  gross_profit: string; operating_expenses_total: string; operating_income: string;
  other_expenses_total: string; net_income: string;
};

export async function getPnl(businessId: string, params: { period_start: string; period_end: string }) {
  const r = await api.get<PnlReport>(`/businesses/${businessId}/reports/pnl`, { params });
  return r.data;
}

export type BsLine = { account_id: string; account_code: string; account_name: string; amount: string; group: AccountGroup };
export type BalanceSheetReport = {
  as_of: string;
  asset_lines: BsLine[]; assets_total: string;
  liability_lines: BsLine[]; liabilities_total: string;
  equity_lines: BsLine[]; equity_total: string;
  net_income_ytd: string; fiscal_year_start: string;
  retained_earnings_prior_years: string;
  liabilities_equity_total: string; in_balance: boolean;
};

export async function getBalanceSheet(businessId: string, params: { as_of?: string } = {}) {
  const r = await api.get<BalanceSheetReport>(`/businesses/${businessId}/reports/balance-sheet`, { params });
  return r.data;
}

// --- Trial Balance — shape copied from trialBalanceService.ts / the
// trialBalance route directly (packages/shared's trialBalanceResponseSchema
// is stale/incomplete, confirmed by reading the route+service code; same
// "no shared report type" pattern as Pnl/BalanceSheet above).

export type TbRow = {
  account_id: string; code: string; name: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  total_debit: string; total_credit: string; net: string;
};
export type TrialBalanceReport = {
  as_of: string;
  rows: TbRow[];
  totals: { total_debit: string; total_credit: string };
  fiscal_year_start: string;
  retained_earnings_prior_years: string;
};

export async function getTrialBalance(businessId: string, params: { as_of?: string } = {}) {
  const r = await api.get<TrialBalanceReport>(`/businesses/${businessId}/reports/trial-balance`, { params });
  return r.data;
}

// --- Statement of Cash Flows — shape copied from
// statementOfCashFlowsService.ts directly (packages/shared has no zod
// schema for this response at all — its cashFlowQuerySchema belongs to the
// separate, unrelated /reports/cash-flow "Cash Activity by Account"
// register report, not this one; don't confuse the two routes).

export type CfLine = { account_id: string; account_code: string; account_name: string; amount: string };
export type StatementOfCashFlowsReport = {
  period_start: string; period_end: string;
  net_income: string;
  operating_adjustments: CfLine[]; operating_total: string;
  investing: CfLine[]; investing_total: string;
  financing: CfLine[]; financing_total: string;
  net_change_in_cash: string;
  cash_beginning: string;
  cash_ending: string;
};

export async function getStatementOfCashFlows(businessId: string, params: { period_start: string; period_end: string }) {
  const r = await api.get<StatementOfCashFlowsReport>(`/businesses/${businessId}/reports/statement-of-cash-flows`, { params });
  return r.data;
}

// --- AR/AP Aging — shape copied from agingBuckets.ts (shared by both
// reports) directly. packages/shared's agingRowSchema is stale — its field
// names (customer_id/customer_name/over_30/over_60/over_90) don't match
// what either route actually returns, and it's unused by the routes
// themselves (confirmed by reading both route handlers), same
// "ignore the stale shared schema" pattern as TrialBalance/CashFlow above.

export type AgingRow = {
  id: string; name: string;
  current: string; days_1_30: string; days_31_60: string; days_61_90: string; days_over_90: string;
  total: string;
};
export type AgingReport = { as_of: string; rows: AgingRow[] };

export async function getArAging(businessId: string, params: { as_of?: string } = {}) {
  const r = await api.get<AgingReport>(`/businesses/${businessId}/reports/aging`, { params });
  return r.data;
}

export async function getApAging(businessId: string, params: { as_of?: string } = {}) {
  const r = await api.get<AgingReport>(`/businesses/${businessId}/reports/ap-aging`, { params });
  return r.data;
}

// --- Payments (AR) — shapes copied from paymentService.ts /
// db/types.ts's PaymentsTable directly (read the actual route/service
// return statements, not guessed). Scoped to create-and-post + void only
// — no per-invoice add/remove-application-after-creation endpoints wired
// up (those exist server-side but aren't needed for a first mobile entry
// flow: initial_applications at creation covers the normal case).

export type PaymentMethod = 'cash' | 'check' | 'ach' | 'wire' | 'card' | 'other';
export type PaymentStatus = 'draft' | 'posted' | 'voided';
export type PaymentRow = {
  id: string; business_id: string; customer_id: string; payment_date: string;
  payment_method: PaymentMethod; reference: string | null;
  amount: string; unapplied_amount: string; cash_account_id: string;
  status: PaymentStatus; posted_journal_entry_id: string | null;
  memo: string | null; is_deposited: boolean;
  posted_at: string | null; posted_by_user_id: string | null;
  voided_at: string | null; voided_by_user_id: string | null;
  created_at: string; created_by_user_id: string | null; updated_at: string;
};
export type PaymentApplication = { id: string; invoice_id: string; invoice_number: string; applied_amount: string; applied_at: string };
export type PaymentDetail = { payment: PaymentRow; applications: PaymentApplication[] };
export type PaymentInput = {
  customer_id: string; payment_date: string; payment_method: PaymentMethod;
  reference?: string | null; amount: string; cash_account_id: string; memo?: string | null;
  initial_applications?: Array<{ invoice_id: string; applied_amount: string }>;
};

export async function listPayments(businessId: string, params: { customer_id?: string; status?: PaymentStatus } = {}) {
  const r = await api.get<{ payments: PaymentRow[] }>(`/businesses/${businessId}/payments`, { params });
  return r.data.payments;
}

export async function getPayment(businessId: string, id: string) {
  const r = await api.get<PaymentDetail>(`/businesses/${businessId}/payments/${id}`);
  return r.data;
}

export async function createPayment(businessId: string, input: PaymentInput) {
  const r = await api.post<{ payment: PaymentRow }>(`/businesses/${businessId}/payments`, input);
  return r.data.payment;
}

export async function postPayment(businessId: string, id: string) {
  const r = await api.post<PaymentRow>(`/businesses/${businessId}/payments/${id}/post`);
  return r.data;
}

export async function voidPayment(businessId: string, id: string, void_reason: string) {
  const r = await api.post<PaymentRow>(`/businesses/${businessId}/payments/${id}/void`, { void_reason });
  return r.data;
}

// --- Bills (AP) — read-only this chunk, mirroring InvoiceRow/InvoiceDetail's
// local-type convention exactly (bills.ts has no list/detail zod schema to
// check against either — only write-side schemas exist, same as bills'
// AR counterpart). Note the list endpoint's computed balance field is named
// `open_balance`, while the detail endpoint's is `amount_due` — different
// names for the same idea, confirmed by reading both route handlers
// directly, not assumed to match.

export type BillRow = {
  id: string; bill_number: string | null; vendor_id: string; bill_date: string;
  due_date: string; status: 'draft' | 'posted' | 'paid' | 'voided'; total: string;
  open_balance: string;
};

export async function listBills(businessId: string, params: { status?: string; vendor_id?: string } = {}) {
  const r = await api.get<{ bills: BillRow[] }>(`/businesses/${businessId}/bills`, {
    params: { limit: 500, ...params },
  });
  return r.data.bills;
}

export type BillLine = {
  id: string; line_number: number; description: string; quantity: string;
  unit_price: string; line_subtotal: string;
};

export type BillDetail = {
  bill: BillRow & { subtotal: string; memo: string | null; terms: string | null };
  lines: BillLine[];
  amount_due: string;
};

export async function getBill(businessId: string, id: string) {
  const r = await api.get<BillDetail>(`/businesses/${businessId}/bills/${id}`);
  return r.data;
}

// --- Bill Payments (AP) — the vendor-side mirror of Payments (AR) above.
// Shapes read directly from billPaymentService.ts / db/types.ts's
// BillPaymentsTable/BillPaymentApplicationsTable: field names mirror the
// AR side 1:1 (applied_amount/unapplied_amount are identical names, only
// the FK differs — vendor_id/bill_id instead of customer_id/invoice_id),
// confirmed rather than assumed. PaymentMethod/PaymentStatus are the same
// enums on both sides, reused as-is.
//
// Web has TWO AP payment UIs: a single-vendor BillPaymentNewPage.tsx (the
// true 1:1 analog of PaymentNewPage.tsx we mirrored for AR) and a
// separate QuickBooks-style multi-vendor "Pay Bills" batch grid
// (PayBillsPage.tsx, posting one bill_payment per vendor via a batch
// endpoint). Mobile mirrors only the single-vendor flow, same reasoning
// as scoping Payments to create-and-post-only — the batch grid is a
// bigger, different UX not asked for here.

export type BillPaymentRow = {
  id: string; business_id: string; vendor_id: string; payment_date: string;
  payment_method: PaymentMethod; reference: string | null;
  amount: string; unapplied_amount: string; cash_account_id: string;
  status: PaymentStatus; posted_journal_entry_id: string | null;
  memo: string | null; posted_at: string | null; posted_by_user_id: string | null;
  voided_at: string | null; voided_by_user_id: string | null;
  created_at: string; created_by_user_id: string | null; updated_at: string;
};
export type BillPaymentApplication = { id: string; bill_id: string; bill_number: string; applied_amount: string; applied_at: string };
export type BillPaymentDetail = { bill_payment: BillPaymentRow; applications: BillPaymentApplication[] };
export type BillPaymentInput = {
  vendor_id: string; payment_date: string; payment_method: PaymentMethod;
  reference?: string | null; amount: string; cash_account_id: string; memo?: string | null;
  initial_applications?: Array<{ bill_id: string; applied_amount: string }>;
};

export async function listBillPayments(businessId: string, params: { vendor_id?: string; status?: PaymentStatus } = {}) {
  const r = await api.get<{ bill_payments: BillPaymentRow[] }>(`/businesses/${businessId}/bill-payments`, { params });
  return r.data.bill_payments;
}

export async function getBillPayment(businessId: string, id: string) {
  const r = await api.get<BillPaymentDetail>(`/businesses/${businessId}/bill-payments/${id}`);
  return r.data;
}

export async function createBillPayment(businessId: string, input: BillPaymentInput) {
  const r = await api.post<{ bill_payment: BillPaymentRow }>(`/businesses/${businessId}/bill-payments`, input);
  return r.data.bill_payment;
}

export async function postBillPayment(businessId: string, id: string) {
  const r = await api.post<BillPaymentRow>(`/businesses/${businessId}/bill-payments/${id}/post`);
  return r.data;
}

export async function voidBillPayment(businessId: string, id: string, void_reason: string) {
  const r = await api.post<BillPaymentRow>(`/businesses/${businessId}/bill-payments/${id}/void`, { void_reason });
  return r.data;
}

// --- Credit Memos (AR) — shapes read directly from CreditMemosTable
// (db/types.ts) and creditMemoService.ts's actual return statements.
// Two real differences from Payments, both confirmed rather than assumed:
// (1) no GET /credit-memos/:id detail route exists at all — only list,
// create, post, apply, void — so there's no getCreditMemo()/CreditMemoDetail
// here; the detail screen fetches the list and finds by id, same as web's
// own CreditMemoDetailPage.tsx does. (2) applying to an invoice is always
// a separate POST .../apply call (invoice_id + applied_amount), never an
// initial_applications field at creation — credit memos reuse the exact
// same payment_applications table as Payments (keyed by credit_memo_id
// instead of payment_id), just through a different endpoint shape.

export type CreditMemoStatus = 'draft' | 'posted' | 'applied' | 'voided';
export type CreditMemoRow = {
  id: string; business_id: string; customer_id: string; credit_memo_number: string | null;
  memo_date: string; status: CreditMemoStatus; amount: string; remaining_amount: string;
  source_payment_id: string | null; ar_account_id: string; revenue_account_id: string;
  posted_journal_entry_id: string | null; memo: string | null;
  posted_at: string | null; posted_by_user_id: string | null;
  voided_at: string | null; voided_by_user_id: string | null;
  created_at: string; created_by_user_id: string | null; updated_at: string;
};
export type CreditMemoInput = {
  customer_id: string; memo_date: string; amount: string; revenue_account_id: string; memo?: string | null;
};

export async function listCreditMemos(businessId: string, params: { customer_id?: string } = {}) {
  const r = await api.get<{ credit_memos: CreditMemoRow[] }>(`/businesses/${businessId}/credit-memos`, { params });
  return r.data.credit_memos;
}

export async function createCreditMemo(businessId: string, input: CreditMemoInput) {
  const r = await api.post<CreditMemoRow>(`/businesses/${businessId}/credit-memos`, input);
  return r.data;
}

export async function postCreditMemo(businessId: string, id: string) {
  const r = await api.post<CreditMemoRow>(`/businesses/${businessId}/credit-memos/${id}/post`);
  return r.data;
}

export async function applyCreditMemoToInvoice(businessId: string, id: string, body: { invoice_id: string; applied_amount: string }) {
  await api.post(`/businesses/${businessId}/credit-memos/${id}/apply`, body);
}

export async function voidCreditMemo(businessId: string, id: string, void_reason: string) {
  const r = await api.post<CreditMemoRow>(`/businesses/${businessId}/credit-memos/${id}/void`, { void_reason });
  return r.data;
}

// --- Vendor Credits (AP) — the vendor-side mirror of Credit Memos above,
// confirmed field-for-field against VendorCreditsTable / vendorCreditService.ts
// rather than assumed symmetric. One naming difference worth noting: the
// AP side's offset account field is generically named `offset_account_id`
// (not `expense_account_id`), while AR's equivalent is `revenue_account_id`
// — different names on each side, both read from the real schema, not
// guessed to match. Same two structural quirks as Credit Memos: no GET
// detail route (list-and-find, same as credit-memo/[id].tsx), and
// application is always a separate POST .../apply call reusing the same
// bill_payment_applications table BillPayments use (keyed by
// vendor_credit_id instead of bill_payment_id).

export type VendorCreditRow = {
  id: string; business_id: string; vendor_id: string; vendor_credit_number: string | null;
  credit_date: string; status: CreditMemoStatus; amount: string; remaining_amount: string;
  ap_account_id: string; offset_account_id: string;
  posted_journal_entry_id: string | null; memo: string | null;
  posted_at: string | null; posted_by_user_id: string | null;
  voided_at: string | null; voided_by_user_id: string | null;
  created_at: string; created_by_user_id: string | null; updated_at: string;
};
export type VendorCreditInput = {
  vendor_id: string; credit_date: string; amount: string; offset_account_id: string; memo?: string | null;
};

export async function listVendorCredits(businessId: string, params: { vendor_id?: string } = {}) {
  const r = await api.get<{ vendor_credits: VendorCreditRow[] }>(`/businesses/${businessId}/vendor-credits`, { params });
  return r.data.vendor_credits;
}

export async function createVendorCredit(businessId: string, input: VendorCreditInput) {
  const r = await api.post<VendorCreditRow>(`/businesses/${businessId}/vendor-credits`, input);
  return r.data;
}

export async function postVendorCredit(businessId: string, id: string) {
  const r = await api.post<VendorCreditRow>(`/businesses/${businessId}/vendor-credits/${id}/post`);
  return r.data;
}

export async function applyVendorCreditToBill(businessId: string, id: string, body: { bill_id: string; applied_amount: string }) {
  await api.post(`/businesses/${businessId}/vendor-credits/${id}/apply`, body);
}

export async function voidVendorCredit(businessId: string, id: string, void_reason: string) {
  const r = await api.post<VendorCreditRow>(`/businesses/${businessId}/vendor-credits/${id}/void`, { void_reason });
  return r.data;
}

// --- Bank Transactions (Banking inbox) — shapes read directly from
// BankTransactionsTable (db/types.ts) and bankTransactions.ts's route
// handlers. This is the triage inbox for bank-feed rows BEFORE they
// become journal entries — confirmed separate from the Cash Flow report
// (which only reads already-posted journal_entries) and separate from
// Reconciliation proper (ReconcileWorksheetPage.tsx — ticking cleared
// transactions against a statement balance), which is NOT built this
// chunk; this only covers the review/triage actions.
//
// Scoped to Categorize/Exclude/Unreview — deliberately NOT building
// "Match to an existing journal entry" this chunk. Matching needs a
// picker over existing JEs (search by date/amount, no simple
// name-based list the way every other picker in this app has), a
// materially different UI problem than the others, and Categorize (the
// "Add" case) covers the common path. CSV import is desktop-only,
// not attempted here either — review-only, same reasoning as every
// other read-first chunk this session.

export type BankTransactionStatus = 'unreviewed' | 'matched' | 'categorized' | 'excluded';
export type BankTransactionRow = {
  id: string; business_id: string; bank_account_id: string; transaction_date: string;
  description: string; amount: string; external_id: string | null;
  status: BankTransactionStatus; matched_journal_entry_id: string | null;
  excluded_reason: string | null; is_reconciled: boolean; reconciliation_id: string | null;
  imported_at: string; reviewed_at: string | null; reviewed_by_user_id: string | null;
  import_batch_id: string | null;
};

export async function listBankTransactions(
  businessId: string,
  params: { bank_account_id?: string; status?: BankTransactionStatus; is_reconciled?: boolean } = {},
) {
  const r = await api.get<{ bank_transactions: BankTransactionRow[] }>(`/businesses/${businessId}/bank-transactions`, { params });
  return r.data.bank_transactions;
}

export async function getBankTransaction(businessId: string, id: string) {
  const r = await api.get<BankTransactionRow>(`/businesses/${businessId}/bank-transactions/${id}`);
  return r.data;
}

export type BankTransactionSuggestion = { account_id: string; confidence: number; band: ConfidenceBand; source_layer: CodingLayerId } | null;

export async function getBankTransactionSuggestion(businessId: string, id: string) {
  const r = await api.get<{ suggestion: BankTransactionSuggestion }>(`/businesses/${businessId}/bank-transactions/${id}/suggestion`);
  return r.data.suggestion;
}

export async function categorizeBankTransaction(businessId: string, id: string, body: { offset_account_id: string; memo?: string | null }) {
  const r = await api.post<BankTransactionRow>(`/businesses/${businessId}/bank-transactions/${id}/categorize`, body);
  return r.data;
}

export async function excludeBankTransaction(businessId: string, id: string, excluded_reason: string) {
  const r = await api.post<BankTransactionRow>(`/businesses/${businessId}/bank-transactions/${id}/exclude`, { excluded_reason });
  return r.data;
}

export async function unreviewBankTransaction(businessId: string, id: string) {
  const r = await api.post<BankTransactionRow>(`/businesses/${businessId}/bank-transactions/${id}/unreview`);
  return r.data;
}
