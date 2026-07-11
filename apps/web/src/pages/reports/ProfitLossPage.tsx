import { useCallback, useEffect, useState } from 'react';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/apiClient';
import { useActiveBusinessId } from '@/lib/business';
import { useAuth } from '@/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ReportCard } from '@/components/ui/ReportCard';
import { fmtMoney, fmtSigned } from '@/lib/money';
import { fmtLongDate } from '@/lib/dates';
import { DownloadButtons } from '@/components/ui/DownloadButtons';
import { pickErr } from '@/lib/apiErrors';

type PnlLine = {
  account_id: string;
  account_code: string;
  account_name: string;
  amount: string;
};

type PnlReport = {
  period_start: string;
  period_end: string;
  revenue_lines: PnlLine[];
  revenue_total: string;
  expense_lines: PnlLine[];
  expense_total: string;
  gross_profit: string;
  operating_expenses_total: string;
  operating_income: string;
  other_expenses_total: string;
  net_income: string;
};


function monthRange(now: Date): { start: string; end: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const iso = (d: Date): string => {
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  };
  return { start: iso(first), end: iso(last) };
}

export default function ProfitLossPage() {
  const [bizId] = useActiveBusinessId();
  const { businesses } = useAuth();
  const bizName = businesses.find(b => b.id === bizId)?.name ?? '';
  const defaults = monthRange(new Date());
  const [periodStart, setPeriodStart] = useState<string>(defaults.start);
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

  if (!bizId) return <div>Pick a business.</div>;

  const dlHeaders = ['Section', 'Code', 'Account', 'Amount'];
  const dlRows = () => report ? [
    ...report.revenue_lines.map(l => ['Revenue', l.account_code, l.account_name, l.amount]),
    ['Revenue', '', 'Total Revenue', report.revenue_total],
    ...report.expense_lines.map(l => ['Expense', l.account_code, l.account_name, l.amount]),
    ['Expense', '', 'Total Expense', report.expense_total],
    ['', '', 'Net Income', report.net_income],
  ] : [];

  const netIncomeNum = report ? parseFloat(report.net_income) : 0;
  const netIncomeClass = netIncomeNum >= 0 ? 'text-emerald-600' : 'text-destructive';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Profit &amp; Loss</h1>
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
          <DownloadButtons
            headers={dlHeaders}
            getRows={dlRows}
            filename={`pnl-${periodStart}-${periodEnd}`}
            title={`Profit & Loss — ${periodStart} to ${periodEnd}`}
          />
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
                <tr className="border-b">
                  <td colSpan={2} className="p-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Income</td>
                </tr>
                {report.revenue_lines.length === 0 && (
                  <tr className="border-b"><td colSpan={2} className="p-3 pl-8 text-muted-foreground">No revenue recorded.</td></tr>
                )}
                {report.revenue_lines.map(r => (
                  <tr key={r.account_id} className="border-b hover:bg-muted/30">
                    <td className="p-3 pl-8"><span className="mr-3 font-mono text-muted-foreground">{r.account_code}</span>{r.account_name}</td>
                    <td className="p-3 text-right font-mono">{fmtMoney(r.amount)}</td>
                  </tr>
                ))}
                <tr className="border-b font-semibold">
                  <td className="p-3">Total Income</td>
                  <td className="p-3 text-right font-mono">{fmtMoney(report.revenue_total)}</td>
                </tr>

                <tr className="border-b">
                  <td colSpan={2} className="p-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Expenses</td>
                </tr>
                {report.expense_lines.length === 0 && (
                  <tr className="border-b"><td colSpan={2} className="p-3 pl-8 text-muted-foreground">No expenses recorded.</td></tr>
                )}
                {report.expense_lines.map(r => (
                  <tr key={r.account_id} className="border-b hover:bg-muted/30">
                    <td className="p-3 pl-8"><span className="mr-3 font-mono text-muted-foreground">{r.account_code}</span>{r.account_name}</td>
                    <td className="p-3 text-right font-mono">{fmtMoney(r.amount)}</td>
                  </tr>
                ))}
                <tr className="border-b font-semibold">
                  <td className="p-3">Total Expenses</td>
                  <td className="p-3 text-right font-mono">{fmtMoney(report.expense_total)}</td>
                </tr>

                <tr className="border-b">
                  <td className="p-3 text-muted-foreground">Gross profit</td>
                  <td className="p-3 text-right font-mono">{fmtSigned(report.gross_profit)}</td>
                </tr>
                <tr className="border-b">
                  <td className="p-3 text-muted-foreground">Operating income</td>
                  <td className="p-3 text-right font-mono">{fmtSigned(report.operating_income)}</td>
                </tr>
                <tr className="font-semibold">
                  <td className="p-3">NET INCOME</td>
                  <td className={`p-3 text-right font-mono ${netIncomeClass}`}>{fmtSigned(report.net_income)}</td>
                </tr>
              </tbody>
            </table>
            </div>
          </ReportCard>
        </>
      )}
    </div>
  );
}
