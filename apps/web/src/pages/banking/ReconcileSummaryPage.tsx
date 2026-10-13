import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileDown, Printer } from 'lucide-react';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { fmtMoney } from '@/lib/money';
import { pickErr } from '@/lib/apiErrors';
import { downloadAsExcel } from '@/lib/download';
import { printReport } from '@/lib/reportExport';
import { ReconcileNav } from './ReconcileNav';

type SummaryRow = {
  id: string;
  account_code: string | null;
  account_name: string | null;
  category: string;
  statement_ending_date: string;
  completed_at: string | null;
  status: 'completed' | 'cancelled';
};

type DetailItem = { transaction_type: string; transaction_id: string; transaction_date: string; description: string | null; amount: string; is_cleared: boolean };

function fmtShortDate(iso: string) {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

export default function ReconcileSummaryPage() {
  const [bizId] = useActiveBusinessId();
  const { businesses } = useAuth();
  const businessName = businesses.find(b => b.id === bizId)?.name ?? '';

  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!bizId) return;
    setErr(null);
    api.get(`/businesses/${bizId}/bank-rec/history`)
      .then(r => setRows((r.data.reconciliations as SummaryRow[]).filter(row => row.status === 'completed')))
      .catch((e: unknown) => setErr(pickErr(e)));
  }, [bizId]);

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

  if (!bizId) return <div>Pick a business.</div>;

  const headers = ['Account', 'Type', 'Statement Ending Date', 'Reconciled On'];
  const exportRows = rows.map(r => [
    `${r.account_code ?? ''} ${r.account_name ?? ''}`.trim(), r.category,
    fmtShortDate(r.statement_ending_date), r.completed_at ? fmtShortDate(r.completed_at.slice(0, 10)) : '',
  ]);

  const deposits = detail?.filter(i => parseFloat(i.amount) >= 0) ?? [];
  const payments = detail?.filter(i => parseFloat(i.amount) < 0) ?? [];
  const sum = (items: DetailItem[]) => items.reduce((s, i) => s + parseFloat(i.amount), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Reconcile</p>
          <h1 className="text-2xl font-semibold">Reconcile</h1>
        </div>
        <ReconcileNav active="summary" />
      </div>

      {err && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{err}</div>}

      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-start justify-between">
            <div />
            <div className="flex-1 text-center">
              <div className="text-xl font-bold">{businessName}</div>
              <div className="mt-1 text-sm font-medium tracking-wide text-muted-foreground">RECONCILIATION SUMMARY</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={() => downloadAsExcel(headers, exportRows, 'reconciliation-summary', { title: 'Reconciliation Summary' })}
                aria-label="Export to Excel"
              >
                <FileDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={() => printReport({ title: 'Reconciliation Summary', headers, rows: exportRows })}
                aria-label="Print"
              >
                <Printer className="h-4 w-4" />
              </button>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead className="border-b">
              <tr>
                <th className="p-2 text-left">Account</th>
                <th className="p-2 text-left">Type</th>
                <th className="p-2 text-left">Statement ending date</th>
                <th className="p-2 text-left">Reconciled on</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-muted-foreground">
                    Each time you reconcile this account, the reconciliation report is saved here. If you're ready to reconcile now, click the Reconcile tab.
                  </td>
                </tr>
              )}
              {rows.map(r => (
                <Fragment key={r.id}>
                  <tr className="cursor-pointer border-b hover:bg-muted/30" onClick={() => void toggleExpand(r.id)}>
                    <td className="p-2">{r.account_code} {r.account_name}</td>
                    <td className="p-2">{r.category}</td>
                    <td className="p-2 whitespace-nowrap">{fmtShortDate(r.statement_ending_date)}</td>
                    <td className="p-2 whitespace-nowrap">{r.completed_at ? fmtShortDate(r.completed_at.slice(0, 10)) : '—'}</td>
                  </tr>
                  {expanded === r.id && (
                    <tr>
                      <td colSpan={4} className="bg-muted/20 p-4">
                        {!detail ? (
                          <div className="text-sm text-muted-foreground">Loading…</div>
                        ) : (
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
                            <div className="col-span-2 border-t pt-2 text-right font-semibold">
                              Reconciled balance: {fmtMoney(sum(deposits) + sum(payments))}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Link to="/accounting/reconcile" className="text-sm text-link underline">Back to Reconcile</Link>
    </div>
  );
}
