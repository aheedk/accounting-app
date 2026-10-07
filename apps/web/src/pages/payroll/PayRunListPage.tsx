import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/EmptyState';
import { fmtMoney } from '@/lib/money';
import { humanizeCode } from '@/lib/labels';

type PayRun = {
  id: string;
  pay_period_start: string;
  pay_period_end: string;
  pay_date: string;
  status: 'draft' | 'finalized' | 'void';
  journal_entry_id: string | null;
  memo: string | null;
  gross_total: string;
  net_total: string;
  employee_count: number;
};

function fmtShortDate(iso: string) {
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return y && m && d ? `${Number(m)}/${Number(d)}/${y.slice(2)}` : iso;
}

const STATUS_PILL: Record<string, string> = {
  draft: 'bg-amber-100 text-amber-800',
  finalized: 'bg-emerald-100 text-emerald-800',
};

// Every payroll that has been run, newest first, with what it paid.
export default function PayRunListPage() {
  const [bizId] = useActiveBusinessId();
  const [runs, setRuns] = useState<PayRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!bizId) return;
    setLoading(true);
    try {
      const r = await api.get<{ pay_runs: PayRun[] }>(`/businesses/${bizId}/pay-runs`);
      setRuns(r.data.pay_runs);
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setLoading(false);
    }
  }, [bizId]);

  useEffect(() => { void load(); }, [load]);

  async function act(run: PayRun, action: 'finalize' | 'void') {
    if (!bizId) return;
    if (action === 'void' && !window.confirm('Void this pay run? Its journal entry will be reversed.')) return;
    setBusyId(run.id); setErr(null);
    try {
      await api.post(`/businesses/${bizId}/pay-runs/${run.id}/${action}`, {});
      await load();
    } catch (e: unknown) {
      setErr(pickErr(e));
    } finally {
      setBusyId(null);
    }
  }

  if (!bizId) return <div>Pick a business.</div>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Pay Runs</h1>
        <Button asChild><Link to="/payroll/pay-runs/new">Run payroll</Link></Button>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      {!loading && runs.length === 0 ? (
        <EmptyState title="No payroll has been run" hint="Run payroll to pay employees and record the taxes owed." actionLabel="Run payroll" actionTo="/payroll/pay-runs/new" />
      ) : (
        <Card><CardContent className="p-0">
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b">
                <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="p-3 text-left">Pay date</th>
                  <th className="p-3 text-left">Pay period</th>
                  <th className="p-3 text-right">Employees</th>
                  <th className="p-3 text-right">Gross pay</th>
                  <th className="p-3 text-right">Net pay</th>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
                {runs.map(run => (
                  <tr key={run.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="p-3 font-mono whitespace-nowrap">{fmtShortDate(run.pay_date)}</td>
                    <td className="p-3 whitespace-nowrap">{fmtShortDate(run.pay_period_start)} – {fmtShortDate(run.pay_period_end)}</td>
                    <td className="p-3 text-right">{run.employee_count}</td>
                    <td className="p-3 text-right font-mono">{fmtMoney(run.gross_total)}</td>
                    <td className="p-3 text-right font-mono">{fmtMoney(run.net_total)}</td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PILL[run.status] ?? 'bg-red-100 text-red-800'}`}>
                        {humanizeCode(run.status)}
                      </span>
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {run.journal_entry_id && (
                        <Link className="mr-3 text-primary hover:underline" to={`/journal/${run.journal_entry_id}`}>Journal entry</Link>
                      )}
                      {run.status === 'draft' && (
                        <button type="button" className="text-primary hover:underline disabled:opacity-50" disabled={busyId === run.id} onClick={() => void act(run, 'finalize')}>
                          Finalize
                        </button>
                      )}
                      {run.status === 'finalized' && (
                        <button type="button" className="text-destructive hover:underline disabled:opacity-50" disabled={busyId === run.id} onClick={() => void act(run, 'void')}>
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}
