import { useCallback, useEffect, useState } from 'react';
import { hideUnless, useCan } from '@/lib/roleAccess';
import { DateInput } from '@/components/ui/date-input';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DetailField, DetailMetric, DetailPageHeader, baseDetailMenuActions } from '@/components/ui/detail-page';
import { fmtMoney } from '@/lib/money';
import { fmtLongDate } from '@/lib/dates';
import { humanizeCode } from '@/lib/labels';

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
  // Depreciation posts to the ledger, which is for an accountant.
  const can = useCan();
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const nav = useNavigate();
  const [data, setData] = useState<FixedAssetDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [periodEnd, setPeriodEnd] = useState<string>(lastDayOfCurrentMonth());
  const [runErr, setRunErr] = useState<string | null>(null);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Account names, so the page never shows an account's id.
  const [accountNames, setAccountNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!bizId) return;
    api.get<{ accounts: { id: string; code: string; name: string }[] }>(`/businesses/${bizId}/coa`)
      .then(r => setAccountNames(new Map(r.data.accounts.map(a => [a.id, `${a.code} ${a.name}`]))))
      .catch(() => undefined);
  }, [bizId]);

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
      <DetailPageHeader
        eyebrow="Fixed asset"
        title={data.name}
        subtitle={`Purchased ${fmtLongDate(data.purchase_date)}`}
        status={data.status}
        totalLabel="Book value"
        total={fmtMoney(data.book_value)}
        menuActions={baseDetailMenuActions()}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <DetailMetric label="Cost" value={fmtMoney(data.cost)} hint={`Salvage value ${fmtMoney(data.salvage_value)}`} />
        <DetailMetric
          label="Accumulated depreciation"
          value={fmtMoney(data.accumulated_depreciation)}
          hint={`${history.length} period${history.length === 1 ? '' : 's'} posted`}
        />
        <DetailMetric
          label="Useful life"
          value={<span className="font-sans">{data.useful_life_years} year{data.useful_life_years === 1 ? '' : 's'}</span>}
          hint={humanizeCode(data.depreciation_method)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <DetailField label="Asset account" value={accountNames.get(data.asset_account_id)} />
          <DetailField label="Depreciation expense account" value={accountNames.get(data.depreciation_expense_account_id)} />
          <DetailField label="Accumulated depreciation account" value={accountNames.get(data.accumulated_depreciation_account_id)} />
          <DetailField label="Memo" value={data.memo} />
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
                <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="text-left p-3">Period end</th>
                  <th className="text-right p-3">Amount</th>
                  <th className="text-left p-3">Journal entry</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b last:border-b-0">
                    <td className="p-3">{fmtLongDate(h.period_end)}</td>
                    <td className="p-3 text-right font-mono">{fmtMoney(h.amount)}</td>
                    <td className="p-3"><Link className="text-primary hover:underline" to={`/journal/${h.journal_entry_id}`}>Open entry</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card {...hideUnless(can.accountant)}>
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
        Back to fixed assets
      </Button>
    </div>
  );
}
