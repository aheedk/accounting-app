import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, string | Date, string | Date>;

export type UserRole = 'firm_admin' | 'accountant' | 'staff' | 'client';

export interface FirmsTable {
  id: Generated<string>;
  name: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface BusinessesTable {
  id: Generated<string>;
  firm_id: string;
  name: string;
  legal_name: string | null;
  fiscal_year_start_month: Generated<number>;
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
  | 'manual' | 'invoice' | 'payment' | 'credit_memo' | 'reversal' | 'adjustment';

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
}
