import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { fmtMoney } from '@/lib/money';
import { pickErr } from '@/lib/apiErrors';

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


function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export default function ShippingLabelListPage() {
  const [bizId] = useActiveBusinessId();
  const [labels, setLabels] = useState<ShippingLabel[]>([]);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Shipping Labels</h1>
        <Button asChild>
          <Link to="/inventory/shipping-labels/new">New label</Link>
        </Button>
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
              downloadable={{ filename: 'shipping-labels', title: 'Shipping Labels' }}
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
