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

export async function listTransactions(
  businessId: string, params: { limit?: number; type?: string; contact_id?: string } = {},
) {
  const r = await api.get<{ transactions: TransactionRow[]; total: number }>(
    `/businesses/${businessId}/transactions`,
    {
      params: {
        page_size: params.limit ?? 50, sort_key: 'date', sort_dir: 'desc',
        ...(params.type ? { type: params.type } : {}),
        ...(params.contact_id ? { contact_id: params.contact_id } : {}),
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

// --- General Ledger (Phase 1, item 6) — shapes copied from
// generalLedgerService.ts's GeneralLedgerReport/-Account/-Line types and
// chartOfAccounts.ts's /coa route, not guessed.

export type CoaAccount = { id: string; code: string; name: string; account_type: string };

export async function listChartOfAccounts(businessId: string) {
  const r = await api.get<{ accounts: CoaAccount[] }>(`/businesses/${businessId}/coa`);
  return r.data.accounts;
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
