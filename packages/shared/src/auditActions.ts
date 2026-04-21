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
} as const;

export type AuditAction = (typeof AUDIT)[keyof typeof AUDIT];
