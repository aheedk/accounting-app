import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { useParams, useNavigate } from 'react-router-dom';
import { SlidersHorizontal } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DetailActivity, DetailField, DetailMetric, DetailPageHeader, baseDetailMenuActions } from '@/components/ui/detail-page';
import { fmtDateTime, fmtLongDate, todayLocal } from '@/lib/dates';
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
  created_at?: string;
  updated_at?: string;
  stock_movements: StockMovement[];
};

type Account = { id: string; code: string; name: string };

const REASONS: Array<{ value: StockMovementReason; label: string }> = [
  { value: 'adjustment', label: 'Adjustment' },
  { value: 'opening_balance', label: 'Opening balance' },
  { value: 'manual_in', label: 'Manual in' },
  { value: 'manual_out', label: 'Manual out' },
  { value: 'write_off', label: 'Write-off' },
];

function today(): string {
  return todayLocal();
}

function reasonLabel(reason: StockMovementReason): string {
  return REASONS.find(r => r.value === reason)?.label ?? reason.replace(/_/g, ' ');
}

function fmtQuantity(value: string | number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSignedQuantity(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const sign = n > 0 ? '+' : '';
  return `${sign}${fmtQuantity(n)}`;
}

export default function InventoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [data, setData] = useState<InventoryItemDetail | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
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
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/coa`, { params: { include_inactive: true } }).then(r => setAccounts(r.data.accounts)).catch(() => setAccounts([]));
  }, [bizId]);

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
      setAdjMsg(`Stock adjusted by ${adjForm.quantity_delta} on ${fmtLongDate(adjForm.movement_date)}.`);
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

  const accountMap = useMemo(() => new Map(accounts.map(a => [a.id, `${a.code} - ${a.name}`])), [accounts]);

  if (!bizId) return <div>Pick a business.</div>;
  if (loadErr) return <div className="text-sm text-destructive">{loadErr}</div>;
  if (!data) return <div>Loading...</div>;

  const lastMovement = data.stock_movements[0];
  const scrollToAdjust = () => document.getElementById('stock-adjust')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="space-y-6">
      <DetailPageHeader
        eyebrow="Inventory item"
        title={data.name}
        subtitle={<span className="font-mono">SKU {data.sku}</span>}
        status={data.is_active ? 'active' : 'inactive'}
        totalLabel="Qty on hand"
        total={fmtQuantity(data.quantity_on_hand)}
        actions={[{ label: 'Adjust stock', icon: <SlidersHorizontal className="h-4 w-4" />, onClick: scrollToAdjust, disabled: !data.is_active }]}
        menuActions={baseDetailMenuActions()}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <DetailMetric label="Quantity on hand" value={fmtQuantity(data.quantity_on_hand)} hint={data.unit_of_measure} />
        <DetailMetric label="Purchase cost" value={data.purchase_cost ? fmtMoney(data.purchase_cost) : '-'} />
        <DetailMetric label="Sale price" value={data.sale_price ? fmtMoney(data.sale_price) : '-'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Item details</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <DetailField label="SKU" value={data.sku} />
            <DetailField label="Unit" value={data.unit_of_measure} />
            <DetailField label="Income account" value={data.income_account_id ? accountMap.get(data.income_account_id) ?? data.income_account_id.slice(0, 8) : null} />
            <DetailField label="Expense account" value={data.expense_account_id ? accountMap.get(data.expense_account_id) ?? data.expense_account_id.slice(0, 8) : null} />
            <DetailField label="Inventory asset account" value={data.inventory_asset_account_id ? accountMap.get(data.inventory_asset_account_id) ?? data.inventory_asset_account_id.slice(0, 8) : null} />
            <DetailField label="Description" className="sm:col-span-2" value={data.description} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
          <CardContent>
            <DetailActivity
              items={[
                { label: 'Created', value: data.created_at ? fmtDateTime(data.created_at) : null },
                { label: 'Last updated', value: data.updated_at ? fmtDateTime(data.updated_at) : null },
                { label: 'Stock movements', value: data.stock_movements.length ? `${data.stock_movements.length} total` : null },
                { label: 'Last movement', value: lastMovement ? `${fmtSignedQuantity(lastMovement.quantity_delta)} on ${fmtLongDate(lastMovement.movement_date)}` : null },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Stock movements</CardTitle></CardHeader>
        <CardContent className="p-0">
          {data.stock_movements.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No stock movements yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="p-3 text-left">Date</th>
                  <th className="p-3 text-right">Delta</th>
                  <th className="p-3 text-left">Reason</th>
                  <th className="p-3 text-left">Memo</th>
                  <th className="p-3 text-left">Posted by</th>
                  <th className="p-3 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.stock_movements.map((m) => (
                  <tr key={m.id} className="border-b last:border-b-0">
                    <td className="p-3">{fmtLongDate(m.movement_date)}</td>
                    <td
                      className={
                        parseFloat(m.quantity_delta) < 0
                          ? 'p-3 text-right font-mono text-destructive'
                          : 'p-3 text-right font-mono'
                      }
                    >
                      {fmtSignedQuantity(m.quantity_delta)}
                    </td>
                    <td className="p-3">{reasonLabel(m.reason)}</td>
                    <td className="p-3">{m.memo ?? '-'}</td>
                    <td className="p-3">{m.posted_by_name ?? '-'}</td>
                    <td className="p-3">{fmtDateTime(m.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card id="stock-adjust">
        <CardHeader><CardTitle>Adjust stock</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-2" onSubmit={submitAdjust}>
            <div>
              <Label>Movement date</Label>
              <DateInput
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
                placeholder="e.g. 10.00 or -3.00"
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
            <div className="md:col-span-2 flex gap-2">
              <Button type="submit" disabled={busy || !data.is_active}>
                {busy ? 'Saving...' : 'Adjust stock'}
              </Button>
            </div>
          </form>
          {adjErr && <p className="mt-3 text-sm text-destructive">{adjErr}</p>}
          {adjMsg && <p className="mt-3 text-sm text-emerald-700">{adjMsg}</p>}
        </CardContent>
      </Card>

      <Button variant="outline" onClick={() => nav('/inventory/items')}>
        Back to inventory
      </Button>
    </div>
  );
}
