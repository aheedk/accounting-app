import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateInput } from '@/components/ui/date-input';
import { Card, CardContent } from '@/components/ui/card';
import { AccountSelect } from '@/components/ui/AccountSelect';
import { AppSelect } from '@/components/ui/select';
import { ComboInput } from '@/components/ui/ComboInput';
import { useAddAccount } from '@/components/addNew/useAddAccount';
import { AttachmentsPanel, useAttachments } from '@/components/Attachments';
import { fmtMoney } from '@/lib/money';

type TransactionType = 'check' | 'expense' | 'deposit' | 'credit_card_payment' | 'credit_card_credit';

type ImportedTransaction = {
  id: string;
  journal_number: string;
  status: 'draft' | 'posted' | 'voided';
  entry_date: string;
  transaction_type: TransactionType;
  direction: 'in' | 'out';
  payee_name: string | null;
  check_number: string | null;
  memo: string | null;
  bank_account_id: string;
  category_account_id: string;
  amount: string;
  can_edit: boolean;
  edit_block_reason: string | null;
};

type Account = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  is_active: boolean;
};

type Vendor = { id: string; name: string };

type Form = {
  entry_date: string;
  transaction_type: TransactionType;
  payee_name: string;
  check_number: string;
  memo: string;
  bank_account_id: string;
  category_account_id: string;
  amount: string;
};

const TITLES: Record<TransactionType, string> = {
  check: 'Check', expense: 'Expense', deposit: 'Deposit',
  credit_card_payment: 'Credit Card Payment', credit_card_credit: 'Credit Card Credit',
};
const AMOUNT_RE = /^\d+(\.\d{1,4})?$/;

function toForm(txn: ImportedTransaction): Form {
  return {
    entry_date: txn.entry_date,
    transaction_type: txn.transaction_type,
    payee_name: txn.payee_name ?? '',
    check_number: txn.check_number ?? '',
    memo: txn.memo ?? '',
    bank_account_id: txn.bank_account_id,
    category_account_id: txn.category_account_id,
    amount: Number(txn.amount).toFixed(2),
  };
}

// Edit screen for a Check / Expense / Deposit that was posted from a bank
// statement import -- the QBO-style form behind those rows in the ledger.
export default function ImportedTransactionPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [txn, setTxn] = useState<ImportedTransaction | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const addAccount = useAddAccount(accounts, account => setAccounts(prev => [...prev, account]));
  // The transaction is its journal entry, so that is what files attach to.
  const attachments = useAttachments('journal_entry', id ?? null);

  useEffect(() => {
    if (!bizId || !id) return;
    setTxn(null);
    setForm(null);
    setLoadError(null);
    api.get<ImportedTransaction>(`/businesses/${bizId}/imported-transactions/${id}`)
      .then(r => { setTxn(r.data); setForm(toForm(r.data)); })
      .catch((e: unknown) => setLoadError(pickErr(e)));
    api.get<{ accounts: Account[] }>(`/businesses/${bizId}/coa`).then(r => setAccounts(r.data.accounts));
    api.get<{ vendors: Vendor[] }>(`/businesses/${bizId}/vendors`).then(r => setVendors(r.data.vendors));
  }, [bizId, id]);

  // Keep the saved account selectable even if it has since been made inactive.
  const bankAccounts = useMemo(() => accounts.filter(a =>
    ((a.account_type === 'asset' || a.account_type === 'liability') && a.is_active) || a.id === form?.bank_account_id,
  ), [accounts, form?.bank_account_id]);
  const categoryAccounts = useMemo(() => accounts.filter(a =>
    a.is_active || a.id === form?.category_account_id,
  ), [accounts, form?.category_account_id]);

  if (!bizId) return <div>Pick a business.</div>;
  if (loadError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{loadError}</p>
        {id && <Link className="text-sm text-primary hover:underline" to={`/journal/${id}?view=entry`}>View the journal entry</Link>}
      </div>
    );
  }
  if (!txn || !form) return <div>Loading...</div>;

  const readOnly = !txn.can_edit;
  const moneyIn = txn.direction === 'in';
  const amountNum = Number(form.amount) || 0;
  const set = (patch: Partial<Form>) => { setNotice(null); setForm(f => (f ? { ...f, ...patch } : f)); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form || readOnly) return;
    setErr(null);
    setNotice(null);
    if (!AMOUNT_RE.test(form.amount) || Number(form.amount) <= 0) {
      setErr('Amount must be a positive number like 125.00');
      return;
    }
    setBusy(true);
    try {
      const r = await api.put<ImportedTransaction>(`/businesses/${bizId}/imported-transactions/${id}`, {
        entry_date: form.entry_date,
        transaction_type: form.transaction_type,
        payee_name: form.payee_name.trim() || null,
        check_number: form.transaction_type === 'check' && form.check_number.trim() ? form.check_number.trim() : null,
        memo: form.memo.trim() || null,
        bank_account_id: form.bank_account_id,
        category_account_id: form.category_account_id,
        amount: form.amount,
      });
      setTxn(r.data);
      setForm(toForm(r.data));
      setNotice('Saved.');
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={submit}>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {TITLES[form.transaction_type]}
            {form.transaction_type === 'check' && form.check_number ? ` #${form.check_number}` : ''}
          </h1>
          <p className="text-sm text-muted-foreground">
            Imported from a bank statement · Journal no. {txn.journal_number}
            {txn.status === 'voided' && <span className="ml-2 uppercase">Voided</span>}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount</div>
          <div className="text-3xl font-semibold font-mono">{fmtMoney(String(amountNum))}</div>
        </div>
      </div>

      {readOnly && (
        <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {txn.edit_block_reason}
        </div>
      )}

      <Card><CardContent className="grid grid-cols-1 gap-3 pt-6 md:grid-cols-2 lg:grid-cols-4">
        {!moneyIn && (
          <div>
            <Label className="text-xs text-muted-foreground">Payee</Label>
            <ComboInput
              value={form.payee_name}
              onChange={payee_name => set({ payee_name })}
              options={vendors.map(v => v.name)}
              placeholder="Who did you pay?"
              disabled={readOnly}
            />
          </div>
        )}
        <div>
          <Label className="text-xs text-muted-foreground">{form.transaction_type.startsWith('credit_card') ? 'Credit card' : moneyIn ? 'Deposit to' : 'Bank account'}</Label>
          <AccountSelect
            accounts={bankAccounts}
            value={form.bank_account_id}
            onChange={accountId => set({ bank_account_id: accountId })}
            required
            disabled={readOnly}
            placeholder="Which bank account?"
            {...(!readOnly ? { onCreate: () => addAccount.open({ accountType: 'asset', onPick: accountId => set({ bank_account_id: accountId }) }) } : {})}
          />
        </div>
        {!moneyIn && (
          <div>
            <Label className="text-xs text-muted-foreground">Type</Label>
            <AppSelect
              className="h-10"
              value={form.transaction_type}
              onChange={e => set({ transaction_type: e.target.value as TransactionType })}
              disabled={readOnly}
            >
              <option value="check">Check</option>
              <option value="expense">Expense</option>
            </AppSelect>
          </div>
        )}
        {form.transaction_type === 'check' && (
          <div>
            <Label className="text-xs text-muted-foreground">Check no.</Label>
            <Input
              value={form.check_number}
              onChange={e => set({ check_number: e.target.value })}
              placeholder="e.g. 1042"
              maxLength={30}
              disabled={readOnly}
            />
          </div>
        )}
        <div>
          <Label className="text-xs text-muted-foreground">Date</Label>
          <DateInput
            value={form.entry_date}
            onChange={e => set({ entry_date: e.target.value })}
            required
            disabled={readOnly}
          />
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <div className="border-b px-6 py-3 text-sm font-semibold">Category details</div>
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="w-10 p-3 text-left">#</th>
              <th className="p-3 text-left">Category</th>
              <th className="p-3 text-left">Description</th>
              <th className="w-40 p-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="p-3 text-muted-foreground">1</td>
              <td className="p-3">
                <AccountSelect
                  accounts={categoryAccounts}
                  value={form.category_account_id}
                  onChange={accountId => set({ category_account_id: accountId })}
                  required
                  disabled={readOnly}
                  placeholder="Choose category…"
                  {...(!readOnly ? { onCreate: () => addAccount.open({ onPick: accountId => set({ category_account_id: accountId }) }) } : {})}
                />
              </td>
              <td className="p-3">
                <Input
                  value={form.memo}
                  onChange={e => set({ memo: e.target.value })}
                  placeholder={moneyIn ? 'What was this deposit for?' : 'What did you pay for?'}
                  disabled={readOnly}
                />
              </td>
              <td className="p-3">
                <Input
                  type="number" step="0.01" inputMode="decimal"
                  value={form.amount}
                  onChange={e => set({ amount: e.target.value })}
                  placeholder="0.00" required
                  disabled={readOnly}
                  className="text-right font-mono"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <div className="flex justify-end gap-12 border-t px-6 py-4 text-sm font-semibold">
          <span>Total</span>
          <span className="font-mono">{fmtMoney(String(amountNum))}</span>
        </div>
      </CardContent></Card>

      <Card><CardContent className="pt-6">
        <AttachmentsPanel attachments={attachments} className="max-w-xl" />
      </CardContent></Card>

      {err && <p className="text-sm text-destructive">{err}</p>}
      {notice && <p className="text-sm text-emerald-700">{notice}</p>}
      <div className="sticky bottom-0 flex items-center gap-2 border-t bg-background py-3">
        <Button type="button" variant="outline" onClick={() => nav(-1)}>{readOnly ? 'Back' : 'Cancel'}</Button>
        <Link className="text-sm text-primary hover:underline" to={`/journal/${txn.id}?view=entry`}>View journal entry</Link>
        <div className="flex-1" />
        {!readOnly && <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>}
      </div>
      {addAccount.drawer}
    </form>
  );
}
