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

export async function getNextInvoiceNumber(businessId: string) {
  const r = await api.get<{ next_number: string }>(`/businesses/${businessId}/invoices/next-number`);
  return r.data.next_number;
}

export type InvoiceLineInput = { description: string; quantity: string; unit_price: string; revenue_account_id: string };
export type InvoiceCreateResult = { id: string; invoice_number: string; total: string; status: string };

export async function createInvoiceDraft(
  businessId: string,
  input: { customer_id: string; invoice_number: string; issue_date: string; due_date: string; memo?: string | null; terms?: string | null; lines: InvoiceLineInput[] },
) {
  // The route returns { invoice, lines }, not the invoice flat — confirmed
  // against invoiceService.ts's createDraft, not guessed from the route file.
  const r = await api.post<{ invoice: InvoiceCreateResult; lines: unknown[] }>(`/businesses/${businessId}/invoices`, input);
  return r.data.invoice;
}

export async function postInvoice(businessId: string, id: string) {
  const r = await api.post<InvoiceCreateResult>(`/businesses/${businessId}/invoices/${id}/post`);
  return r.data;
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

export async function getNextCheckNumber(businessId: string, bankAccountId: string) {
  const r = await api.get<{ check_number: string | null }>(`/businesses/${businessId}/checks/next-number`, { params: { bank_account_id: bankAccountId } });
  return r.data.check_number;
}

export type CheckPayeeType = 'vendor' | 'customer' | 'other';
export type CheckLineInput = { account_id: string; description?: string | null; amount: string };
export type CheckCreateResult = { id: string; check_number: string; total_amount: string; status: string; journal_entry_id: string | null };

export async function createCheck(
  businessId: string,
  input: {
    payment_date: string; bank_account_id: string; check_number?: string | null;
    payee_id?: string | null; payee_type?: CheckPayeeType | null; payee_text?: string | null;
    memo?: string | null; lines: CheckLineInput[];
  },
) {
  const r = await api.post<CheckCreateResult>(`/businesses/${businessId}/checks`, input);
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

export async function getNextJournalNumber(businessId: string) {
  const r = await api.get<{ journal_number: string }>(`/businesses/${businessId}/journal-entries/next-number`);
  return r.data.journal_number;
}

export type JournalLineInput = { account_id: string; debit: string; credit: string; memo?: string | null };
export type JournalEntryCreateResult = { id: string; journal_number: string; entry_date: string; status: string };

export async function createJournalEntry(
  businessId: string,
  input: { entry_date: string; journal_number?: string | null; memo?: string | null; reference?: string | null; lines: JournalLineInput[] },
) {
  const r = await api.post<JournalEntryCreateResult>(`/businesses/${businessId}/journal-entries`, input);
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

// --- Cash Activity by Account — a single bank account's register with a
// running balance, distinct from the Statement of Cash Flows above
// (operating/investing/financing categorization). Defaults to the
// business's Operating Bank Account when cash_account_id is omitted.

export type CashActivityLine = {
  entry_date: string; journal_entry_id: string; source_type: string; status: 'posted' | 'voided';
  memo: string | null; debit: string; credit: string; net_amount: string; running_balance: string;
};
export type CashActivityReport = {
  period_start: string; period_end: string;
  cash_account_id: string; cash_account_code: string; cash_account_name: string;
  beginning_balance: string; ending_balance: string; net_change: string;
  lines: CashActivityLine[];
};

export async function getCashActivity(
  businessId: string, params: { period_start: string; period_end: string; cash_account_id?: string },
) {
  const r = await api.get<CashActivityReport>(`/businesses/${businessId}/reports/cash-flow`, { params });
  return r.data;
}

export type MonthAmount = { month: string; amount: string };
export type ManagementReport = {
  revenue_by_month: MonthAmount[];
  expense_breakdown: Array<{ account_code: string; account_name: string; amount: string }>;
  total_revenue_last_12: string; total_expense_last_12: string;
};

export async function getManagementReport(businessId: string) {
  const r = await api.get<ManagementReport>(`/businesses/${businessId}/management-report`);
  return r.data;
}

export type PerformanceReport = {
  revenue_trend: MonthAmount[]; expense_trend: MonthAmount[]; net_income_trend: MonthAmount[];
};

export async function getPerformanceReport(businessId: string) {
  const r = await api.get<PerformanceReport>(`/businesses/${businessId}/performance-report`);
  return r.data;
}

export type CustomReportGroupBy = 'account' | 'month' | 'cost_center' | 'customer' | 'vendor';
export type CustomReportColumn = 'debit' | 'credit' | 'net';
export type CustomReportDefinition = {
  account_ids: string[];
  date_range: { from: string; to: string };
  group_by: CustomReportGroupBy;
  columns: CustomReportColumn[];
};
export type CustomReport = {
  id: string; business_id: string; name: string; owner_user_id: string;
  definition: CustomReportDefinition; created_at: string; updated_at: string;
};
export type CustomReportRow = { group_key: string; debit: string; credit: string; net: string };

export async function listCustomReports(businessId: string) {
  const r = await api.get<{ reports: CustomReport[] }>(`/businesses/${businessId}/custom-reports`);
  return r.data.reports;
}

export async function getCustomReport(businessId: string, id: string) {
  const r = await api.get<CustomReport>(`/businesses/${businessId}/custom-reports/${id}`);
  return r.data;
}

export async function createCustomReport(businessId: string, name: string, definition: CustomReportDefinition) {
  const r = await api.post<CustomReport>(`/businesses/${businessId}/custom-reports`, { name, definition });
  return r.data;
}

export async function updateCustomReport(
  businessId: string, id: string, patch: { name?: string; definition?: CustomReportDefinition },
) {
  const r = await api.patch<CustomReport>(`/businesses/${businessId}/custom-reports/${id}`, patch);
  return r.data;
}

export async function deleteCustomReport(businessId: string, id: string) {
  await api.delete(`/businesses/${businessId}/custom-reports/${id}`);
}

export async function runSavedCustomReport(businessId: string, id: string) {
  const r = await api.post<{ rows: CustomReportRow[] }>(`/businesses/${businessId}/custom-reports/${id}/run`);
  return r.data.rows;
}

export async function runCustomReport(businessId: string, definition: CustomReportDefinition) {
  const r = await api.post<{ rows: CustomReportRow[] }>(`/businesses/${businessId}/custom-reports/run`, { definition });
  return r.data.rows;
}

export type BudgetStatus = 'draft' | 'active' | 'archived';
export type Budget = {
  id: string; business_id: string; name: string; fiscal_year: number; status: BudgetStatus;
  created_at: string; updated_at: string; created_by_user_id: string | null;
};
export type BudgetLine = { id: string; budget_id: string; account_id: string; month_offset: number; amount: string };
export type BudgetWithLines = Budget & { lines: BudgetLine[] };
export type BudgetVarianceRow = {
  account_id: string; account_code: string; account_name: string; month_offset: number;
  budget: string; actual: string; variance: string;
};

export async function listBudgets(businessId: string) {
  const r = await api.get<{ budgets: Budget[] }>(`/businesses/${businessId}/budgets`);
  return r.data.budgets;
}

export async function getBudget(businessId: string, id: string) {
  const r = await api.get<BudgetWithLines>(`/businesses/${businessId}/budgets/${id}`);
  return r.data;
}

export async function createBudget(businessId: string, name: string, fiscal_year: number) {
  const r = await api.post<Budget>(`/businesses/${businessId}/budgets`, { name, fiscal_year });
  return r.data;
}

export async function updateBudget(businessId: string, id: string, patch: { name?: string; status?: BudgetStatus }) {
  const r = await api.patch<Budget>(`/businesses/${businessId}/budgets/${id}`, patch);
  return r.data;
}

export async function deleteBudget(businessId: string, id: string) {
  await api.delete(`/businesses/${businessId}/budgets/${id}`);
}

export async function setBudgetLine(businessId: string, id: string, account_id: string, month_offset: number, amount: string) {
  const r = await api.patch<BudgetLine>(`/businesses/${businessId}/budgets/${id}/lines`, { account_id, month_offset, amount });
  return r.data;
}

export async function getBudgetVariance(businessId: string, id: string) {
  const r = await api.get<{ rows: BudgetVarianceRow[] }>(`/businesses/${businessId}/budgets/${id}/variance`);
  return r.data.rows;
}

export type MessageRow = {
  id: string; body: string; created_at: string; author_name: string; author_role: string; mine: boolean;
};

export async function listMessages(businessId: string, params: { limit?: number; before?: string } = {}) {
  const r = await api.get<{ messages: MessageRow[]; has_more: boolean }>(`/businesses/${businessId}/messages`, { params });
  return r.data;
}

export async function getUnreadMessageCount(businessId: string) {
  const r = await api.get<{ count: number }>(`/businesses/${businessId}/messages/unread-count`);
  return r.data.count;
}

export async function postMessage(businessId: string, body: string) {
  // The raw inserted row — id/business_id/author_user_id/body/created_at,
  // not the joined MessageRow shape listMessages returns. Callers should
  // invalidate and refetch the list rather than rely on this response.
  const r = await api.post<{ id: string; business_id: string; author_user_id: string; body: string; created_at: string }>(
    `/businesses/${businessId}/messages`, { body },
  );
  return r.data;
}

export async function markMessagesRead(businessId: string) {
  await api.post(`/businesses/${businessId}/messages/read`);
}

// --- Inventory ---

export type InventoryOverview = {
  total_items_count: number; total_stock_value: string; unposted_stock_value: string;
  recent_receipts: Array<{ id: string; receipt_date: string; po_number: string }>;
  recent_sales: Array<{ id: string; order_date: string; so_number: string }>;
};

export async function getInventoryOverview(businessId: string) {
  const r = await api.get<InventoryOverview>(`/businesses/${businessId}/inventory-overview`);
  return r.data;
}

export async function postOpeningInventoryBalance(businessId: string, entry_date: string) {
  const r = await api.post<{ journal_entry_id: string | null; movement_count: number; value: string }>(
    `/businesses/${businessId}/inventory/post-opening-balance`, { entry_date },
  );
  return r.data;
}

export type StockMovementReason = 'adjustment' | 'opening_balance' | 'manual_in' | 'manual_out' | 'write_off';
export type InventoryItem = {
  id: string; business_id: string; sku: string; name: string; description: string | null;
  unit_of_measure: string; purchase_cost: string | null; sale_price: string | null;
  income_account_id: string | null; expense_account_id: string | null; inventory_asset_account_id: string | null;
  is_active: boolean; created_at: string; updated_at: string; deleted_at: string | null;
  quantity_on_hand: string;
};
export type StockMovement = {
  id: string; inventory_item_id: string; movement_date: string; quantity_delta: string;
  reason: StockMovementReason; memo: string | null; posted_by_user_id: string | null; created_at: string;
  posted_by_name: string | null;
};
export type InventoryItemWithMovements = InventoryItem & { stock_movements: StockMovement[] };

export async function listInventoryItems(businessId: string, params: { include_inactive?: boolean } = {}) {
  const r = await api.get<{ items: InventoryItem[] }>(`/businesses/${businessId}/inventory-items`, {
    params: params.include_inactive ? { include_inactive: 'true' } : undefined,
  });
  return r.data.items;
}

export async function getInventoryItem(businessId: string, id: string) {
  const r = await api.get<InventoryItemWithMovements>(`/businesses/${businessId}/inventory-items/${id}`);
  return r.data;
}

export type InventoryItemCreate = {
  sku: string; name: string; description?: string | null; unit_of_measure?: string;
  purchase_cost?: string | null; sale_price?: string | null;
  income_account_id?: string | null; expense_account_id?: string | null; inventory_asset_account_id?: string | null;
};

export async function createInventoryItem(businessId: string, input: InventoryItemCreate) {
  const r = await api.post<InventoryItem>(`/businesses/${businessId}/inventory-items`, input);
  return r.data;
}

export async function updateInventoryItem(businessId: string, id: string, patch: Partial<InventoryItemCreate> & { is_active?: boolean }) {
  const r = await api.patch<InventoryItem>(`/businesses/${businessId}/inventory-items/${id}`, patch);
  return r.data;
}

export async function deleteInventoryItem(businessId: string, id: string) {
  await api.delete(`/businesses/${businessId}/inventory-items/${id}`);
}

export async function adjustInventoryStock(
  businessId: string, id: string,
  input: { movement_date: string; quantity_delta: string; reason: StockMovementReason; memo?: string | null; unit_cost?: string },
) {
  const r = await api.post<StockMovement>(`/businesses/${businessId}/inventory-items/${id}/adjust-stock`, input);
  return r.data;
}

export type PurchaseOrderStatus = 'draft' | 'sent' | 'received' | 'closed' | 'void';
export type PurchaseOrder = {
  id: string; business_id: string; po_number: string; vendor_id: string; order_date: string;
  expected_delivery_date: string | null; status: PurchaseOrderStatus; memo: string | null;
  created_at: string; updated_at: string; created_by_user_id: string | null;
};
export type PurchaseOrderLine = {
  id: string; purchase_order_id: string; line_number: number; inventory_item_id: string;
  description: string | null; quantity: string; unit_cost: string;
};
export type PurchaseOrderWithLines = PurchaseOrder & { lines: PurchaseOrderLine[] };

export async function listPurchaseOrders(businessId: string, params: { status?: PurchaseOrderStatus } = {}) {
  const r = await api.get<{ purchase_orders: PurchaseOrder[] }>(`/businesses/${businessId}/purchase-orders`, { params });
  return r.data.purchase_orders;
}

export async function getPurchaseOrder(businessId: string, id: string) {
  const r = await api.get<PurchaseOrderWithLines>(`/businesses/${businessId}/purchase-orders/${id}`);
  return r.data;
}

export type PurchaseOrderLineInput = { inventory_item_id: string; quantity: string; unit_cost: string; description?: string | null };
export async function createPurchaseOrder(
  businessId: string,
  input: { vendor_id: string; order_date: string; expected_delivery_date?: string | null; memo?: string | null; lines: PurchaseOrderLineInput[] },
) {
  const r = await api.post<PurchaseOrderWithLines>(`/businesses/${businessId}/purchase-orders`, input);
  return r.data;
}

export async function voidPurchaseOrder(businessId: string, id: string) {
  const r = await api.post<PurchaseOrder>(`/businesses/${businessId}/purchase-orders/${id}/void`);
  return r.data;
}

export type ItemReceipt = {
  id: string; business_id: string; purchase_order_id: string; receipt_date: string;
  bill_id: string | null; memo: string | null; created_at: string; updated_at: string; created_by_user_id: string | null;
};

export async function listItemReceipts(businessId: string) {
  const r = await api.get<{ item_receipts: ItemReceipt[] }>(`/businesses/${businessId}/item-receipts`);
  return r.data.item_receipts;
}

export async function createItemReceipt(businessId: string, input: { purchase_order_id: string; receipt_date: string; memo?: string | null }) {
  const r = await api.post<ItemReceipt>(`/businesses/${businessId}/item-receipts`, input);
  return r.data;
}

export type SalesOrderStatus = 'draft' | 'confirmed' | 'fulfilled' | 'void';
export type SalesOrder = {
  id: string; business_id: string; so_number: string; customer_id: string; order_date: string;
  status: SalesOrderStatus; invoice_id: string | null; memo: string | null;
  created_at: string; updated_at: string; created_by_user_id: string | null;
};
export type SalesOrderLine = {
  id: string; sales_order_id: string; line_number: number; inventory_item_id: string;
  description: string | null; quantity: string; unit_price: string;
};
export type SalesOrderWithLines = SalesOrder & { lines: SalesOrderLine[] };

export async function listSalesOrders(businessId: string, params: { status?: SalesOrderStatus } = {}) {
  const r = await api.get<{ sales_orders: SalesOrder[] }>(`/businesses/${businessId}/sales-orders`, { params });
  return r.data.sales_orders;
}

export async function getSalesOrder(businessId: string, id: string) {
  const r = await api.get<SalesOrderWithLines>(`/businesses/${businessId}/sales-orders/${id}`);
  return r.data;
}

export type SalesOrderLineInput = { inventory_item_id: string; quantity: string; unit_price: string; description?: string | null };
export async function createSalesOrder(
  businessId: string,
  input: { customer_id: string; order_date: string; memo?: string | null; lines: SalesOrderLineInput[] },
) {
  const r = await api.post<SalesOrderWithLines>(`/businesses/${businessId}/sales-orders`, input);
  return r.data;
}

export async function fulfillSalesOrder(businessId: string, id: string) {
  const r = await api.post<SalesOrder>(`/businesses/${businessId}/sales-orders/${id}/fulfill`);
  return r.data;
}

export async function voidSalesOrder(businessId: string, id: string) {
  const r = await api.post<SalesOrder>(`/businesses/${businessId}/sales-orders/${id}/void`);
  return r.data;
}

export type ShippingLabel = {
  id: string; business_id: string; invoice_id: string | null; sales_order_id: string | null;
  carrier: string; tracking_number: string; shipped_at: string; cost: string | null;
  label_file_id: string | null; notes: string | null; created_at: string; updated_at: string;
  created_by_user_id: string | null; invoice_number: string | null; so_number: string | null;
};

export async function listShippingLabels(businessId: string, params: { invoice_id?: string; sales_order_id?: string } = {}) {
  const r = await api.get<{ labels: ShippingLabel[] }>(`/businesses/${businessId}/shipping-labels`, { params });
  return r.data.labels;
}

export async function createShippingLabel(
  businessId: string,
  input: { carrier: string; tracking_number: string; shipped_at: string; invoice_id?: string | null; sales_order_id?: string | null; cost?: string | null; notes?: string | null },
) {
  const r = await api.post<ShippingLabel>(`/businesses/${businessId}/shipping-labels`, input);
  return r.data;
}

export async function deleteShippingLabel(businessId: string, id: string) {
  await api.delete(`/businesses/${businessId}/shipping-labels/${id}`);
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

// --- Reconciliation — shapes read directly from
// bankReconciliationWorksheetService.ts's actual return statements and
// ReconciliationsTable/ReconciliationItemsTable in db/types.ts. Confirmed
// there are TWO backend systems (an older, apparently web-unused
// /reconciliations route, and this one, /bank-rec/*, which is what
// web's Reconcile*Page.tsx components actually call) — built against
// /bank-rec/* only, not the unused one.
//
// Scoped to Start/Resume → Worksheet (tick + save + finish) → History.
// Deliberately NOT built: Undo (firm_admin-only, rare, can follow later),
// Cancel (abandoning an in-progress session — same reasoning), and a
// discrepancy-account picker on Finish (the server already defaults to
// Opening Balance Equity when none is given, so "accept the difference"
// needs no extra picker for the common case).

export type ReconcilableCategory =
  | 'Bank' | 'Credit Card' | 'Other Current Asset' | 'Fixed Asset' | 'Other Asset'
  | 'Other Current Liability' | 'Long-Term Liability' | 'Equity';
export type ReconcilableAccount = { id: string; code: string; name: string; category: ReconcilableCategory };

export async function listReconcilableAccounts(businessId: string) {
  const r = await api.get<{ accounts: ReconcilableAccount[] }>(`/businesses/${businessId}/bank-rec/accounts`);
  return r.data.accounts;
}

export async function getReconciliationStatus(businessId: string, accountId: string) {
  const r = await api.get<{ beginning_balance: string; in_progress_id: string | null }>(
    `/businesses/${businessId}/bank-rec/status`, { params: { account_id: accountId } },
  );
  return r.data;
}

export type ReconciliationSessionStatus = 'in_progress' | 'completed' | 'cancelled';
export type ReconciliationRow = {
  id: string; business_id: string; account_id: string;
  statement_beginning_balance: string; statement_ending_balance: string; statement_ending_date: string;
  beginning_balance: string;
  service_charge_amount: string; service_charge_date: string | null; service_charge_account_id: string | null;
  interest_earned_amount: string; interest_earned_date: string | null; interest_earned_account_id: string | null;
  status: ReconciliationSessionStatus; difference: string; adjustment_journal_entry_id: string | null;
  completed_at: string | null; completed_by_user_id: string | null;
  created_by_user_id: string | null; created_at: string; updated_at: string;
};

export type ReconciliationStartInput = {
  account_id: string; statement_ending_balance: string; statement_ending_date: string;
  service_charge_amount?: string | null; service_charge_date?: string | null; service_charge_account_id?: string | null;
  interest_earned_amount?: string | null; interest_earned_date?: string | null; interest_earned_account_id?: string | null;
};

export async function startReconciliation(businessId: string, input: ReconciliationStartInput) {
  const r = await api.post<ReconciliationRow>(`/businesses/${businessId}/bank-rec/start`, input);
  return r.data;
}

export type ReconciliationItemType = 'deposit' | 'expense' | 'check' | 'journal_entry' | 'service_charge' | 'interest';
export type WorksheetItem = {
  transaction_type: ReconciliationItemType; transaction_id: string; transaction_date: string;
  type_label: string; ref_no: string | null; name: string | null; description: string | null;
  amount: string; is_cleared: boolean; auto_matched: boolean; transaction_path: string;
};
export type ReconciliationSummary = {
  statement_beginning_balance: string; statement_ending_balance: string; cleared_balance: string;
  difference: string; cleared_count: number; total_count: number; auto_matched_count: number;
};
export type Worksheet = {
  reconciliation: ReconciliationRow; account: CoaAccount; category: ReconcilableCategory;
  items: WorksheetItem[]; summary: ReconciliationSummary;
};

export async function getWorksheet(businessId: string, id: string) {
  const r = await api.get<Worksheet>(`/businesses/${businessId}/bank-rec/${id}/worksheet`);
  return r.data;
}

export async function saveReconciliationProgress(
  businessId: string, id: string,
  items: Array<{ transaction_type: ReconciliationItemType; transaction_id: string; is_cleared: boolean }>,
) {
  const r = await api.patch<{ reconciliation: ReconciliationRow; summary: ReconciliationSummary }>(
    `/businesses/${businessId}/bank-rec/${id}/items`, { items },
  );
  return r.data;
}

export async function finishReconciliation(businessId: string, id: string, accept_difference?: boolean) {
  const r = await api.post<ReconciliationRow>(`/businesses/${businessId}/bank-rec/${id}/finish`, { accept_difference });
  return r.data;
}

export type ReconciliationHistoryRow = ReconciliationRow & {
  account_code: string; account_name: string;
  account_type: string; detail_type: string | null;
  category: ReconcilableCategory; items_cleared: number; changes: number;
  auto_adjustment: string | null; completed_by: string | null;
};

export async function listReconciliationHistory(businessId: string, params: { account_id?: string } = {}) {
  const r = await api.get<{ reconciliations: ReconciliationHistoryRow[] }>(`/businesses/${businessId}/bank-rec/history`, { params });
  return r.data.reconciliations;
}

// --- Checks (AP) — read-only list, mirroring listChecks' actual merge
// logic read directly from checkService.ts: it unions the real `checks`
// table with "legacy" checks (an expense_transactions row with
// payment_method='check', which predates this feature's own table —
// otherwise invisible here even though GL already shows them). `legacy`
// is what the row actually is, not a cosmetic flag — it decides which
// detail screen a tap should open (type=check vs type=expense on the
// existing app/transaction/[id].tsx, since a legacy row has no `checks`
// table record to fetch via getCheck).

export type CheckListRow = {
  id: string; check_number: string | null; payment_date: string; payee_name: string | null;
  total_amount: string; status: 'draft' | 'posted' | 'void'; bank_account_name: string | null; legacy: boolean;
};

export async function listChecks(businessId: string) {
  const r = await api.get<{ checks: CheckListRow[] }>(`/businesses/${businessId}/checks`);
  return r.data.checks;
}

// --- AI Suspense — unclassified amounts the AI coding engine couldn't
// place anywhere real, parked in the client's Suspense account and
// blocking period close (see CLAUDE.md). Shapes read directly from
// suspenseService.ts's actual types/return statements — no confidence/
// band field here (unlike the AI inbox), since these are confidence-0
// items by definition; ConfidenceBadge isn't used on this screen for
// the same reason web's SuspensePage.tsx doesn't show it either.

export type SuspenseItem = {
  journal_entry_id: string; entry_date: string; label: string; num: string | null;
  payee: string | null; description: string | null; amount: string; direction: 'out' | 'in';
  bank_account_name: string | null; path: string; age_days: number;
};

export async function listSuspenseItems(businessId: string) {
  const r = await api.get<{ account_id: string | null; items: SuspenseItem[] }>(`/businesses/${businessId}/suspense`);
  return r.data;
}

export async function reclassifySuspenseItem(
  businessId: string, journalEntryId: string, body: { account_id: string; remember?: boolean },
) {
  const r = await api.post<{ method: 'edited' | 'journal_entry'; journal_entry_id: string }>(
    `/businesses/${businessId}/suspense/${journalEntryId}/reclassify`, body,
  );
  return r.data;
}

// --- AI Coding Rules — the "learned client rule" layer CLAUDE.md's
// auto-coding order starts with. Shapes read directly from the route's
// actual query/select and AccountCodingMemoryTable in db/types.ts. No
// create endpoint exists anywhere — rules are only ever created
// implicitly by the engine (e.g. Suspense's "Remember for this payee"),
// confirmed by reading the whole route file, not assumed from the
// pattern of every other entity having one. Only edit (which account(s)
// a rule posts to) and delete exist.

export type CodingRuleLine = { account_id: string; debit: string; credit: string; memo: string | null };
export type CodingRule = {
  id: string; normalized_vendor: string; direction: 'debit' | 'credit';
  lines: CodingRuleLine[]; times_applied: number; times_corrected: number;
  last_applied_at: string | null; created_at: string; bank_account_name: string | null;
};

export async function listCodingRules(businessId: string) {
  const r = await api.get<{ rules: CodingRule[] }>(`/businesses/${businessId}/ai/coding-rules`);
  return r.data.rules;
}

export async function updateCodingRule(businessId: string, ruleId: string, account_ids: string[]) {
  await api.patch(`/businesses/${businessId}/ai/coding-rules/${ruleId}`, { account_ids });
}

export async function deleteCodingRule(businessId: string, ruleId: string) {
  await api.delete(`/businesses/${businessId}/ai/coding-rules/${ruleId}`);
}

// --- AP Overview — a single-call dashboard, shape read directly from
// apOverviewService.ts's getOverview return statement. No aging buckets
// despite the name — just 4 KPI tiles + a top-5-vendors table, confirmed
// from the real implementation rather than assumed from "AP Overview"
// sounding like it should mirror the Aging report.

export type ApOverview = {
  outstanding_bills_total: string; unused_credits_total: string; net_payable_total: string;
  overdue_bills_count: number; upcoming_payments_7d: string; upcoming_payments_30d: string;
  top_vendors: Array<{ vendor_id: string; vendor_name: string; outstanding: string }>;
};

export async function getApOverview(businessId: string) {
  const r = await api.get<ApOverview>(`/businesses/${businessId}/ap-overview`);
  return r.data;
}

// --- Contractors — vendors with is_1099=true, via the dedicated
// /contractors route (richer than listVendors: adds tax_id_last_four/
// tax_id_type, confirmed from listContractors' selectAll() on vendors).

export type Contractor = {
  id: string; name: string; email: string | null; phone: string | null;
  is_1099: boolean; tax_id_last_four: string | null; tax_id_type: 'SSN' | 'EIN' | null;
};

export async function listContractors(businessId: string) {
  const r = await api.get<{ vendors: Contractor[] }>(`/businesses/${businessId}/contractors`);
  return r.data.vendors;
}

// --- 1099 report — shape read directly from tenNinetyNineReportService.ts.
// Note: web's own page declares a local `tax_id` field that doesn't match
// what the service actually returns (tax_id_last_four + tax_id_type) — a
// pre-existing bug on web (that column always renders blank there). Mobile
// uses the real field names, not web's stale local type.

export type TenNinetyNineRow = {
  vendor_id: string; vendor_name: string;
  tax_id_last_four: string | null; tax_id_type: 'SSN' | 'EIN' | null; total_paid: string;
};

export async function getTenNinetyNineReport(businessId: string, year: number) {
  const r = await api.get<{ year: number; rows: TenNinetyNineRow[] }>(`/businesses/${businessId}/reports/1099`, { params: { year } });
  return r.data;
}

// --- Customer Statement — shape read directly from
// customerStatementService.ts. Per-customer only (customer_id is a
// required query param) — no bulk/all-customers variant exists, confirmed
// by reading the route rather than assumed. Lines before period_start are
// already folded into opening_balance server-side, not returned
// individually.

export type StatementLine = {
  date: string; type: 'invoice' | 'payment' | 'credit_memo'; number: string | null;
  charge: string; credit: string; balance: string;
};
export type CustomerStatement = {
  customer: { id: string; name: string };
  period_start: string; period_end: string;
  opening_balance: string; lines: StatementLine[]; closing_balance: string;
};

export async function getCustomerStatement(businessId: string, params: { customer_id: string; period_start: string; period_end: string }) {
  const r = await api.get<CustomerStatement>(`/businesses/${businessId}/reports/customer-statement`, { params });
  return r.data;
}

// --- Bank Accounts (full) — the richer shape the real /bank-accounts
// route returns, confirmed directly from bankAccountService.ts. The
// existing BankAccountRow ({id,name,cash_account_id}) used for payment-
// account pickers elsewhere is a narrower subset kept as-is (every
// existing picker call site only reads those 3 fields) — this is a
// separate, additive type for the full list screen, not a replacement.

export type BankAccountFull = {
  id: string; name: string; institution: string | null; account_last_four: string | null;
  cash_account_id: string; is_active: boolean;
  cash_account_code: string; cash_account_name: string;
  bank_balance: string; book_balance: string;
};

export async function listBankAccountsFull(businessId: string) {
  const r = await api.get<{ bank_accounts: BankAccountFull[] }>(`/businesses/${businessId}/bank-accounts`);
  return r.data.bank_accounts;
}

// --- Fixed Assets — read-only list+detail, shapes read directly from
// fixedAssetService.ts (selectAll() on fixed_assets + computed
// accumulated_depreciation/book_value). Create/edit/depreciate exist
// server-side but aren't built here — same "read-only reference screen"
// scoping as Chart of Accounts/Bills.

export type FixedAssetRow = {
  id: string; business_id: string; name: string;
  asset_account_id: string; depreciation_expense_account_id: string; accumulated_depreciation_account_id: string;
  purchase_date: string; cost: string; salvage_value: string; useful_life_years: number;
  depreciation_method: 'straight_line'; status: 'active' | 'disposed'; memo: string | null;
  created_at: string; updated_at: string;
  accumulated_depreciation: string; book_value: string;
};

export async function listFixedAssets(businessId: string) {
  const r = await api.get<{ fixed_assets: FixedAssetRow[]; ledger_cost_total: string }>(`/businesses/${businessId}/fixed-assets`);
  return r.data;
}

export async function getFixedAsset(businessId: string, id: string) {
  const r = await api.get<FixedAssetRow>(`/businesses/${businessId}/fixed-assets/${id}`);
  return r.data;
}

// --- Receipts — file attachments linked to a transaction/document
// (bill, invoice, journal entry, check, bank_deposit, expense_transaction,
// bank_transaction, or unlinked). Genuinely separate from the AI Document
// Inbox (apps/mobile/app/inbox/ — email/staged-import review), confirmed
// by reading both route files, not assumed from the similar-sounding name.

export type ReceiptRow = {
  id: string; business_id: string; file_id: string; uploaded_by_user_id: string | null;
  linked_entity_type: string | null; linked_entity_id: string | null;
  created_at: string; updated_at: string;
  file_name: string; file_mime_type: string; file_byte_size: number;
  linked_label: string | null;
};

export async function listReceipts(businessId: string) {
  const r = await api.get<{ receipts: ReceiptRow[] }>(`/businesses/${businessId}/receipts`);
  return r.data.receipts;
}

// --- Bank Transaction Rules — manually-defined keyword/amount-match
// rules on the bank feed (table bank_transaction_rules), confirmed
// distinct from AI Coding Rules (the engine's learned rules,
// apps/mobile/app/coding-rules.tsx — different table, different
// mechanism). Scoped to list + delete this chunk, same reasoning as
// Contractors' reveal/W-9 edit: create/edit are real but lower-frequency
// actions not rushed in.

export type BankRuleSignFilter = 'any' | 'inflow_only' | 'outflow_only';
export type BankRule = {
  id: string; business_id: string; name: string; description_contains: string;
  min_amount: string | null; max_amount: string | null; sign_filter: BankRuleSignFilter;
  offset_account_id: string; priority: number; is_active: boolean; bank_account_id: string | null;
  created_at: string; updated_at: string;
  offset_account_code: string; offset_account_name: string; bank_account_name: string | null;
};

export async function listBankRules(businessId: string) {
  const r = await api.get<{ bank_rules: BankRule[] }>(`/businesses/${businessId}/bank-rules`);
  return r.data.bank_rules;
}

export async function deleteBankRule(businessId: string, id: string) {
  await api.delete(`/businesses/${businessId}/bank-rules/${id}`);
}

// --- Approvals — the queue CLAUDE.md's HELD_ACTIONS note refers to:
// a staff-level save that posts to the ledger waits here when
// staff_entries_need_approval is on, until an accountant approves (which
// replays the original request as them) or rejects it. Shapes read
// directly from approvalService.ts/approvals.ts route.

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ApprovalRow = {
  id: string; action: string; summary: string; amount: string | null; status: string;
  payload: unknown; created_at: string; requested_by: string;
  decided_by: string | null; decided_at: string | null; decision_note: string | null;
};

export async function listApprovals(businessId: string, params: { status?: ApprovalStatus } = {}) {
  const r = await api.get<{ requests: ApprovalRow[]; needs_approval: boolean }>(`/businesses/${businessId}/approvals`, { params });
  return r.data;
}

export async function approveRequest(businessId: string, approvalId: string) {
  const r = await api.post<{ id: string; status: string; result: unknown }>(`/businesses/${businessId}/approvals/${approvalId}/approve`);
  return r.data;
}

export async function rejectRequest(businessId: string, approvalId: string, note?: string) {
  const r = await api.post<{ id: string; status: string }>(`/businesses/${businessId}/approvals/${approvalId}/reject`, { note });
  return r.data;
}

// --- Recurring Templates — shapes read directly from RecurringTemplatesTable
// (db/types.ts) and recurringTemplates.ts's route. Read-only list this
// chunk, plus the one simple action worth wiring (pause/resume — there's
// no dedicated endpoint for it, confirmed: it's just PATCH {is_active}).
// Create/edit-the-payload/run-now/delete are real but not built here.

export type RecurringTemplateType = 'journal_entry' | 'invoice' | 'bill' | 'deposit' | 'expense' | 'check';
export type RecurringTemplateRecurrence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type RecurringTemplateRow = {
  id: string; business_id: string; name: string; template_type: RecurringTemplateType;
  recurrence: RecurringTemplateRecurrence; recurrence_type: 'scheduled' | 'reminder' | 'unscheduled';
  days_in_advance: number | null; next_run_date: string; end_date: string | null;
  last_run_at: string | null; is_active: boolean; created_at: string; updated_at: string;
  created_by_user_id: string | null;
};

export async function listRecurringTemplates(businessId: string) {
  const r = await api.get<{ templates: RecurringTemplateRow[] }>(`/businesses/${businessId}/recurring-templates`);
  return r.data.templates;
}

export async function setRecurringTemplateActive(businessId: string, id: string, is_active: boolean) {
  await api.patch(`/businesses/${businessId}/recurring-templates/${id}`, { is_active });
}

// --- Integration Transactions (integration inbox) — rows imported from
// a 3rd-party platform CSV export (Stripe/PayPal/Shopify/generic),
// confirmed distinct from bank-feed Bank Transactions AND the AI email
// Document Inbox by reading all three route files. Mirrors the Bank
// Transactions review screen's Categorize/Exclude pattern, with one real
// difference: categorize here needs BOTH a cash_account_id and an
// offset_account_id (no bank_account_id on the row to imply the cash
// side, unlike a bank transaction which already belongs to one account).

export type IntegrationSource = 'stripe_csv' | 'paypal_csv' | 'shopify_csv' | 'generic';
export type IntegrationInboxStatus = 'pending' | 'matched' | 'categorized' | 'excluded';
export type IntegrationInboxRow = {
  id: string; business_id: string; source: IntegrationSource; external_id: string | null;
  occurred_at: string; description: string; amount: string; status: IntegrationInboxStatus;
  matched_journal_entry_id: string | null; excluded_reason: string | null;
  imported_at: string; reviewed_at: string | null; reviewed_by_user_id: string | null;
};

export async function listIntegrationInbox(businessId: string, params: { status?: IntegrationInboxStatus; source?: IntegrationSource } = {}) {
  const r = await api.get<{ integration_inbox: IntegrationInboxRow[] }>(`/businesses/${businessId}/integration-inbox`, { params });
  return r.data.integration_inbox;
}

export async function getIntegrationInboxSuggestion(businessId: string, id: string) {
  const r = await api.get<{ suggestion: BankTransactionSuggestion }>(`/businesses/${businessId}/integration-inbox/${id}/suggestion`);
  return r.data.suggestion;
}

export async function categorizeIntegrationRow(
  businessId: string, id: string, body: { cash_account_id: string; offset_account_id: string; memo?: string | null },
) {
  await api.post(`/businesses/${businessId}/integration-inbox/${id}/categorize`, body);
}

export async function excludeIntegrationRow(businessId: string, id: string, excluded_reason: string) {
  await api.post(`/businesses/${businessId}/integration-inbox/${id}/exclude`, { excluded_reason });
}

// --- Setup group — Entity, Company Settings, Cost Centers, Users,
// Activity Log, Tax Codes, Fiscal Periods. Shapes read directly from
// each route/service/table rather than guessed. Users is deliberately
// read-only (list view only) — invite/deactivate/role-change/password-
// reset/2FA-reset are real but security-sensitive, high-blast-radius
// actions not built on mobile without a deliberate security review first.

export type BusinessAddress = { line1?: string; line2?: string; city?: string; state?: string; postal_code?: string; country?: string };
export type BusinessSettings = {
  id: string; firm_id: string; name: string; legal_name: string | null; tax_id: string | null;
  fiscal_year_start_month: number; address: BusinessAddress | null; phone: string | null; import_email: string | null;
  ai_auto_post_enabled: boolean; staff_entries_need_approval: boolean; capitalization_threshold: string;
  invoice_number_prefix: string; invoice_next_number: string | null;
  default_invoice_terms_days: number; default_bill_terms_days: number;
  default_sales_tax_code_id: string | null; default_expense_payment_method: string;
  created_at: string; updated_at: string;
};

export async function getBusinessSettings(businessId: string) {
  const r = await api.get<BusinessSettings>(`/businesses/${businessId}`);
  return r.data;
}

export type CostCenter = { id: string; business_id: string; name: string; code: string | null; is_active: boolean; created_at: string; updated_at: string };

export async function listCostCenters(businessId: string, params: { include_inactive?: boolean } = {}) {
  const r = await api.get<{ cost_centers: CostCenter[] }>(`/businesses/${businessId}/cost-centers`, {
    params: params.include_inactive ? { include_inactive: 'true' } : undefined,
  });
  return r.data.cost_centers;
}

export async function deleteCostCenter(businessId: string, id: string) {
  await api.delete(`/businesses/${businessId}/cost-centers/${id}`);
}

export type FirmUserRow = {
  id: string; email: string; full_name: string; role: string;
  last_login_at: string | null; created_at: string; deactivated_at: string | null;
  locked: boolean; two_step_enabled: boolean; payroll_access: boolean;
  business_access: Array<{ business_id: string; business_name: string; role_override: string | null }>;
};

export async function listFirmUsers() {
  const r = await api.get<{ users: FirmUserRow[] }>('/me/firm/users');
  return r.data.users;
}

export type ActivityLogRow = {
  id: string; created_at: string; action: string; entity_type: string; entity_id: string;
  user_id: string | null; user_name: string | null; before: unknown; after: unknown;
};

export async function listActivityLog(businessId: string, params: { before?: string; user_id?: string; entity_type?: string } = {}) {
  const r = await api.get<{ rows: ActivityLogRow[]; has_more: boolean; facets?: { users: Array<{ id: string; name: string }>; entity_types: string[] } }>(
    `/businesses/${businessId}/activity-log`, { params },
  );
  return r.data;
}

export type TaxCode = {
  id: string; business_id: string; code: string; name: string; tax_payable_account_id: string;
  is_active: boolean; created_at: string; updated_at: string; current_rate: string | null;
};

export async function listTaxCodes(businessId: string) {
  const r = await api.get<{ tax_codes: TaxCode[] }>(`/businesses/${businessId}/tax-codes`);
  return r.data.tax_codes;
}

export type FiscalPeriodStatus = 'open' | 'closed';
export type FiscalPeriod = {
  id: string; business_id: string; starts_on: string; ends_on: string; status: FiscalPeriodStatus;
  closed_at: string | null; closed_by_user_id: string | null; close_memo: string | null;
  created_at: string; updated_at: string;
};

export async function listFiscalPeriods(businessId: string) {
  const r = await api.get<{ periods: FiscalPeriod[] }>(`/businesses/${businessId}/periods`);
  return r.data.periods;
}

export async function closeFiscalPeriod(businessId: string, id: string, memo?: string) {
  const r = await api.post<FiscalPeriod>(`/businesses/${businessId}/periods/${id}/close`, { memo });
  return r.data;
}

export async function reopenFiscalPeriod(businessId: string, id: string, reason: string) {
  const r = await api.post<FiscalPeriod>(`/businesses/${businessId}/periods/${id}/reopen`, { reason });
  return r.data;
}

export type ReviewTaskStatus = 'todo' | 'in_progress' | 'done';
export type ReviewTaskKey = 'reconcile_bank' | 'post_adjustments' | 'review_unreviewed_txns' | 'close_period';
export type ReviewTask = {
  id: string; business_id: string; period_id: string; task_key: ReviewTaskKey; status: ReviewTaskStatus;
  assignee_user_id: string | null; notes: string | null;
  signed_off_at: string | null; signed_off_by_user_id: string | null;
  created_at: string; updated_at: string;
};

export async function listReviewTasks(businessId: string, periodId: string) {
  const r = await api.get<{ tasks: ReviewTask[] }>(`/businesses/${businessId}/fiscal-periods/${periodId}/review-tasks`);
  return r.data.tasks;
}

export async function updateReviewTask(
  businessId: string, taskId: string,
  patch: { status?: ReviewTaskStatus; notes?: string | null },
) {
  const r = await api.patch<ReviewTask>(`/businesses/${businessId}/review-tasks/${taskId}`, patch);
  return r.data;
}

// --- CSV exports ("Spreadsheet Sync") — these routes return a raw CSV
// file (Content-Type: text/csv, Content-Disposition: attachment), not
// JSON; the filename matches csvExportService.ts's own convention so a
// user who shares/saves it sees the same name web's download would give.

export async function exportTrialBalanceCsv(businessId: string, asOf: string) {
  const r = await api.get<string>(`/businesses/${businessId}/csv-exports/trial-balance`, {
    params: { as_of: asOf }, responseType: 'text',
  });
  return { content: r.data, filename: `trial-balance-${asOf}.csv` };
}

export async function exportJournalEntriesCsv(businessId: string, from: string, to: string) {
  const r = await api.get<string>(`/businesses/${businessId}/csv-exports/journal-entries`, {
    params: { from, to }, responseType: 'text',
  });
  return { content: r.data, filename: `journal-entries-${from}-to-${to}.csv` };
}

export async function exportGeneralLedgerCsv(businessId: string, periodStart: string, periodEnd: string, accountId?: string) {
  const r = await api.get<string>(`/businesses/${businessId}/csv-exports/general-ledger`, {
    params: { period_start: periodStart, period_end: periodEnd, ...(accountId ? { account_id: accountId } : {}) }, responseType: 'text',
  });
  return { content: r.data, filename: `general-ledger-${periodStart}-to-${periodEnd}.csv` };
}
