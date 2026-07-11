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

  // Bank rules
  BANK_RULE_CREATE: 'bank_rule.create',
  BANK_RULE_UPDATE: 'bank_rule.update',
  BANK_RULE_DELETE: 'bank_rule.delete',
  BANK_RULE_APPLY: 'bank_rule.apply',

  // Fixed assets
  FIXED_ASSET_CREATE: 'fixed_asset.create',
  FIXED_ASSET_UPDATE: 'fixed_asset.update',
  FIXED_ASSET_DEPRECIATE: 'fixed_asset.depreciate',

  // Cost centers
  COST_CENTER_CREATE: 'cost_center.create',
  COST_CENTER_UPDATE: 'cost_center.update',
  COST_CENTER_DELETE: 'cost_center.delete',

  // Inventory
  INVENTORY_ITEM_CREATE: 'inventory_item.create',
  INVENTORY_ITEM_UPDATE: 'inventory_item.update',
  INVENTORY_ITEM_DELETE: 'inventory_item.delete',
  STOCK_MOVEMENT_CREATE: 'stock_movement.create',

  // Slice 8 — AP polish
  EXPENSE_TRANSACTION_CREATE: 'expense_transaction.create',
  EXPENSE_TRANSACTION_UPDATE: 'expense_transaction.update',
  EXPENSE_TRANSACTION_POST: 'expense_transaction.post',
  EXPENSE_TRANSACTION_VOID: 'expense_transaction.void',
  VENDOR_TAX_ID_REVEAL: 'vendor.tax_id_reveal',

  // Slice 9 — Period review tasks
  PERIOD_REVIEW_TASK_UPDATE: 'period_review_task.update',
  PERIOD_REVIEW_TASK_SIGN_OFF: 'period_review_task.sign_off',

  // Slice 9 — Recurring templates
  RECURRING_TEMPLATE_CREATE: 'recurring_template.create',
  RECURRING_TEMPLATE_UPDATE: 'recurring_template.update',
  RECURRING_TEMPLATE_DELETE: 'recurring_template.delete',
  RECURRING_TEMPLATE_RUN: 'recurring_template.run',

  // Slice 10 — Files
  FILE_UPLOAD: 'file.upload',

  // Slice 10 — Receipts
  RECEIPT_CREATE: 'receipt.create',
  RECEIPT_LINK: 'receipt.link',
  RECEIPT_UNLINK: 'receipt.unlink',

  // Slice 10 — Integration inbox
  INTEGRATION_INBOX_IMPORT: 'integration_inbox.import',
  INTEGRATION_INBOX_MATCH: 'integration_inbox.match',
  INTEGRATION_INBOX_CATEGORIZE: 'integration_inbox.categorize',
  INTEGRATION_INBOX_EXCLUDE: 'integration_inbox.exclude',

  // Slice 11 — Inventory workflow
  PURCHASE_ORDER_CREATE: 'purchase_order.create',
  PURCHASE_ORDER_UPDATE: 'purchase_order.update',
  PURCHASE_ORDER_VOID: 'purchase_order.void',
  ITEM_RECEIPT_CREATE: 'item_receipt.create',
  SALES_ORDER_CREATE: 'sales_order.create',
  SALES_ORDER_UPDATE: 'sales_order.update',
  SALES_ORDER_FULFILL: 'sales_order.fulfill',
  SALES_ORDER_VOID: 'sales_order.void',
  SHIPPING_LABEL_CREATE: 'shipping_label.create',
  SHIPPING_LABEL_UPDATE: 'shipping_label.update',
  SHIPPING_LABEL_DELETE: 'shipping_label.delete',

  // Slice 12 — Reports polish
  CUSTOM_REPORT_CREATE: 'custom_report.create',
  CUSTOM_REPORT_UPDATE: 'custom_report.update',
  CUSTOM_REPORT_DELETE: 'custom_report.delete',
  BUDGET_CREATE: 'budget.create',
  BUDGET_UPDATE: 'budget.update',
  BUDGET_DELETE: 'budget.delete',
  CSV_EXPORT: 'csv.export',

  // Slice 13 — Payroll
  EMPLOYEE_CREATE: 'employee.create',
  EMPLOYEE_UPDATE: 'employee.update',
  EMPLOYEE_DELETE: 'employee.delete',
  EMPLOYEE_SSN_REVEAL: 'employee.ssn_reveal',
  PAY_RUN_CREATE: 'pay_run.create',
  PAY_RUN_UPDATE: 'pay_run.update',
  PAY_RUN_FINALIZE: 'pay_run.finalize',
  PAY_RUN_VOID: 'pay_run.void',
  PAYROLL_TAX_RECORD: 'payroll_tax.record',
  PAYROLL_TAX_PAY: 'payroll_tax.pay',
  COMPLIANCE_ITEM_UPDATE: 'compliance_item.update',

  // Banking import batches
  BANK_IMPORT_UNDO: 'bank_import.undo',
} as const;

export type AuditAction = (typeof AUDIT)[keyof typeof AUDIT];
