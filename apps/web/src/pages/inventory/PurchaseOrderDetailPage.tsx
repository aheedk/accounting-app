import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type POStatus = 'draft' | 'sent' | 'received' | 'closed' | 'void';

type POLine = {
  id: string;
  inventory_item_id: string;
  line_number: number;
  description: string | null;
  quantity: string;
  unit_cost: string;
};

type PurchaseOrderDetail = {
  id: string;
  po_number: string;
  vendor_id: string;
  order_date: string;
  expected_delivery_date: string | null;
  status: POStatus;
  memo: string | null;
  lines: POLine[];
};

type Vendor = { id: string; name: string };
type InventoryItem = { id: string; sku: string; name: string };
type ItemsResponse = { items: InventoryItem[] };

function statusBadgeClass(status: POStatus): string {
  switch (status) {
    case 'draft':
      return 'inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground';
    case 'sent':
      return 'inline-flex items-center rounded-md bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800';
    case 'received':
      return 'inline-flex items-center rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800';
    case 'closed':
      return 'inline-flex items-center rounded-md bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-800';
    case 'void':
      return 'inline-flex items-center rounded-md bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800';
  }
}

function lineTotal(qty: string, unit: string): number {
  const q = Number(qty);
  const u = Number(unit);
  if (!Number.isFinite(q) || !Number.isFinite(u)) return 0;
  return q * u;
}

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [data, setData] = useState<PurchaseOrderDetail | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [itemMap, setItemMap] = useState<Map<string, InventoryItem>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!bizId || !id) return;
    setErr(null);
    try {
      const r = await api.get<PurchaseOrderDetail>(`/businesses/${bizId}/purchase-orders/${id}`);
      setData(r.data);
      if (r.data.vendor_id) {
        try {
          const v = await api.get<Vendor>(`/businesses/${bizId}/vendors/${r.data.vendor_id}`);
          setVendor(v.data);
        } catch {
          setVendor(null);
        }
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed to load purchase order');
    }
  }

  useEffect(() => {
    void reload();
  }, [bizId, id]);

  useEffect(() => {
    if (!bizId) return;
    api
      .get<ItemsResponse>(`/businesses/${bizId}/inventory-items`)
      .then((r) => setItemMap(new Map(r.data.items.map((it) => [it.id, it]))))
      .catch(() => {
        /* item lookup is best-effort */
      });
  }, [bizId]);

  async function voidIt() {
    if (!bizId || !id) return;
    if (!window.confirm('Void this purchase order?')) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/businesses/${bizId}/purchase-orders/${id}/void`);
      await reload();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed to void');
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;
  if (!data) return <div>{err ?? 'Loading…'}</div>;

  const canVoid = data.status !== 'void' && data.status !== 'received';
  const canReceive = data.status !== 'void' && data.status !== 'received' && data.status !== 'closed';
  const total = data.lines.reduce((acc, l) => acc + lineTotal(l.quantity, l.unit_cost), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Purchase Order {data.po_number}</h1>
        <div className="flex gap-2">
          {canReceive && (
            <Button asChild>
              <Link to={`/inventory/item-receipts/new?po=${data.id}`}>Receive</Link>
            </Button>
          )}
          {canVoid && (
            <Button variant="destructive" disabled={busy} onClick={voidIt}>
              {busy ? 'Voiding…' : 'Void'}
            </Button>
          )}
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Header</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-sm">
          <div>
            Status: <span className={statusBadgeClass(data.status)}>{data.status}</span>
          </div>
          <div>Vendor: {vendor?.name ?? '—'}</div>
          <div>Order date: {data.order_date}</div>
          <div>Expected: {data.expected_delivery_date ?? '—'}</div>
          <div className="col-span-2">Memo: {data.memo ?? '—'}</div>
          <div className="font-semibold">Total: {fmtMoney(total)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="text-left p-3">#</th>
                <th className="text-left p-3">Item</th>
                <th className="text-left p-3">Description</th>
                <th className="text-right p-3">Qty</th>
                <th className="text-right p-3">Unit Cost</th>
                <th className="text-right p-3">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => {
                const it = itemMap.get(l.inventory_item_id);
                return (
                  <tr key={l.id} className="border-b last:border-b-0">
                    <td className="p-3">{l.line_number}</td>
                    <td className="p-3">{it ? `${it.sku} — ${it.name}` : '—'}</td>
                    <td className="p-3">{l.description ?? '—'}</td>
                    <td className="p-3 text-right">{l.quantity}</td>
                    <td className="p-3 text-right">{fmtMoney(l.unit_cost)}</td>
                    <td className="p-3 text-right">{fmtMoney(lineTotal(l.quantity, l.unit_cost))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button variant="outline" onClick={() => nav('/inventory/purchase-orders')}>
        Back to list
      </Button>
    </div>
  );
}
