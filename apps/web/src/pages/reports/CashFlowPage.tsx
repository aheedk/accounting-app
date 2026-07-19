import { useCallback, useEffect, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReportCard } from '@/components/ui/ReportCard';
import { useAuth } from '@/auth/useAuth';
import { fmtMoney } from '@/lib/money';
import { FileDown, Printer } from 'lucide-react';
import { downloadAsExcel } from '@/lib/download';
import { fmtLongDate } from '@/lib/dates';

type CashFlowLine = {
  entry_date: string;
  journal_entry_id: string;
  source_type: string;
  memo: string | null;
  debit: string;
  credit: string;
  net_amount: string;
  running_balance: string;
};

type CashFlowReport = {
  period_start: string;
  period_end: string;
  cash_account_id: string;
  cash_account_code: string;
  cash_account_name: string;
  beginning_balance: string;
  ending_balance: string;
  net_change: string;
  lines: CashFlowLine[];
};

type BankAccount = {
  id: string;
  name: string;
  cash_account_id: string;
  cash_account_code: string;
  cash_account_name: string;
};

function defaultPeriodStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function defaultPeriodEnd(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
}

function netClass(net: string): string {
  const v = parseFloat(net);
  if (v > 0) return 'text-emerald-600';
  if (v < 0) return 'text-rose-600';
  return '';
}

export default function CashFlowPage() {
  const [bizId] = useActiveBusinessId();
  const { businesses } = useAuth();
  const bizName = businesses.find(b => b.id === bizId)?.name ?? '';
  const [periodStart, setPeriodStart] = useState<string>(defaultPeriodStart());
  const [periodEnd, setPeriodEnd] = useState<string>(defaultPeriodEnd());
  const [cashAccountId, setCashAccountId] = useState<string>('');
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [report, setReport] = useState<CashFlowReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [excelBusy, setExcelBusy] = useState(false);

  const load = useCallback(async () => {
    if (!bizId) return;
    setLoading(true);
    setErr(null);
    try {
      const params: { period_start: string; period_end: string; cash_account_id?: string } = {
        period_start: periodStart,
        period_end: periodEnd,
      };
      if (cashAccountId) params.cash_account_id = cashAccountId;
      const r = await api.get<CashFlowReport>(`/businesses/${bizId}/reports/cash-flow`, { params });
      setReport(r.data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: { message?: string } } } } | undefined)?.response?.data?.error?.message;
      setErr(msg ?? 'Failed to load report');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [bizId, periodStart, periodEnd, cashAccountId]);

  useEffect(() => {
    if (!bizId) return;
    api.get<{ bank_accounts: BankAccount[] }>(`/businesses/${bizId}/bank-accounts`)
      .then(r => setBankAccounts(r.data.bank_accounts))
      .catch(() => setBankAccounts([]));
  }, [bizId]);

  useEffect(() => { load(); }, [load]);

  if (!bizId) return <div>Pick a business.</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Cash Flow Statement</h1>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Period start</div>
            <DateInput value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Period end</div>
            <DateInput value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Cash account</div>
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={cashAccountId}
              onChange={e => setCashAccountId(e.target.value)}
            >
              <option value="">Default</option>
              {bankAccounts.map(b => (
                <option key={b.id} value={b.cash_account_id}>
                  {b.cash_account_code} — {b.cash_account_name}
                </option>
              ))}
            </select>
          </div>
          <Button variant="outline" onClick={() => load()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>
          <div className="flex items-center gap-2">
            <div className="relative group">
              <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50" onClick={() => { if (!report) return; setExcelBusy(true); try { downloadAsExcel(['Date', 'Source', 'Memo', 'Debit', 'Credit', 'Net', 'Running Balance'], report.lines.map(l => [l.entry_date, l.source_type, l.memo ?? '', l.debit, l.credit, l.net_amount, l.running_balance]), `cash-flow-${periodStart}-${periodEnd}`); } finally { setExcelBusy(false); } }} disabled={excelBusy || !report} aria-label="Export to Excel">
                <FileDown className="h-4 w-4" />
              </button>
              <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Export to Excel</div>
            </div>
            <div className="relative group">
              <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50" onClick={() => { if (!report) return; const hdrs = ['Date', 'Source', 'Memo', 'Debit', 'Credit', 'Net', 'Running Balance']; const rowsHtml = report.lines.map(l => `<tr>${[l.entry_date, l.source_type, l.memo ?? '', l.debit, l.credit, l.net_amount, l.running_balance].map(c => `<td>${c}</td>`).join('')}</tr>`).join(''); const win = window.open('', '_blank'); if (!win) return; win.document.write(`<!DOCTYPE html><html><head><title>Cash Flow</title><style>body{font-family:Arial,sans-serif;font-size:11px;margin:24px}h2{margin-bottom:4px}p{color:#666;font-size:10px;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:5px 7px;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:4px 7px;border-bottom:1px solid #e5e5e5}</style></head><body><h2>Cash Flow — ${periodStart} to ${periodEnd}</h2><p>Generated ${new Date().toLocaleDateString()}</p><table><thead><tr>${hdrs.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print()}</script></body></html>`); win.document.close(); }} disabled={!report} aria-label="Print">
                <Printer className="h-4 w-4" />
              </button>
              <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Print</div>
            </div>
          </div>
        </div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}

      {report && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Beginning Balance</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold font-mono">{fmtMoney(report.beginning_balance)}</div></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Net Change</CardTitle></CardHeader>
              <CardContent><div className={`text-2xl font-semibold font-mono ${netClass(report.net_change)}`}>{fmtMoney(report.net_change)}</div></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">Ending Balance</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold font-mono">{fmtMoney(report.ending_balance)}</div></CardContent>
            </Card>
          </div>

          <ReportCard
            companyName={bizName}
            title={`Statement of Cash Flows — ${report.cash_account_code} ${report.cash_account_name}`}
            subtitle={`${fmtLongDate(report.period_start)} – ${fmtLongDate(report.period_end)}`}
          >
            {report.lines.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">No cash activity in this period.</div>
            ) : (
              <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm sm:min-w-0">
                <thead className="border-b">
                  <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="p-3 text-left">Date</th>
                    <th className="p-3 text-left">Source</th>
                    <th className="p-3 text-left">Memo</th>
                    <th className="p-3 text-right">Debit</th>
                    <th className="p-3 text-right">Credit</th>
                    <th className="p-3 text-right">Net</th>
                    <th className="p-3 text-right">Running balance</th>
                  </tr>
                </thead>
                <tbody>
                  {report.lines.map(l => (
                    <tr key={l.journal_entry_id} className="border-b hover:bg-muted/30">
                      <td className="p-3 whitespace-nowrap">{l.entry_date}</td>
                      <td className="p-3"><span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize">{l.source_type}</span></td>
                      <td className="p-3">{l.memo ?? ''}</td>
                      <td className="p-3 text-right font-mono">{fmtMoney(l.debit)}</td>
                      <td className="p-3 text-right font-mono">{fmtMoney(l.credit)}</td>
                      <td className={`p-3 text-right font-mono ${netClass(l.net_amount)}`}>{fmtMoney(l.net_amount)}</td>
                      <td className="p-3 text-right font-mono">{fmtMoney(l.running_balance)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td colSpan={5} className="p-3">NET CHANGE IN CASH</td>
                    <td className={`p-3 text-right font-mono ${netClass(report.net_change)}`}>{fmtMoney(report.net_change)}</td>
                    <td className="p-3 text-right font-mono">{fmtMoney(report.ending_balance)}</td>
                  </tr>
                </tbody>
              </table>
              </div>
            )}
          </ReportCard>
        </>
      )}
    </div>
  );
}
