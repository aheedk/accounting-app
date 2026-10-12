import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { hideUnless, useCan } from '@/lib/roleAccess';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';
import { todayLocal } from '@/lib/dates';
import { pickErr } from '@/lib/apiErrors';
import { AppSelect } from '../../components/ui/select';
import { ReconcileNav } from './ReconcileNav';

type ReconcilableAccount = { id: string; code: string; name: string; category: string };

type HistoryRow = {
  id: string;
  account_id: string;
  account_code: string | null;
  account_name: string | null;
  category: string;
  statement_ending_date: string;
  statement_ending_balance: string;
  difference: string;
  status: 'completed' | 'cancelled';
  completed_at: string | null;
  completed_by: string | null;
  items_cleared: number;
  changes: number;
  auto_adjustment: string | null;
};

type DetailItem = { transaction_type: string; transaction_id: string; transaction_date: string; description: string | null; amount: string; is_cleared: boolean };

type Period = 'since_365' | 'this_year' | 'last_year' | 'all_time';

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

function withinPeriod(dateIso: string, period: Period): boolean {
  if (period === 'all_time') return true;
  const today = todayLocal();
  const thisYear = Number(today.slice(0, 4));
  const year = Number(dateIso.slice(0, 4));
  if (period === 'this_year') return year === thisYear;
  if (period === 'last_year') return year === thisYear - 1;
  // since_365: within the last 365 days of today.
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 365);
  return dateIso >= cutoff.toISOString().slice(0, 10);
}

export default function ReconcileHistoryPage() {
  const can = useCan();
  const [bizId] = useActiveBusinessId();
  const [reconcilableAccounts, setReconcilableAccounts] = useState<ReconcilableAccount[]>([]);
  const [accountId, setAccountId] = useState<string>('');
  const [period, setPeriod] = useState<Period>('all_time');
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bizId) return;
    api.get(`/businesses/${bizId}/bank-rec/accounts`).then(r => setReconcilableAccounts(r.data.accounts)).catch((e: unknown) => setErr(pickErr(e)));
  }, [bizId]);

  function reload() {
    if (!bizId) return;
    setErr(null);
    const params = accountId ? { account_id: accountId } : {};
    api.get(`/businesses/${bizId}/bank-rec/history`, { params })
      .then(r => setRows(r.data.reconciliations))
      .catch((e: unknown) => setErr(pickErr(e)));
  }

  useEffect(reload, [bizId, accountId]);

  const visible = useMemo(() => rows.filter(r => withinPeriod(r.statement_ending_date, period)), [rows, period]);

  async function toggleExpand(id: string) {
    if (expanded === id) { setExpanded(null); setDetail(null); return; }
    setExpanded(id); setDetail(null);
    if (!bizId) return;
    try {
      const r = await api.get(`/businesses/${bizId}/bank-rec/${id}`);
      setDetail(r.data.items);
    } catch (e: unknown) {
      setErr(pickErr(e));
    }
  }

  const latestCompletedId = rows.find(r => r.status === 'completed')?.id ?? null;

  async function undo(id: string) {
    if (!bizId) return;
    if (!confirm('Undo this reconciliation? Every transaction it cleared goes back to unreconciled.')) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/bank-rec/${id}/undo`, {});
      reload();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusy(false);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Reconcile</p>
          <h1 className="text-2xl font-semibold">Reconciliation history</h1>
        </div>
        <ReconcileNav active="history" accountId={accountId || undefined} />
      </div>

      {err && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{err}</div>}

      <div className="flex items-end gap-3">
        <div className="w-64">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Account</label>
          <AppSelect className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={accountId} onChange={e => setAccountId(e.target.value)}>
            <option value="">All accounts</option>
            {reconcilableAccounts.map(a => <option key={a.id} value={a.id} data-hint={a.category}>{a.code} {a.name}</option>)}
          </AppSelect>
        </div>
        <div className="w-56">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Report period</label>
          <AppSelect className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={period} onChange={e => setPeriod(e.target.value as Period)}>
            <option value="since_365">Since 365 days ago</option>
            <option value="this_year">This year</option>
            <option value="last_year">Last year</option>
            <option value="all_time">All time</option>
          </AppSelect>
        </div>
      </div>

      <Card className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              {!accountId && <th className="p-3 text-left">Account</th>}
              <th className="p-3 text-left">Statement ending date</th>
              <th className="p-3 text-left">Reconciled on</th>
              <th className="p-3 text-right">Ending balance</th>
              <th className="p-3 text-right">Changes</th>
              <th className="p-3 text-right">Auto adjustment</th>
              <th className="p-3 text-left">Statements</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={9} className="p-6 text-center text-muted-foreground">
                  Each time you reconcile this account, the reconciliation report is saved here. If you're ready to reconcile now, click the Reconcile tab.
                </td>
              </tr>
            )}
            {visible.map(r => (
              <Fragment key={r.id}>
                <tr className="cursor-pointer border-b hover:bg-muted/30" onClick={() => void toggleExpand(r.id)}>
                  {!accountId && <td className="p-3">{r.account_code} {r.account_name}</td>}
                  <td className="p-3 whitespace-nowrap">{fmtShortDate(r.statement_ending_date)}</td>
                  <td className="p-3 whitespace-nowrap">{r.completed_at ? fmtShortDate(r.completed_at.slice(0, 10)) : '—'}</td>
                  <td className="p-3 text-right font-mono">{fmtMoney(r.statement_ending_balance)}</td>
                  <td className="p-3 text-right">{r.changes > 0 ? r.changes : <span className="text-muted-foreground">—</span>}</td>
                  <td className="p-3 text-right font-mono">{r.auto_adjustment !== null ? fmtMoney(r.auto_adjustment) : <span className="text-muted-foreground">—</span>}</td>
                  <td className="p-3 text-muted-foreground">—</td>
                  <td className="p-3 capitalize">{r.status}</td>
                  <td className="p-3 text-right">
                    {r.status === 'completed' && r.id === latestCompletedId && (
                      <Button
                        variant="outline" size="sm" disabled={busy}
                        {...hideUnless(can.admin)}
                        onClick={ev => { ev.stopPropagation(); void undo(r.id); }}
                      >
                        Undo
                      </Button>
                    )}
                  </td>
                </tr>
                {expanded === r.id && (
                  <tr>
                    <td colSpan={9} className="bg-muted/20 p-3">
                      {!detail ? (
                        <div className="text-sm text-muted-foreground">Loading…</div>
                      ) : (
                        <CardContent className="p-0">
                          <div className="mb-2 text-xs text-muted-foreground">{r.items_cleared} transaction{r.items_cleared === 1 ? '' : 's'} cleared</div>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-muted-foreground">
                                <th className="p-1">Date</th><th className="p-1">Type</th><th className="p-1">Description</th><th className="p-1 text-right">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.map(i => (
                                <tr key={`${i.transaction_type}:${i.transaction_id}`}>
                                  <td className="p-1">{fmtShortDate(i.transaction_date)}</td>
                                  <td className="p-1 capitalize">{i.transaction_type.replace('_', ' ')}</td>
                                  <td className="p-1">{i.description ?? ''}</td>
                                  <td className="p-1 text-right font-mono">{fmtMoney(i.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </CardContent>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Card>

      <Link to="/accounting/reconcile" className="text-sm text-primary underline">Back to Reconcile</Link>
    </div>
  );
}
