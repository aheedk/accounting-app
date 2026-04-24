import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, string | Date, string | Date>;

export type UserRole = 'firm_admin' | 'accountant' | 'staff' | 'client';

export interface FirmsTable {
  id: Generated<string>;
  name: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface BusinessAddress {
  line1?: string | undefined;
  line2?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  postal_code?: string | undefined;
  country?: string | undefined;
}

export interface BusinessesTable {
  id: Generated<string>;
  firm_id: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  fiscal_year_start_month: Generated<number>;
  address: ColumnType<BusinessAddress | null, string | null, string | null>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface UsersTable {
  id: Generated<string>;
  firm_id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: UserRole;
  last_login_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface UserBusinessAccessTable {
  id: Generated<string>;
  user_id: string;
  business_id: string;
  role_override: UserRole | null;
  created_at: Generated<Timestamp>;
}

export interface RefreshTokensTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  last_used_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export interface AuditLogsTable {
  id: Generated<string>;
  firm_id: string;
  business_id: string | null;
  user_id: string | null;
  request_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_state: unknown | null;
  after_state: unknown | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Generated<Timestamp>;
}

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type FiscalPeriodStatus = 'open' | 'closed';
export type JournalEntryStatus = 'draft' | 'posted' | 'voided';
export type JournalEntrySourceType =
  | 'manual' | 'invoice' | 'payment' | 'credit_memo'
  | 'bill' | 'bill_payment' | 'vendor_credit'
  | 'reversal' | 'adjustment';

export interface ChartOfAccountsTable {
  id: Generated<string>;
  business_id: string;
  code: string;
  name: string;
  account_type: AccountType;
  parent_id: string | null;
  is_system: Generated<boolean>;
  is_active: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface FiscalPeriodsTable {
  id: Generated<string>;
  business_id: string;
  starts_on: ColumnType<string, string, string>;
  ends_on: ColumnType<string, string, string>;
  status: Generated<FiscalPeriodStatus>;
  closed_at: Timestamp | null;
  closed_by_user_id: string | null;
  close_memo: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface JournalEntriesTable {
  id: Generated<string>;
  business_id: string;
  period_id: string;
  entry_date: ColumnType<string, string, string>;
  memo: string | null;
  reference: string | null;
  status: Generated<JournalEntryStatus>;
  source_type: Generated<JournalEntrySourceType>;
  source_id: string | null;
  reversed_entry_id: string | null;
  posted_at: Timestamp | null;
  posted_by_user_id: string | null;
  voided_at: Timestamp | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  created_at: Generated<Timestamp>;
  created_by_user_id: string | null;
  updated_at: Generated<Timestamp>;
}

export interface JournalEntryLinesTable {
  id: Generated<string>;
  journal_entry_id: string;
  line_number: number;
  account_id: string;
  // Money columns are STRINGS on the JS side (we configured pg to parse
  // numeric as string). Operations go through decimal.js helpers.
  debit: ColumnType<string, string | number, string | number>;
  credit: ColumnType<string, string | number, string | number>;
  memo: string | null;
}

export type InvoiceStatus = 'draft' | 'posted' | 'voided' | 'paid';
export type PaymentStatus = 'draft' | 'posted' | 'voided';
export type PaymentMethod = 'cash' | 'check' | 'ach' | 'wire' | 'card' | 'other';
export type CreditMemoStatus = 'draft' | 'posted' | 'voided' | 'applied';

export interface CustomersTable {
  id: Generated<string>;
  business_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  billing_address: unknown | null;
  default_terms_days: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface TaxCodesTable {
  id: Generated<string>;
  business_id: string;
  code: string;
  name: string;
  tax_payable_account_id: string;
  is_active: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface TaxRatesTable {
  id: Generated<string>;
  tax_code_id: string;
  rate: ColumnType<string, string | number, string | number>;
  effective_from: ColumnType<string, string, string>;
  effective_to: ColumnType<string, string, string> | null;
  created_at: Generated<Timestamp>;
}

export interface InvoicesTable {
  id: Generated<string>;
  business_id: string;
  customer_id: string;
  invoice_number: string;
  issue_date: ColumnType<string, string, string>;
  due_date: ColumnType<string, string, string>;
  status: Generated<InvoiceStatus>;
  subtotal: ColumnType<string, string | number | undefined, string | number>;
  tax_total: ColumnType<string, string | number | undefined, string | number>;
  total: ColumnType<string, string | number | undefined, string | number>;
  ar_account_id: string;
  posted_journal_entry_id: string | null;
  memo: string | null;
  terms: string | null;
  posted_at: Timestamp | null;
  posted_by_user_id: string | null;
  voided_at: Timestamp | null;
  voided_by_user_id: string | null;
  created_at: Generated<Timestamp>;
  created_by_user_id: string | null;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface InvoiceLinesTable {
  id: Generated<string>;
  invoice_id: string;
  line_number: number;
  description: string;
  quantity: ColumnType<string, string | number, string | number>;
  unit_price: ColumnType<string, string | number, string | number>;
  revenue_account_id: string;
  tax_code_id: string | null;
  line_subtotal: ColumnType<string, string | number, string | number>;
  tax_amount: ColumnType<string, string | number | undefined, string | number>;
  line_total: ColumnType<string, string | number, string | number>;
}

export interface PaymentsTable {
  id: Generated<string>;
  business_id: string;
  customer_id: string;
  payment_date: ColumnType<string, string, string>;
  payment_method: PaymentMethod;
  reference: string | null;
  amount: ColumnType<string, string | number, string | number>;
  unapplied_amount: ColumnType<string, string | number, string | number>;
  cash_account_id: string;
  status: Generated<PaymentStatus>;
  posted_journal_entry_id: string | null;
  memo: string | null;
  posted_at: Timestamp | null;
  posted_by_user_id: string | null;
  voided_at: Timestamp | null;
  voided_by_user_id: string | null;
  created_at: Generated<Timestamp>;
  created_by_user_id: string | null;
  updated_at: Generated<Timestamp>;
}

export interface PaymentApplicationsTable {
  id: Generated<string>;
  payment_id: string | null;
  credit_memo_id: string | null;
  invoice_id: string;
  applied_amount: ColumnType<string, string | number, string | number>;
  applied_at: Generated<Timestamp>;
  applied_by_user_id: string | null;
}

export interface CreditMemosTable {
  id: Generated<string>;
  business_id: string;
  customer_id: string;
  memo_date: ColumnType<string, string, string>;
  status: Generated<CreditMemoStatus>;
  amount: ColumnType<string, string | number, string | number>;
  remaining_amount: ColumnType<string, string | number, string | number>;
  source_payment_id: string | null;
  ar_account_id: string;
  revenue_account_id: string;
  posted_journal_entry_id: string | null;
  memo: string | null;
  posted_at: Timestamp | null;
  posted_by_user_id: string | null;
  voided_at: Timestamp | null;
  voided_by_user_id: string | null;
  created_at: Generated<Timestamp>;
  created_by_user_id: string | null;
  updated_at: Generated<Timestamp>;
}

export type BillStatus = 'draft' | 'posted' | 'paid' | 'voided';
export type BillPaymentStatus = 'draft' | 'posted' | 'voided';
export type VendorCreditStatus = 'draft' | 'posted' | 'applied' | 'voided';

export interface VendorsTable {
  id: Generated<string>;
  business_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  billing_address: ColumnType<unknown, unknown, unknown> | null;
  tax_id_encrypted: Buffer | null;
  tax_id_last_four: string | null;
  tax_id_type: 'SSN' | 'EIN' | null;
  is_1099: Generated<boolean>;
  default_terms_days: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export type ExpenseTransactionStatus = 'draft' | 'posted' | 'void';

export interface ExpenseTransactionsTable {
  id: Generated<string>;
  business_id: string;
  transaction_date: ColumnType<string, string, string>;
  payee_text: string | null;
  vendor_id: string | null;
  expense_account_id: string;
  payment_account_id: string;
  amount: ColumnType<string, string | number, string | number>;
  memo: string | null;
  status: Generated<ExpenseTransactionStatus>;
  journal_entry_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  created_by_user_id: string | null;
  posted_at: Timestamp | null;
  posted_by_user_id: string | null;
  voided_at: Timestamp | null;
  voided_by_user_id: string | null;
}

export type PeriodReviewTaskKey = 'reconcile_bank' | 'post_adjustments' | 'review_unreviewed_txns' | 'close_period';
export type PeriodReviewTaskStatus = 'todo' | 'in_progress' | 'done';

export interface PeriodReviewTasksTable {
  id: Generated<string>;
  business_id: string;
  period_id: string;
  task_key: PeriodReviewTaskKey;
  status: Generated<PeriodReviewTaskStatus>;
  assignee_user_id: string | null;
  notes: string | null;
  signed_off_at: Timestamp | null;
  signed_off_by_user_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export type RecurringTemplateType = 'journal_entry' | 'invoice' | 'bill';
export type RecurringTemplateRecurrence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurringTemplatesTable {
  id: Generated<string>;
  business_id: string;
  name: string;
  template_type: RecurringTemplateType;
  payload: ColumnType<unknown, unknown, unknown>;
  recurrence: RecurringTemplateRecurrence;
  next_run_date: ColumnType<string, string, string>;
  end_date: ColumnType<string, string, string> | null;
  last_run_at: Timestamp | null;
  is_active: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  created_by_user_id: string | null;
}

export interface BillsTable {
  id: Generated<string>;
  business_id: string;
  vendor_id: string;
  bill_number: string;
  bill_date: ColumnType<string, string, string>;
  due_date: ColumnType<string, string, string>;
  status: Generated<BillStatus>;
  subtotal: ColumnType<string, string | number | undefined, string | number>;
  total: ColumnType<string, string | number | undefined, string | number>;
  ap_account_id: string;
  posted_journal_entry_id: string | null;
  memo: string | null;
  terms: string | null;
  posted_at: Timestamp | null;
  posted_by_user_id: string | null;
  voided_at: Timestamp | null;
  voided_by_user_id: string | null;
  created_at: Generated<Timestamp>;
  created_by_user_id: string | null;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface BillLinesTable {
  id: Generated<string>;
  bill_id: string;
  line_number: number;
  description: string;
  quantity: ColumnType<string, string | number, string | number>;
  unit_price: ColumnType<string, string | number, string | number>;
  expense_account_id: string;
  line_subtotal: ColumnType<string, string | number, string | number>;
}

export interface BillPaymentsTable {
  id: Generated<string>;
  business_id: string;
  vendor_id: string;
  payment_date: ColumnType<string, string, string>;
  payment_method: PaymentMethod;
  reference: string | null;
  amount: ColumnType<string, string | number, string | number>;
  unapplied_amount: ColumnType<string, string | number | undefined, string | number>;
  cash_account_id: string;
  status: Generated<BillPaymentStatus>;
  posted_journal_entry_id: string | null;
  memo: string | null;
  posted_at: Timestamp | null;
  posted_by_user_id: string | null;
  voided_at: Timestamp | null;
  voided_by_user_id: string | null;
  created_at: Generated<Timestamp>;
  created_by_user_id: string | null;
  updated_at: Generated<Timestamp>;
}

export interface BillPaymentApplicationsTable {
  id: Generated<string>;
  bill_payment_id: string | null;
  vendor_credit_id: string | null;
  bill_id: string;
  applied_amount: ColumnType<string, string | number, string | number>;
  applied_at: Generated<Timestamp>;
  applied_by_user_id: string | null;
}

export interface VendorCreditsTable {
  id: Generated<string>;
  business_id: string;
  vendor_id: string;
  credit_date: ColumnType<string, string, string>;
  amount: ColumnType<string, string | number, string | number>;
  remaining_amount: ColumnType<string, string | number, string | number>;
  offset_account_id: string;
  ap_account_id: string;
  status: Generated<VendorCreditStatus>;
  posted_journal_entry_id: string | null;
  memo: string | null;
  posted_at: Timestamp | null;
  posted_by_user_id: string | null;
  voided_at: Timestamp | null;
  voided_by_user_id: string | null;
  created_at: Generated<Timestamp>;
  created_by_user_id: string | null;
  updated_at: Generated<Timestamp>;
}

export type BankTransactionStatus = 'unreviewed' | 'matched' | 'categorized' | 'excluded';

export interface BankAccountsTable {
  id: Generated<string>;
  business_id: string;
  name: string;
  institution: string | null;
  account_last_four: string | null;
  cash_account_id: string;
  is_active: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface BankTransactionsTable {
  id: Generated<string>;
  business_id: string;
  bank_account_id: string;
  transaction_date: ColumnType<string, string, string>;
  description: string;
  amount: ColumnType<string, string | number, string | number>;
  external_id: string | null;
  status: Generated<BankTransactionStatus>;
  matched_journal_entry_id: string | null;
  excluded_reason: string | null;
  is_reconciled: Generated<boolean>;
  reconciliation_id: string | null;
  imported_at: Generated<Timestamp>;
  reviewed_at: Timestamp | null;
  reviewed_by_user_id: string | null;
}

export interface BankReconciliationsTable {
  id: Generated<string>;
  business_id: string;
  bank_account_id: string;
  period_start: ColumnType<string, string, string>;
  period_end: ColumnType<string, string, string>;
  statement_ending_balance: ColumnType<string, string | number, string | number>;
  reconciled_at: Generated<Timestamp>;
  reconciled_by_user_id: string | null;
  memo: string | null;
}

export type BankRuleSignFilter = 'any' | 'inflow_only' | 'outflow_only';
export type FixedAssetStatus = 'active' | 'disposed';
export type DepreciationMethod = 'straight_line';

export interface BankTransactionRulesTable {
  id: Generated<string>;
  business_id: string;
  name: string;
  description_contains: string;
  min_amount: ColumnType<string | null, string | number | null | undefined, string | number | null>;
  max_amount: ColumnType<string | null, string | number | null | undefined, string | number | null>;
  sign_filter: Generated<BankRuleSignFilter>;
  offset_account_id: string;
  priority: Generated<number>;
  is_active: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface FixedAssetsTable {
  id: Generated<string>;
  business_id: string;
  name: string;
  asset_account_id: string;
  depreciation_expense_account_id: string;
  accumulated_depreciation_account_id: string;
  purchase_date: ColumnType<string, string, string>;
  cost: ColumnType<string, string | number, string | number>;
  salvage_value: ColumnType<string, string | number | undefined, string | number>;
  useful_life_years: number;
  depreciation_method: Generated<DepreciationMethod>;
  status: Generated<FixedAssetStatus>;
  memo: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface CostCentersTable {
  id: Generated<string>;
  business_id: string;
  name: string;
  code: string | null;
  is_active: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export type StockMovementReason =
  | 'adjustment'
  | 'opening_balance'
  | 'manual_in'
  | 'manual_out'
  | 'write_off';

export interface InventoryItemsTable {
  id: Generated<string>;
  business_id: string;
  sku: string;
  name: string;
  description: string | null;
  unit_of_measure: Generated<string>;
  purchase_cost: ColumnType<string | null, string | number | null | undefined, string | number | null>;
  sale_price: ColumnType<string | null, string | number | null | undefined, string | number | null>;
  income_account_id: string | null;
  expense_account_id: string | null;
  inventory_asset_account_id: string | null;
  is_active: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
}

export interface StockMovementsTable {
  id: Generated<string>;
  inventory_item_id: string;
  movement_date: ColumnType<string, string, string>;
  quantity_delta: ColumnType<string, string | number, string | number>;
  reason: StockMovementReason;
  memo: string | null;
  posted_by_user_id: string | null;
  created_at: Generated<Timestamp>;
}

export interface DepreciationEntriesTable {
  id: Generated<string>;
  fixed_asset_id: string;
  period_end: ColumnType<string, string, string>;
  amount: ColumnType<string, string | number, string | number>;
  journal_entry_id: string;
  posted_at: Generated<Timestamp>;
  posted_by_user_id: string | null;
}

export interface DB {
  firms: FirmsTable;
  businesses: BusinessesTable;
  users: UsersTable;
  user_business_access: UserBusinessAccessTable;
  refresh_tokens: RefreshTokensTable;
  audit_logs: AuditLogsTable;
  chart_of_accounts: ChartOfAccountsTable;
  fiscal_periods: FiscalPeriodsTable;
  journal_entries: JournalEntriesTable;
  journal_entry_lines: JournalEntryLinesTable;
  customers: CustomersTable;
  tax_codes: TaxCodesTable;
  tax_rates: TaxRatesTable;
  invoices: InvoicesTable;
  invoice_lines: InvoiceLinesTable;
  payments: PaymentsTable;
  payment_applications: PaymentApplicationsTable;
  credit_memos: CreditMemosTable;
  vendors: VendorsTable;
  bills: BillsTable;
  bill_lines: BillLinesTable;
  bill_payments: BillPaymentsTable;
  bill_payment_applications: BillPaymentApplicationsTable;
  vendor_credits: VendorCreditsTable;
  bank_accounts: BankAccountsTable;
  bank_transactions: BankTransactionsTable;
  bank_reconciliations: BankReconciliationsTable;
  bank_transaction_rules: BankTransactionRulesTable;
  fixed_assets: FixedAssetsTable;
  depreciation_entries: DepreciationEntriesTable;
  cost_centers: CostCentersTable;
  inventory_items: InventoryItemsTable;
  stock_movements: StockMovementsTable;
  expense_transactions: ExpenseTransactionsTable;
  period_review_tasks: PeriodReviewTasksTable;
  recurring_templates: RecurringTemplatesTable;
}
