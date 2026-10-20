import { api } from './apiClient';

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

export async function listTransactions(businessId: string, params: { limit?: number; type?: string } = {}) {
  const r = await api.get<{ transactions: TransactionRow[]; total: number }>(
    `/businesses/${businessId}/transactions`,
    { params: { page_size: params.limit ?? 50, sort_key: 'date', sort_dir: 'desc', ...(params.type ? { type: params.type } : {}) } },
  );
  return r.data;
}

export type InvoiceRow = {
  id: string; invoice_number: string; customer_id: string; issue_date: string;
  due_date: string; status: string; total: string;
};

export async function listInvoices(businessId: string) {
  const r = await api.get<{ invoices: InvoiceRow[] }>(`/businesses/${businessId}/invoices`, { params: { status: 'posted', limit: 500 } });
  return r.data.invoices;
}

export type InboxRow = { id: string; status: string; source: string; created_at: string };

export async function listPendingInbox(businessId: string) {
  const r = await api.get<{ integration_inbox: InboxRow[] }>(`/businesses/${businessId}/integration-inbox`, { params: { status: 'pending' } });
  return r.data.integration_inbox;
}

// --- Transaction detail — the 4 types Phase 1 scopes for mobile viewing.
// Shapes mirror each service's own getX() return value (bankDepositService,
// expenseTransactionService, checkService, journalEntryQueryService) —
// field names copied from the route handlers, not guessed.

export type DepositDetail = {
  id: string; deposit_date: string; deposit_number: string | null; memo: string | null;
  total_amount: string; bank_account_name: string; editable: boolean; imported: boolean;
  is_reconciled: boolean; voided_at: string | null;
  lines: Array<{
    id: string; line_type: string; received_from: string | null; description: string | null;
    payment_method: string | null; ref_no: string | null; amount: string;
    account_name: string | null; account_code: string | null;
  }>;
};
export async function getDeposit(businessId: string, id: string) {
  const r = await api.get<DepositDetail>(`/businesses/${businessId}/bank-deposits/${id}`);
  return r.data;
}

export type ExpenseDetail = {
  id: string; transaction_date: string; payee_text: string | null; payee_name: string | null;
  vendor_name: string | null; customer_name: string | null; payment_account_name: string;
  payment_method: string; reference: string | null; memo: string | null; total_amount: string;
  status: string; editable: boolean; imported: boolean; is_reconciled: boolean;
  lines: Array<{ id: string; category_name: string; category_code: string; description: string | null; amount: string }>;
};
export async function getExpense(businessId: string, id: string) {
  const r = await api.get<ExpenseDetail>(`/businesses/${businessId}/expense-transactions/${id}`);
  return r.data;
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
