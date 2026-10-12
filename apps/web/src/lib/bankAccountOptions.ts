import { SUSPENSE_DETAIL_TYPE, accountGroup } from '@accounting/shared';

type AccountOption = { id: string; account_type: string; detail_type?: string | null };

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
  const banks = assets.filter(a => bankingAccountIds.has(a.id) || accountGroup(a) === 'Bank');
  if (banks.length === 0) return assets;
  const selected = assets.find(a => a.id === selectedId);
  return selected && !banks.includes(selected) ? [...banks, selected] : banks;
}

/**
 * What an expense can be paid from: the bank accounts, then the credit cards.
 * The account already on the expense always stays listed, whatever it is.
 */
export function expensePaymentAccounts<T extends AccountOption>(
  accounts: T[], bankingAccountIds: ReadonlySet<string>, selectedId: string,
): T[] {
  const banks = statementBankAccounts(accounts, bankingAccountIds, selectedId);
  const cards = accounts.filter(a => a.account_type === 'liability' && a.detail_type === 'Credit Card');
  const listed = [...banks, ...cards];
  const selected = accounts.find(a => a.id === selectedId);
  return selected && !listed.includes(selected) ? [...listed, selected] : listed;
}
