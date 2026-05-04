import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AccountSelect } from '@/components/ui/AccountSelect';
import { parseMoneyInput } from '@/lib/money';

type Line = { description: string; quantity: string; unit_price: string; revenue_account_id: string; tax_code_id: string | null };
type Customer = { id: string; name: string };
type Account = { id: string; code: string; name: string; account_type: string; is_system: boolean; is_active: boolean };
type TaxCode = { id: string; code: string; name: string };
const blank = (): Line => ({ description: '', quantity: '1', unit_price: '0.00', revenue_account_id: '', tax_code_id: null });

export default function InvoiceNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [revenueAccounts, setRevenueAccounts] = useState<Account[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [hdr, setHdr] = useState({ customer_id: '', invoice_number: '', issue_date: today, due_date: today, memo: '' });
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/customers`).then(r => setCustomers(r.data.customers));
    api.get(`/businesses/${bizId}/coa`).then(r => setRevenueAccounts(r.data.accounts.filter((a: Account) => a.account_type === 'revenue' && a.is_active)));
    api.get(`/businesses/${bizId}/tax-codes`).then(r => setTaxCodes(r.data.tax_codes ?? []));
  }, [bizId]);

  function update(i: number, patch: Partial<Line>) { setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l)); }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const body = {
        customer_id: hdr.customer_id, invoice_number: hdr.invoice_number,
        issue_date: hdr.issue_date, due_date: hdr.due_date, memo: hdr.memo || null, terms: null,
        lines: lines.map(l => ({
          description: l.description, quantity: parseMoneyInput(l.quantity), unit_price: parseMoneyInput(l.unit_price),
          revenue_account_id: l.revenue_account_id, tax_code_id: l.tax_code_id,
        })),
      };
      const r = await api.post(`/businesses/${bizId}/invoices`, body);
      nav(`/invoices/${r.data.invoice.id}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    }
    finally { setBusy(false); }
  }

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <form className="space-y-6" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">New Invoice</h1>
      <Card><CardHeader><CardTitle>Header</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <div><Label>Customer</Label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={hdr.customer_id} onChange={e => setHdr(h => ({ ...h, customer_id: e.target.value }))} required>
              <option value="">Select a customer…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><Label>Invoice #</Label><Input value={hdr.invoice_number} onChange={e => setHdr(h => ({ ...h, invoice_number: e.target.value }))} placeholder="e.g. INV-1042" required /></div>
          <div><Label>Memo</Label><Input value={hdr.memo} onChange={e => setHdr(h => ({ ...h, memo: e.target.value }))} placeholder="Optional note (visible on invoice)" /></div>
          <div><Label>Issue date</Label><Input type="date" value={hdr.issue_date} onChange={e => setHdr(h => ({ ...h, issue_date: e.target.value }))} required /></div>
          <div><Label>Due date</Label><Input type="date" value={hdr.due_date} onChange={e => setHdr(h => ({ ...h, due_date: e.target.value }))} required /></div>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Lines</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-12 gap-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <div className="col-span-3">Description</div>
            <div className="col-span-1 text-right">Qty</div>
            <div className="col-span-2 text-right">Unit price</div>
            <div className="col-span-3">Revenue account (credit)</div>
            <div className="col-span-2">Tax</div>
            <div className="col-span-1" />
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-start">
              <div className="col-span-3">
                <Label htmlFor={`line-${i}-desc`} className="sr-only">Description</Label>
                <Input id={`line-${i}-desc`} value={l.description} onChange={e => update(i, { description: e.target.value })} placeholder="What was sold" required />
              </div>
              <div className="col-span-1">
                <Label htmlFor={`line-${i}-qty`} className="sr-only">Quantity</Label>
                <Input id={`line-${i}-qty`} type="number" step="0.01" inputMode="decimal" value={l.quantity} onChange={e => update(i, { quantity: e.target.value })} placeholder="1" className="text-right font-mono" />
              </div>
              <div className="col-span-2">
                <Label htmlFor={`line-${i}-unit`} className="sr-only">Unit price</Label>
                <Input id={`line-${i}-unit`} type="number" step="0.01" inputMode="decimal" value={l.unit_price} onChange={e => update(i, { unit_price: e.target.value })} placeholder="0.00" className="text-right font-mono" />
              </div>
              <div className="col-span-3">
                <Label htmlFor={`line-${i}-revenue`} className="sr-only">Revenue account</Label>
                <AccountSelect
                  id={`line-${i}-revenue`}
                  accounts={revenueAccounts}
                  value={l.revenue_account_id}
                  onChange={(id) => update(i, { revenue_account_id: id })}
                  required
                  placeholder="Search revenue account…"
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor={`line-${i}-tax`} className="sr-only">Tax code</Label>
                <select id={`line-${i}-tax`} className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={l.tax_code_id ?? ''} onChange={e => update(i, { tax_code_id: e.target.value || null })}>
                  <option value="">No tax</option>{taxCodes.map((tc: TaxCode) => <option key={tc.id} value={tc.id}>{tc.code}</option>)}
                </select>
              </div>
              <div className="col-span-1 flex items-center justify-end">
                <Button type="button" variant="ghost" onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} disabled={lines.length <= 1} aria-label="Remove line">×</Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={() => setLines(ls => [...ls, blank()])}>Add line</Button>
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create draft'}</Button><Button type="button" variant="outline" onClick={() => nav('/invoices')}>Cancel</Button></div>
    </form>
  );
}
