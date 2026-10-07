import { SUSPENSE_DETAIL_TYPE } from '@accounting/shared';

type AccountOption = { id: string; account_type: string; detail_type?: string | null };

// The detail types under the "Bank" account type in the Chart of Accounts.
const BANK_DETAIL_TYPES = new Set(['Cash on hand', 'Checking', 'Money Market', 'Rents Held in Trust', 'Savings', 'Trust account']);

/**
 * The accounts money is kept in: accounts of type Bank, plus any account set up
 * under Banking. A chart where nothing is marked as a bank falls back to every
 * asset, so a picker is never empty; the account already chosen always stays listed.
 */
export function statementBankAccounts<T extends AccountOption>(
  accounts: T[], bankingAccountIds: ReadonlySet<string>, selectedId: string,
): T[] {
  // Suspense is an asset too, but never an account money is paid from or into.
  const assets = accounts.filter(a => a.account_type === 'asset' && a.detail_type !== SUSPENSE_DETAIL_TYPE);
  const banks = assets.filter(a => bankingAccountIds.has(a.id) || BANK_DETAIL_TYPES.has(a.detail_type ?? ''));
  if (banks.length === 0) return assets;
  const selected = assets.find(a => a.id === selectedId);
  return selected && !banks.includes(selected) ? [...banks, selected] : banks;
}
