import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileDown, Printer } from 'lucide-react';
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

// Server returns `{ labels: [...] }` (see apps/api/src/routes/shippingLabels.ts).
type ListResponse = { labels: ShippingLabel[] };

function pickErr(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Failed';
}

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

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
      header: 'Linked entity',
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
    win.document.write(`<!DOCTYPE html><html><head><title>Shipping Labels</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>Shipping Labels</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${dlHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}<\/script></body></html>`);
    win.document.close();
  }

  return (
    <div className="space-y-6">
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
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => deleteLabel(r.id)}
                >
                  Delete
                </Button>
              )}
              emptyMessage={<EmptyState title="No shipping labels yet" hint="Create a label to record a shipment's carrier, tracking number, and cost." actionLabel="New label" actionTo="/inventory/shipping-labels/new" />}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
