import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PackageCheck, Trash2 } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DetailField, DetailMetric, DetailPageHeader, baseDetailMenuActions } from '@/components/ui/detail-page';
import { fmtMoney } from '@/lib/money';
import { fmtLongDate } from '@/lib/dates';
import { fmtQty } from '@/lib/labels';

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
      <DetailPageHeader
        eyebrow="Purchase order"
        title={data.po_number}
        subtitle={vendor ? <Link className="text-primary hover:underline" to={`/ap/vendors/${vendor.id}`}>{vendor.name}</Link> : 'Vendor'}
        status={data.status}
        totalLabel="Order total"
        total={fmtMoney(total)}
        actions={canReceive ? [{ label: 'Receive', icon: <PackageCheck className="h-4 w-4" />, to: `/inventory/item-receipts/new?po=${data.id}` }] : []}
        menuActions={[
          ...baseDetailMenuActions(),
          ...(canVoid ? [{ label: busy ? 'Voiding…' : 'Void purchase order', icon: <Trash2 className="h-4 w-4" />, onSelect: voidIt, destructive: true, disabled: busy }] : []),
        ]}
      />

      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="grid gap-3 md:grid-cols-3">
        <DetailMetric label="Order date" value={<span className="font-sans">{fmtLongDate(data.order_date)}</span>} />
        <DetailMetric
          label="Expected delivery"
          value={<span className="font-sans">{data.expected_delivery_date ? fmtLongDate(data.expected_delivery_date) : 'Not set'}</span>}
        />
        <DetailMetric label="Lines" value={data.lines.length} hint="Received through an item receipt, which raises the bill" />
      </div>

      {data.memo && (
        <Card>
          <CardHeader><CardTitle>Memo</CardTitle></CardHeader>
          <CardContent><DetailField label="Note on this order" value={data.memo} /></CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Items ordered</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
                    <td className="p-3 text-right font-mono">{fmtQty(l.quantity)}</td>
                    <td className="p-3 text-right font-mono">{fmtMoney(l.unit_cost)}</td>
                    <td className="p-3 text-right font-mono">{fmtMoney(lineTotal(l.quantity, l.unit_cost))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Button variant="outline" onClick={() => nav('/inventory/purchase-orders')}>
        Back to purchase orders
      </Button>
    </div>
  );
}
