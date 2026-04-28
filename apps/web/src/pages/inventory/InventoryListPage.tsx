import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

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

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <Button asChild>
          <Link to="/inventory/items/new">Add item</Link>
        </Button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : items.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No inventory items yet. Add one to track stock.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="text-left p-3">SKU</th>
                  <th className="text-left p-3">Name</th>
                  <th className="text-left p-3">Unit</th>
                  <th className="text-right p-3">Purchase Cost</th>
                  <th className="text-right p-3">Sale Price</th>
                  <th className="text-right p-3">Qty on Hand</th>
                  <th className="text-left p-3">Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b last:border-b-0">
                    <td className="p-3 font-mono">{it.sku}</td>
                    <td className="p-3">{it.name}</td>
                    <td className="p-3">{it.unit_of_measure}</td>
                    <td className="p-3 text-right">{it.purchase_cost ? fmtMoney(it.purchase_cost) : '—'}</td>
                    <td className="p-3 text-right">{it.sale_price ? fmtMoney(it.sale_price) : '—'}</td>
                    <td className="p-3 text-right">{fmtMoney(it.quantity_on_hand)}</td>
                    <td className="p-3">
                      <span
                        className={
                          it.is_active
                            ? 'inline-flex items-center rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800'
                            : 'inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
                        }
                      >
                        {it.is_active ? 'active' : 'inactive'}
                      </span>
                    </td>
                    <td className="p-3">
                      <Link className="text-primary underline" to={`/inventory/items/${it.id}`}>
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
