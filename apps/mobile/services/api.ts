import { api } from './apiClient';
import type { ConfidenceBand, CodingLayerId } from '@accounting/shared';

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

export type CustomerDetail = {
  id: string; name: string; company_name: string | null; email: string | null;
  phone: string | null; mobile: string | null; is_active: boolean;
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

// --- General Ledger (Phase 1, item 6) — shapes copied from
// generalLedgerService.ts's GeneralLedgerReport/-Account/-Line types and
// chartOfAccounts.ts's /coa route, not guessed.

export type CoaAccount = {
  id: string; code: string; name: string; account_type: string; detail_type: string | null;
};

export async function listChartOfAccounts(businessId: string) {
  const r = await api.get<{ accounts: CoaAccount[] }>(`/businesses/${businessId}/coa`);
  return r.data.accounts;
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
