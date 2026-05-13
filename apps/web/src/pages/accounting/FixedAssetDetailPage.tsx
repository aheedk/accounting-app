import { useCallback, useEffect, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';

type FixedAssetStatus = 'active' | 'disposed';

type DepreciationEntry = {
  id: string;
  period_end: string;
  amount: string;
  journal_entry_id: string;
};

type FixedAssetDetail = {
  id: string;
  business_id: string;
  name: string;
  asset_account_id: string;
  depreciation_expense_account_id: string;
  accumulated_depreciation_account_id: string;
  purchase_date: string;
  cost: string;
  salvage_value: string;
  useful_life_years: number;
  depreciation_method: 'straight_line';
  status: FixedAssetStatus;
  memo: string | null;
  accumulated_depreciation: string;
  book_value: string;
  depreciation_history?: DepreciationEntry[];
};

function lastDayOfCurrentMonth(): string {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const y = last.getFullYear();
  const m = String(last.getMonth() + 1).padStart(2, '0');
  const d = String(last.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function FixedAssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [data, setData] = useState<FixedAssetDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [periodEnd, setPeriodEnd] = useState<string>(lastDayOfCurrentMonth());
  const [runErr, setRunErr] = useState<string | null>(null);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!bizId || !id) return;
    setLoadErr(null);
    try {
      const r = await api.get<FixedAssetDetail>(`/businesses/${bizId}/fixed-assets/${id}`);
      setData(r.data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setLoadErr(msg ?? 'Failed to load fixed asset');
    }
  }, [bizId, id]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setRunErr(null);
    setRunMsg(null);
    setBusy(true);
    try {
      await api.post(`/businesses/${bizId}/fixed-assets/${id}/depreciate`, { period_end: periodEnd });
      setRunMsg(`Depreciation posted for ${periodEnd}.`);
      await reload();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setRunErr(msg ?? 'Failed to run depreciation');
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;
  if (loadErr) return <div className="text-sm text-destructive">{loadErr}</div>;
  if (!data) return <div>Loading…</div>;

  const history = data.depreciation_history ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{data.name}</h1>
        <span
          className={
            data.status === 'active'
              ? 'inline-flex items-center rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800'
              : 'inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
          }
        >
          {data.status}
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-sm">
          <div>Name: {data.name}</div>
          <div>Status: {data.status}</div>
          <div>Purchase date: {data.purchase_date}</div>
          <div>Useful life: {data.useful_life_years} yr(s)</div>
          <div>Method: {data.depreciation_method}</div>
          <div>Memo: {data.memo ?? '—'}</div>
          <div>Cost: {fmtMoney(data.cost)}</div>
          <div>Salvage value: {fmtMoney(data.salvage_value)}</div>
          <div>Accumulated depreciation: {fmtMoney(data.accumulated_depreciation)}</div>
          <div className="font-semibold">Book value: {fmtMoney(data.book_value)}</div>
          <div className="col-span-2 font-mono text-xs text-muted-foreground">
            Asset acct: {data.asset_account_id}
          </div>
          <div className="col-span-2 font-mono text-xs text-muted-foreground">
            Depreciation expense acct: {data.depreciation_expense_account_id}
          </div>
          <div className="col-span-2 font-mono text-xs text-muted-foreground">
            Accumulated depreciation acct: {data.accumulated_depreciation_account_id}
          </div>
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Depreciation history</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="text-left p-3">Period end</th>
                  <th className="text-right p-3">Amount</th>
                  <th className="text-left p-3">Journal entry</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b last:border-b-0">
                    <td className="p-3">{h.period_end}</td>
                    <td className="p-3 text-right">{fmtMoney(h.amount)}</td>
                    <td className="p-3 font-mono text-xs">{h.journal_entry_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Run depreciation</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex items-end gap-3" onSubmit={run}>
            <div>
              <Label>Period end</Label>
              <DateInput
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={busy || data.status !== 'active'}>
              {busy ? 'Running…' : 'Run'}
            </Button>
          </form>
          {runErr && <p className="mt-3 text-sm text-destructive">{runErr}</p>}
          {runMsg && <p className="mt-3 text-sm text-emerald-700">{runMsg}</p>}
        </CardContent>
      </Card>

      <Button variant="outline" onClick={() => nav('/accounting/fixed-assets')}>
        Back to list
      </Button>
    </div>
  );
}
