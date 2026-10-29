import { ACCOUNT_TYPE_GROUPS, type AccountGroup } from '@accounting/shared';

// QuickBooks' account type names, as an upload writes them, read as the app's
// five base types and a detail type. Shared by the Chart of Accounts upload
// and Setup -> Import from QuickBooks.

// Import sheets often use QBO-style type names ("Bank", "AR", "Credit Card").
// Normalize them to our five account types; when the original name is also a
// known detail type, carry it through.
const TYPE_ALIASES: Record<string, { type: string; detail?: string }> = {
  'asset': { type: 'asset' },
  'assets': { type: 'asset' },
  'bank': { type: 'asset', detail: 'Checking' },
  'cash': { type: 'asset', detail: 'Cash on Hand' },
  'ar': { type: 'asset', detail: 'Accounts Receivable' },
  'a/r': { type: 'asset', detail: 'Accounts Receivable' },
  'accounts receivable': { type: 'asset', detail: 'Accounts Receivable' },
  'inventory': { type: 'asset', detail: 'Inventory' },
  'fixed asset': { type: 'asset', detail: 'Fixed Assets' },
  'fixed assets': { type: 'asset', detail: 'Fixed Assets' },
  'other current asset': { type: 'asset' },
  'other current assets': { type: 'asset' },
  'other asset': { type: 'asset', detail: 'Other Assets' },
  'other assets': { type: 'asset', detail: 'Other Assets' },
  'liability': { type: 'liability' },
  'liabilities': { type: 'liability' },
  'ap': { type: 'liability', detail: 'Accounts Payable' },
  'a/p': { type: 'liability', detail: 'Accounts Payable' },
  'accounts payable': { type: 'liability', detail: 'Accounts Payable' },
  'credit card': { type: 'liability', detail: 'Credit Card' },
  'loan': { type: 'liability', detail: 'Loan Payable' },
  'other current liability': { type: 'liability' },
  'other current liabilities': { type: 'liability' },
  'long term liability': { type: 'liability', detail: 'Other Long Term Liabilities' },
  'long-term liability': { type: 'liability', detail: 'Other Long Term Liabilities' },
  'equity': { type: 'equity' },
  "owner's equity": { type: 'equity' },
  'owner equity': { type: 'equity' },
  'retained earnings': { type: 'equity', detail: 'Retained Earnings' },
  'revenue': { type: 'revenue' },
  'income': { type: 'revenue' },
  'sales': { type: 'revenue', detail: 'Sales Income' },
  'other income': { type: 'revenue', detail: 'Other Miscellaneous Income' },
  'expense': { type: 'expense' },
  'expenses': { type: 'expense' },
  // Was 'Cost of Labor', which is an ordinary expense: imported cost of goods
  // landed under Expenses on the P&L, after Gross Profit (2026-10-22).
  'cost of goods sold': { type: 'expense', detail: 'Supplies & Materials - COGS' },
  'cogs': { type: 'expense', detail: 'Supplies & Materials - COGS' },
  'other expense': { type: 'expense', detail: 'Other Miscellaneous Expense' },
  'other expenses': { type: 'expense', detail: 'Other Miscellaneous Expense' },
};

// A sheet that names QuickBooks' account types exactly ("Accounts receivable
// (A/R)", "Long Term Liabilities"): the detail type an account of that type
// gets when the sheet gives none. Equity, Income and Expenses need none.
const GROUP_DEFAULT_DETAIL: Partial<Record<AccountGroup, string>> = {
  'Bank': 'Checking',
  'Accounts receivable (A/R)': 'Accounts receivable (A/R)',
  'Other Current Assets': 'Other Current Assets',
  'Fixed Assets': 'Other fixed assets',
  'Other Assets': 'Other Long-term Assets',
  'Credit Card': 'Credit Card',
  'Accounts payable (A/P)': 'AP',
  'Other Current Liabilities': 'Other Current Liabilities',
  'Long Term Liabilities': 'Other Long Term Liabilities',
  'Other Income': 'Other Miscellaneous Income',
  'Cost of Goods Sold': 'Supplies & Materials - COGS',
  'Other Expense': 'Other Miscellaneous Expense',
};

/** An import sheet's type name as our base type and, when it says, a detail type. */
export function importType(name: string): { type: string; detail?: string } | null {
  const lower = name.trim().toLowerCase();
  const group = ACCOUNT_TYPE_GROUPS.flatMap(entry => [...entry.items] as AccountGroup[])
    .find(item => item.toLowerCase() === lower);
  if (group) {
    const detail = GROUP_DEFAULT_DETAIL[group];
    return { type: baseTypeOf(group), ...(detail ? { detail } : {}) };
  }
  return TYPE_ALIASES[lower] ?? null;
}

/** The base type (asset, liability...) a QuickBooks account type belongs to. */
export function baseTypeOf(group: string): string {
  return ACCOUNT_TYPE_GROUPS.find(entry => (entry.items as readonly string[]).includes(group))?.accountType ?? '';
}
