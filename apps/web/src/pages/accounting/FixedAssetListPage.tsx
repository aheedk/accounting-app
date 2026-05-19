import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
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

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export default function FixedAssetListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<FixedAssetRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

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

  const filtered = statusFilter ? items.filter(a => a.status === statusFilter) : items;

  const columns: Column<FixedAssetRow>[] = [
    { key: 'name', header: 'Name', sortable: true, sortValue: r => r.name, render: r => r.name },
    { key: 'cost', header: 'Cost', sortable: true, align: 'right', sortValue: r => Number(r.cost), render: r => <span className="font-mono">{fmtMoney(r.cost)}</span> },
    { key: 'salvage_value', header: 'Salvage', sortable: true, align: 'right', sortValue: r => Number(r.salvage_value), render: r => <span className="font-mono">{fmtMoney(r.salvage_value)}</span> },
    { key: 'useful_life_years', header: 'Life (yrs)', sortable: true, align: 'right', sortValue: r => r.useful_life_years, render: r => r.useful_life_years },
    { key: 'purchase_date', header: 'Purchase Date', sortable: true, sortValue: r => Date.parse(r.purchase_date), render: r => <span className="whitespace-nowrap">{fmtShortDate(r.purchase_date)}</span> },
    { key: 'status', header: 'Status', sortable: true, sortValue: r => r.status, render: r => <span className="capitalize">{r.status}</span> },
    { key: 'accumulated_depreciation', header: 'Accumulated Dep', sortable: true, align: 'right', sortValue: r => Number(r.accumulated_depreciation), render: r => <span className="font-mono">{fmtMoney(r.accumulated_depreciation)}</span> },
    { key: 'book_value', header: 'Book Value', sortable: true, align: 'right', sortValue: r => Number(r.book_value), render: r => <span className="font-mono">{fmtMoney(r.book_value)}</span> },
  ];

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Fixed Assets</h1>
        <div className="flex items-center gap-3">
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {['active', 'disposed'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <Button asChild>
            <Link to="/accounting/fixed-assets/new">Add fixed asset</Link>
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
              rows={filtered}
              getRowId={r => r.id}
              columns={columns}
              defaultSortKey="purchase_date"
              defaultSortDir="desc"
              actions={r => (
                <Link className="text-primary hover:underline" to={`/accounting/fixed-assets/${r.id}`}>
                  View/Edit
                </Link>
              )}
              emptyMessage="No fixed assets. Add one to track cost and depreciation."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
