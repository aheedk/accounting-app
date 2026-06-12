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
import { todayLocal } from '@/lib/dates';

type Customer = { id: string; name: string };

type InventoryItem = {
  id: string;
  sku: string;
  name: string;
  sale_price: string | null;
  is_active: boolean;
};

type CustomersResponse = { customers: Customer[] };
type ItemsResponse = { items: InventoryItem[] };

type Line = {
  inventory_item_id: string;
  description: string;
  quantity: string;
  unit_price: string;
};

type CreatedSO = { id: string };

const blankLine = (): Line => ({
  inventory_item_id: '',
  description: '',
  quantity: '1',
  unit_price: '0.00',
});

export default function SalesOrderNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const today = todayLocal();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [hdr, setHdr] = useState({
    customer_id: '',
    order_date: today,
    memo: '',
  });
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api
      .get<CustomersResponse>(`/businesses/${bizId}/customers`)
      .then((r) => setCustomers(r.data.customers))
      .catch(() => setCustomers([]));
    api
      .get<ItemsResponse>(`/businesses/${bizId}/inventory-items`)
      .then((r) => setItems(r.data.items.filter((it) => it.is_active)))
      .catch(() => setItems([]));
  }, [bizId]);

  function update(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function pickItem(i: number, itemId: string) {
    const item = items.find((it) => it.id === itemId);
    update(i, {
      inventory_item_id: itemId,
      description: item?.name ?? '',
      unit_price: item?.sale_price ?? '0.00',
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const body = {
        customer_id: hdr.customer_id,
        order_date: hdr.order_date,
        memo: hdr.memo.trim() === '' ? null : hdr.memo,
        lines: lines.map((l) => ({
          inventory_item_id: l.inventory_item_id,
          description: l.description.trim() === '' ? null : l.description,
          quantity: parseMoneyInput(l.quantity),
          unit_price: parseMoneyInput(l.unit_price),
        })),
      };
      const r = await api.post<CreatedSO>(`/businesses/${bizId}/sales-orders`, body);
      nav(`/inventory/sales-orders/${r.data.id}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed to create sales order');
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <form className="space-y-6" onSubmit={submit}>
      <h1 className="text-2xl font-semibold">New Sales Order</h1>
      <Card>
        <CardHeader>
          <CardTitle>Header</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <div>
            <Label>Customer</Label>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={hdr.customer_id}
              onChange={(e) => setHdr((h) => ({ ...h, customer_id: e.target.value }))}
              required
            >
              <option value="">Select…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
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
            <Label>Memo</Label>
            <Input
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
              <div className="col-span-3">
                <Label className="sr-only">Description</Label>
                <Input
                  value={l.description}
                  onChange={(e) => update(i, { description: e.target.value })}
                  placeholder="Description"
                />
              </div>
              <div className="col-span-2">
                <Label className="sr-only">Qty</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={l.quantity}
                  onChange={(e) => update(i, { quantity: e.target.value })}
                  required
                />
              </div>
              <div className="col-span-2">
                <Label className="sr-only">Unit price</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={l.unit_price}
                  onChange={(e) => update(i, { unit_price: e.target.value })}
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
          <Button
            type="button"
            variant="outline"
            onClick={() => setLines((ls) => [...ls, blankLine()])}
          >
            Add line
          </Button>
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Create sales order'}
        </Button>
        <Button type="button" variant="outline" onClick={() => nav('/inventory/sales-orders')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
