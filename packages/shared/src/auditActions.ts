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

  // Customers
  CUSTOMER_CREATE: 'customer.create',
  CUSTOMER_UPDATE: 'customer.update',
  CUSTOMER_DELETE: 'customer.delete',

  // Tax codes
  TAX_CODE_CREATE: 'tax_code.create',
  TAX_CODE_UPDATE: 'tax_code.update',
  TAX_RATE_ADD: 'tax_rate.add',

  // Invoices
  INVOICE_CREATE: 'invoice.create',
  INVOICE_UPDATE: 'invoice.update',
  INVOICE_ADD_LINE: 'invoice.add_line',
  INVOICE_REMOVE_LINE: 'invoice.remove_line',
  INVOICE_POST: 'invoice.post',
  INVOICE_VOID: 'invoice.void',

  // Payments
  PAYMENT_CREATE: 'payment.create',
  PAYMENT_UPDATE: 'payment.update',
  PAYMENT_POST: 'payment.post',
  PAYMENT_VOID: 'payment.void',
  PAYMENT_APPLY: 'payment.apply',
  PAYMENT_UNAPPLY: 'payment.unapply',

  // Credit memos
  CREDIT_MEMO_CREATE: 'credit_memo.create',
  CREDIT_MEMO_UPDATE: 'credit_memo.update',
  CREDIT_MEMO_POST: 'credit_memo.post',
  CREDIT_MEMO_VOID: 'credit_memo.void',
  CREDIT_MEMO_APPLY: 'credit_memo.apply',
  CREDIT_MEMO_UNAPPLY: 'credit_memo.unapply',

  // Vendors
  VENDOR_CREATE: 'vendor.create',
  VENDOR_UPDATE: 'vendor.update',
  VENDOR_DELETE: 'vendor.delete',

  // Bills
  BILL_CREATE: 'bill.create',
  BILL_UPDATE: 'bill.update',
  BILL_ADD_LINE: 'bill.add_line',
  BILL_REMOVE_LINE: 'bill.remove_line',
  BILL_POST: 'bill.post',
  BILL_VOID: 'bill.void',

  // Bill payments
  BILL_PAYMENT_CREATE: 'bill_payment.create',
  BILL_PAYMENT_POST: 'bill_payment.post',
  BILL_PAYMENT_VOID: 'bill_payment.void',
  BILL_PAYMENT_APPLY: 'bill_payment.apply',
  BILL_PAYMENT_UNAPPLY: 'bill_payment.unapply',

  // Vendor credits
  VENDOR_CREDIT_CREATE: 'vendor_credit.create',
  VENDOR_CREDIT_POST: 'vendor_credit.post',
  VENDOR_CREDIT_APPLY: 'vendor_credit.apply',
  VENDOR_CREDIT_VOID: 'vendor_credit.void',

  // Banking
  BANK_ACCOUNT_CREATE: 'bank_account.create',
  BANK_ACCOUNT_UPDATE: 'bank_account.update',
  BANK_TRANSACTION_IMPORT: 'bank_transaction.import',
  BANK_TRANSACTION_MATCH: 'bank_transaction.match',
  BANK_TRANSACTION_CATEGORIZE: 'bank_transaction.categorize',
  BANK_TRANSACTION_EXCLUDE: 'bank_transaction.exclude',
  BANK_TRANSACTION_UNREVIEW: 'bank_transaction.unreview',
  RECONCILIATION_CREATE: 'reconciliation.create',
  RECONCILIATION_DELETE: 'reconciliation.delete',
} as const;

export type AuditAction = (typeof AUDIT)[keyof typeof AUDIT];
