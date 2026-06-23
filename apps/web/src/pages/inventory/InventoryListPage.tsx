import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { fmtMoney } from '@/lib/money';

function statusBadge(active: boolean) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';
  return active
    ? <span className={`${base} bg-emerald-100 text-emerald-800`}>Active</span>
    : <span className={`${base} bg-muted text-muted-foreground`}>Inactive</span>;
}

type InventoryItemRow = {
  id: string;
  sku: string;
  name: string;
  unit_of_measure: string;
  purchase_cost: string | null;
  sale_price: string | null;
  is_active: boolean;
  quantity_on_hand: string;
};

type ListResponse = { items: InventoryItemRow[] };

export default function InventoryListPage() {
  const [bizId] = useActiveBusinessId();
  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    if (!bizId) return;
    setLoading(true);
    setErr(null);
    api
      .get<ListResponse>(`/businesses/${bizId}/inventory-items?include_inactive=true`)
      .then((r) => setItems(r.data.items))
      .catch((e: unknown) => {
        const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
        setErr(msg ?? 'Failed to load inventory items');
      })
      .finally(() => setLoading(false));
  }, [bizId]);

  const filtered = statusFilter
    ? items.filter(i => (statusFilter === 'active' ? i.is_active : !i.is_active))
    : items;

  const columns: Column<InventoryItemRow>[] = [
    { key: 'sku', header: 'SKU', sortable: true, sortValue: r => r.sku, render: r => <span className="font-mono">{r.sku}</span> },
    { key: 'name', header: 'Name', sortable: true, sortValue: r => r.name, render: r => <Link className="font-medium hover:underline" to={`/inventory/items/${r.id}`}>{r.name}</Link> },
    { key: 'unit_of_measure', header: 'Unit', sortable: true, sortValue: r => r.unit_of_measure, render: r => r.unit_of_measure },
    { key: 'purchase_cost', header: 'Purchase Cost', sortable: true, align: 'right', sortValue: r => Number(r.purchase_cost ?? 0), render: r => <span className="font-mono">{r.purchase_cost ? fmtMoney(r.purchase_cost) : <span className="text-muted-foreground">—</span>}</span> },
    { key: 'sale_price', header: 'Sale Price', sortable: true, align: 'right', sortValue: r => Number(r.sale_price ?? 0), render: r => <span className="font-mono">{r.sale_price ? fmtMoney(r.sale_price) : <span className="text-muted-foreground">—</span>}</span> },
    { key: 'quantity_on_hand', header: 'Qty on Hand', sortable: true, align: 'right', sortValue: r => Number(r.quantity_on_hand), render: r => <span className="font-mono">{Number(r.quantity_on_hand).toLocaleString()}</span> },
    { key: 'status', header: 'Status', sortable: true, sortValue: r => r.is_active ? 'active' : 'inactive', render: r => statusBadge(r.is_active) },
  ];

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <Button asChild>
          <Link to="/inventory/items/new">Add item</Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Status</div>
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
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
              defaultSortKey="name"
              defaultSortDir="asc"
              downloadable={{ filename: 'inventory', title: 'Inventory' }}
              actions={r => (
                <Link className="text-primary hover:underline" to={`/inventory/items/${r.id}`}>
                  View/Edit
                </Link>
              )}
              emptyMessage={<EmptyState title="No inventory items yet" hint="Add an item to track stock levels, cost, and sale price." actionLabel="Add item" actionTo="/inventory/items/new" />}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
