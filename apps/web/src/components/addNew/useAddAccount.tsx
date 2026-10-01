import { useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import AccountCreateDrawer, { type CreatedAccount } from '@/pages/coa/AccountCreateDrawer';

type AccountRow = { id: string; code: string; name: string; account_type: string };

type OpenOptions = {
  /** Pre-selects the account type in the drawer, e.g. 'expense'. */
  accountType?: string;
  /** Called with the new account's id so the dropdown can select it. */
  onPick?: (id: string) => void;
};

/**
 * "Add new account" for any account dropdown. Opens the shared New account
 * drawer, hands the created row back to the page so it can add it to its own
 * list, then selects it in the dropdown that asked.
 */
export function useAddAccount<T extends AccountRow>(
  accounts: T[],
  onCreated: (account: T) => void,
) {
  const [businessId] = useActiveBusinessId();
  const [request, setRequest] = useState<OpenOptions | null>(null);

  async function created(account: CreatedAccount) {
    if (!businessId) return;
    // Re-read the chart so the page gets the row in the same shape it loaded.
    const response = await api.get<{ accounts: T[] }>(`/businesses/${businessId}/coa`, {
      params: { include_inactive: 'true' },
    });
    const row = response.data.accounts.find(candidate => candidate.id === account.id);
    if (!row) return;
    onCreated(row);
    request?.onPick?.(row.id);
  }

  // Portalled, and submit is stopped, because pages render this inside their
  // own <form>: the drawer's form must neither nest in it nor submit it.
  const drawer = request && businessId ? createPortal(
    <div onSubmit={event => event.stopPropagation()}>
      <AccountCreateDrawer
        businessId={businessId}
        accounts={accounts.map(account => ({ ...account, is_active: true }))}
        {...(request.accountType ? { initialAccountType: request.accountType } : {})}
        onClose={() => setRequest(null)}
        onCreated={created}
      />
    </div>,
    document.body,
  ) : null;

  return { open: (options: OpenOptions = {}) => setRequest(options), drawer };
}
