import { useRef, useState } from 'react';
import { ChevronDown, Info, Lock, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { todayLocal } from '@/lib/dates';

const ACCOUNT_TYPE_GROUPS = [
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

const DETAIL_TYPES: Record<string, string[]> = {
  asset: ['Checking', 'Savings', 'Money Market', 'Cash on Hand', 'Accounts Receivable', 'Prepaid Expenses', 'Inventory', 'Fixed Assets', 'Buildings', 'Vehicles', 'Equipment', 'Accumulated Depreciation', 'Other Assets'],
  liability: ['Accounts Payable', 'Credit Card', 'Line of Credit', 'Loan Payable', 'Sales Tax Payable', 'Accrued Liabilities', 'Customer Deposits', 'Notes Payable', 'Mortgage', 'Other Liabilities'],
  equity: ['Opening Balance Equity', 'Retained Earnings', 'Common Stock', 'Partner Contributions', 'Partner Distributions', 'Paid-In Capital', 'Other Equity'],
  revenue: ['Sales Income', 'Service Income', 'Interest Earned', 'Dividend Income', 'Other Income', 'Discounts Given'],
  expense: ['Advertising', 'Auto', 'Bank Charges', 'Cost of Labor', 'Dues & Subscriptions', 'Equipment Rental', 'Insurance', 'Legal & Professional Fees', 'Meals & Entertainment', 'Office Expenses', 'Payroll Expenses', 'Rent', 'Repairs & Maintenance', 'Taxes & Licenses', 'Travel', 'Utilities', 'Other Expenses'],
};

type AccountOption = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  detail_type?: string | null;
  is_active: boolean;
};

export type CreatedAccount = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  is_active: boolean;
  is_locked: boolean;
};

type Props = {
  businessId: string;
  accounts: AccountOption[];
  initialParentId?: string | null;
  initialAccountType?: string;
  onClose: () => void;
  onCreated: (account: CreatedAccount) => void | Promise<void>;
};

type CreateForm = {
  code: string;
  name: string;
  account_type: string;
  detail_type: string;
  description: string;
  opening_balance: string;
  opening_balance_as_of: string;
};

function blankForm(accountType = 'asset', detailType = ''): CreateForm {
  return {
    code: '',
    name: '',
    account_type: accountType,
    detail_type: detailType,
    description: '',
    opening_balance: '',
    opening_balance_as_of: todayLocal(),
  };
}

function firstTypeChoice(accountType: string) {
  const group = ACCOUNT_TYPE_GROUPS.find(item => item.accountType === accountType) ?? ACCOUNT_TYPE_GROUPS[0];
  return { accountType: group.accountType, label: group.items[0] };
}

export default function AccountCreateDrawer({
  businessId,
  accounts,
  initialParentId = null,
  initialAccountType = 'asset',
  onClose,
  onCreated,
}: Props) {
  const initialParent = accounts.find(account => account.id === initialParentId);
  const initialChoice = firstTypeChoice(initialParent?.account_type ?? initialAccountType);
  const [parentId, setParentId] = useState<string | null>(initialParentId);
  const [isSubaccount, setIsSubaccount] = useState(initialParentId !== null);
  const [locked, setLocked] = useState(false);
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const [selectedTypeLabel, setSelectedTypeLabel] = useState(initialParent?.detail_type || initialChoice.label);
  const saveAndNewRef = useRef(false);
  const [form, setForm] = useState(() => blankForm(
    initialParent?.account_type ?? initialChoice.accountType,
    initialParent?.detail_type || initialChoice.label,
  ));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isBalanceSheetType = ['asset', 'liability', 'equity'].includes(form.account_type);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const andNew = saveAndNewRef.current;
    saveAndNewRef.current = false;
    setError(null);
    if (isSubaccount && !parentId) {
      setError('Choose a parent account.');
      return;
    }
    const openingBalance = form.opening_balance.trim();
    if (openingBalance && Number.isNaN(Number(openingBalance))) {
      setError('Opening balance must be a number.');
      return;
    }

    setBusy(true);
    try {
      const response = await api.post<CreatedAccount>(`/businesses/${businessId}/coa`, {
        code: form.code.trim(),
        name: form.name.trim(),
        account_type: form.account_type,
        detail_type: form.detail_type || null,
        description: form.description || null,
        parent_id: isSubaccount ? parentId : null,
        opening_balance: openingBalance && isBalanceSheetType ? openingBalance : null,
        opening_balance_as_of: openingBalance && isBalanceSheetType ? form.opening_balance_as_of : null,
        is_locked: locked,
      });
      await onCreated(response.data);
      if (andNew) {
        setForm(blankForm(form.account_type, form.detail_type));
        setLocked(false);
      } else {
        onClose();
      }
    } catch (requestError: unknown) {
      setError(pickErr(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/20" onClick={onClose} />
      <div className="flex w-[420px] flex-col border-l bg-background shadow-xl" role="dialog" aria-modal="true" aria-label="New account">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-semibold">New account</h2>
          <button type="button" aria-label="Close new account" className="text-lg leading-none text-muted-foreground hover:text-foreground" onClick={onClose}>×</button>
        </div>
        <form id="coa-create-form" className="flex flex-1 flex-col overflow-hidden" onSubmit={event => { void create(event); }}>
          <div className="flex-1 space-y-4 overflow-auto p-6">
            <div className="grid grid-cols-[1fr_130px] gap-3">
              <div>
                <Label htmlFor="new-account-name">Account name <span className="text-destructive">*</span></Label>
                <Input id="new-account-name" className="mt-1" placeholder="e.g. Cash" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} required autoFocus />
              </div>
              <div>
                <Label htmlFor="new-account-code">Account number <span className="text-destructive">*</span></Label>
                <Input id="new-account-code" className="mt-1" placeholder="e.g. 1000" value={form.code} onChange={event => setForm(current => ({ ...current, code: event.target.value }))} required />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="new-account-type" className="inline-flex items-center gap-1">Account type <span className="text-destructive">*</span><Info className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /></Label>
                <div className="relative mt-1">
                  <button
                    id="new-account-type"
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={showTypeMenu}
                    disabled={isSubaccount && parentId !== null}
                    onClick={() => setShowTypeMenu(current => !current)}
                    className="flex h-10 w-full items-center justify-between rounded-md border bg-background px-3 text-left text-sm disabled:opacity-60"
                  >
                    <span>{selectedTypeLabel}</span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </button>
                  {showTypeMenu && (
                    <div role="menu" aria-label="Account type choices" className="absolute left-0 top-full z-50 mt-1 max-h-96 w-72 overflow-y-auto rounded-md border bg-background py-2 shadow-lg">
                      {ACCOUNT_TYPE_GROUPS.map(group => (
                        <div key={group.heading} className="pb-1">
                          <div data-account-type-group className="px-3 pb-1 pt-2 text-xs font-bold tracking-wide text-foreground">{group.heading}</div>
                          {group.items.map(item => (
                            <button
                              key={item}
                              type="button"
                              role="menuitem"
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                              onClick={() => {
                                setSelectedTypeLabel(item);
                                setForm(current => ({ ...current, account_type: group.accountType, detail_type: item }));
                                setShowTypeMenu(false);
                              }}
                            >
                              {item}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <Label htmlFor="new-account-detail-type">Detail type</Label>
                <select id="new-account-detail-type" className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.detail_type} onChange={event => setForm(current => ({ ...current, detail_type: event.target.value }))}>
                  <option value="">— select —</option>
                  {form.detail_type && !(DETAIL_TYPES[form.account_type] ?? []).includes(form.detail_type) && (
                    <option value={form.detail_type}>{form.detail_type}</option>
                  )}
                  {(DETAIL_TYPES[form.account_type] ?? []).map(detail => <option key={detail} value={detail}>{detail}</option>)}
                </select>
              </div>
            </div>

            <label className="flex cursor-pointer select-none items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="h-4 w-4 cursor-pointer rounded border-input accent-emerald-600" checked={isSubaccount} onChange={event => { setIsSubaccount(event.target.checked); if (!event.target.checked) setParentId(null); }} />
              Make this a subaccount
            </label>
            {isSubaccount && (
              <div>
                <Label htmlFor="new-account-parent">Parent account <span className="text-destructive">*</span></Label>
                <select id="new-account-parent" className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={parentId ?? ''} onChange={event => {
                  const nextParentId = event.target.value || null;
                  setParentId(nextParentId);
                  const parent = accounts.find(account => account.id === nextParentId);
                  if (parent) {
                    const parentChoice = firstTypeChoice(parent.account_type);
                    const nextDetailType = parent.detail_type || parentChoice.label;
                    setSelectedTypeLabel(nextDetailType);
                    setForm(current => ({ ...current, account_type: parent.account_type, detail_type: nextDetailType }));
                  }
                }}>
                  <option value="">— select parent —</option>
                  {accounts.filter(account => account.is_active && account.account_type === form.account_type).map(account => <option key={account.id} value={account.id}>{account.code} {account.name}</option>)}
                </select>
              </div>
            )}

            {isBalanceSheetType && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="new-account-opening-balance" className="inline-flex items-center gap-1">Opening balance <Info className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /></Label>
                  <Input id="new-account-opening-balance" className="mt-1" inputMode="decimal" placeholder="0.00" value={form.opening_balance} onChange={event => setForm(current => ({ ...current, opening_balance: event.target.value }))} />
                </div>
                <div>
                  <Label htmlFor="new-account-opening-date">As of</Label>
                  <Input id="new-account-opening-date" type="date" className="mt-1" value={form.opening_balance_as_of} onChange={event => setForm(current => ({ ...current, opening_balance_as_of: event.target.value }))} />
                </div>
                <p className="col-span-2 -mt-2 text-xs text-muted-foreground">Posts a journal entry against Opening Balance Equity as of this date.</p>
              </div>
            )}

            <div>
              <Label htmlFor="new-account-description">Description</Label>
              <textarea id="new-account-description" className="mt-1 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1" rows={3} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} placeholder="Optional description" />
            </div>

            <div className="flex items-center gap-3 border-t pt-4">
              <span className="text-sm font-medium underline underline-offset-2">Lock account</span>
              <div className="inline-flex overflow-hidden rounded-md border">
                <button type="button" className={`inline-flex h-8 w-9 items-center justify-center ${!locked ? 'bg-background' : 'bg-muted/40 text-muted-foreground'}`} aria-pressed={!locked} title="Unlocked — account is active" onClick={() => setLocked(false)}><Unlock className="h-4 w-4" /></button>
                <button type="button" className={`inline-flex h-8 w-9 items-center justify-center border-l ${locked ? 'bg-muted text-foreground' : 'bg-background text-muted-foreground'}`} aria-pressed={locked} title="Locked — account rejects edits and new postings until unlocked" onClick={() => setLocked(true)}><Lock className="h-4 w-4" /></button>
              </div>
              {locked && <span className="text-xs text-muted-foreground">Created locked — no edits or postings until unlocked</span>}
            </div>

            <div className="overflow-hidden rounded-md border">
              <div className="flex items-center justify-between border-b bg-muted/20 px-3 py-2">
                <div><div className="text-sm font-semibold">{isBalanceSheetType ? 'Balance Sheet' : 'Income Statement'}</div><div className="text-xs text-muted-foreground">Active accounts as of {todayLocal()}</div></div>
                <span className="rounded bg-blue-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">New account preview</span>
              </div>
              <div className="max-h-40 overflow-y-auto py-1">
                {(() => {
                  const siblings = accounts.filter(account => account.is_active && account.account_type === form.account_type).map(account => ({ id: account.id, code: account.code, name: account.name, pending: false }));
                  if (form.code || form.name) siblings.push({ id: '__new__', code: form.code || '—', name: form.name || 'New account', pending: true });
                  siblings.sort((left, right) => left.code.localeCompare(right.code, undefined, { numeric: true }));
                  if (siblings.length === 0) return <p className="px-3 py-2 text-sm text-muted-foreground">No active accounts of this type yet.</p>;
                  return siblings.map(sibling => <div key={sibling.id} className={`px-3 py-1.5 text-sm ${sibling.pending ? 'bg-blue-50 font-medium dark:bg-blue-950/40' : ''}`}><span className="font-mono text-muted-foreground">{sibling.code}</span> {sibling.name}</div>);
                })()}
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <div className="flex items-center justify-end gap-2 border-t px-6 py-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <div className="flex items-center">
              <Button type="submit" disabled={busy} className="rounded-r-none border-r border-primary-foreground/20">{busy ? 'Saving…' : 'Save'}</Button>
              <div className="relative">
                <Button type="button" disabled={busy} aria-label="New account save options" className="rounded-l-none px-2" onClick={() => setShowSaveMenu(current => !current)}><ChevronDown className="h-4 w-4" /></Button>
                {showSaveMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowSaveMenu(false)} />
                    <div className="absolute bottom-full right-0 z-50 mb-1 w-40 rounded-md border bg-background py-1 shadow-lg">
                      <button type="submit" form="coa-create-form" className="w-full px-4 py-2 text-left text-sm hover:bg-accent" onClick={() => { saveAndNewRef.current = true; setShowSaveMenu(false); }}>Save and new</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
