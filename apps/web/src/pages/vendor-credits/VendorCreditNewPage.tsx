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

type Address = { line1?: string; line2?: string; city?: string; state?: string; postal_code?: string; country?: string };
type Vendor = { id: string; name: string; billing_address: Address | null };
type Account = { id: string; code: string; name: string; account_type: string; is_system: boolean; is_active: boolean };

function fmtAddress(a: Address | null | undefined): string {
  if (!a) return '';
  const cityLine = [a.city, a.state, a.postal_code].filter(Boolean).join(', ');
  return [a.line1, a.line2, cityLine, a.country].filter(Boolean).join('\n');
}

export default function VendorCreditNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [offsetAccounts, setOffsetAccounts] = useState<Account[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ vendor_id: '', credit_date: today, amount: '', offset_account_id: '', memo: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/vendors`).then(r => setVendors(r.data.vendors));
    // Slice 2: offset accounts are any active expense accounts.
    api.get(`/businesses/${bizId}/coa`).then(r => setOffsetAccounts(r.data.accounts.filter((a: Account) => a.account_type === 'expense' && a.is_active)));
  }, [bizId]);

  const vendor = useMemo(() => vendors.find(v => v.id === form.vendor_id), [vendors, form.vendor_id]);
  const creditAmount = Number(form.amount) || 0;

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
    <form className="space-y-6" onSubmit={submit}>
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-semibold">Vendor Credit</h1>
        <div className="text-right">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Credit amount</div>
          <div className="text-3xl font-semibold font-mono">{fmtMoney(String(creditAmount))}</div>
        </div>
      </div>

      <Card><CardContent className="grid grid-cols-1 gap-3 pt-6 md:grid-cols-3">
        <div>
          <Label className="text-xs text-muted-foreground">Vendor</Label>
          <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.vendor_id} onChange={e => setForm(f => ({ ...f, vendor_id: e.target.value }))} required>
            <option value="">Choose a vendor</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <div className="mt-3">
            <Label className="text-xs text-muted-foreground">Mailing address</Label>
            <div className="min-h-[5rem] whitespace-pre-line rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              {fmtAddress(vendor?.billing_address) || '—'}
            </div>
          </div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Payment date</Label>
          <DateInput value={form.credit_date} onChange={e => setForm(f => ({ ...f, credit_date: e.target.value }))} required />
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
                  accounts={offsetAccounts}
                  value={form.offset_account_id}
                  onChange={(id) => setForm(f => ({ ...f, offset_account_id: id }))}
                  required
                  placeholder="Search expense account to reverse…"
                />
              </td>
              <td className="p-3">
                <Input value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="Reason for credit (optional)" />
              </td>
              <td className="p-3">
                <Input
                  type="number" step="0.01" inputMode="decimal"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00" required
                  className="text-right font-mono"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <div className="flex justify-end gap-12 border-t px-6 py-4 text-sm font-semibold">
          <span>Total</span>
          <span className="font-mono">{fmtMoney(String(creditAmount))}</span>
        </div>
      </CardContent></Card>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex items-center gap-2 sticky bottom-0 border-t bg-background py-3">
        <Button type="button" variant="outline" onClick={() => nav('/ap/vendor-credits')}>Cancel</Button>
        <div className="flex-1" />
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</Button>
      </div>
    </form>
  );
}
