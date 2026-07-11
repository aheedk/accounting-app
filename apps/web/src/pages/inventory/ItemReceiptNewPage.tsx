import { useEffect, useMemo, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';
import { pickErr } from '@/lib/apiErrors';

type POStatus = 'draft' | 'sent' | 'received' | 'closed' | 'void';

type PurchaseOrder = {
  id: string;
  po_number: string;
  vendor_id: string;
  order_date: string;
  status: POStatus;
};

type POLine = {
  id: string;
  line_number: number;
  inventory_item_id: string;
  description: string | null;
  quantity: string;
  unit_cost: string;
};

type POWithLines = PurchaseOrder & { lines: POLine[] };

type InventoryItem = { id: string; sku: string; name: string };

type Vendor = { id: string; name: string };

type POListResponse = { purchase_orders: PurchaseOrder[] };
type ItemsResponse = { items: InventoryItem[] };
type VendorsResponse = { vendors: Vendor[] };


function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

export default function ItemReceiptNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [selectedPoId, setSelectedPoId] = useState<string>('');
  const [poDetail, setPoDetail] = useState<POWithLines | null>(null);
  const [loadingPo, setLoadingPo] = useState(false);
  const [receiptDate, setReceiptDate] = useState<string>(todayIso());
  const [memo, setMemo] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Load receivable POs (status=sent), vendors, and inventory items for display lookups.
  useEffect(() => {
    if (!bizId) return;
    setErr(null);
    api
      .get<POListResponse>(`/businesses/${bizId}/purchase-orders`, { params: { status: 'sent' } })
      .then((r) => setPos(r.data.purchase_orders))
      .catch((e: unknown) => setErr(pickErr(e)));
    api
      .get<VendorsResponse>(`/businesses/${bizId}/vendors`)
      .then((r) => setVendors(r.data.vendors))
      .catch(() => {
        /* best-effort */
      });
    api
      .get<ItemsResponse>(`/businesses/${bizId}/inventory-items?include_inactive=true`)
      .then((r) => setItems(r.data.items))
      .catch(() => {
        /* best-effort */
      });
  }, [bizId]);

  // When PO selection changes, fetch its lines.
  useEffect(() => {
    if (!bizId || !selectedPoId) {
      setPoDetail(null);
      return;
    }
    setLoadingPo(true);
    setErr(null);
    api
      .get<POWithLines>(`/businesses/${bizId}/purchase-orders/${selectedPoId}`)
      .then((r) => setPoDetail(r.data))
      .catch((e: unknown) => {
        setPoDetail(null);
        setErr(pickErr(e));
      })
      .finally(() => setLoadingPo(false));
  }, [bizId, selectedPoId]);

  const vendorMap = useMemo(() => new Map(vendors.map((v) => [v.id, v.name])), [vendors]);
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const total = useMemo(() => {
    if (!poDetail) return '0';
    return poDetail.lines
      .reduce((acc, l) => acc + Number(l.quantity) * Number(l.unit_cost), 0)
      .toString();
  }, [poDetail]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!bizId || !selectedPoId) return;
    setBusy(true);
    setErr(null);
    try {
      const trimmedMemo = memo.trim();
      const body: { purchase_order_id: string; receipt_date: string; memo?: string } = {
        purchase_order_id: selectedPoId,
        receipt_date: receiptDate,
      };
      if (trimmedMemo !== '') body.memo = trimmedMemo;
      await api.post(`/businesses/${bizId}/item-receipts`, body);
      nav('/inventory/item-receipts');
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <form className="space-y-6" onSubmit={submit}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Receive Items</h1>
        <Button asChild variant="outline">
          <Link to="/inventory/item-receipts">Back to receipts</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Select purchase order</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {pos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No purchase orders are awaiting receipt. Create and send a PO first.
            </p>
          ) : (
            <div>
              <Label>Purchase order (status: sent)</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={selectedPoId}
                onChange={(e) => setSelectedPoId(e.target.value)}
                required
              >
                <option value="">Select a PO…</option>
                {pos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.po_number} — {vendorMap.get(p.vendor_id) ?? 'Unknown vendor'} · ordered{' '}
                    {p.order_date}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Receiving is all-or-nothing: every line on the PO will be received in full and a
                Bill will be created automatically.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedPoId && (
        <Card>
          <CardHeader>
            <CardTitle>2. Lines to receive</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loadingPo ? (
              <div className="p-6 text-sm text-muted-foreground">Loading PO…</div>
            ) : !poDetail ? (
              <div className="p-6 text-sm text-muted-foreground">PO not loaded.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="text-left p-3">#</th>
                    <th className="text-left p-3">SKU</th>
                    <th className="text-left p-3">Item</th>
                    <th className="text-left p-3">Description</th>
                    <th className="text-right p-3">Qty</th>
                    <th className="text-right p-3">Unit Cost</th>
                    <th className="text-right p-3">Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {poDetail.lines.map((l) => {
                    const it = itemMap.get(l.inventory_item_id);
                    const lineTotal = (Number(l.quantity) * Number(l.unit_cost)).toString();
                    return (
                      <tr key={l.id} className="border-b last:border-b-0">
                        <td className="p-3">{l.line_number}</td>
                        <td className="p-3 font-mono">{it?.sku ?? '—'}</td>
                        <td className="p-3">{it?.name ?? l.inventory_item_id.slice(0, 8)}</td>
                        <td className="p-3">{l.description ?? '—'}</td>
                        <td className="p-3 text-right">{fmtMoney(l.quantity)}</td>
                        <td className="p-3 text-right">{fmtMoney(l.unit_cost)}</td>
                        <td className="p-3 text-right">{fmtMoney(lineTotal)}</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-muted/20">
                    <td className="p-3 font-semibold" colSpan={6}>
                      Total
                    </td>
                    <td className="p-3 text-right font-semibold">{fmtMoney(total)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>3. Receipt details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label>Receipt date</Label>
            <DateInput
              value={receiptDate}
              onChange={(e) => setReceiptDate(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Memo</Label>
            <Input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Optional note recorded on the receipt and Bill"
            />
          </div>
        </CardContent>
      </Card>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={busy || !selectedPoId || loadingPo || !poDetail || poDetail.lines.length === 0}
        >
          {busy ? 'Receiving…' : 'Receive'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => nav('/inventory/item-receipts')}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
