import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type StockMovementReason = 'adjustment' | 'opening_balance' | 'manual_in' | 'manual_out' | 'write_off';

type StockMovement = {
  id: string;
  movement_date: string;
  quantity_delta: string;
  reason: StockMovementReason;
  memo: string | null;
  posted_by_user_id: string | null;
  posted_by_name: string | null;
  created_at: string;
};

type InventoryItemDetail = {
  id: string;
  business_id: string;
  sku: string;
  name: string;
  description: string | null;
  unit_of_measure: string;
  purchase_cost: string | null;
  sale_price: string | null;
  income_account_id: string | null;
  expense_account_id: string | null;
  inventory_asset_account_id: string | null;
  is_active: boolean;
  quantity_on_hand: string;
  stock_movements: StockMovement[];
};

const REASONS: Array<{ value: StockMovementReason; label: string }> = [
  { value: 'adjustment', label: 'Adjustment' },
  { value: 'opening_balance', label: 'Opening balance' },
  { value: 'manual_in', label: 'Manual in' },
  { value: 'manual_out', label: 'Manual out' },
  { value: 'write_off', label: 'Write-off' },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function InventoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [data, setData] = useState<InventoryItemDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [adjForm, setAdjForm] = useState({
    movement_date: today(),
    quantity_delta: '',
    reason: 'adjustment' as StockMovementReason,
    memo: '',
  });
  const [adjErr, setAdjErr] = useState<string | null>(null);
  const [adjMsg, setAdjMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!bizId || !id) return;
    setLoadErr(null);
    try {
      const r = await api.get<InventoryItemDetail>(`/businesses/${bizId}/inventory-items/${id}`);
      setData(r.data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setLoadErr(msg ?? 'Failed to load inventory item');
    }
  }, [bizId, id]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function submitAdjust(e: React.FormEvent) {
    e.preventDefault();
    setAdjErr(null);
    setAdjMsg(null);
    setBusy(true);
    try {
      if (adjForm.quantity_delta.trim() === '') {
        throw new Error('Quantity delta is required');
      }
      const body = {
        movement_date: adjForm.movement_date,
        quantity_delta: adjForm.quantity_delta,
        reason: adjForm.reason,
        memo: adjForm.memo.trim() === '' ? null : adjForm.memo,
      };
      await api.post(`/businesses/${bizId}/inventory-items/${id}/adjust-stock`, body);
      setAdjMsg(`Stock adjusted by ${adjForm.quantity_delta} on ${adjForm.movement_date}.`);
      setAdjForm({ movement_date: today(), quantity_delta: '', reason: 'adjustment', memo: '' });
      await reload();
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message ??
        (e instanceof Error ? e.message : undefined);
      setAdjErr(msg ?? 'Failed to adjust stock');
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;
  if (loadErr) return <div className="text-sm text-destructive">{loadErr}</div>;
  if (!data) return <div>Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{data.name}</h1>
          <p className="text-sm text-muted-foreground font-mono">SKU: {data.sku}</p>
        </div>
        <span
          className={
            data.is_active
              ? 'inline-flex items-center rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800'
              : 'inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
          }
        >
          {data.is_active ? 'active' : 'inactive'}
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-sm">
          <div>SKU: {data.sku}</div>
          <div>Unit: {data.unit_of_measure}</div>
          <div>Purchase cost: {data.purchase_cost ? fmtMoney(data.purchase_cost) : '—'}</div>
          <div>Sale price: {data.sale_price ? fmtMoney(data.sale_price) : '—'}</div>
          <div className="col-span-2">
            Description: {data.description ?? '—'}
          </div>
          <div className="col-span-2 font-mono text-xs text-muted-foreground">
            Income acct: {data.income_account_id ?? '—'}
          </div>
          <div className="col-span-2 font-mono text-xs text-muted-foreground">
            Expense acct: {data.expense_account_id ?? '—'}
          </div>
          <div className="col-span-2 font-mono text-xs text-muted-foreground">
            Inventory asset acct: {data.inventory_asset_account_id ?? '—'}
          </div>
          <div className="col-span-2 font-semibold">
            Quantity on hand: {fmtMoney(data.quantity_on_hand)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stock movements</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.stock_movements.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No stock movements yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="text-left p-3">Date</th>
                  <th className="text-right p-3">Delta</th>
                  <th className="text-left p-3">Reason</th>
                  <th className="text-left p-3">Memo</th>
                  <th className="text-left p-3">Posted by</th>
                </tr>
              </thead>
              <tbody>
                {data.stock_movements.map((m) => (
                  <tr key={m.id} className="border-b last:border-b-0">
                    <td className="p-3">{m.movement_date}</td>
                    <td
                      className={
                        parseFloat(m.quantity_delta) < 0
                          ? 'p-3 text-right text-destructive'
                          : 'p-3 text-right'
                      }
                    >
                      {fmtMoney(m.quantity_delta)}
                    </td>
                    <td className="p-3">{m.reason}</td>
                    <td className="p-3">{m.memo ?? '—'}</td>
                    <td className="p-3">{m.posted_by_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Adjust stock</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid grid-cols-2 gap-3" onSubmit={submitAdjust}>
            <div>
              <Label>Movement date</Label>
              <Input
                type="date"
                value={adjForm.movement_date}
                onChange={(e) => setAdjForm((f) => ({ ...f, movement_date: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label>Quantity delta (signed)</Label>
              <Input
                type="number"
                step="0.0001"
                value={adjForm.quantity_delta}
                onChange={(e) => setAdjForm((f) => ({ ...f, quantity_delta: e.target.value }))}
                placeholder="e.g. 10 or -3"
                required
              />
            </div>
            <div>
              <Label>Reason</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={adjForm.reason}
                onChange={(e) =>
                  setAdjForm((f) => ({ ...f, reason: e.target.value as StockMovementReason }))
                }
              >
                {REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Memo</Label>
              <Input
                value={adjForm.memo}
                onChange={(e) => setAdjForm((f) => ({ ...f, memo: e.target.value }))}
              />
            </div>
            <div className="col-span-2 flex gap-2">
              <Button type="submit" disabled={busy || !data.is_active}>
                {busy ? 'Saving…' : 'Adjust stock'}
              </Button>
            </div>
          </form>
          {adjErr && <p className="mt-3 text-sm text-destructive">{adjErr}</p>}
          {adjMsg && <p className="mt-3 text-sm text-emerald-700">{adjMsg}</p>}
        </CardContent>
      </Card>

      <Button variant="outline" onClick={() => nav('/inventory/items')}>
        Back to list
      </Button>
    </div>
  );
}
