import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';

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

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
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

  const vendorMap = useMemo(() => new Map(vendors.map((v) => [v.id, v.name])), [vendors]);

  type Row = PurchaseOrder & { vendor_name: string };
  const rows: Row[] = useMemo(
    () => items.map((po) => ({ ...po, vendor_name: vendorMap.get(po.vendor_id) ?? '' })),
    [items, vendorMap],
  );

  const columns: Column<Row>[] = [
    {
      key: 'po_number',
      header: 'PO #',
      sortable: true,
      sortValue: r => r.po_number,
      render: r => <span className="font-mono">{r.po_number}</span>,
    },
    {
      key: 'vendor',
      header: 'Vendor',
      sortable: true,
      sortValue: r => r.vendor_name,
      render: r => r.vendor_name || <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'order_date',
      header: 'Order date',
      sortable: true,
      sortValue: r => Date.parse(r.order_date) || 0,
      render: r => <span className="whitespace-nowrap">{fmtShortDate(r.order_date)}</span>,
    },
    {
      key: 'expected_delivery_date',
      header: 'Expected',
      sortable: true,
      sortValue: r => r.expected_delivery_date ? Date.parse(r.expected_delivery_date) || 0 : 0,
      render: r => r.expected_delivery_date
        ? <span className="whitespace-nowrap">{fmtShortDate(r.expected_delivery_date)}</span>
        : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: r => r.status,
      render: r => <span className={statusBadgeClass(r.status)}>{r.status}</span>,
    },
  ];

  if (!bizId) return <div>Pick a business.</div>;

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
          <DataTable
            rows={rows}
            getRowId={r => r.id}
            columns={columns}
            defaultSortKey="order_date"
            defaultSortDir="desc"
            actions={r => (
              <span className="inline-flex items-center gap-3">
                <Link className="text-primary underline" to={`/inventory/purchase-orders/${r.id}`}>
                  view
                </Link>
                {r.status !== 'received' && r.status !== 'void' && (
                  <button
                    type="button"
                    className="text-destructive underline disabled:opacity-50"
                    disabled={busyId === r.id}
                    onClick={() => voidIt(r.id)}
                  >
                    {busyId === r.id ? 'voiding…' : 'void'}
                  </button>
                )}
              </span>
            )}
            emptyMessage="No purchase orders yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}
