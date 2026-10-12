// What each page is called: on the browser tab, and as the default name of a
// bookmark. A new page only needs a line here when its address does not already
// read well ("/reports/trial-balance" becomes "Trial Balance" on its own).

export const PAGE_NAMES: Record<string, string> = {
  '/': 'Dashboard',
  '/account': 'My Account',
  '/messages': 'Messages',
  '/documents/send': 'Send Documents',
  '/customers': 'Customers',
  '/invoices': 'Invoices',
  '/payments': 'Payments',
  '/credit-memos': 'Credit Memos',
  '/reports/aging': 'AR Aging',
  '/reports/ap-aging': 'AP Aging',
  '/reports/customer-statement': 'Statements',
  '/ap/overview': 'AP Overview',
  '/accounting/transactions': 'Transactions',
  '/accounting/expense-transactions': 'Expense Transactions',
  '/accounting/checks': 'Checks',
  '/accounting/bank-deposits': 'Bank Deposits',
  '/ap/vendors': 'Vendors',
  '/ap/bills': 'Bills',
  '/ap/pay-bills': 'Pay Bills',
  '/ap/bill-payments': 'Bill Payments',
  '/ap/vendor-credits': 'Vendor Credits',
  '/ap/contractors': 'Contractors',
  '/reports/1099': '1099s',
  '/ai/inbox': 'Document Inbox',
  '/ai/coding-rules': 'Coding Rules',
  '/ai/suspense': 'Suspense',
  '/accounting/client-overview': 'Client Overview',
  '/accounting/books-review': 'Books Review',
  '/accounting/approvals': 'Approvals',
  '/accounting/bank-accounts': 'Bank Accounts',
  '/accounting/bank-transactions': 'Bank Transactions',
  '/accounting/bank-transactions/import': 'Import Bank Transactions',
  '/accounting/email-imports': 'Email Import Review',
  '/accounting/invoice-imports': 'Email Import Review',
  '/accounting/integrations': 'Integration Transactions',
  '/accounting/receipts': 'Receipts',
  '/accounting/reconcile': 'Reconcile',
  '/accounting/reconcile/history': 'Reconciliation History',
  '/accounting/rules': 'Bank Rules',
  '/settings/coa': 'Chart of Accounts',
  '/accounting/recurring': 'Recurring Transactions',
  '/accounting/fixed-assets': 'Fixed Assets',
  '/journal': 'New Journal Entry',
  '/reports/standard': 'Reports',
  '/reports/pnl': 'Profit & Loss',
  '/reports/balance-sheet': 'Balance Sheet',
  '/reports/general-ledger': 'General Ledger',
  '/reports/statement-of-cash-flows': 'Statement of Cash Flows',
  '/reports/cash-flow': 'Cash Activity',
  '/reports/custom': 'Custom Reports',
  '/reports/management': 'Management Reports',
  '/reports/performance': 'Performance Center',
  '/reports/financial-planning': 'Financial Planning',
  '/reports/spreadsheet-sync': 'Spreadsheet Sync',
  '/reports/trial-balance': 'Trial Balance',
  '/payroll/overview': 'Payroll Overview',
  '/payroll/pay-runs': 'Pay Runs',
  '/payroll/employees': 'Employees',
  '/payroll/contractors': 'Payroll Contractors',
  '/payroll/taxes': 'Payroll Taxes',
  '/payroll/compliance': 'Compliance',
  '/inventory/overview': 'Inventory Overview',
  '/inventory/items': 'Inventory Items',
  '/inventory/purchase-orders': 'Purchase Orders',
  '/inventory/item-receipts': 'Item Receipts',
  '/inventory/sales-orders': 'Sales Orders',
  '/inventory/shipping-labels': 'Shipping Labels',
  '/clients/new': 'Add Client',
  '/setup/entity': 'Entity',
  '/setup/coa': 'Chart of Accounts Setup',
  '/setup/cost-centers': 'Cost Centers',
  '/setup/users': 'Users',
  '/setup/activity': 'Activity Log',
  '/settings/tax-codes': 'Tax Codes',
  '/settings/periods': 'Fiscal Periods',
};

// One record of a list: "/invoices/new" is "New Invoice", "/invoices/<id>" is "Invoice".
const RECORD_NAMES: Record<string, string> = {
  '/customers': 'Customer',
  '/invoices': 'Invoice',
  '/payments': 'Payment',
  '/credit-memos': 'Credit Memo',
  '/journal': 'Journal Entry',
  '/transactions': 'Transaction',
  '/ap/vendors': 'Vendor',
  '/ap/bills': 'Bill',
  '/ap/bill-payments': 'Bill Payment',
  '/ap/vendor-credits': 'Vendor Credit',
  '/accounting/bank-deposits': 'Bank Deposit',
  '/accounting/transfers': 'Transfer',
  '/accounting/expenses': 'Expense',
  '/accounting/checks': 'Check',
  '/accounting/reconcile': 'Reconciliation',
  '/accounting/fixed-assets': 'Fixed Asset',
  '/payroll/pay-runs': 'Pay Run',
  '/payroll/employees': 'Employee',
  '/inventory/items': 'Inventory Item',
  '/inventory/purchase-orders': 'Purchase Order',
  '/inventory/item-receipts': 'Item Receipt',
  '/inventory/sales-orders': 'Sales Order',
  '/inventory/shipping-labels': 'Shipping Label',
};

function titleCase(slug: string): string {
  return slug.split('-').filter(Boolean).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/** The name of the page at this address, or null when nothing sensible can be said. */
export function pageName(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const exact = PAGE_NAMES[path];
  if (exact) return exact;
  if (/\/register$/.test(path)) return 'Account Register';

  const cut = path.lastIndexOf('/');
  const parent = path.slice(0, cut);
  const last = path.slice(cut + 1);
  const record = RECORD_NAMES[parent];
  if (record) return last === 'new' ? `New ${record}` : record;

  // An address made of words reads as a name; one ending in an id does not.
  if (last && /^[a-z]+(-[a-z]+)*$/.test(last)) return titleCase(last);
  return null;
}

/** What the browser tab says: the page first, so it survives a narrow tab. */
export function documentTitle(pathname: string, company: string): string {
  return [pageName(pathname), company || 'Accounting App'].filter(Boolean).join(' - ');
}
