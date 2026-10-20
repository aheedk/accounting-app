import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { pickErr } from '@/lib/apiErrors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
import { ProductServiceSelect, type ProductServiceItem } from '@/components/ui/ProductServiceSelect';
import { fmtMoney, parseMoneyInput } from '@/lib/money';
import { todayLocal } from '@/lib/dates';
import { AppSelect } from '@/components/ui/select';
import { useAddParty } from '@/components/addNew/useAddParty';
import type { EstimateDetail } from '@/lib/estimates';

// A new estimate, or one being changed (/estimates/:id/edit). The lines carry a
// quantity and rate, as QuickBooks' estimate does; each keeps its product's
// income account so the estimate can become an invoice as it stands.
// Spec: docs/specs/2026-10-20-estimates-design.md

type Line = {
  inventory_item_id: string;
  description: string;
  quantity: string;
  unit_price: string;
  /** The account a saved line had, kept if its product has since gone. */
  revenue_account_id?: string;
};
type Customer = { id: string; name: string };
type TaxCode = { id: string; code: string; name: string; current_rate: string | null; is_active: boolean };
const blank = (): Line => ({ inventory_item_id: '', description: '', quantity: '1', unit_price: '' });
const isLineEmpty = (l: Line) => !l.inventory_item_id && !l.description && !l.unit_price;
const lineAmount = (l: Line) => (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);

export default function EstimateFormPage() {
  const { id: editId } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const addCustomer = useAddParty<Customer>('customer', customer => setCustomers(prev => [...prev, customer]));
  const [items, setItems] = useState<ProductServiceItem[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [hdr, setHdr] = useState({
    customer_id: params.get('customer_id') ?? '', estimate_date: todayLocal(), expiration_date: '', memo: '',
  });
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const [taxCodeId, setTaxCodeId] = useState<string | null>(null);
  const [number, setNumber] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!editId);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refetchItems = useCallback(() => {
    if (!bizId) return;
    api.get<{ items: ProductServiceItem[] }>(`/businesses/${bizId}/inventory-items`).then(r => setItems(r.data.items));
  }, [bizId]);

  useEffect(() => {
    if (!bizId) return;
    api.get<{ customers: Customer[] }>(`/businesses/${bizId}/customers`).then(r => setCustomers(r.data.customers));
    refetchItems();
    api.get<{ tax_codes?: TaxCode[] }>(`/businesses/${bizId}/tax-codes`).then(r => setTaxCodes(r.data.tax_codes ?? []));
  }, [bizId, refetchItems]);

  // A product added in another tab shows up when this one is back in front.
  useEffect(() => {
    window.addEventListener('focus', refetchItems);
    return () => window.removeEventListener('focus', refetchItems);
  }, [refetchItems]);

  // A new estimate starts with the company's default sales tax (Company Settings).
  useEffect(() => {
    if (!bizId || editId) return;
    api.get<{ default_sales_tax_code_id?: string | null }>(`/businesses/${bizId}`).then(r => {
      const tax = r.data.default_sales_tax_code_id;
      if (tax) setTaxCodeId(current => current ?? tax);
    }).catch(() => undefined);
  }, [bizId, editId]);

  // Changing an estimate starts from what it says.
  useEffect(() => {
    if (!bizId || !editId) return;
    setLoading(true);
    api.get<EstimateDetail>(`/businesses/${bizId}/estimates/${editId}`).then(r => {
      const { estimate, lines: saved } = r.data;
      setNumber(estimate.estimate_number);
      setHdr({
        customer_id: estimate.customer_id,
        estimate_date: estimate.estimate_date,
        expiration_date: estimate.expiration_date ?? '',
        memo: estimate.memo ?? '',
      });
      setTaxCodeId(saved.find(l => l.tax_code_id)?.tax_code_id ?? null);
      setLines(saved.map(l => ({
        inventory_item_id: l.inventory_item_id ?? '',
        description: l.description,
        quantity: String(Number(l.quantity)),
        unit_price: Number(l.unit_price).toFixed(2),
        revenue_account_id: l.revenue_account_id,
      })));
    }).catch((e: unknown) => setErr(pickErr(e))).finally(() => setLoading(false));
  }, [bizId, editId]);

  function update(i: number, patch: Partial<Line>) {
    setLines(ls => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function pickItem(i: number, item_id: string) {
    const item = items.find(it => it.id === item_id);
    setLines(ls => ls.map((l, idx) => {
      if (idx !== i) return l;
      const next: Line = { ...l, inventory_item_id: item_id };
      delete next.revenue_account_id;
      if (item) {
        if (!l.description) next.description = item.description || item.name;
        if (!l.unit_price && item.sale_price) next.unit_price = Number(item.sale_price).toFixed(2);
      }
      return next;
    }));
  }

  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, l) => sum + lineAmount(l), 0);
    const tc = taxCodes.find(t => t.id === taxCodeId);
    const tax = subtotal * (tc?.current_rate ? Number(tc.current_rate) : 0);
    return { subtotal, tax, total: subtotal + tax };
  }, [lines, taxCodes, taxCodeId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const filled = lines.filter(l => !isLineEmpty(l));
    if (filled.length === 0) { setErr('Add at least one line.'); return; }
    if (hdr.expiration_date && hdr.expiration_date < hdr.estimate_date) {
      setErr('The expiration date cannot be before the estimate date.');
      return;
    }
    const mapped: { inventory_item_id: string | null; description: string; quantity: string; unit_price: string; revenue_account_id: string; tax_code_id: string | null }[] = [];
    for (const l of filled) {
      const item = items.find(it => it.id === l.inventory_item_id);
      const revenue_account_id = item?.income_account_id ?? l.revenue_account_id;
      if (!item && !l.revenue_account_id) { setErr('Pick a product/service for every line.'); return; }
      if (!revenue_account_id) { setErr(`"${item?.name ?? l.description}" has no income account set. Edit the item and assign one.`); return; }
      if (!(Number(l.quantity) > 0)) { setErr('Every line needs a quantity above 0.'); return; }
      mapped.push({
        inventory_item_id: item?.id ?? null,
        description: l.description || item?.name || '',
        quantity: String(Number(l.quantity)),
        unit_price: parseMoneyInput(l.unit_price || '0'),
        revenue_account_id,
        tax_code_id: taxCodeId,
      });
    }
    const body = {
      customer_id: hdr.customer_id,
      estimate_date: hdr.estimate_date,
      expiration_date: hdr.expiration_date || null,
      memo: hdr.memo || null,
      lines: mapped,
    };
    setBusy(true);
    try {
      const r = editId
        ? await api.patch<{ estimate: { id: string } }>(`/businesses/${bizId}/estimates/${editId}`, body)
        : await api.post<{ estimate: { id: string } }>(`/businesses/${bizId}/estimates`, body);
      nav(`/estimates/${r.data.estimate.id}`);
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;
  if (loading) return <LoadingIndicator />;
  return (
    <form className="space-y-6" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">{editId ? `Edit estimate ${number ?? ''}` : 'New Estimate'}</h1>
      <Card><CardHeader><CardTitle>Estimate details</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div><Label>Customer</Label>
            <AppSelect className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={hdr.customer_id}
              onChange={e => setHdr(h => ({ ...h, customer_id: e.target.value }))} required
              onAddNew={() => addCustomer.open(id => setHdr(h => ({ ...h, customer_id: id })))} addNewLabel="Add new customer">
              <option value="">Select a customer…</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </AppSelect>
          </div>
          <div><Label>Estimate no.</Label>
            <Input value={number ?? 'Given when saved'} disabled />
          </div>
          <div className="hidden lg:block" />
          <div><Label>Estimate date</Label>
            <DateInput value={hdr.estimate_date} onChange={e => setHdr(h => ({ ...h, estimate_date: e.target.value }))} required />
          </div>
          <div><Label>Expiration date</Label>
            <DateInput value={hdr.expiration_date} onChange={e => setHdr(h => ({ ...h, expiration_date: e.target.value }))} />
          </div>
          <div><Label>Message to customer</Label>
            <Input value={hdr.memo} onChange={e => setHdr(h => ({ ...h, memo: e.target.value }))} placeholder="Thank you for the opportunity." />
          </div>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Product or service</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-12 gap-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground border-b pb-2">
            <div className="col-span-1">#</div>
            <div className="col-span-3">Product/service</div>
            <div className="col-span-3">Description</div>
            <div className="col-span-1 text-right">Qty</div>
            <div className="col-span-2 text-right">Rate</div>
            <div className="col-span-2 text-right">Amount</div>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center group">
              <div className="col-span-1 font-mono text-sm text-muted-foreground">{i + 1}</div>
              <div className="col-span-3">
                <Label htmlFor={`line-${i}-item`} className="sr-only">Product/service</Label>
                <ProductServiceSelect id={`line-${i}-item`} items={items} value={l.inventory_item_id}
                  onChange={id => pickItem(i, id)} onAddNew={() => window.open('/inventory/items/new', '_blank')}
                  required={!isLineEmpty(l) && !l.revenue_account_id} placeholder="Select product/service…" />
              </div>
              <div className="col-span-3">
                <Label htmlFor={`line-${i}-desc`} className="sr-only">Description</Label>
                <Input id={`line-${i}-desc`} value={l.description} onChange={e => update(i, { description: e.target.value })} placeholder="Description" />
              </div>
              <div className="col-span-1">
                <Label htmlFor={`line-${i}-qty`} className="sr-only">Quantity</Label>
                <Input id={`line-${i}-qty`} type="number" step="0.0001" min="0" value={l.quantity}
                  onChange={e => update(i, { quantity: e.target.value })} className="text-right font-mono" />
              </div>
              <div className="col-span-2">
                <Label htmlFor={`line-${i}-rate`} className="sr-only">Rate</Label>
                <MoneyInput id={`line-${i}-rate`} value={l.unit_price} onChange={e => update(i, { unit_price: e.target.value })} placeholder="0.00" className="text-right font-mono" />
              </div>
              <div className="col-span-2 flex items-center justify-end gap-1">
                <span className="font-mono text-sm">{fmtMoney(lineAmount(l).toFixed(2))}</span>
                <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0 opacity-0 group-hover:opacity-100"
                  onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} disabled={lines.length <= 1} aria-label="Remove line">×</Button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap justify-between items-start gap-4 pt-3">
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setLines(ls => [...ls, blank()])}>Add product or service</Button>
              <Button type="button" variant="ghost" onClick={() => setLines([blank()])} disabled={lines.length === 1 && isLineEmpty(lines[0]!)}>Clear all lines</Button>
            </div>
            <div className="w-80 space-y-2 text-sm">
              <div className="flex justify-between items-center"><span className="text-muted-foreground">Subtotal</span><span className="font-mono">{fmtMoney(totals.subtotal.toFixed(2))}</span></div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-muted-foreground shrink-0">Sales tax</span>
                <AppSelect className="h-8 flex-1 rounded-md border bg-background px-2 text-xs" value={taxCodeId ?? ''} onChange={e => setTaxCodeId(e.target.value || null)}>
                  <option value="">No tax</option>
                  {taxCodes.filter(tc => tc.is_active || tc.id === taxCodeId).map(tc => (
                    <option key={tc.id} value={tc.id}>{tc.code}{tc.current_rate ? ` (${(Number(tc.current_rate) * 100).toFixed(2)}%)` : ''}</option>
                  ))}
                </AppSelect>
                <span className="font-mono w-20 text-right">{fmtMoney(totals.tax.toFixed(2))}</span>
              </div>
              <div className="flex justify-between border-t pt-2 font-semibold"><span>Estimate total</span><span className="font-mono">{fmtMoney(totals.total.toFixed(2))}</span></div>
            </div>
          </div>
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? <span className="inline-flex items-center gap-2"><LoadingIndicator size="sm" /> Saving…</span> : 'Save'}
        </Button>
        <Button type="button" variant="outline" onClick={() => nav(editId ? `/estimates/${editId}` : '/estimates')}>Cancel</Button>
      </div>
      {addCustomer.dialog}
    </form>
  );
}
