import { useEffect, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { parseMoneyInput } from '@/lib/money';

type Vendor = { id: string; name: string };
type InventoryItem = { id: string; sku: string; name: string; purchase_cost: string | null };
type Line = { inventory_item_id: string; description: string; quantity: string; unit_cost: string };

type VendorsResponse = { vendors: Vendor[] };
type ItemsResponse = { items: InventoryItem[] };
type CreateResponse = { id: string };

const blank = (): Line => ({ inventory_item_id: '', description: '', quantity: '1', unit_cost: '0.00' });

export default function PurchaseOrderNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [hdr, setHdr] = useState({ vendor_id: '', order_date: today, expected_delivery_date: '', memo: '' });
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get<VendorsResponse>(`/businesses/${bizId}/vendors`).then((r) => setVendors(r.data.vendors));
    api
      .get<ItemsResponse>(`/businesses/${bizId}/inventory-items`)
      .then((r) => setItems(r.data.items));
  }, [bizId]);

  function update(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function pickItem(i: number, itemId: string) {
    const it = items.find((x) => x.id === itemId);
    setLines((ls) =>
      ls.map((l, idx) =>
        idx === i
          ? {
              ...l,
              inventory_item_id: itemId,
              unit_cost: it?.purchase_cost ?? l.unit_cost,
            }
          : l,
      ),
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId) return;
    setErr(null);
    setBusy(true);
    try {
      const body = {
        vendor_id: hdr.vendor_id,
        order_date: hdr.order_date,
        expected_delivery_date: hdr.expected_delivery_date || null,
        memo: hdr.memo || null,
        lines: lines.map((l) => ({
          inventory_item_id: l.inventory_item_id,
          description: l.description || null,
          quantity: parseMoneyInput(l.quantity),
          unit_cost: parseMoneyInput(l.unit_cost),
        })),
      };
      const r = await api.post<CreateResponse>(`/businesses/${bizId}/purchase-orders`, body);
      nav(`/inventory/purchase-orders/${r.data.id}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed');
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <form className="space-y-6" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">New Purchase Order</h1>
      <Card>
        <CardHeader>
          <CardTitle>Header</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <div>
            <Label>Vendor</Label>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={hdr.vendor_id}
              onChange={(e) => setHdr((h) => ({ ...h, vendor_id: e.target.value }))}
              required
            >
              <option value="">Select…</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Order date</Label>
            <DateInput
              value={hdr.order_date}
              onChange={(e) => setHdr((h) => ({ ...h, order_date: e.target.value }))}
              required
            />
          </div>
          <div>
            <Label>Expected delivery</Label>
            <DateInput
              value={hdr.expected_delivery_date}
              onChange={(e) => setHdr((h) => ({ ...h, expected_delivery_date: e.target.value }))}
            />
          </div>
          <div className="col-span-3">
            <Label>Memo</Label>
            <textarea
              className="min-h-[72px] w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={hdr.memo}
              onChange={(e) => setHdr((h) => ({ ...h, memo: e.target.value }))}
            />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-4">
                <Label className="sr-only">Item</Label>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={l.inventory_item_id}
                  onChange={(e) => pickItem(i, e.target.value)}
                  required
                >
                  <option value="">Item…</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.sku} — {it.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-4">
                <Label className="sr-only">Description</Label>
                <Input
                  value={l.description}
                  onChange={(e) => update(i, { description: e.target.value })}
                  placeholder="Description (optional)"
                />
              </div>
              <div className="col-span-1">
                <Label className="sr-only">Qty</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={l.quantity}
                  onChange={(e) => update(i, { quantity: e.target.value })}
                  required
                />
              </div>
              <div className="col-span-2">
                <Label className="sr-only">Unit cost</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={l.unit_cost}
                  onChange={(e) => update(i, { unit_cost: e.target.value })}
                  required
                />
              </div>
              <div className="col-span-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                  disabled={lines.length <= 1}
                >
                  ×
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, blank()])}>
            Add line
          </Button>
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Create PO'}
        </Button>
        <Button type="button" variant="outline" onClick={() => nav('/inventory/purchase-orders')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
