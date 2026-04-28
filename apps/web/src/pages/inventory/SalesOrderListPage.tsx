import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type SalesOrderStatus = 'draft' | 'confirmed' | 'fulfilled' | 'void';

type SalesOrderRow = {
  id: string;
  so_number: string;
  customer_id: string;
  order_date: string;
  status: SalesOrderStatus;
  invoice_id: string | null;
  memo: string | null;
};

type Customer = { id: string; name: string };

type ListResponse = { sales_orders: SalesOrderRow[] };
type CustomersResponse = { customers: Customer[] };

const STATUSES: SalesOrderStatus[] = ['draft', 'confirmed', 'fulfilled', 'void'];

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

export default function SalesOrderListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<SalesOrderRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!bizId) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get<ListResponse>(`/businesses/${bizId}/sales-orders`, {
        params: statusFilter ? { status: statusFilter } : {},
      });
      setItems(r.data.sales_orders);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed to load sales orders');
    } finally {
      setLoading(false);
    }
  }, [bizId, statusFilter]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!bizId) return;
    api
      .get<CustomersResponse>(`/businesses/${bizId}/customers`)
      .then((r) => setCustomers(r.data.customers))
      .catch(() => setCustomers([]));
  }, [bizId]);

  const customerName = (id: string): string => customers.find((c) => c.id === id)?.name ?? id;

  async function fulfill(id: string) {
    if (!bizId) return;
    setActionErr(null);
    setBusyId(id);
    try {
      await api.post(`/businesses/${bizId}/sales-orders/${id}/fulfill`);
      await reload();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setActionErr(msg ?? 'Failed to fulfill sales order');
    } finally {
      setBusyId(null);
    }
  }

  async function voidIt(id: string) {
    if (!bizId) return;
    if (!window.confirm('Void this sales order?')) return;
    setActionErr(null);
    setBusyId(id);
    try {
      await api.post(`/businesses/${bizId}/sales-orders/${id}/void`);
      await reload();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setActionErr(msg ?? 'Failed to void sales order');
    } finally {
      setBusyId(null);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sales Orders</h1>
        <div className="flex items-center gap-3">
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button asChild>
            <Link to="/inventory/sales-orders/new">New sales order</Link>
          </Button>
        </div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {actionErr && <p className="text-sm text-destructive">{actionErr}</p>}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : items.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No sales orders yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="text-left p-3">SO #</th>
                  <th className="text-left p-3">Customer</th>
                  <th className="text-left p-3">Order Date</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Invoice</th>
                  <th className="text-left p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((so) => {
                  const canFulfill = so.status === 'draft' || so.status === 'confirmed';
                  const canVoid = so.status !== 'fulfilled' && so.status !== 'void';
                  const busy = busyId === so.id;
                  return (
                    <tr key={so.id} className="border-b last:border-b-0">
                      <td className="p-3 font-mono">{so.so_number}</td>
                      <td className="p-3">{customerName(so.customer_id)}</td>
                      <td className="p-3">{so.order_date}</td>
                      <td className="p-3">
                        <span className={statusBadgeClass(so.status)}>{so.status}</span>
                      </td>
                      <td className="p-3">
                        {so.invoice_id ? (
                          <Link className="text-primary underline" to={`/invoices/${so.invoice_id}`}>
                            view invoice
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Link className="text-primary underline" to={`/inventory/sales-orders/${so.id}`}>
                            view
                          </Link>
                          {canFulfill && (
                            <Button size="sm" disabled={busy} onClick={() => fulfill(so.id)}>
                              {busy ? 'Working…' : 'Fulfill'}
                            </Button>
                          )}
                          {canVoid && (
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={busy}
                              onClick={() => voidIt(so.id)}
                            >
                              Void
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
