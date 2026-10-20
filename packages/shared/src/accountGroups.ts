// The account types and detail types an account can have, as QuickBooks lays
// them out. An account stores its base type (asset, liability, equity, revenue,
// expense) and its detail type; the account type in between ("Bank", "Fixed
// Assets", "Long Term Liabilities") is worked out from the detail type here.
// The Chart of Accounts, the add-account form and the Balance Sheet all read
// this one list.

export const ACCOUNT_TYPE_GROUPS = [
  {
    heading: 'ASSET',
    accountType: 'asset',
    items: ['Bank', 'Accounts receivable (A/R)', 'Other Current Assets', 'Fixed Assets', 'Other Assets'],
  },
  {
    heading: 'LIABILITY',
    accountType: 'liability',
    items: ['Credit Card', 'Accounts payable (A/P)', 'Other Current Liabilities', 'Long Term Liabilities'],
  },
  { heading: 'EQUITY', accountType: 'equity', items: ['Equity'] },
  { heading: 'INCOME', accountType: 'revenue', items: ['Income', 'Other Income'] },
  { heading: 'EXPENSE', accountType: 'expense', items: ['Cost of Goods Sold', 'Expenses', 'Other Expense'] },
] as const;

export type BaseAccountType = typeof ACCOUNT_TYPE_GROUPS[number]['accountType'];
/** The QuickBooks account type, e.g. "Bank" or "Other Current Liabilities". */
export type AccountGroup = typeof ACCOUNT_TYPE_GROUPS[number]['items'][number];

export const DETAIL_TYPES: Record<AccountGroup, string[]> = {
  'Bank': ['Cash on hand', 'Checking', 'Money Market', 'Rents Held in Trust', 'Savings', 'Trust account'],
  'Accounts receivable (A/R)': ['Accounts receivable (A/R)'],
  'Other Current Assets': ['Allowance for Bad Debts', 'Development Costs', 'Employee Cash Advances', 'Inventory', 'Investment - Mortgage/Real Estate Loans', 'Investment - Tax-Exempt Securities', 'Investment - U.S. Government Obligations', 'Investments - Other', 'Loans To Officers', 'Loans to Others', 'Loans to Stockholders', 'Other Current Assets', 'Prepaid Expenses', 'Retainage', 'Undeposited Funds'],
  'Fixed Assets': ['Accumulated Amortization', 'Accumulated Depletion', 'Accumulated Depreciation', 'Buildings', 'Depletable Assets', 'Fixed Asset Computers', 'Fixed Asset Copiers', 'Fixed Asset Furniture', 'Fixed Asset Other Tools Equipment', 'Fixed Asset Phone', 'Fixed Asset Photo Video', 'Fixed Asset Software', 'Furniture & Fixtures', 'Intangible Assets', 'Land', 'Leasehold Improvements', 'Machinery & Equipment', 'Other fixed assets', 'Vehicles'],
  'Other Assets': ['Accumulated Amortization of Other Assets', 'Goodwill', 'Lease Buyout', 'Licenses', 'Organizational Costs', 'Other Long-term Assets', 'Security Deposits'],
  'Credit Card': ['Credit Card'],
  'Accounts payable (A/P)': ['AP'],
  'Other Current Liabilities': ['Deferred Revenue', 'Federal Income Tax Payable', 'Insurance Payable', 'Line of Credit', 'Loan Payable', 'Other Current Liabilities', 'Payroll Clearing', 'Payroll Tax Payable', 'Prepaid Expenses Payable', 'Rents in trust - Liability', 'Sales Tax Payable', 'State/Local Income Tax Payable', 'Trust Accounts - Liabilities', 'Undistributed Tips'],
  'Long Term Liabilities': ['Notes Payable', 'Other Long Term Liabilities', 'Shareholder Notes Payable'],
  'Equity': ['Accumulated Adjustment', 'Common Stock', 'Estimated Taxes', 'Health Insurance Premium', 'Health Savings Account Contribution', 'Opening Balance Equity', "Owner's Equity", 'Paid-In Capital or Surplus', 'Partner Contributions', 'Partner Distributions', "Partner's Equity", 'Personal Expense', 'Personal Income', 'Preferred Stock', 'Retained Earnings', 'Treasury Stock'],
  'Income': ['Discounts/Refunds Given', 'Non-Profit Income', 'Other Primary Income', 'Sales of Product Income', 'Service/Fee Income', 'Unapplied Cash Payment Income'],
  'Other Income': ['Dividend Income', 'Interest Earned', 'Other Investment Income', 'Other Miscellaneous Income', 'Tax-Exempt Interest'],
  'Cost of Goods Sold': ['Cost of labor - COS', 'Equipment Rental - COS', 'Other Costs of Services - COS', 'Shipping, Freight & Delivery - COS', 'Supplies & Materials - COGS'],
  'Expenses': ['Advertising/Promotional', 'Auto', 'Bad Debts', 'Bank Charges', 'Charitable Contributions', 'Communication', 'Cost of Labor', 'Dues & subscriptions', 'Entertainment', 'Entertainment Meals', 'Equipment Rental', 'Finance costs', 'Insurance', 'Interest Paid', 'Legal & Professional Fees', 'Office/General Administrative Expenses', 'Other Business Expenses', 'Other Miscellaneous Service Cost', 'Payroll Expenses', 'Payroll Tax Expenses', 'Payroll Wage Expenses', 'Promotional Meals', 'Rent or Lease of Buildings', 'Repair & Maintenance', 'Shipping, Freight & Delivery', 'Supplies & Materials', 'Taxes Paid', 'Travel', 'Travel Meals', 'Unapplied Cash Bill Payment Expense', 'Utilities'],
  'Other Expense': ['Amortization', 'Depreciation', 'Exchange Gain or Loss', 'Gas And Fuel', 'Home Office', 'Homeowner Rental Insurance', 'Mortgage Interest Home Office', 'Other Home Office Expenses', 'Other Miscellaneous Expense', 'Other Vehicle Expenses', 'Parking and Tolls', 'Penalties & Settlements', 'Property Tax Home Office', 'Rent and Lease Home Office', 'Repairs and Maintenance Home Office', 'Utilities Home Office', 'Vehicle', 'Vehicle Insurance', 'Vehicle Lease', 'Vehicle Loan', 'Vehicle Loan Interest', 'Vehicle Registration', 'Vehicle Repairs', 'Wash and Road Services'],
};

// Detail types from before this list was adopted, still on older accounts.
const LEGACY_DETAIL_TYPES: Record<string, AccountGroup> = {
  'cash on hand': 'Bank',
  'accounts receivable': 'Accounts receivable (A/R)',
  'suspense': 'Other Current Assets',
  'fixed assets': 'Fixed Assets',
  'equipment': 'Fixed Assets',
  'other assets': 'Other Assets',
  'accounts payable': 'Accounts payable (A/P)',
  'accrued liabilities': 'Other Current Liabilities',
  'customer deposits': 'Other Current Liabilities',
  'other liabilities': 'Other Current Liabilities',
  'mortgage': 'Long Term Liabilities',
  'paid-in capital': 'Equity',
  'other equity': 'Equity',
  'sales income': 'Income',
  'service income': 'Income',
  'discounts given': 'Income',
  'other income': 'Other Income',
  'other expenses': 'Other Expense',
};

// Where an account goes when its detail type says nothing.
const DEFAULT_GROUP: Record<BaseAccountType, AccountGroup> = {
  asset: 'Other Current Assets',
  liability: 'Other Current Liabilities',
  equity: 'Equity',
  revenue: 'Income',
  expense: 'Expenses',
};

function isBaseAccountType(value: string): value is BaseAccountType {
  return value in DEFAULT_GROUP;
}

/** The QuickBooks account types under a base type, in the order QuickBooks lists them. */
export function accountGroupsOf(accountType: string): readonly AccountGroup[] {
  return ACCOUNT_TYPE_GROUPS.find(group => group.accountType === accountType)?.items ?? [];
}

/**
 * The QuickBooks account type of an account. Read from the detail type, within
 * the account's own base type (so a detail type can never move an asset under
 * liabilities); an account with no detail type, or one this list does not
 * know, falls back to the plainest type of its kind.
 */
export function accountGroup(account: { account_type: string; detail_type?: string | null }): AccountGroup | null {
  if (!isBaseAccountType(account.account_type)) return null;
  const candidates = accountGroupsOf(account.account_type);
  const detail = (account.detail_type ?? '').trim().toLowerCase();
  if (detail) {
    const listed = candidates.find(group => DETAIL_TYPES[group].some(item => item.toLowerCase() === detail));
    if (listed) return listed;
    const legacy = LEGACY_DETAIL_TYPES[detail];
    if (legacy && candidates.includes(legacy)) return legacy;
  }
  return DEFAULT_GROUP[account.account_type];
}

const NOT_MONEY: readonly AccountGroup[] = ['Fixed Assets', 'Accounts receivable (A/R)', 'Other Assets'];

/**
 * An asset whose detail type says plainly that it is not money held: equipment
 * and other fixed assets, receivables, long-term assets, inventory. Such an
 * account is never a bank account, whatever Banking says (item 39: Equipment
 * once showed in a statement's bank picker). An asset with no detail type is
 * not judged; old charts have many.
 */
export function isNotMoneyAccount(account: { account_type: string; detail_type?: string | null }): boolean {
  const detail = (account.detail_type ?? '').trim().toLowerCase();
  if (account.account_type !== 'asset' || !detail) return false;
  const group = accountGroup(account);
  return (group !== null && NOT_MONEY.includes(group)) || detail === 'inventory';
}
