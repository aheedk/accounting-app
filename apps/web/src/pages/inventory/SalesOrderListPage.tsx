import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileDown, Printer, CheckCircle2 } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';

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

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export default function SalesOrderListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<SalesOrderRow[]>([]);
  const [excelBusy, setExcelBusy] = useState(false);
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

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!bizId) return;
    api.get<CustomersResponse>(`/businesses/${bizId}/customers`)
      .then((r) => setCustomers(r.data.customers))
      .catch(() => setCustomers([]));
  }, [bizId]);

  const customerMap = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);

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

  type Row = SalesOrderRow & { customer_name: string };
  const rows: Row[] = useMemo(
    () => items.map((so) => ({ ...so, customer_name: customerMap.get(so.customer_id) ?? so.customer_id })),
    [items, customerMap],
  );

  const columns: Column<Row>[] = [
    {
      key: 'so_number',
      header: 'SO #',
      sortable: true,
      sortValue: r => r.so_number,
      render: r => <span className="font-mono">{r.so_number}</span>,
    },
    {
      key: 'customer',
      header: 'Customer',
      sortable: true,
      sortValue: r => r.customer_name,
      render: r => r.customer_name || <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'order_date',
      header: 'Order date',
      sortable: true,
      sortValue: r => Date.parse(r.order_date) || 0,
      render: r => <span className="whitespace-nowrap">{fmtShortDate(r.order_date)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: r => r.status,
      render: r => <span className={`${statusBadgeClass(r.status)} capitalize`}>{r.status}</span>,
    },
    {
      key: 'invoice',
      header: 'Invoice',
      render: r => r.invoice_id
        ? <Link className="text-primary underline" to={`/invoices/${r.invoice_id}`}>view invoice</Link>
        : <span className="text-muted-foreground">—</span>,
    },
  ];

  if (!bizId) return <div>Pick a business.</div>;

  const dlHeaders = columns.map(c => c.header);
  const dlRows = () => rows.map(row => columns.map(col => col.sortValue ? String(col.sortValue(row)) : ''));

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'sales-orders'); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    const rowsHtml = dlRows().map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Sales Orders</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>Sales Orders</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${dlHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}</script></body></html>`);
    win.document.close();
  }

  const showHero = !loading && rows.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sales Orders</h1>
        <div className="flex items-center gap-2">
          <div className="relative group">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50" onClick={handleExport} disabled={excelBusy} aria-label="Export to Excel">
              <FileDown className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Export to Excel</div>
          </div>
          <div className="relative group">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground" onClick={handlePrint} aria-label="Print">
              <Printer className="h-4 w-4" />
            </button>
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Print</div>
          </div>
          <Button asChild>
            <Link to="/inventory/sales-orders/new">New sales order</Link>
          </Button>
        </div>
      </div>

      {/* QBO-style hero — shown only when the list is empty */}
      {showHero && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="flex flex-col md:flex-row gap-8 p-10">
            <div className="flex-1 space-y-5">
              <h2 className="text-3xl font-bold leading-tight text-foreground">
                Simplify sales order management
              </h2>
              <p className="text-muted-foreground">
                Reserve inventory, avoid overselling, and sync your inventory with accounting for total peace of mind.
              </p>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                {[
                  'Track what you\'ve committed and stay on top of inventory',
                  'Keep tabs on inventory assets and costs to get the full picture',
                  'See what\'s selling and track popular products with sales reports',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>
              <Button asChild size="lg" className="mt-2">
                <Link to="/inventory/sales-orders/new">Create sales order</Link>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Filters + table — hidden when hero is showing */}
      {!showHero && (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Status</div>
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s} className="capitalize">{s}</option>
                ))}
              </select>
            </div>
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          {actionErr && <p className="text-sm text-destructive">{actionErr}</p>}
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6 text-sm text-muted-foreground">Loading…</div>
              ) : (
                <DataTable
                  rows={rows}
                  getRowId={r => r.id}
                  columns={columns}
                  defaultSortKey="order_date"
                  defaultSortDir="desc"
                  actions={r => {
                    const canFulfill = r.status === 'draft' || r.status === 'confirmed';
                    const canVoid = r.status !== 'fulfilled' && r.status !== 'void';
                    const busy = busyId === r.id;
                    return (
                      <span className="inline-flex items-center gap-2">
                        <Link className="text-primary underline" to={`/inventory/sales-orders/${r.id}`}>view</Link>
                        {canFulfill && (
                          <Button size="sm" disabled={busy} onClick={() => fulfill(r.id)}>
                            {busy ? 'Working…' : 'Fulfill'}
                          </Button>
                        )}
                        {canVoid && (
                          <Button size="sm" variant="destructive" disabled={busy} onClick={() => voidIt(r.id)}>
                            Void
                          </Button>
                        )}
                      </span>
                    );
                  }}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
