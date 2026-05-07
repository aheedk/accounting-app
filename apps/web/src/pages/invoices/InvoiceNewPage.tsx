import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AccountSelect } from '@/components/ui/AccountSelect';
import { fmtMoney, parseMoneyInput } from '@/lib/money';

type Line = { description: string; quantity: string; unit_price: string; revenue_account_id: string; tax_code_id: string | null };
type Customer = { id: string; name: string };
type Account = { id: string; code: string; name: string; account_type: string; is_system: boolean; is_active: boolean };
type TaxCode = { id: string; code: string; name: string; current_rate: string | null };
const blank = (): Line => ({ description: '', quantity: '1', unit_price: '0.00', revenue_account_id: '', tax_code_id: null });

const STANDARD_TERMS = ['Due on receipt', 'Net 15', 'Net 30', 'Net 45', 'Net 60'];

export default function InvoiceNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [revenueAccounts, setRevenueAccounts] = useState<Account[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [hdr, setHdr] = useState({ customer_id: '', invoice_number: '', issue_date: today, due_date: today, memo: '', terms: 'Net 30' });
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/customers`).then(r => setCustomers(r.data.customers));
    api.get(`/businesses/${bizId}/coa`).then(r => setRevenueAccounts(r.data.accounts.filter((a: Account) => a.account_type === 'revenue' && a.is_active)));
    api.get(`/businesses/${bizId}/tax-codes`).then(r => setTaxCodes(r.data.tax_codes ?? []));
    api.get(`/businesses/${bizId}/invoices/next-number`).then(r => {
      setHdr(h => h.invoice_number ? h : { ...h, invoice_number: r.data.next_number });
    });
  }, [bizId]);

  function update(i: number, patch: Partial<Line>) { setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l)); }

  const totals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const l of lines) {
      const qty = Number(l.quantity) || 0;
      const rate = Number(l.unit_price) || 0;
      const lineSub = qty * rate;
      subtotal += lineSub;
      if (l.tax_code_id) {
        const tc = taxCodes.find(t => t.id === l.tax_code_id);
        const r = tc?.current_rate ? Number(tc.current_rate) : 0;
        tax += lineSub * r;
      }
    }
    return { subtotal, tax, total: subtotal + tax };
  }, [lines, taxCodes]);

  function lineAmount(l: Line): number {
    return (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const body = {
        customer_id: hdr.customer_id, invoice_number: hdr.invoice_number,
        issue_date: hdr.issue_date, due_date: hdr.due_date, memo: hdr.memo || null, terms: hdr.terms || null,
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
      <Card><CardHeader><CardTitle>Invoice details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <div><Label>Customer</Label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={hdr.customer_id} onChange={e => setHdr(h => ({ ...h, customer_id: e.target.value }))} required>
              <option value="">Select a customer…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><Label>Invoice no.</Label><Input value={hdr.invoice_number} onChange={e => setHdr(h => ({ ...h, invoice_number: e.target.value }))} placeholder="e.g. 1042" required /></div>
          <div><Label>Terms</Label>
            <Input list="invoice-terms" value={hdr.terms} onChange={e => setHdr(h => ({ ...h, terms: e.target.value }))} placeholder="e.g. Net 30" />
            <datalist id="invoice-terms">{STANDARD_TERMS.map(t => <option key={t} value={t} />)}</datalist>
          </div>
          <div><Label>Invoice date</Label><Input type="date" value={hdr.issue_date} onChange={e => setHdr(h => ({ ...h, issue_date: e.target.value }))} required /></div>
          <div><Label>Due date</Label><Input type="date" value={hdr.due_date} onChange={e => setHdr(h => ({ ...h, due_date: e.target.value }))} required /></div>
          <div><Label>Note to customer</Label><Input value={hdr.memo} onChange={e => setHdr(h => ({ ...h, memo: e.target.value }))} placeholder="Thank you for your business." /></div>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Product or service</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-12 gap-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground border-b pb-2">
            <div className="col-span-1">#</div>
            <div className="col-span-3">Product/service</div>
            <div className="col-span-3">Description</div>
            <div className="col-span-1 text-right">Qty</div>
            <div className="col-span-1 text-right">Rate</div>
            <div className="col-span-1">Tax</div>
            <div className="col-span-2 text-right">Amount</div>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center group">
              <div className="col-span-1 flex items-center gap-2 text-sm text-muted-foreground">
                <span className="cursor-grab select-none text-base leading-none" aria-hidden="true">⋮⋮</span>
                <span className="font-mono">{i + 1}</span>
              </div>
              <div className="col-span-3">
                <Label htmlFor={`line-${i}-revenue`} className="sr-only">Product/service</Label>
                <AccountSelect
                  id={`line-${i}-revenue`}
                  accounts={revenueAccounts}
                  value={l.revenue_account_id}
                  onChange={(id) => update(i, { revenue_account_id: id })}
                  required
                  placeholder="Select product/service…"
                />
              </div>
              <div className="col-span-3">
                <Label htmlFor={`line-${i}-desc`} className="sr-only">Description</Label>
                <Input id={`line-${i}-desc`} value={l.description} onChange={e => update(i, { description: e.target.value })} placeholder="Description" required />
              </div>
              <div className="col-span-1">
                <Label htmlFor={`line-${i}-qty`} className="sr-only">Quantity</Label>
                <Input id={`line-${i}-qty`} type="number" step="0.01" inputMode="decimal" value={l.quantity} onChange={e => update(i, { quantity: e.target.value })} placeholder="1" className="text-right font-mono" />
              </div>
              <div className="col-span-1">
                <Label htmlFor={`line-${i}-unit`} className="sr-only">Rate</Label>
                <Input id={`line-${i}-unit`} type="number" step="0.01" inputMode="decimal" value={l.unit_price} onChange={e => update(i, { unit_price: e.target.value })} placeholder="0.00" className="text-right font-mono" />
              </div>
              <div className="col-span-1">
                <Label htmlFor={`line-${i}-tax`} className="sr-only">Tax code</Label>
                <select id={`line-${i}-tax`} className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={l.tax_code_id ?? ''} onChange={e => update(i, { tax_code_id: e.target.value || null })}>
                  <option value="">—</option>{taxCodes.map((tc: TaxCode) => <option key={tc.id} value={tc.id}>{tc.code}</option>)}
                </select>
              </div>
              <div className="col-span-2 flex items-center justify-end gap-1">
                <span className="font-mono text-sm">{fmtMoney(lineAmount(l).toFixed(2))}</span>
                <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100" onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} disabled={lines.length <= 1} aria-label="Remove line">×</Button>
              </div>
            </div>
          ))}
          <div className="flex justify-between items-start pt-3">
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setLines(ls => [...ls, blank()])}>Add product or service</Button>
              <Button type="button" variant="ghost" onClick={() => setLines([blank()])} disabled={lines.length === 1 && !lines[0]?.description && !lines[0]?.revenue_account_id}>Clear all lines</Button>
            </div>
            <div className="w-72 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-mono">{fmtMoney(totals.subtotal.toFixed(2))}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Sales tax</span><span className="font-mono">{fmtMoney(totals.tax.toFixed(2))}</span></div>
              <div className="flex justify-between border-t pt-1 font-semibold"><span>Invoice total</span><span className="font-mono">{fmtMoney(totals.total.toFixed(2))}</span></div>
            </div>
          </div>
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create draft'}</Button><Button type="button" variant="outline" onClick={() => nav('/invoices')}>Cancel</Button></div>
    </form>
  );
}
