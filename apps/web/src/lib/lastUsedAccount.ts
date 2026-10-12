// The bank account last used on a form, per company, so entering ten checks in a
// row means choosing the bank once. Kept in this browser only; a missing or
// blocked localStorage just means nothing is remembered.

export type RememberedForm = 'check' | 'expense' | 'bank_deposit';

function storageKey(businessId: string, form: RememberedForm): string {
  return `last_account:${form}:${businessId}`;
}

export function rememberAccount(businessId: string | null | undefined, form: RememberedForm, accountId: string): void {
  if (!businessId || !accountId) return;
  try { localStorage.setItem(storageKey(businessId, form), accountId); } catch { /* nothing remembered */ }
}

/** The remembered account if it is still one of `available`, otherwise ''. */
export function recallAccount(
  businessId: string | null | undefined, form: RememberedForm, available: ReadonlyArray<{ id: string }>,
): string {
  if (!businessId) return '';
  try {
    const id = localStorage.getItem(storageKey(businessId, form)) ?? '';
    return available.some(account => account.id === id) ? id : '';
  } catch {
    return '';
  }
}
