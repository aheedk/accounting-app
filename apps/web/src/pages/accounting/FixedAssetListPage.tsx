import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type FixedAssetStatus = 'active' | 'disposed';

type FixedAssetRow = {
  id: string;
  name: string;
  cost: string;
  salvage_value: string;
  useful_life_years: number;
  purchase_date: string;
  status: FixedAssetStatus;
  accumulated_depreciation: string;
  book_value: string;
};

type ListResponse = { fixed_assets: FixedAssetRow[] };

export default function FixedAssetListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<FixedAssetRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!bizId) return;
    setLoading(true);
    setErr(null);
    api
      .get<ListResponse>(`/businesses/${bizId}/fixed-assets`)
      .then((r) => setItems(r.data.fixed_assets))
      .catch((e: unknown) => {
        const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
        setErr(msg ?? 'Failed to load fixed assets');
      })
      .finally(() => setLoading(false));
  }, [bizId]);

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Fixed Assets</h1>
        <Button asChild>
          <Link to="/accounting/fixed-assets/new">Add fixed asset</Link>
        </Button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : items.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No fixed assets. Add one to track cost and depreciation.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="text-left p-3">Name</th>
                  <th className="text-right p-3">Cost</th>
                  <th className="text-right p-3">Salvage</th>
                  <th className="text-right p-3">Life (yrs)</th>
                  <th className="text-left p-3">Purchase Date</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-right p-3">Accumulated Dep</th>
                  <th className="text-right p-3">Book Value</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className="border-b last:border-b-0">
                    <td className="p-3">{a.name}</td>
                    <td className="p-3 text-right">{fmtMoney(a.cost)}</td>
                    <td className="p-3 text-right">{fmtMoney(a.salvage_value)}</td>
                    <td className="p-3 text-right">{a.useful_life_years}</td>
                    <td className="p-3">{a.purchase_date}</td>
                    <td className="p-3">
                      <span
                        className={
                          a.status === 'active'
                            ? 'inline-flex items-center rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800'
                            : 'inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
                        }
                      >
                        {a.status}
                      </span>
                    </td>
                    <td className="p-3 text-right">{fmtMoney(a.accumulated_depreciation)}</td>
                    <td className="p-3 text-right">{fmtMoney(a.book_value)}</td>
                    <td className="p-3">
                      <Link className="text-primary underline" to={`/accounting/fixed-assets/${a.id}`}>
                        view
                      </Link>
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
