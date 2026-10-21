import { SUSPENSE_DETAIL_TYPE, accountGroup, isNotMoneyAccount } from '@accounting/shared';

// Direct port of apps/web/src/lib/bankAccountOptions.ts — same filtering
// logic, so mobile's account pickers match the web app's exactly. Not moved
// into packages/shared itself to avoid touching the stable web app's import
// in this chunk (same reasoning as apiClient.ts's pickErr copy).

type AccountOption = { id: string; account_type: string; detail_type?: string | null };

/**
 * The accounts money is kept in: accounts of type Bank, plus any account set
 * up under Banking. A chart where nothing is marked as a bank falls back to
 * every asset, so a picker is never empty; the account already chosen
 * always stays listed.
 */
export function statementBankAccounts<T extends AccountOption>(
  accounts: T[], bankingAccountIds: ReadonlySet<string>, selectedId: string,
): T[] {
  const assets = accounts.filter(a => a.account_type === 'asset' && a.detail_type !== SUSPENSE_DETAIL_TYPE && !isNotMoneyAccount(a));
  const banks = assets.filter(a => bankingAccountIds.has(a.id) || accountGroup(a) === 'Bank');
  if (banks.length === 0) return assets;
  const selected = accounts.find(a => a.id === selectedId && a.account_type === 'asset');
  return selected && !banks.includes(selected) ? [...banks, selected] : banks;
}

/**
 * What an expense can be paid from: the bank accounts, then the credit
 * cards. The account already on the expense always stays listed.
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

/** Expense category picker: expense-type accounts first, everything else after — any account is pickable. */
export function categoryAccountsFirst<T extends AccountOption>(accounts: T[]): T[] {
  return [...accounts.filter(a => a.account_type === 'expense'), ...accounts.filter(a => a.account_type !== 'expense')];
}
