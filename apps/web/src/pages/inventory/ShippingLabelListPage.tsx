import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileDown, Printer, Package, CheckCircle2 } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { fmtMoney } from '@/lib/money';

type ShippingLabel = {
  id: string;
  invoice_id: string | null;
  sales_order_id: string | null;
  carrier: string;
  tracking_number: string;
  shipped_at: string;
  cost: string | null;
  label_file_id: string | null;
  notes: string | null;
};

type ListResponse = { labels: ShippingLabel[] };

function pickErr(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Failed to load shipping labels';
}

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

const CARRIERS = [
  { name: 'USPS', transit: '1–5 business days', best: true },
  { name: 'FedEx', transit: '1–3 business days', best: false },
  { name: 'UPS',   transit: '1–5 business days', best: false },
];

export default function ShippingLabelListPage() {
  const [bizId] = useActiveBusinessId();
  const [labels, setLabels] = useState<ShippingLabel[]>([]);
  const [excelBusy, setExcelBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!bizId) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get<ListResponse>(`/businesses/${bizId}/shipping-labels`);
      setLabels(r.data.labels);
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setLoading(false);
    }
  }, [bizId]);

  useEffect(() => { reload(); }, [reload]);

  async function deleteLabel(id: string) {
    if (!bizId) return;
    if (!window.confirm('Delete this shipping label? This cannot be undone.')) return;
    setBusy(true);
    setErr(null);
    try {
      await api.delete(`/businesses/${bizId}/shipping-labels/${id}`);
      await reload();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<ShippingLabel>[] = [
    {
      key: 'shipped_at',
      header: 'Shipped at',
      sortable: true,
      sortValue: r => Date.parse(r.shipped_at) || 0,
      render: r => <span className="whitespace-nowrap">{fmtShortDate(r.shipped_at)}</span>,
    },
    {
      key: 'carrier',
      header: 'Carrier',
      sortable: true,
      sortValue: r => r.carrier,
      render: r => r.carrier,
    },
    {
      key: 'tracking_number',
      header: 'Tracking #',
      sortable: true,
      sortValue: r => r.tracking_number,
      render: r => <span className="font-mono text-xs">{r.tracking_number}</span>,
    },
    {
      key: 'linked',
      header: 'Linked Entity',
      render: r => (
        <span className="font-mono text-xs">
          {r.invoice_id
            ? <span><span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">invoice</span> {r.invoice_id.slice(0, 8)}</span>
            : r.sales_order_id
              ? <span><span className="rounded-md bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">SO</span> {r.sales_order_id.slice(0, 8)}</span>
              : <span className="text-muted-foreground">—</span>}
        </span>
      ),
    },
    {
      key: 'cost',
      header: 'Cost',
      align: 'right',
      sortable: true,
      sortValue: r => Number(r.cost ?? 0),
      render: r => <span className="font-mono">{r.cost ? fmtMoney(r.cost) : <span className="text-muted-foreground">—</span>}</span>,
    },
  ];

  if (!bizId) return <div>Pick a business.</div>;

  const dlHeaders = columns.map(c => c.header);
  const dlRows = () => labels.map(row => columns.map(col => col.sortValue ? String(col.sortValue(row)) : ''));

  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), 'shipping-labels'); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    const rowsHtml = dlRows().map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Shipping Labels</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>Shipping Labels</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${dlHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}</script></body></html>`);
    win.document.close();
  }

  return (
    <div className="space-y-6">
      {/* Hero banner — mirrors QBO "Simplify your shipping" layout */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="flex flex-col md:flex-row gap-8 p-8">
          {/* Left: copy + CTA */}
          <div className="flex-1 space-y-4">
            <div className="flex items-center gap-2 text-primary">
              <Package className="h-6 w-6" />
              <span className="text-sm font-semibold uppercase tracking-wide">Shipping</span>
            </div>
            <h2 className="text-3xl font-bold text-foreground leading-tight">
              Track your shipments
            </h2>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {[
                'Record carrier, tracking number, and cost in one place',
                'Link labels directly to invoices or sales orders',
                'See shipping history and costs across all carriers',
                'Download and print your label log any time',
              ].map(item => (
                <li key={item} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  {item}
                </li>
              ))}
            </ul>
            <Button asChild className="mt-2">
              <Link to="/inventory/shipping-labels/new">New label</Link>
            </Button>
          </div>

          {/* Right: carrier reference table */}
          <div className="md:w-72 shrink-0">
            <div className="rounded-lg border bg-background overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Carrier</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Transit time</th>
                  </tr>
                </thead>
                <tbody>
                  {CARRIERS.map((c, i) => (
                    <tr key={c.name} className={i < CARRIERS.length - 1 ? 'border-b' : ''}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {c.best && <CheckCircle2 className="h-4 w-4 text-primary" />}
                          <span className={c.best ? 'font-medium text-foreground' : 'text-muted-foreground'}>{c.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{c.transit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-4 py-2 text-xs text-muted-foreground border-t">
                * Transit times are estimates only
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* List section */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Shipping Labels</h1>
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
            <Link to="/inventory/shipping-labels/new">New label</Link>
          </Button>
        </div>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : (
            <DataTable
              rows={labels}
              getRowId={r => r.id}
              columns={columns}
              defaultSortKey="shipped_at"
              defaultSortDir="desc"
              actions={r => (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => deleteLabel(r.id)}>
                  Delete
                </Button>
              )}
              emptyMessage={
                <EmptyState
                  title="No shipping labels yet"
                  hint="Create a label to record a shipment's carrier, tracking number, and cost."
                  actionLabel="New label"
                  actionTo="/inventory/shipping-labels/new"
                />
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
