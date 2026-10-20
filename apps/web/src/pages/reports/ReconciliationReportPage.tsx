import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronLeft, FileDown, Printer } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';
import { pickErr } from '@/lib/apiErrors';
import { downloadAsPdf } from '@/lib/download';
import { printReport } from '@/lib/reportExport';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
import { ErrorState } from '@/components/ui/ErrorState';

type ReconciliationDetail = {
  id: string;
  account_code: string | null;
  account_name: string | null;
  statement_beginning_balance: string;
  statement_ending_balance: string;
  beginning_balance: string;
  difference: string;
  status: string;
  statement_ending_date: string;
  completed_at: string | null;
  completed_by: string | null;
};

type DetailItem = {
  transaction_type: string; transaction_id: string; transaction_date: string;
  description: string | null; amount: string;
};

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

/**
 * Item 74, 2026-10-16 follow-ups: the fixed report for one completed
 * reconciliation — QuickBooks keeps this unchangeable once it's finished, so
 * this page is read-only by construction (no save, no tick, nothing to edit).
 * getReconciliationDetail already reads the frozen reconciliation_items
 * snapshot finishReconciliation wrote, not a live recomputation.
 */
export default function ReconciliationReportPage() {
  const { id } = useParams<{ id: string }>();
  const [bizId] = useActiveBusinessId();
  const { businesses } = useAuth();
  const businessName = businesses.find(b => b.id === bizId)?.name ?? '';

  const [reconciliation, setReconciliation] = useState<ReconciliationDetail | null>(null);
  const [category, setCategory] = useState('');
  const [items, setItems] = useState<DetailItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    if (!bizId || !id) return;
    setErr(null);
    setReconciliation(null);
    setItems(null);
    api.get(`/businesses/${bizId}/bank-rec/${id}`)
      .then(r => {
        setReconciliation(r.data.reconciliation);
        setCategory(r.data.category);
        setItems(r.data.items);
      })
      .catch((e: unknown) => setErr(pickErr(e)));
  }

  useEffect(load, [bizId, id]);

  if (!bizId) return <div>Pick a business.</div>;
  if (err) return <ErrorState message={err} onRetry={load} />;
  if (!reconciliation || !items) return <LoadingIndicator />;

  const deposits = items.filter(i => parseFloat(i.amount) >= 0);
  const payments = items.filter(i => parseFloat(i.amount) < 0);
  const sum = (list: DetailItem[]) => list.reduce((s, i) => s + parseFloat(i.amount), 0);
  const reconciledBalance = sum(deposits) + sum(payments) + parseFloat(reconciliation.beginning_balance);

  const pdfHeaders = ['Date', 'Type', 'Description', 'Amount'];
  const pdfRows = [
    ...deposits.map(i => [fmtShortDate(i.transaction_date), 'Deposit', i.description ?? '', fmtMoney(i.amount)]),
    ...payments.map(i => [fmtShortDate(i.transaction_date), 'Payment', i.description ?? '', fmtMoney(Math.abs(parseFloat(i.amount)))]),
  ];
  const subtitle = `${reconciliation.account_code ?? ''} ${reconciliation.account_name ?? ''} · Statement ending ${fmtShortDate(reconciliation.statement_ending_date)}`;

  function downloadPdf() {
    downloadAsPdf(pdfHeaders, pdfRows, 'Reconciliation Report', `reconciliation-${reconciliation!.statement_ending_date}`, {
      title: 'Reconciliation Report', subtitle,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/reports/reconciliation" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Back to Reconciliation Reports
        </Link>
      </div>

      <Card>
        <CardContent className="space-y-6 p-6">
          <div className="flex items-start justify-between">
            <div />
            <div className="flex-1 text-center">
              <div className="text-xl font-bold">{businessName}</div>
              <div className="mt-1 text-sm font-medium tracking-wide text-muted-foreground">RECONCILIATION REPORT</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {reconciliation.account_code} {reconciliation.account_name} ({category})
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={downloadPdf}
                aria-label="Download PDF"
              >
                <FileDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={() => printReport({ title: 'Reconciliation Report', subtitle, headers: pdfHeaders, rows: pdfRows })}
                aria-label="Print"
              >
                <Printer className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-y py-4 text-sm sm:grid-cols-4">
            <div><div className="text-muted-foreground">Statement ending date</div><div>{fmtShortDate(reconciliation.statement_ending_date)}</div></div>
            <div><div className="text-muted-foreground">Reconciled on</div><div>{reconciliation.completed_at ? fmtShortDate(reconciliation.completed_at.slice(0, 10)) : '—'}</div></div>
            <div><div className="text-muted-foreground">Reconciled by</div><div>{reconciliation.completed_by ?? '—'}</div></div>
            <div>
              <div className="text-muted-foreground">Difference</div>
              <div className={`font-mono font-semibold ${Math.abs(parseFloat(reconciliation.difference)) < 0.005 ? 'text-emerald-600' : 'text-destructive'}`}>
                {fmtMoney(reconciliation.difference)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 text-sm">
            <div><div className="text-muted-foreground">Beginning balance</div><div className="font-mono">{fmtMoney(reconciliation.beginning_balance)}</div></div>
            <div><div className="text-muted-foreground">Statement ending balance</div><div className="font-mono">{fmtMoney(reconciliation.statement_ending_balance)}</div></div>
            <div><div className="text-muted-foreground">Reconciled balance</div><div className="font-mono">{fmtMoney(reconciledBalance.toFixed(2))}</div></div>
          </div>

          <div className="grid grid-cols-2 gap-6 text-xs">
            <div>
              <div className="mb-1 font-semibold">Deposits and other credits</div>
              <table className="w-full">
                <tbody>
                  {deposits.map(i => (
                    <tr key={`${i.transaction_type}:${i.transaction_id}`}>
                      <td className="p-1">{fmtShortDate(i.transaction_date)}</td>
                      <td className="p-1">{i.description ?? ''}</td>
                      <td className="p-1 text-right font-mono">{fmtMoney(i.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-medium">
                    <td className="p-1" colSpan={2}>Total deposits and other credits</td>
                    <td className="p-1 text-right font-mono">{fmtMoney(sum(deposits))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div>
              <div className="mb-1 font-semibold">Payments and other debits</div>
              <table className="w-full">
                <tbody>
                  {payments.map(i => (
                    <tr key={`${i.transaction_type}:${i.transaction_id}`}>
                      <td className="p-1">{fmtShortDate(i.transaction_date)}</td>
                      <td className="p-1">{i.description ?? ''}</td>
                      <td className="p-1 text-right font-mono">{fmtMoney(Math.abs(parseFloat(i.amount)))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-medium">
                    <td className="p-1" colSpan={2}>Total payments and other debits</td>
                    <td className="p-1 text-right font-mono">{fmtMoney(Math.abs(sum(payments)))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
