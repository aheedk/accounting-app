import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProductServiceSelect, type ProductServiceItem } from '@/components/ui/ProductServiceSelect';
import { fmtMoney, parseMoneyInput } from '@/lib/money';
import { todayLocal } from '@/lib/dates';

type Line = { description: string; inventory_item_id: string; amount: string };
type Customer = { id: string; name: string };
type TaxCode = { id: string; code: string; name: string; current_rate: string | null };
const blank = (): Line => ({ description: '', inventory_item_id: '', amount: '' });

const STANDARD_TERMS = ['Net 30', 'Net 60', 'Net 90', '2/10 Net 30'];

export default function InvoiceNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<ProductServiceItem[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const today = todayLocal();
  const [hdr, setHdr] = useState({ customer_id: '', invoice_number: '', issue_date: today, due_date: today, memo: '', terms: 'Net 30' });
  const [taxCodeId, setTaxCodeId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refetchItems = useCallback(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/inventory-items`).then(r => setItems(r.data.items));
  }, [bizId]);

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/customers`).then(r => setCustomers(r.data.customers));
    refetchItems();
    api.get(`/businesses/${bizId}/tax-codes`).then(r => setTaxCodes(r.data.tax_codes ?? []));
    api.get(`/businesses/${bizId}/invoices/next-number`).then(r => {
      setHdr(h => h.invoice_number ? h : { ...h, invoice_number: r.data.next_number });
    });
  }, [bizId, refetchItems]);

  useEffect(() => {
    function onFocus() { refetchItems(); }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refetchItems]);

  function update(i: number, patch: Partial<Line>) { setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l)); }

  function pickItem(i: number, item_id: string) {
    const item = items.find(it => it.id === item_id);
    setLines(ls => ls.map((l, idx) => {
      if (idx !== i) return l;
      const next: Line = { ...l, inventory_item_id: item_id };
      if (item) {
        if (!l.description && item.name) next.description = item.name;
        if (!l.amount && item.sale_price) next.amount = String(item.sale_price);
      }
      return next;
    }));
  }

  const totals = useMemo(() => {
    let subtotal = 0;
    for (const l of lines) subtotal += Number(l.amount) || 0;
    const tc = taxCodes.find(t => t.id === taxCodeId);
    const taxRate = tc?.current_rate ? Number(tc.current_rate) : 0;
    const tax = subtotal * taxRate;
    return { subtotal, tax, total: subtotal + tax };
  }, [lines, taxCodes, taxCodeId]);

  function isLineEmpty(l: Line) {
    return !l.description && !l.inventory_item_id && !l.amount;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const filled = lines.filter(l => !isLineEmpty(l));
      if (filled.length === 0) { setErr('Add at least one line.'); setBusy(false); return; }
      const mapped: { description: string; quantity: string; unit_price: string; revenue_account_id: string; tax_code_id: string | null }[] = [];
      for (const l of filled) {
        const item = items.find(it => it.id === l.inventory_item_id);
        if (!item) { setErr('Pick a product/service for every line.'); setBusy(false); return; }
        if (!item.income_account_id) { setErr(`"${item.name}" has no income account set. Edit the item and assign one.`); setBusy(false); return; }
        mapped.push({
          description: l.description,
          quantity: '1',
          unit_price: parseMoneyInput(l.amount || '0'),
          revenue_account_id: item.income_account_id,
          tax_code_id: taxCodeId,
        });
      }
      const body = {
        customer_id: hdr.customer_id, invoice_number: hdr.invoice_number,
        issue_date: hdr.issue_date, due_date: hdr.due_date, memo: hdr.memo || null, terms: hdr.terms || null,
        lines: mapped,
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
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={hdr.terms} onChange={e => setHdr(h => ({ ...h, terms: e.target.value }))}>
              {STANDARD_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div><Label>Invoice date</Label><DateInput value={hdr.issue_date} onChange={e => setHdr(h => ({ ...h, issue_date: e.target.value }))} required /></div>
          <div><Label>Due date</Label><DateInput value={hdr.due_date} onChange={e => setHdr(h => ({ ...h, due_date: e.target.value }))} required /></div>
          <div><Label>Note to customer</Label><Input value={hdr.memo} onChange={e => setHdr(h => ({ ...h, memo: e.target.value }))} placeholder="Thank you for your business." /></div>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Product or service</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-12 gap-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground border-b pb-2">
            <div className="col-span-1">#</div>
            <div className="col-span-4">Product/service</div>
            <div className="col-span-5">Description</div>
            <div className="col-span-2 text-right">Amount</div>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center group">
              <div className="col-span-1 flex items-center gap-2 text-sm text-muted-foreground">
                <span className="cursor-grab select-none text-base leading-none" aria-hidden="true">⋮⋮</span>
                <span className="font-mono">{i + 1}</span>
              </div>
              <div className="col-span-4">
                <Label htmlFor={`line-${i}-item`} className="sr-only">Product/service</Label>
                <ProductServiceSelect
                  id={`line-${i}-item`}
                  items={items}
                  value={l.inventory_item_id}
                  onChange={(id) => pickItem(i, id)}
                  onAddNew={() => window.open('/inventory/items/new', '_blank')}
                  required={!isLineEmpty(l)}
                  placeholder="Select product/service…"
                />
              </div>
              <div className="col-span-5">
                <Label htmlFor={`line-${i}-desc`} className="sr-only">Description</Label>
                <Input id={`line-${i}-desc`} value={l.description} onChange={e => update(i, { description: e.target.value })} placeholder="Description" required={!isLineEmpty(l)} />
              </div>
              <div className="col-span-2 flex items-center gap-1">
                <Label htmlFor={`line-${i}-amount`} className="sr-only">Amount</Label>
                <Input id={`line-${i}-amount`} type="number" step="0.01" inputMode="decimal" value={l.amount} onChange={e => update(i, { amount: e.target.value })} placeholder="0.00" className="text-right font-mono" />
                <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0 opacity-0 group-hover:opacity-100" onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} disabled={lines.length <= 1} aria-label="Remove line">×</Button>
              </div>
            </div>
          ))}
          <div className="flex justify-between items-start pt-3">
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setLines(ls => [...ls, blank()])}>Add product or service</Button>
              <Button type="button" variant="ghost" onClick={() => setLines([blank()])} disabled={lines.length === 1 && isLineEmpty(lines[0]!)}>Clear all lines</Button>
            </div>
            <div className="w-80 space-y-2 text-sm">
              <div className="flex justify-between items-center"><span className="text-muted-foreground">Subtotal</span><span className="font-mono">{fmtMoney(totals.subtotal.toFixed(2))}</span></div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-muted-foreground shrink-0">Sales tax</span>
                <select className="h-8 flex-1 rounded-md border bg-background px-2 text-xs" value={taxCodeId ?? ''} onChange={e => setTaxCodeId(e.target.value || null)}>
                  <option value="">No tax</option>{taxCodes.map(tc => <option key={tc.id} value={tc.id}>{tc.code}{tc.current_rate ? ` (${(Number(tc.current_rate) * 100).toFixed(2)}%)` : ''}</option>)}
                </select>
                <span className="font-mono w-20 text-right">{fmtMoney(totals.tax.toFixed(2))}</span>
              </div>
              <div className="flex justify-between border-t pt-2 font-semibold"><span>Invoice total</span><span className="font-mono">{fmtMoney(totals.total.toFixed(2))}</span></div>
            </div>
          </div>
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create draft'}</Button><Button type="button" variant="outline" onClick={() => nav('/invoices')}>Cancel</Button></div>
    </form>
  );
}
