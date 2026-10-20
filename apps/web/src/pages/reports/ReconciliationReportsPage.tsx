import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
import { ErrorState } from '@/components/ui/ErrorState';
import { pickErr } from '@/lib/apiErrors';

type HistoryRow = {
  id: string;
  account_code: string | null;
  account_name: string | null;
  category: string;
  statement_ending_date: string;
  completed_at: string | null;
  status: 'completed' | 'cancelled';
};

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

/**
 * Item 74, 2026-10-16 follow-ups: every completed reconciliation, across
 * every account, as a fixed report — QuickBooks' "Reconciliation reports"
 * under Reports → For my accountant. Each row opens the one-reconciliation
 * report at ReconciliationReportPage; Banking → Reconcile History lists the
 * same rows for the account-at-a-time workflow, this is the report-shelf view.
 */
export default function ReconciliationReportsPage() {
  const [bizId] = useActiveBusinessId();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    if (!bizId) return;
    setErr(null);
    setRows(null);
    api.get(`/businesses/${bizId}/bank-rec/history`)
      .then(r => setRows((r.data.reconciliations as HistoryRow[]).filter(row => row.status === 'completed')))
      .catch((e: unknown) => setErr(pickErr(e)));
  }

  useEffect(load, [bizId]);

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reconciliation Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every completed reconciliation, kept exactly as it was the day it was finished.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {err ? (
            <ErrorState message={err} onRetry={load} />
          ) : !rows ? (
            <LoadingIndicator />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No reconciliations completed yet"
              hint="Finish a reconciliation under Banking → Reconcile, and its report shows up here."
            />
          ) : (
            <div className="divide-y">
              {rows.map(r => (
                <Link
                  key={r.id}
                  to={`/reports/reconciliation/${r.id}`}
                  className="group flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <div>
                    <div className="font-medium text-link">{r.account_code} {r.account_name}</div>
                    <div className="text-sm text-muted-foreground">
                      {r.category} · Statement ending {fmtShortDate(r.statement_ending_date)}
                      {r.completed_at ? ` · Reconciled ${fmtShortDate(r.completed_at.slice(0, 10))}` : ''}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
