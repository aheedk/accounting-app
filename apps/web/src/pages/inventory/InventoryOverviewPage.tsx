import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useActiveBusinessId } from '@/lib/business';
import { api } from '@/lib/apiClient';
import { fmtMoney } from '@/lib/money';

type Overview = {
  total_items_count: number;
  total_stock_value: string;
  recent_receipts: Array<{ id: string; receipt_date: string; po_number: string }>;
  recent_sales: Array<{ id: string; order_date: string; so_number: string }>;
};

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export default function InventoryOverviewPage() {
  const [bizId] = useActiveBusinessId();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bizId) return;
    setData(null);
    setError(null);
    api
      .get<Overview>(`/businesses/${bizId}/inventory-overview`)
      .then((r) => setData(r.data))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'load failed'));
  }, [bizId]);

  if (error) return <div className="text-destructive">{error}</div>;
  if (!data) return <div className="text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Inventory Overview</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{data.total_items_count}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Stock Value</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold font-mono">{fmtMoney(data.total_stock_value)}</CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recent receipts</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recent_receipts.length === 0 ? (
            <div className="text-sm text-muted-foreground">No receipts yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">PO</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_receipts.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 whitespace-nowrap">{fmtShortDate(r.receipt_date)}</td>
                    <td className="px-3 py-2 font-mono">{r.po_number}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recent sales</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recent_sales.length === 0 ? (
            <div className="text-sm text-muted-foreground">No fulfilled sales orders yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">SO</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_sales.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 whitespace-nowrap">{fmtShortDate(r.order_date)}</td>
                    <td className="px-3 py-2 font-mono">{r.so_number}</td>
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
