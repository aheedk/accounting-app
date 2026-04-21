// Action names are dotted strings namespaced by entity. Plans 1.1 and 1.2
// will append their own constants here via subsequent commits — do not split
// this file.
export const AUDIT = {
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGIN_FAILED: 'auth.login_failed',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_REFRESH: 'auth.refresh',

  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_DELETE: 'user.delete',

  BUSINESS_CREATE: 'business.create',
  BUSINESS_UPDATE: 'business.update',

  USER_BUSINESS_ACCESS_GRANT: 'user_business_access.grant',
  USER_BUSINESS_ACCESS_REVOKE: 'user_business_access.revoke',

  // Chart of accounts
  COA_CREATE: 'coa.create',
  COA_UPDATE: 'coa.update',
  COA_DEACTIVATE: 'coa.deactivate',

  // Fiscal periods
  FISCAL_PERIOD_CREATE: 'fiscal_period.create',
  FISCAL_PERIOD_CLOSE: 'fiscal_period.close',
  FISCAL_PERIOD_REOPEN: 'fiscal_period.reopen',
  FISCAL_PERIOD_ADMIN_OVERRIDE_POST: 'fiscal_period.admin_override_post',

  // Journal entries
  JOURNAL_ENTRY_CREATE: 'journal_entry.create',
  JOURNAL_ENTRY_UPDATE: 'journal_entry.update',
  JOURNAL_ENTRY_POST: 'journal_entry.post',
  JOURNAL_ENTRY_VOID: 'journal_entry.void',
  JOURNAL_ENTRY_REVERSE: 'journal_entry.reverse',
} as const;

export type AuditAction = (typeof AUDIT)[keyof typeof AUDIT];
