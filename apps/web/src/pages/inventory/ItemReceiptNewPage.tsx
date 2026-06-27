import { useEffect, useMemo, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fmtMoney } from '@/lib/money';

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

function pickErr(e: unknown): string {
  return (
    (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data
      ?.error?.message ?? 'Failed to receive purchase order'
  );
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ItemReceiptNewPage() {
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [selectedPoId, setSelectedPoId] = useState('');
  const [poDetail, setPoDetail] = useState<POWithLines | null>(null);
  const [loadingPo, setLoadingPo] = useState(false);
  const [receiptDate, setReceiptDate] = useState(todayIso());
  const [memo, setMemo] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get<POListResponse>(`/businesses/${bizId}/purchase-orders`, { params: { status: 'sent' } })
      .then((r) => setPos(r.data.purchase_orders))
      .catch(() => {});
    api.get<VendorsResponse>(`/businesses/${bizId}/vendors`)
      .then((r) => setVendors(r.data.vendors))
      .catch(() => {});
    api.get<ItemsResponse>(`/businesses/${bizId}/inventory-items?include_inactive=true`)
      .then((r) => setItems(r.data.items))
      .catch(() => {});
  }, [bizId]);

  useEffect(() => {
    if (!bizId || !selectedPoId) { setPoDetail(null); return; }
    setLoadingPo(true);
    api.get<POWithLines>(`/businesses/${bizId}/purchase-orders/${selectedPoId}`)
      .then((r) => setPoDetail(r.data))
      .catch((e: unknown) => { setPoDetail(null); setErr(pickErr(e)); })
      .finally(() => setLoadingPo(false));
  }, [bizId, selectedPoId]);

  const vendorMap = useMemo(() => new Map(vendors.map((v) => [v.id, v.name])), [vendors]);
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const selectedPo = pos.find((p) => p.id === selectedPoId);
  const vendorName = selectedPo ? (vendorMap.get(selectedPo.vendor_id) ?? '—') : '';

  async function save(andClose: boolean) {
    if (!bizId || !selectedPoId) return;
    setBusy(true);
    setErr(null);
    try {
      const body: { purchase_order_id: string; receipt_date: string; memo?: string } = {
        purchase_order_id: selectedPoId,
        receipt_date: receiptDate,
      };
      const trimmed = memo.trim();
      if (trimmed !== '') body.memo = trimmed;
      await api.post(`/businesses/${bizId}/item-receipts`, body);
      if (andClose) nav('/inventory/item-receipts');
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await save(true);
  }

  const canSave = !!selectedPoId && !loadingPo && !!poDetail && poDetail.lines.length > 0;

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <form onSubmit={submit} className="pb-20">

      {/* Page title */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Item receipt #(new)</h1>
      </div>

      {/* Top fields: PO / Vendor / Date / Receipt no. */}
      <div className="mb-8 flex flex-wrap items-end gap-4">
        <div className="min-w-[220px]">
          <Label>Purchase order</Label>
          <select
            className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm shadow-sm"
            value={selectedPoId}
            onChange={(e) => { setSelectedPoId(e.target.value); setErr(null); }}
            required
          >
            <option value="">Choose a PO…</option>
            {pos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.po_number} — {vendorMap.get(p.vendor_id) ?? 'Unknown vendor'}
              </option>
            ))}
          </select>
          {pos.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">No sent purchase orders available.</p>
          )}
        </div>

        {vendorName && (
          <div className="min-w-[160px]">
            <Label>Vendor</Label>
            <Input value={vendorName} disabled className="mt-1 bg-muted/30 text-muted-foreground" />
          </div>
        )}

        <div>
          <Label>Date</Label>
          <DateInput
            value={receiptDate}
            onChange={(e) => setReceiptDate(e.target.value)}
            required
            className="mt-1"
          />
        </div>

        <div>
          <Label>Receipt no.</Label>
          <Input value="(auto-assigned)" disabled className="mt-1 w-36 bg-muted/30 text-muted-foreground" />
        </div>
      </div>

      {/* Item details */}
      <div className="mb-6">
        <h2 className="mb-3 text-base font-semibold">Item details</h2>
        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="w-10 px-4 py-3 text-left font-medium text-muted-foreground">#</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Product / Service</th>
                <th className="w-32 px-4 py-3 text-left font-medium text-muted-foreground">SKU</th>
                <th className="w-28 px-4 py-3 text-right font-medium text-muted-foreground">Rate</th>
                <th className="w-32 px-4 py-3 text-right font-medium text-muted-foreground">Qty received</th>
              </tr>
            </thead>
            <tbody>
              {!selectedPoId && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Select a purchase order to see items.
                  </td>
                </tr>
              )}
              {selectedPoId && loadingPo && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {selectedPoId && !loadingPo && poDetail && poDetail.lines.map((l) => {
                const it = itemMap.get(l.inventory_item_id);
                return (
                  <tr key={l.id} className="border-b last:border-b-0">
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{l.line_number}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{it?.name ?? '—'}</span>
                      {l.description && (
                        <span className="block text-xs text-muted-foreground">{l.description}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{it?.sku ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmtMoney(l.unit_cost)}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold">{l.quantity}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Table footer note */}
          {poDetail && poDetail.lines.length > 0 && (
            <div className="border-t bg-muted/10 px-4 py-3">
              <p className="text-xs text-muted-foreground">
                All lines from this purchase order will be received in full. A bill will be created automatically.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Memo */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 mb-6">
        <div>
          <Label>Memo</Label>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={5}
            placeholder="Optional note…"
            className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        {/* Attachments placeholder — matches QBO visual */}
        <div>
          <Label>Attachments</Label>
          <div className="mt-1 flex flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/20 p-8 text-center">
            <p className="text-sm font-medium text-primary">Add attachment</p>
            <p className="text-xs text-muted-foreground">Max file size: 20 MB</p>
          </div>
        </div>
      </div>

      {err && <p className="mb-4 text-sm text-destructive">{err}</p>}

      {/* Sticky bottom action bar */}
      <div className="fixed bottom-0 left-64 right-0 z-20 flex items-center justify-between border-t bg-card px-8 py-3 shadow-sm">
        <Button type="button" variant="outline" onClick={() => nav('/inventory/item-receipts')}>
          Cancel
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={busy || !canSave} onClick={() => save(false)}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button type="submit" disabled={busy || !canSave}>
            {busy ? 'Saving…' : 'Save and close'}
          </Button>
        </div>
      </div>
    </form>
  );
}
