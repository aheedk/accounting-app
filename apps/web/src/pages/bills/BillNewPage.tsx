import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { parseMoneyInput } from '@/lib/money';

type Line = { description: string; quantity: string; unit_price: string; expense_account_id: string };
type Vendor = { id: string; name: string };
type Account = { id: string; code: string; name: string; account_type: string; is_system: boolean; is_active: boolean };
const blank = (): Line => ({ description: '', quantity: '1', unit_price: '0.00', expense_account_id: '' });

export default function BillNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<Account[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [hdr, setHdr] = useState({ vendor_id: '', bill_number: '', bill_date: today, due_date: today, memo: '' });
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/vendors`).then(r => setVendors(r.data.vendors));
    api.get(`/businesses/${bizId}/coa`).then(r => setExpenseAccounts(r.data.accounts.filter((a: Account) => a.account_type === 'expense' && a.is_active)));
  }, [bizId]);

  function update(i: number, patch: Partial<Line>) { setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l)); }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const body = {
        vendor_id: hdr.vendor_id, bill_number: hdr.bill_number,
        bill_date: hdr.bill_date, due_date: hdr.due_date, memo: hdr.memo || null, terms: null,
        lines: lines.map(l => ({
          description: l.description, quantity: parseMoneyInput(l.quantity), unit_price: parseMoneyInput(l.unit_price),
          expense_account_id: l.expense_account_id,
        })),
      };
      const r = await api.post(`/businesses/${bizId}/bills`, body);
      nav(`/ap/bills/${r.data.bill.id}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <form className="space-y-6" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">New Bill</h1>
      <Card><CardHeader><CardTitle>Header</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <div><Label>Vendor</Label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={hdr.vendor_id} onChange={e => setHdr(h => ({ ...h, vendor_id: e.target.value }))} required>
              <option value="">Select…</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div><Label>Bill #</Label><Input value={hdr.bill_number} onChange={e => setHdr(h => ({ ...h, bill_number: e.target.value }))} required /></div>
          <div><Label>Memo</Label><Input value={hdr.memo} onChange={e => setHdr(h => ({ ...h, memo: e.target.value }))} /></div>
          <div><Label>Bill date</Label><Input type="date" value={hdr.bill_date} onChange={e => setHdr(h => ({ ...h, bill_date: e.target.value }))} required /></div>
          <div><Label>Due date</Label><Input type="date" value={hdr.due_date} onChange={e => setHdr(h => ({ ...h, due_date: e.target.value }))} required /></div>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Lines</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-4"><Label className="sr-only">Desc</Label><Input value={l.description} onChange={e => update(i, { description: e.target.value })} placeholder="Description" required /></div>
              <div className="col-span-1"><Label className="sr-only">Qty</Label><Input type="number" step="0.01" value={l.quantity} onChange={e => update(i, { quantity: e.target.value })} /></div>
              <div className="col-span-2"><Label className="sr-only">Unit</Label><Input type="number" step="0.01" value={l.unit_price} onChange={e => update(i, { unit_price: e.target.value })} /></div>
              <div className="col-span-4"><Label className="sr-only">Expense acct</Label>
                <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={l.expense_account_id} onChange={e => update(i, { expense_account_id: e.target.value })} required>
                  <option value="">Account…</option>{expenseAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
              </div>
              <div className="col-span-1"><Button type="button" variant="ghost" onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} disabled={lines.length <= 1}>×</Button></div>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={() => setLines(ls => [...ls, blank()])}>Add line</Button>
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create draft'}</Button><Button type="button" variant="outline" onClick={() => nav('/ap/bills')}>Cancel</Button></div>
    </form>
  );
}
