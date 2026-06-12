import { useEffect, useMemo, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { AccountSelect } from '@/components/ui/AccountSelect';
import { fmtMoney, parseMoneyInput } from '@/lib/money';
import { todayLocal } from '@/lib/dates';

type Address = { line1?: string; line2?: string; city?: string; state?: string; postal_code?: string; country?: string };
type Customer = { id: string; name: string; billing_address: Address | null };
type Account = { id: string; code: string; name: string; account_type: string; is_system: boolean; is_active: boolean };

function fmtAddress(a: Address | null | undefined): string {
  if (!a) return '';
  const cityLine = [a.city, a.state, a.postal_code].filter(Boolean).join(', ');
  return [a.line1, a.line2, cityLine, a.country].filter(Boolean).join('\n');
}

export default function CreditMemoNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [revenueAccounts, setRevenueAccounts] = useState<Account[]>([]);
  const today = todayLocal();
  const [form, setForm] = useState({ customer_id: '', memo_date: today, amount: '', revenue_account_id: '', memo: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/customers`).then(r => setCustomers(r.data.customers));
    // Prefer Sales Returns (4910) but list all revenue accounts so users can pick a contra-revenue if needed.
    api.get(`/businesses/${bizId}/coa`).then(r => setRevenueAccounts(r.data.accounts.filter((a: Account) => a.account_type === 'revenue' && a.is_active)));
  }, [bizId]);

  const customer = useMemo(() => customers.find(c => c.id === form.customer_id), [customers, form.customer_id]);
  const amountToCredit = Number(form.amount) || 0;

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
    <form className="space-y-6" onSubmit={submit}>
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-semibold">Credit Memo</h1>
        <div className="text-right">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount to credit</div>
          <div className="text-3xl font-semibold font-mono">{fmtMoney(String(amountToCredit))}</div>
        </div>
      </div>

      <Card><CardContent className="grid grid-cols-1 gap-3 pt-6 md:grid-cols-3">
        <div>
          <Label className="text-xs text-muted-foreground">Customer</Label>
          <select
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={form.customer_id}
            onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))}
            required
          >
            <option value="">Choose a customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="mt-3">
            <Label className="text-xs text-muted-foreground">Billing address</Label>
            <div className="min-h-[5rem] whitespace-pre-line rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              {fmtAddress(customer?.billing_address) || '—'}
            </div>
          </div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Credit memo date</Label>
          <DateInput value={form.memo_date} onChange={e => setForm(f => ({ ...f, memo_date: e.target.value }))} required />
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="w-10 p-3 text-left">#</th>
              <th className="p-3 text-left">Description</th>
              <th className="p-3 text-left">Revenue/contra account</th>
              <th className="p-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="p-3 text-muted-foreground">1</td>
              <td className="p-3">
                <Input value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="Reason for credit (optional)" />
              </td>
              <td className="p-3">
                <AccountSelect
                  accounts={revenueAccounts}
                  value={form.revenue_account_id}
                  onChange={(id) => setForm(f => ({ ...f, revenue_account_id: id }))}
                  required
                  placeholder="Search revenue account (e.g. Sales Returns)…"
                />
              </td>
              <td className="p-3">
                <Input
                  type="number" step="0.01" inputMode="decimal"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00" required
                  className="ml-auto w-36 text-right font-mono"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <div className="flex justify-end gap-12 border-t px-6 py-4 text-sm">
          <div className="text-muted-foreground">Subtotal</div>
          <div className="font-mono">{fmtMoney(String(amountToCredit))}</div>
        </div>
        <div className="flex justify-end gap-12 border-t px-6 py-4 text-sm font-semibold">
          <div>Total</div>
          <div className="font-mono">{fmtMoney(String(amountToCredit))}</div>
        </div>
      </CardContent></Card>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex items-center gap-2 sticky bottom-0 border-t bg-background py-3">
        <Button type="button" variant="outline" onClick={() => nav('/credit-memos')}>Cancel</Button>
        <div className="flex-1" />
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</Button>
      </div>
    </form>
  );
}
