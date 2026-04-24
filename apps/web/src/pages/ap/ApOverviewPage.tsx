import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type TopVendor = {
  vendor_id: string;
  vendor_name: string;
  outstanding: string;
};

type Overview = {
  outstanding_bills_total: string;
  overdue_bills_count: number;
  upcoming_payments_7d: string;
  upcoming_payments_30d: string;
  top_vendors: TopVendor[];
};

export default function ApOverviewPage() {
  const [bizId] = useActiveBusinessId();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bizId) return;
    setData(null);
    setError(null);
    api.get<Overview>(`/businesses/${bizId}/ap-overview`)
      .then(r => setData(r.data))
      .catch((e: unknown) => {
        const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
        setError(msg ?? (e instanceof Error ? e.message : 'Failed to load AP overview'));
      });
  }, [bizId]);

  if (!bizId) return <div>Pick a business.</div>;
  if (error) return <div className="text-sm text-destructive">{error}</div>;
  if (!data) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">AP Overview</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Outstanding bills</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">${data.outstanding_bills_total}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Overdue bills</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{data.overdue_bills_count}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Due next 7 days</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">${data.upcoming_payments_7d}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Due next 30 days</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">${data.upcoming_payments_30d}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Top vendors by outstanding balance</CardTitle></CardHeader>
        <CardContent className="p-0">
          {data.top_vendors.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No outstanding bills.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="text-left p-3">Vendor</th>
                  <th className="text-right p-3">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {data.top_vendors.map(v => (
                  <tr key={v.vendor_id} className="border-b last:border-b-0">
                    <td className="p-3">{v.vendor_name}</td>
                    <td className="p-3 text-right font-mono">${v.outstanding}</td>
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
