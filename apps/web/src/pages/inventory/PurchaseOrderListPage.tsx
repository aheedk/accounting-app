import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type POStatus = 'draft' | 'sent' | 'received' | 'closed' | 'void';

type PurchaseOrder = {
  id: string;
  po_number: string;
  vendor_id: string;
  order_date: string;
  expected_delivery_date: string | null;
  status: POStatus;
  memo: string | null;
};

type Vendor = { id: string; name: string };

type ListResponse = { purchase_orders: PurchaseOrder[] };
type VendorsResponse = { vendors: Vendor[] };

const STATUS_OPTIONS: POStatus[] = ['draft', 'sent', 'received', 'closed', 'void'];

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

export default function PurchaseOrderListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!bizId) return;
    setErr(null);
    api
      .get<ListResponse>(`/businesses/${bizId}/purchase-orders`, {
        params: statusFilter ? { status: statusFilter } : {},
      })
      .then((r) => setItems(r.data.purchase_orders))
      .catch((e: unknown) => {
        const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
        setErr(msg ?? 'Failed to load purchase orders');
      });
    api
      .get<VendorsResponse>(`/businesses/${bizId}/vendors`)
      .then((r) => setVendors(r.data.vendors))
      .catch(() => {
        /* vendor lookup is best-effort */
      });
  }, [bizId, statusFilter, reloadKey]);

  async function voidIt(id: string) {
    if (!bizId) return;
    if (!window.confirm('Void this purchase order?')) return;
    setBusyId(id);
    setErr(null);
    try {
      await api.post(`/businesses/${bizId}/purchase-orders/${id}/void`);
      setReloadKey((k) => k + 1);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed to void');
    } finally {
      setBusyId(null);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  const vendorMap = new Map(vendors.map((v) => [v.id, v.name]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Purchase Orders</h1>
        <div className="flex items-center gap-3">
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button asChild>
            <Link to="/inventory/purchase-orders/new">New PO</Link>
          </Button>
        </div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No purchase orders yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="text-left p-3">PO #</th>
                  <th className="text-left p-3">Vendor</th>
                  <th className="text-left p-3">Order Date</th>
                  <th className="text-left p-3">Expected</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((po) => (
                  <tr key={po.id} className="border-b last:border-b-0">
                    <td className="p-3 font-mono">{po.po_number}</td>
                    <td className="p-3">{vendorMap.get(po.vendor_id) ?? '—'}</td>
                    <td className="p-3">{po.order_date}</td>
                    <td className="p-3">{po.expected_delivery_date ?? '—'}</td>
                    <td className="p-3">
                      <span className={statusBadgeClass(po.status)}>{po.status}</span>
                    </td>
                    <td className="p-3">
                      <div className="flex gap-3">
                        <Link className="text-primary underline" to={`/inventory/purchase-orders/${po.id}`}>
                          view
                        </Link>
                        {po.status !== 'received' && po.status !== 'void' && (
                          <button
                            type="button"
                            className="text-destructive underline disabled:opacity-50"
                            disabled={busyId === po.id}
                            onClick={() => voidIt(po.id)}
                          >
                            {busyId === po.id ? 'voiding…' : 'void'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
