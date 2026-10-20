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
