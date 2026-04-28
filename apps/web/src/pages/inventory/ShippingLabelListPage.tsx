import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
          ) : labels.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No shipping labels yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="text-left p-3">Shipped At</th>
                  <th className="text-left p-3">Carrier</th>
                  <th className="text-left p-3">Tracking #</th>
                  <th className="text-left p-3">Linked entity</th>
                  <th className="text-right p-3">Cost</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {labels.map((l) => (
                  <tr key={l.id} className="border-b last:border-b-0">
                    <td className="p-3">{l.shipped_at}</td>
                    <td className="p-3">{l.carrier}</td>
                    <td className="p-3 font-mono text-xs">{l.tracking_number}</td>
                    <td className="p-3 font-mono text-xs">
                      {l.invoice_id
                        ? <span><span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">invoice</span> {l.invoice_id.slice(0, 8)}</span>
                        : l.sales_order_id
                        ? <span><span className="rounded-md bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">SO</span> {l.sales_order_id.slice(0, 8)}</span>
                        : '—'}
                    </td>
                    <td className="p-3 text-right">{l.cost ? fmtMoney(l.cost) : '—'}</td>
                    <td className="p-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => deleteLabel(l.id)}
                      >
                        Delete
                      </Button>
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
