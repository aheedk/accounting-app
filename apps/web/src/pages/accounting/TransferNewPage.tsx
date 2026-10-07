import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { DateInput } from '@/components/ui/date-input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { AccountSelect } from '@/components/ui/AccountSelect';
import { fmtMoney, parseMoneyInput } from '@/lib/money';
import { todayLocal } from '@/lib/dates';

type Account = { id: string; code: string; name: string; account_type: string; is_active: boolean };

// Move money between two of the client's own accounts: checking to savings, a
// payment toward a card or a loan. Saved as a journal entry labelled Transfer,
// so afterwards it is opened and changed on the journal entry page.
export default function TransferNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState({ from_account_id: '', to_account_id: '', amount: '', transfer_date: todayLocal(), memo: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get<{ accounts: Account[] }>(`/businesses/${bizId}/coa`)
      // Money sits in balance sheet accounts; income and expense accounts are categories.
      .then(r => setAccounts(r.data.accounts.filter(a => a.is_active && ['asset', 'liability', 'equity'].includes(a.account_type))))
      .catch((e: unknown) => setErr(pickErr(e)));
  }, [bizId]);

  const from = useMemo(() => accounts.find(a => a.id === form.from_account_id), [accounts, form.from_account_id]);
  const to = useMemo(() => accounts.find(a => a.id === form.to_account_id), [accounts, form.to_account_id]);
  const amount = Number(form.amount) || 0;
  const sameAccount = form.from_account_id !== '' && form.from_account_id === form.to_account_id;
  const ready = form.from_account_id !== '' && form.to_account_id !== '' && !sameAccount && amount > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId || !ready) return;
    setErr(null); setBusy(true);
    try {
      const r = await api.post<{ id: string }>(`/businesses/${bizId}/transfers`, {
        from_account_id: form.from_account_id,
        to_account_id: form.to_account_id,
        amount: parseMoneyInput(form.amount),
        transfer_date: form.transfer_date,
        memo: form.memo.trim() || null,
      });
      nav(`/journal/${r.data.id}`);
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <form className="space-y-6" onSubmit={submit}>
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-semibold">Transfer</h1>
        <div className="text-right">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount</div>
          <div className="text-3xl font-semibold font-mono">{fmtMoney(String(amount))}</div>
        </div>
      </div>

      <Card><CardContent className="space-y-4 pt-6">
        <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_auto_1fr]">
          <div>
            <Label className="text-xs text-muted-foreground">Transfer funds from</Label>
            <AccountSelect
              accounts={accounts}
              value={form.from_account_id}
              onChange={id => setForm(f => ({ ...f, from_account_id: id }))}
              required
              placeholder="Choose an account"
              ariaLabel="Transfer funds from"
            />
          </div>
          <ArrowRight className="mb-3 hidden h-4 w-4 text-muted-foreground md:block" />
          <div>
            <Label className="text-xs text-muted-foreground">Transfer funds to</Label>
            <AccountSelect
              accounts={accounts}
              value={form.to_account_id}
              onChange={id => setForm(f => ({ ...f, to_account_id: id }))}
              required
              placeholder="Choose an account"
              ariaLabel="Transfer funds to"
            />
          </div>
        </div>
        {sameAccount && <p className="text-sm text-destructive">Choose two different accounts.</p>}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <Label className="text-xs text-muted-foreground">Transfer amount</Label>
            <MoneyInput
              value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              placeholder="0.00" required
              className="text-right font-mono"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Date</Label>
            <DateInput value={form.transfer_date} onChange={e => setForm(f => ({ ...f, transfer_date: e.target.value }))} required />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Memo</Label>
            <Input
              value={form.memo}
              onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
              placeholder={from && to ? `Transfer from ${from.name} to ${to.name}` : 'Optional'}
            />
          </div>
        </div>
      </CardContent></Card>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex items-center gap-2 sticky -bottom-4 z-10 lg:-bottom-6 border-t bg-background py-3">
        <Button type="button" variant="outline" onClick={() => nav(-1)}>Cancel</Button>
        <div className="flex-1" />
        <Button type="submit" disabled={busy || !ready}>{busy ? 'Saving…' : 'Save and close'}</Button>
      </div>
    </form>
  );
}
