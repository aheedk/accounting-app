import { useCallback, useEffect, useState } from 'react';
import { FileDown, Printer } from 'lucide-react';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { pickErr } from '@/lib/apiErrors';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ReportCard } from '@/components/ui/ReportCard';
import { fmtSigned } from '@/lib/money';
import { fmtLongDate, todayLocal } from '@/lib/dates';
import { downloadAsExcel } from '@/lib/download';
import { ReportAmountLink } from '@/components/ui/ReportAmountLink';
import { generalLedgerDrilldownUrl } from '@/lib/reportDrilldown';
import { printReport } from '@/lib/reportExport';

type Line = { account_id: string; account_code: string; account_name: string; amount: string };

type Statement = {
  period_start: string;
  period_end: string;
  net_income: string;
  operating_adjustments: Line[];
  operating_total: string;
  investing: Line[];
  investing_total: string;
  financing: Line[];
  financing_total: string;
  net_change_in_cash: string;
  cash_beginning: string;
  cash_ending: string;
};

// The statement an accountant or lender expects: the change in cash for the
// period, explained as operating, investing and financing activities.
export default function StatementOfCashFlowsPage() {
  const [bizId] = useActiveBusinessId();
  const { businesses } = useAuth();
  const bizName = businesses.find(b => b.id === bizId)?.name ?? '';
  const today = todayLocal();
  const [periodStart, setPeriodStart] = useState(`${today.slice(0, 4)}-01-01`);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [report, setReport] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!bizId) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get<Statement>(`/businesses/${bizId}/reports/statement-of-cash-flows`, {
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

  if (!bizId) return <div>Pick a business.</div>;

  const subtitle = `${fmtLongDate(periodStart)} – ${fmtLongDate(periodEnd)}`;
  const dlHeaders = ['Section', 'Code', 'Account', 'Amount'];
  const dlRows = () => report ? [
    ['Operating activities', '', 'Net Income', report.net_income],
    ...report.operating_adjustments.map(l => ['Operating activities', l.account_code, l.account_name, l.amount]),
    ['Operating activities', '', 'Net cash provided by operating activities', report.operating_total],
    ...report.investing.map(l => ['Investing activities', l.account_code, l.account_name, l.amount]),
    ['Investing activities', '', 'Net cash provided by investing activities', report.investing_total],
    ...report.financing.map(l => ['Financing activities', l.account_code, l.account_name, l.amount]),
    ['Financing activities', '', 'Net cash provided by financing activities', report.financing_total],
    ['', '', 'NET CASH INCREASE FOR PERIOD', report.net_change_in_cash],
    ['', '', 'Cash at beginning of period', report.cash_beginning],
    ['', '', 'CASH AT END OF PERIOD', report.cash_ending],
  ] : [];

  function accountRows(lines: Line[], r: Statement) {
    return lines.map(l => (
      <tr key={l.account_id} className="border-b hover:bg-muted/30">
        <td className="p-3 pl-8"><span className="mr-3 font-mono text-muted-foreground">{l.account_code}</span>{l.account_name}</td>
        <td className="p-3 text-right font-mono">
          <ReportAmountLink
            to={generalLedgerDrilldownUrl({ accountId: l.account_id, periodStart: r.period_start, periodEnd: r.period_end })}
            title={`View ${l.account_name} transactions in the General Ledger`}
          >
            {fmtSigned(l.amount)}
          </ReportAmountLink>
        </td>
      </tr>
    ));
  }
  const heading = (text: string) => (
    <tr className="border-b">
      <td colSpan={2} className="p-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{text}</td>
    </tr>
  );
  const total = (label: string, amount: string, strong = false) => (
    <tr className={`border-b font-semibold ${strong ? 'bg-muted/30' : ''}`}>
      <td className="p-3">{label}</td>
      <td className="p-3 text-right font-mono">{fmtSigned(amount)}</td>
    </tr>
  );
  const none = (text: string) => (
    <tr className="border-b"><td colSpan={2} className="p-3 pl-8 text-muted-foreground">{text}</td></tr>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Statement of Cash Flows</h1>
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
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
          <div className="flex items-center gap-2">
            <div className="relative group">
              <button
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={() => downloadAsExcel(dlHeaders, dlRows(), `cash-flows-${periodStart}-${periodEnd}`, { title: 'Statement of Cash Flows', subtitle })}
                aria-label="Export to Excel"
              >
                <FileDown className="h-4 w-4" />
              </button>
              <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Export to Excel</div>
            </div>
            <div className="relative group">
              <button
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={() => printReport({ title: 'Statement of Cash Flows', subtitle, headers: dlHeaders, rows: dlRows() })}
                aria-label="Print"
              >
                <Printer className="h-4 w-4" />
              </button>
              <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">Print</div>
            </div>
          </div>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{err}</div>
      )}

      {report && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card><CardContent className="p-4">
              <div className="text-xs uppercase text-muted-foreground">Cash at beginning</div>
              <div className="mt-1 text-2xl font-semibold font-mono">{fmtSigned(report.cash_beginning)}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs uppercase text-muted-foreground">Net change in cash</div>
              <div className={`mt-1 text-2xl font-semibold font-mono ${parseFloat(report.net_change_in_cash) >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                {fmtSigned(report.net_change_in_cash)}
              </div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs uppercase text-muted-foreground">Cash at end</div>
              <div className="mt-1 text-2xl font-semibold font-mono">{fmtSigned(report.cash_ending)}</div>
            </CardContent></Card>
          </div>

          <ReportCard companyName={bizName} title="Statement of Cash Flows" subtitle={`${fmtLongDate(report.period_start)} – ${fmtLongDate(report.period_end)}`}>
            <div className="w-full overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {heading('Operating activities')}
                  <tr className="border-b">
                    <td className="p-3 pl-8">Net Income</td>
                    <td className="p-3 text-right font-mono">{fmtSigned(report.net_income)}</td>
                  </tr>
                  {report.operating_adjustments.length > 0 && (
                    <tr className="border-b">
                      <td colSpan={2} className="p-3 pl-8 text-xs text-muted-foreground">Adjustments to reconcile Net Income to net cash provided by operations:</td>
                    </tr>
                  )}
                  {accountRows(report.operating_adjustments, report)}
                  {total('Net cash provided by operating activities', report.operating_total)}

                  {heading('Investing activities')}
                  {report.investing.length === 0 && none('No investing activity in this period.')}
                  {accountRows(report.investing, report)}
                  {total('Net cash provided by investing activities', report.investing_total)}

                  {heading('Financing activities')}
                  {report.financing.length === 0 && none('No financing activity in this period.')}
                  {accountRows(report.financing, report)}
                  {total('Net cash provided by financing activities', report.financing_total)}

                  {total('NET CASH INCREASE FOR PERIOD', report.net_change_in_cash, true)}
                  <tr className="border-b">
                    <td className="p-3">Cash at beginning of period</td>
                    <td className="p-3 text-right font-mono">{fmtSigned(report.cash_beginning)}</td>
                  </tr>
                  {total('CASH AT END OF PERIOD', report.cash_ending, true)}
                </tbody>
              </table>
            </div>
          </ReportCard>
        </>
      )}
    </div>
  );
}
