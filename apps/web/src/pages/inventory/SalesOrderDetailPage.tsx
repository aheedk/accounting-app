import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
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

type Customer = {
  id: string;
  name: string;
  billing_address: Record<string, string> | null;
};
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

function lineAmount(l: SalesOrderLine): number {
  const q = parseFloat(l.quantity);
  const p = parseFloat(l.unit_price);
  return Number.isNaN(q) || Number.isNaN(p) ? 0 : q * p;
}

function fmtAddress(addr: Record<string, string> | null, name: string): string {
  if (!addr || Object.keys(addr).length === 0) return name;
  const cityLine = [addr['city'], addr['state'], addr['postal_code']].filter(Boolean).join(', ');
  return [name, addr['line1'], addr['line2'], cityLine, addr['country']]
    .filter(Boolean)
    .join('\n');
}

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
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

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!bizId) return;
    api.get<CustomersResponse>(`/businesses/${bizId}/customers`)
      .then((r) => setCustomers(r.data.customers))
      .catch(() => setCustomers([]));
    api.get<ItemsResponse>(`/businesses/${bizId}/inventory-items?include_inactive=true`)
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
  if (!data) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  const customer = customers.find((c) => c.id === data.customer_id);
  const customerName = customer?.name ?? data.customer_id;
  const billToText = fmtAddress(customer?.billing_address ?? null, customerName);

  const itemLabel = (lineItemId: string): string => {
    const it = items.find((x) => x.id === lineItemId);
    return it ? `${it.sku} — ${it.name}` : lineItemId;
  };

  const subtotal = data.lines.reduce((s, l) => s + lineAmount(l), 0);
  const canFulfill = data.status === 'draft' || data.status === 'confirmed';
  const canVoid = data.status !== 'fulfilled' && data.status !== 'void';

  return (
    <div className="space-y-6">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sales Order {data.so_number}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Order date: {fmtShortDate(data.order_date)}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`${statusBadgeClass(data.status)} capitalize`}>{data.status}</span>
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

      {/* Header band — mirrors the create form */}
      <div className="rounded-xl border bg-sky-50 p-6">
        <div className="grid grid-cols-2 gap-6">
          {/* Left: bill-to */}
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Bill to</p>
            <p className="whitespace-pre-line text-sm text-foreground leading-relaxed">{billToText}</p>
          </div>
          {/* Right: metadata */}
          <div className="space-y-2 text-sm">
            <div className="flex gap-2">
              <span className="text-muted-foreground w-36">Sales order no.</span>
              <span className="font-mono font-medium">{data.so_number}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground w-36">Sales order date</span>
              <span>{fmtShortDate(data.order_date)}</span>
            </div>
            {data.invoice_id && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-36">Invoice</span>
                <Link className="text-primary underline" to={`/invoices/${data.invoice_id}`}>
                  view invoice
                </Link>
              </div>
            )}
            {data.memo && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-36">Note to customer</span>
                <span>{data.memo}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Line items table */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 border-b">
            <tr>
              <th className="w-10 px-4 py-3 text-left font-medium text-muted-foreground">#</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Item</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Description</th>
              <th className="w-20 px-4 py-3 text-right font-medium text-muted-foreground">Qty</th>
              <th className="w-28 px-4 py-3 text-right font-medium text-muted-foreground">Rate</th>
              <th className="w-28 px-4 py-3 text-right font-medium text-muted-foreground">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.id} className="border-b last:border-b-0">
                <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{l.line_number}</td>
                <td className="px-4 py-3">{itemLabel(l.inventory_item_id)}</td>
                <td className="px-4 py-3 text-muted-foreground">{l.description ?? '—'}</td>
                <td className="px-4 py-3 text-right font-mono">{l.quantity}</td>
                <td className="px-4 py-3 text-right font-mono">{fmtMoney(l.unit_price)}</td>
                <td className="px-4 py-3 text-right font-mono">{fmtMoney(lineAmount(l).toFixed(2))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals footer */}
        <div className="flex justify-end p-4 border-t bg-muted/10">
          <div className="w-72 space-y-2 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-mono">{fmtMoney(subtotal.toFixed(2))}</span>
            </div>
            <div className="flex justify-between items-center border-t pt-2 font-semibold">
              <span>Sales order total</span>
              <span className="font-mono">{fmtMoney(subtotal.toFixed(2))}</span>
            </div>
          </div>
        </div>
      </div>

      {actionErr && <p className="text-sm text-destructive">{actionErr}</p>}

      <Button variant="outline" onClick={() => nav('/inventory/sales-orders')}>
        Back to list
      </Button>
    </div>
  );
}
