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

export interface DB {
  firms: FirmsTable;
  businesses: BusinessesTable;
  users: UsersTable;
  user_business_access: UserBusinessAccessTable;
  refresh_tokens: RefreshTokensTable;
  audit_logs: AuditLogsTable;
  // 1.1 and 1.2 will extend DB in later tasks by augmenting this interface
  // via module augmentation. Keep this interface open to extension.
}
