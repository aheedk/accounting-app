import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type SalesOrderStatus = 'draft' | 'confirmed' | 'fulfilled' | 'void';

type SalesOrderLine = {
  id: string;
  line_number: number;
  inventory_item_id: string;
  description: string | null;
  quantity: string;
  unit_price: string;
};

type SalesOrderDetail = {
  id: string;
  business_id: string;
  so_number: string;
  customer_id: string;
  order_date: string;
  status: SalesOrderStatus;
  invoice_id: string | null;
  memo: string | null;
  lines: SalesOrderLine[];
};

type Customer = { id: string; name: string };
type CustomersResponse = { customers: Customer[] };

type InventoryItem = { id: string; sku: string; name: string };
type ItemsResponse = { items: InventoryItem[] };

function statusBadgeClass(status: SalesOrderStatus): string {
  switch (status) {
    case 'fulfilled':
      return 'inline-flex items-center rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800';
    case 'confirmed':
      return 'inline-flex items-center rounded-md bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800';
    case 'void':
      return 'inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground';
    case 'draft':
    default:
      return 'inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800';
  }
}

function lineTotal(l: SalesOrderLine): number {
  const q = parseFloat(l.quantity);
  const p = parseFloat(l.unit_price);
  if (Number.isNaN(q) || Number.isNaN(p)) return 0;
  return q * p;
}

export default function SalesOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [data, setData] = useState<SalesOrderDetail | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!bizId || !id) return;
    setLoadErr(null);
    try {
      const r = await api.get<SalesOrderDetail>(`/businesses/${bizId}/sales-orders/${id}`);
      setData(r.data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setLoadErr(msg ?? 'Failed to load sales order');
    }
  }, [bizId, id]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!bizId) return;
    api
      .get<CustomersResponse>(`/businesses/${bizId}/customers`)
      .then((r) => setCustomers(r.data.customers))
      .catch(() => setCustomers([]));
    api
      .get<ItemsResponse>(`/businesses/${bizId}/inventory-items?include_inactive=true`)
      .then((r) => setItems(r.data.items))
      .catch(() => setItems([]));
  }, [bizId]);

  async function fulfill() {
    if (!bizId || !id) return;
    setActionErr(null);
    setBusy(true);
    try {
      await api.post(`/businesses/${bizId}/sales-orders/${id}/fulfill`);
      await reload();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setActionErr(msg ?? 'Failed to fulfill sales order');
    } finally {
      setBusy(false);
    }
  }

  async function voidIt() {
    if (!bizId || !id) return;
    if (!window.confirm('Void this sales order?')) return;
    setActionErr(null);
    setBusy(true);
    try {
      await api.post(`/businesses/${bizId}/sales-orders/${id}/void`);
      await reload();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setActionErr(msg ?? 'Failed to void sales order');
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;
  if (loadErr) return <div className="text-sm text-destructive">{loadErr}</div>;
  if (!data) return <div>Loading…</div>;

  const customerName = customers.find((c) => c.id === data.customer_id)?.name ?? data.customer_id;
  const itemLabel = (lineItemId: string): string => {
    const it = items.find((x) => x.id === lineItemId);
    return it ? `${it.sku} — ${it.name}` : lineItemId;
  };
  const total = fmtMoney(data.lines.reduce((s, l) => s + lineTotal(l), 0));

  const canFulfill = data.status === 'draft' || data.status === 'confirmed';
  const canVoid = data.status !== 'fulfilled' && data.status !== 'void';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sales Order {data.so_number}</h1>
          <p className="text-sm text-muted-foreground">Customer: {customerName}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={statusBadgeClass(data.status)}>{data.status}</span>
          {canFulfill && (
            <Button disabled={busy} onClick={fulfill}>
              {busy ? 'Working…' : 'Fulfill'}
            </Button>
          )}
          {canVoid && (
            <Button variant="destructive" disabled={busy} onClick={voidIt}>
              Void
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-sm">
          <div>SO #: <span className="font-mono">{data.so_number}</span></div>
          <div>Status: {data.status}</div>
          <div>Order date: {data.order_date}</div>
          <div>Customer: {customerName}</div>
          <div className="col-span-2">Memo: {data.memo ?? '—'}</div>
          <div className="col-span-2">
            Invoice:{' '}
            {data.invoice_id ? (
              <Link className="text-primary underline" to={`/invoices/${data.invoice_id}`}>
                {data.invoice_id}
              </Link>
            ) : (
              '—'
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="text-left p-3">#</th>
                <th className="text-left p-3">Item</th>
                <th className="text-left p-3">Description</th>
                <th className="text-right p-3">Qty</th>
                <th className="text-right p-3">Unit Price</th>
                <th className="text-right p-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.id} className="border-b last:border-b-0">
                  <td className="p-3">{l.line_number}</td>
                  <td className="p-3">{itemLabel(l.inventory_item_id)}</td>
                  <td className="p-3">{l.description ?? '—'}</td>
                  <td className="p-3 text-right">{l.quantity}</td>
                  <td className="p-3 text-right">{fmtMoney(l.unit_price)}</td>
                  <td className="p-3 text-right">{fmtMoney(lineTotal(l))}</td>
                </tr>
              ))}
              <tr className="border-t bg-muted/20 font-semibold">
                <td className="p-3" colSpan={5}>
                  Total
                </td>
                <td className="p-3 text-right">{fmtMoney(total)}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {actionErr && <p className="text-sm text-destructive">{actionErr}</p>}
      <Button variant="outline" onClick={() => nav('/inventory/sales-orders')}>
        Back to list
      </Button>
    </div>
  );
}
