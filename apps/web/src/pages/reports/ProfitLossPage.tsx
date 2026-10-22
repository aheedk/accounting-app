import { useCallback, useEffect, useState } from 'react';
import { FileDown, Printer } from 'lucide-react';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ReportCard } from '@/components/ui/ReportCard';
import { fmtMoney, fmtSigned } from '@/lib/money';
import { fmtLongDate } from '@/lib/dates';
import { useFiscalYear } from '@/lib/fiscalYear';
import { downloadAsExcel } from '@/lib/download';
import { ReportAmountLink } from '@/components/ui/ReportAmountLink';
import { generalLedgerDrilldownUrl } from '@/lib/reportDrilldown';
import { printReport } from '@/lib/reportExport';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
import { pnlRows, type PnlReport } from './pnlLayout';

function pickErr(e: unknown): string {
  return (e as { response?: { data?: { error?: { message?: string } } } } | undefined)
    ?.response?.data?.error?.message ?? 'Failed to load report';
}

function ytdRange(now: Date): { start: string; end: string } {
  const y = now.getFullYear();
  const iso = (d: Date): string => {
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  };
  return { start: `${y}-01-01`, end: iso(now) };
}

export default function ProfitLossPage() {
  const [bizId] = useActiveBusinessId();
  const { businesses } = useAuth();
  const bizName = businesses.find(b => b.id === bizId)?.name ?? '';
  const defaults = ytdRange(new Date());
  // Year to date starts at the client's fiscal year, not always January 1.
  const fiscalYear = useFiscalYear();
  const [periodStart, setPeriodStart] = useState<string>(fiscalYear.start);
  const [periodEnd, setPeriodEnd] = useState<string>(defaults.end);
  const [report, setReport] = useState<PnlReport | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!bizId) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get<PnlReport>(`/businesses/${bizId}/reports/pnl`, {
        params: { period_start: periodStart, period_end: periodEnd },
      });
      setReport(r.data);
    } catch (e: unknown) {
      setErr(pickErr(e));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [bizId, periodStart, periodEnd]);

  useEffect(() => { void load(); }, [load]);

  const [excelBusy, setExcelBusy] = useState(false);
  if (!bizId) return <div>Pick a business.</div>;

  // No Section column: each section is a heading row of its own, as on the page.
  const dlHeaders = ['Code', 'Account', 'Amount'];
  const dlRows = () => report ? pnlRows(report).map(row => {
    switch (row.kind) {
      case 'heading': return ['', row.label, ''];
      case 'line': return [row.line.account_code, row.line.account_name, row.line.amount];
      case 'empty': return ['', row.label, ''];
      default: return ['', row.label, row.amount];
    }
  }) : [];

  const netIncomeNum = report ? parseFloat(report.net_income) : 0;
  function handleExport() {
    setExcelBusy(true);
    try { downloadAsExcel(dlHeaders, dlRows(), `pnl-${periodStart}-${periodEnd}`, { title: 'Profit & Loss', subtitle: `${fmtLongDate(periodStart)} – ${fmtLongDate(periodEnd)}` }); } finally { setExcelBusy(false); }
  }

  function handlePrint() {
    printReport({ title: 'Profit & Loss', subtitle: `${fmtLongDate(periodStart)} – ${fmtLongDate(periodEnd)}`, headers: dlHeaders, rows: dlRows() });
  }
  const netIncomeClass = netIncomeNum >= 0 ? 'text-emerald-600' : 'text-destructive';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-end gap-3">
        <h1 className="sr-only">Profit &amp; Loss</h1>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Period start</div>
            <DateInput value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
          </div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Period end</div>
            <DateInput value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
          </div>
          <Button variant="outline" onClick={() => { void load(); }} disabled={loading}>
            {loading ? <span className="inline-flex items-center gap-2"><LoadingIndicator size="sm" /> Loading…</span> : 'Refresh'}
          </Button>
          <div className="flex items-center gap-2">
            <div className="relative group">
              <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50" onClick={handleExport} disabled={excelBusy} aria-label="Export to Excel">
                <FileDown className="h-4 w-4" />
              </button>
              <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Export to Excel</div>
            </div>
            <div className="relative group">
              <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground" onClick={handlePrint} aria-label="Print">
                <Printer className="h-4 w-4" />
              </button>
              <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Print</div>
            </div>
          </div>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </div>
      )}

      {report && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs uppercase text-muted-foreground">Revenue Total</div>
                <div className="mt-1 text-2xl font-semibold font-mono">{fmtMoney(report.revenue_total)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs uppercase text-muted-foreground">Expense Total</div>
                <div className="mt-1 text-2xl font-semibold font-mono">{fmtMoney(report.expense_total)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs uppercase text-muted-foreground">Net Income</div>
                <div className={`mt-1 text-2xl font-semibold font-mono ${netIncomeClass}`}>{fmtSigned(report.net_income)}</div>
              </CardContent>
            </Card>
          </div>

          <ReportCard
            companyName={bizName}
            title="Profit and Loss"
            subtitle={`${fmtLongDate(report.period_start)} – ${fmtLongDate(report.period_end)}`}
          >
            <div className="w-full overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {pnlRows(report).map((row, i) => {
                  switch (row.kind) {
                    case 'heading':
                      return (
                        <tr key={i} className="border-b">
                          <td colSpan={2} className="p-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{row.label}</td>
                        </tr>
                      );
                    case 'empty':
                      return <tr key={i} className="border-b"><td colSpan={2} className="p-3 pl-8 text-muted-foreground">{row.label}</td></tr>;
                    case 'line':
                      return (
                        <tr key={i} className="border-b hover:bg-muted/30">
                          <td className="p-3 pl-8"><span className="mr-3 font-mono text-muted-foreground">{row.line.account_code}</span>{row.line.account_name}</td>
                          <td className="p-3 text-right font-mono">
                            <ReportAmountLink
                              to={generalLedgerDrilldownUrl({ accountId: row.line.account_id, periodStart: report.period_start, periodEnd: report.period_end })}
                              title={`View ${row.line.account_name} transactions in the General Ledger`}
                            >
                              {fmtMoney(row.line.amount)}
                            </ReportAmountLink>
                          </td>
                        </tr>
                      );
                    case 'total':
                      return (
                        <tr key={i} className="border-b font-semibold">
                          <td className="p-3">{row.label}</td>
                          <td className="p-3 text-right font-mono">{fmtMoney(row.amount)}</td>
                        </tr>
                      );
                    case 'result':
                      return (
                        <tr key={i} className={row.final ? 'font-semibold' : 'border-b font-semibold'}>
                          <td className="p-3">{row.label}</td>
                          <td className={`p-3 text-right font-mono ${row.final ? netIncomeClass : ''}`}>{fmtSigned(row.amount)}</td>
                        </tr>
                      );
                  }
                })}
              </tbody>
            </table>
            </div>
          </ReportCard>
        </>
      )}
    </div>
  );
}
