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

type Vendor = { id: string; name: string };
type Account = { id: string; code: string; name: string; account_type: string; is_system: boolean; is_active: boolean };

export default function VendorCreditNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [offsetAccounts, setOffsetAccounts] = useState<Account[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ vendor_id: '', credit_date: today, amount: '0.00', offset_account_id: '', memo: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/vendors`).then(r => setVendors(r.data.vendors));
    // Slice 2: offset accounts are any active expense accounts.
    api.get(`/businesses/${bizId}/coa`).then(r => setOffsetAccounts(r.data.accounts.filter((a: Account) => a.account_type === 'expense' && a.is_active)));
  }, [bizId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const body = { ...form, amount: parseMoneyInput(form.amount), memo: form.memo || null };
      const r = await api.post(`/businesses/${bizId}/vendor-credits`, body);
      nav(`/ap/vendor-credits/${r.data.id}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <form className="space-y-6 max-w-xl" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">New Vendor Credit</h1>
      <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div><Label>Vendor</Label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.vendor_id} onChange={e => setForm(f => ({ ...f, vendor_id: e.target.value }))} required>
              <option value="">Select a vendor…</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div><Label>Date</Label><DateInput value={form.credit_date} onChange={e => setForm(f => ({ ...f, credit_date: e.target.value }))} required /></div>
          <div><Label>Amount</Label><Input type="number" step="0.01" inputMode="decimal" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" required className="text-right font-mono" /></div>
          <div><Label>Offset account (credit)</Label>
            <AccountSelect
              accounts={offsetAccounts}
              value={form.offset_account_id}
              onChange={(id) => setForm(f => ({ ...f, offset_account_id: id }))}
              required
              placeholder="Search expense account to reverse…"
            />
          </div>
          <div className="col-span-2"><Label>Memo</Label><Input value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="Reason for credit (optional)" /></div>
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create draft'}</Button><Button type="button" variant="outline" onClick={() => nav('/ap/vendor-credits')}>Cancel</Button></div>
    </form>
  );
}
