import { useEffect, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AccountSelect } from '@/components/ui/AccountSelect';
import { parseMoneyInput } from '@/lib/money';

type Customer = { id: string; name: string };
type Account = { id: string; code: string; name: string; account_type: string; is_system: boolean; is_active: boolean };

export default function PaymentNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cashAccounts, setCashAccounts] = useState<Account[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ customer_id: '', payment_date: today, payment_method: 'check', reference: '', amount: '0.00', cash_account_id: '', memo: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/customers`).then(r => setCustomers(r.data.customers));
    api.get(`/businesses/${bizId}/coa`).then(r => setCashAccounts(r.data.accounts.filter((a: Account) => a.account_type === 'asset' && a.is_active && a.code.startsWith('10'))));
  }, [bizId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const body = { ...form, amount: parseMoneyInput(form.amount), reference: form.reference || null, memo: form.memo || null };
      const r = await api.post(`/businesses/${bizId}/payments`, body);
      nav(`/payments/${r.data.payment.id}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <form className="space-y-6 max-w-2xl" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">Record Payment</h1>
      <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div><Label>Customer</Label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))} required>
              <option value="">Select a customer…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><Label>Date</Label><DateInput value={form.payment_date} onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))} required /></div>
          <div><Label>Method</Label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}>
              {['cash','check','ach','wire','card','other'].map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div><Label>Reference</Label><Input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} placeholder="Check #, transaction ID, etc." /></div>
          <div><Label>Amount</Label><Input type="number" step="0.01" inputMode="decimal" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" required className="text-right font-mono" /></div>
          <div><Label>Cash account (debit)</Label>
            <AccountSelect
              accounts={cashAccounts}
              value={form.cash_account_id}
              onChange={(id) => setForm(f => ({ ...f, cash_account_id: id }))}
              required
              placeholder="Search cash account…"
            />
          </div>
          <div className="col-span-2"><Label>Memo</Label><Input value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="Optional note" /></div>
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create draft'}</Button><Button type="button" variant="outline" onClick={() => nav('/payments')}>Cancel</Button></div>
    </form>
  );
}
