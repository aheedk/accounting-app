import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { parseMoneyInput } from '@/lib/money';

type Customer = { id: string; name: string };
type Account = { id: string; code: string; name: string; account_type: string; is_system: boolean; is_active: boolean };

export default function CreditMemoNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [revenueAccounts, setRevenueAccounts] = useState<Account[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ customer_id: '', memo_date: today, amount: '0.00', revenue_account_id: '', memo: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/customers`).then(r => setCustomers(r.data.customers));
    // Prefer Sales Returns (4910) but list all revenue accounts so users can pick a contra-revenue if needed.
    api.get(`/businesses/${bizId}/coa`).then(r => setRevenueAccounts(r.data.accounts.filter((a: Account) => a.account_type === 'revenue' && a.is_active)));
  }, [bizId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const body = { ...form, amount: parseMoneyInput(form.amount), memo: form.memo || null };
      const r = await api.post(`/businesses/${bizId}/credit-memos`, body);
      nav(`/credit-memos/${r.data.id}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <form className="space-y-6 max-w-xl" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">New Credit Memo</h1>
      <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div><Label>Customer</Label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.customer_id} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))} required>
              <option value="">Select…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><Label>Date</Label><Input type="date" value={form.memo_date} onChange={e => setForm(f => ({ ...f, memo_date: e.target.value }))} required /></div>
          <div><Label>Amount</Label><Input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required /></div>
          <div><Label>Revenue/contra account</Label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.revenue_account_id} onChange={e => setForm(f => ({ ...f, revenue_account_id: e.target.value }))} required>
              <option value="">Select…</option>{revenueAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </div>
          <div className="col-span-2"><Label>Memo</Label><Input value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} /></div>
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create draft'}</Button><Button type="button" variant="outline" onClick={() => nav('/credit-memos')}>Cancel</Button></div>
    </form>
  );
}
